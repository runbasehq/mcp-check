import {
  experimental_createMCPClient,
  streamText,
  stepCountIs,
  type LanguageModel,
} from "ai";

import { Provider } from "./base.js";
import type {
  StreamResult,
  NormalizedChunk,
  NormalizedChunkAISDK,
} from "../chunks/types.js";
import type { ProviderConfig } from "./types.js";
import type { McpServer } from "../index.js";
import { nanoid } from "../utils/nanoid.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AIProviderRegistry } from "./registry.js";

type AISDKChunk =
  | {
      type: "text-delta";
      textDelta: string;
    }
  | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      input: any;
    }
  | {
      type: "tool-call-delta";
      toolCallId: string;
      toolName: string;
      argsTextDelta: string;
    }
  | {
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      input: any;
      output: any;
      providerExecuted?: boolean;
      dynamic?: boolean;
      preliminary?: boolean;
    }
  | {
      type: "error";
      error: string;
    }
  | {
      type: "finish";
    };

/**
 * Provider for AI SDK models.
 *
 * This class handles interactions with AI models through the AI SDK.
 * It supports streaming responses, MCP tool calls,
 * and chunk normalization for the AI SDK format.
 */
export class AIProvider extends Provider {
  /** Array of tool names used during the current session */
  private usedTools: string[] = [];
  /** Record of tool calls organized by tool name */
  private toolCalls: Record<string, any[]> = {};
  /** Accumulated content from the model response */
  private content: string = "";
  /** Current model being used for the request */
  private currentModel: string | LanguageModel = "";
  /** Unique execution ID for this streaming session */
  private executionId: string = "";
  /** Provider for AI models */
  private provider: "ai-gateway" | "openai" | "openrouter" | "anthropic" =
    "ai-gateway";

  /**
   * Creates a new AISDKProvider instance.
   */
  constructor(
    mcpServer: McpServer,
    promptText: string,
    config: ProviderConfig = {},
  ) {
    super(mcpServer, promptText, config);
  }

  /**
   * Streams a response from the specified AI model.
   */
  async stream(model: string): Promise<StreamResult> {
    this.usedTools = [];
    this.toolCalls = {};
    this.content = "";
    this.currentModel = model;
    this.executionId = nanoid();

    const { model: configuredModel, providerName } =
      AIProviderRegistry.createModel(this.config, model);
    this.currentModel = configuredModel;
    this.provider = providerName;

    let mcpClient: any = null;

    try {
      const httpTransport = new StreamableHTTPClientTransport(
        new URL(this.mcpServer.url),
        {
          requestInit: {
            headers: {
              Authorization: this.mcpServer.authorizationToken!,
            },
          },
        },
      );

      mcpClient = await experimental_createMCPClient({
        transport: httpTransport,
      });

      const toolSet = await mcpClient.tools();

      const tools = {
        ...toolSet,
      };

      const response = streamText({
        model: this.currentModel,
        tools,
        stopWhen: stepCountIs(5),
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: this.promptText }],
          },
        ],
      });

      if (!this.config.silent) {
        process.stdout.write(
          JSON.stringify({
            type: "model_stream",
            model: model,
            text: `Starting ${model} execution...\n`,
          }) + "\n",
        );
      }

      for await (const chunk of response.fullStream) {
        if (chunk.type === "tool-call") {
          const toolName = chunk.toolName;
          this.usedTools.push(toolName);

          if (!this.toolCalls[toolName]) {
            this.toolCalls[toolName] = [];
          }

          this.toolCalls[toolName].push({
            args: chunk.input || {},
            result: null,
          });
        } else if (chunk.type === "tool-result") {
          const toolName = chunk.toolName;
          if (this.toolCalls[toolName] && this.toolCalls[toolName].length > 0) {
            const lastCall =
              this.toolCalls[toolName][this.toolCalls[toolName].length - 1];
            if (lastCall) {
              lastCall.result = chunk.output;
            }
          }
        }

        await this.processChunk(chunk);
      }

      return {
        usedTools: this.usedTools,
        content: this.content,
        toolCalls: this.toolCalls,
      };
    } catch (error) {
      console.error("Error in AI provider stream:", error);
      throw error;
    } finally {
      if (mcpClient) {
        try {
          await mcpClient.close();
        } catch (closeError) {
          console.error("Error closing MCP client:", closeError);
        }
      }
    }
  }

  /**
   * Normalizes AI SDK chunks into the unified NormalizedChunk format.
   */
  protected normalizeChunk(chunk: AISDKChunk): NormalizedChunkAISDK | null {
    const timestamp = Date.now();

    if (chunk.type === "error") {
      return {
        provider: "aisdk",
        executionId: this.executionId,
        timestamp,
        type: "error",
        data: { error: chunk.error || "Unknown error" },
        originalChunk: chunk,
      };
    }

    const baseChunk = {
      provider: "aisdk" as const,
      executionId: this.executionId,
      timestamp,
      originalChunk: chunk,
    };

    if (chunk.type === "text-delta") {
      return {
        ...baseChunk,
        type: "text_delta" as const,
        data: {
          textDelta: chunk.textDelta,
        },
      };
    }

    if (chunk.type === "tool-call") {
      return {
        ...baseChunk,
        type: "tool_call_start" as const,
        data: {
          toolName: chunk.toolName,
          toolId: chunk.toolCallId,
        },
      };
    }

    if (chunk.type === "tool-call-delta") {
      return {
        ...baseChunk,
        type: "tool_call_delta" as const,
        data: { toolDelta: chunk.argsTextDelta },
      };
    }

    if (chunk.type === "tool-result") {
      return {
        ...baseChunk,
        type: "tool_result" as const,
        data: {
          toolId: chunk.toolCallId,
          isError: false,
          toolResult: chunk.output,
        },
      };
    }

    if (chunk.type === "finish") {
      return {
        ...baseChunk,
        type: "block_stop" as const,
        data: {},
      };
    }

    return null;
  }

  protected async processNormalizedChunk(
    normalizedChunk: NormalizedChunk,
  ): Promise<void> {
    if (normalizedChunk.type === "tool_call_start") {
      const toolName = normalizedChunk.data.toolName;
      if (toolName) {
        if (!this.config.silent) {
          process.stdout.write(
            JSON.stringify({
              type: "model_stream",
              model: this.currentModel,
              text: `Calling tool: ${toolName}\n`,
            }) + "\n",
          );
        }
      }
    } else if (normalizedChunk.type === "tool_result") {
      const toolName = normalizedChunk.data.toolId;
      if (!this.config.silent && toolName) {
        process.stdout.write(
          JSON.stringify({
            type: "model_stream",
            model: this.currentModel,
            text: `Tool ${toolName} completed\n`,
          }) + "\n",
        );
      }
    }

    if (normalizedChunk.type === "text_delta") {
      const text = normalizedChunk.data.textDelta;
      if (text) {
        this.content += text;
      }
    }

    await super.processNormalizedChunk(normalizedChunk);
  }
}
