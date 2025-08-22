import OpenAI from "openai";
import type { ChatModel, Responses } from "openai/resources";
import { Provider } from "./provider.js";
import type { StreamResult, NormalizedChunk, NormalizedChunkOpenAI } from "../chunks/types.js";
import type { ProviderConfig } from "./types.js";
import type { McpServer } from "../index.js";
import { nanoid } from "../utils/nanoid.js";

type OpenAIChunk = Responses.ResponseOutputItemDoneEvent | Responses.ResponseContentPartAddedEvent | Responses.ResponseTextDeltaEvent | Responses.ResponseMcpCallArgumentsDeltaEvent | Responses.ResponseOutputItemAddedEvent | Responses.ResponseErrorEvent;

/**
 * Type alias for OpenAI model names.
 *
 * This type represents all available OpenAI model identifiers
 * that can be used with the OpenAIProvider.
 *
 * @example
 * ```typescript
 * const model: OpenAIModel = "gpt-4";
 * ```
 */
export type OpenAIModel = ChatModel;

/**
 * Provider for OpenAI models.
 *
 * This class handles interactions with OpenAI's models through their
 * official SDK. It supports streaming responses, MCP tool calls,
 * and chunk normalization for the OpenAI API format.
 *
 * @example
 * ```typescript
 * const provider = new OpenAIProvider(mcpServer, "What tools are available?", {
 *   openaiApiKey: process.env.OPENAI_API_KEY,
 *   silent: true
 * });
 *
 * const result = await provider.stream("gpt-4");
 * console.log("Content:", result.content);
 * console.log("Used tools:", result.usedTools);
 * ```
 */
export class OpenAIProvider extends Provider {
  /** OpenAI SDK client instance */
  private client: OpenAI | null;
  /** Array of tool names used during the current session */
  private usedTools: string[] = [];
  /** Record of tool calls organized by tool name */
  private toolCalls: Record<string, any[]> = {};
  /** Accumulated content from the model response */
  private content: string = "";
  /** Current model being used for the request */
  private currentModel: string = "";
  /** Unique execution ID for this streaming session */
  private executionId: string = "";

  /**
   * Creates a new OpenAIProvider instance.
   *
   * @param mcpServer - The MCP server configuration
   * @param promptText - The prompt text to send to the OpenAI model
   * @param config - Optional provider configuration including API key
   *
   * @example
   * ```typescript
   * const provider = new OpenAIProvider(mcpServer, "Hello GPT!", {
   *   openaiApiKey: process.env.OPENAI_API_KEY,
   *   silent: false,
   *   chunkHandlers: {
   *     onTextDelta: (data) => console.log("Text:", data.text)
   *   }
   * });
   * ```
   */
  constructor(
    mcpServer: McpServer,
    promptText: string,
    config: ProviderConfig = {},
  ) {
    super(mcpServer, promptText, config);
    const apiKey = config.openaiApiKey || process.env.OPENAI_API_KEY;
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  /**
   * Streams a response from the specified OpenAI model.
   *
   * This method establishes a streaming connection to the OpenAI API,
   * processes the response chunks, tracks tool usage, and returns the
   * final result with content and tool call information.
   *
   * @param model - The OpenAI model name to use (e.g., "gpt-4", "gpt-3.5-turbo")
   * @returns Promise that resolves to a StreamResult containing the response
   *
   * @throws {Error} When the OpenAI client is not initialized (missing API key)
   *
   * @example
   * ```typescript
   * const result = await provider.stream("gpt-4");
   * console.log("Final content:", result.content);
   * console.log("Tools used:", result.usedTools);
   * console.log("Tool calls:", result.toolCalls);
   * ```
   */
  async stream(model: string): Promise<StreamResult> {
    if (!this.client) {
      throw new Error(
        "OpenAI client not initialized. Please set OPENAI_API_KEY environment variable or pass openaiApiKey in config.",
      );
    }

    this.usedTools = [];
    this.toolCalls = {};
    this.content = "";
    this.currentModel = model;
    this.executionId = nanoid();

    const response = await this.client.responses.create({
      model: model.replace("openai/", "") as ChatModel,
      tools: [
        {
          type: "mcp",
          require_approval: "never",
          server_label: this.mcpServer.name,
          server_url: this.mcpServer.url,
          ...(this.mcpServer.authorizationToken && { headers: { Authorization: this.mcpServer.authorizationToken } }),
        },
      ],
      input: this.promptText,
      stream: true,
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

    for await (const chunk of response) {
      if (chunk.type === "response.output_item.added") {
        const item = chunk.item;
        if (item.type === "mcp_call") {
          const toolName = item.name;
          this.usedTools.push(toolName);

          if (!this.toolCalls[toolName]) {
            this.toolCalls[toolName] = [];
          }

          this.toolCalls[toolName].push({
            args: item.arguments || {},
            result: null,
          });
        }
      } else if (chunk.type === "response.output_item.done") {
        const item = chunk.item;
        if (item.type === "mcp_call") {
          const toolName = item.name;
          if (this.toolCalls[toolName] && this.toolCalls[toolName].length > 0) {
            const lastCall =
              this.toolCalls[toolName][this.toolCalls[toolName].length - 1];
            if (lastCall) {
              lastCall.result = (item as any).result || {
                id: `result_${Date.now()}`,
                status: "completed",
              };
            }
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
  }

  /**
   * Normalizes OpenAI-specific chunks into the unified NormalizedChunk format.
   *
   * This method converts OpenAI's streaming response chunks into a standardized
   * format that can be processed by the chunk handling system.
   *
   * @param chunk - The raw chunk from OpenAI's streaming API
   * @returns NormalizedChunk if the chunk can be normalized, null otherwise
   *
   * @example
   * ```typescript
   * const normalized = this.normalizeChunk(openaiChunk);
   * if (normalized) {
   *   console.log("Normalized chunk type:", normalized.type);
   *   console.log("Provider:", normalized.provider);
   * }
   * ```
   */
  protected normalizeChunk(chunk: OpenAIChunk): NormalizedChunk | null {
    const timestamp = Date.now();

    if (chunk.type === "error") {
      return {
        provider: "openai",
        executionId: this.executionId,
        timestamp,
        index: -1,
        type: "error",
        data: { error: chunk.message },
        originalChunk: chunk,
      };
    }

    const baseChunk: Pick<NormalizedChunkOpenAI, "provider" | "executionId" | "timestamp" | "index" | "originalChunk"> = {
      provider: "openai",
      executionId: this.executionId,
      timestamp,
      index: chunk.output_index,
      originalChunk: chunk,
    };

    // text_start
    if (chunk.type === "response.content_part.added" && chunk.part.type === "output_text") {
      return {
        ...baseChunk,
        type: "text_start",
        data: {
          text: ""
        }
      };
    }

    // text_delta
    if (chunk.type === "response.output_text.delta") {
      return {
        ...baseChunk,
        type: "text_delta",
        data: {
          textDelta: chunk.delta
        },
      }
    }

    // tool_call_start
    if (chunk.type === "response.output_item.added" && chunk.item.type === "mcp_call") {
      return {
        ...baseChunk,
        type: "tool_call_start",
        data: {
          toolName: chunk.item.name,
          toolId: chunk.item.id
        },
      }
    }

    // tool_call_delta
    if (chunk.type === "response.mcp_call_arguments.delta") {
      return {
        ...baseChunk,
        type: "tool_call_delta",
        data: { toolDelta: chunk.delta },
      };
    }

    // tool_result
    if (chunk.type === "response.output_item.done" && chunk.item.type === "mcp_call") {
      return {
        ...baseChunk,
        type: "tool_result",
        data: {
          toolId: chunk.item.id,
          isError: !chunk.item.error,
          toolResult: chunk.item.output,
        },
      }
    }

    // block_stop
    if (chunk.type === "response.output_item.done") {
      return {
        ...baseChunk,
        type: "block_stop",
        data: {},
      };
    }

    return null;
  }

  protected async processNormalizedChunk(
    normalizedChunk: NormalizedChunk,
  ): Promise<void> {
    // Backward compatibility: keep logs but avoid duplicating state updates
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

    // Provider-specific handlers are invoked centrally by the normalizer

    // Handle text delta accumulation
    if (normalizedChunk.type === "text_delta") {
      const text = normalizedChunk.data.textDelta;
      if (text) {
        this.content += text;
      }
    }

    // Delegate to parent class for standard processing
    await super.processNormalizedChunk(normalizedChunk);
  }
}
