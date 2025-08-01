import OpenAI from "openai";
import type { ChatModel } from "openai/resources";
import { Provider } from "./provider.js";
import type { StreamResult, NormalizedChunk } from "../chunks/types.js";
import type { ProviderConfig } from "./types.js";
import type { McpServer } from "../index.js";

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
  constructor(mcpServer: McpServer, promptText: string, config: ProviderConfig = {}) {
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
        "OpenAI client not initialized. Please set OPENAI_API_KEY environment variable or pass openaiApiKey in config."
      );
    }

    this.usedTools = [];
    this.toolCalls = {};
    this.content = "";
    this.currentModel = model;

    const response = await this.client.responses.create({
      model: model as ChatModel,
      tools: [
        {
          type: "mcp",
          require_approval: "never",
          server_label: this.mcpServer.name,
          server_url: this.mcpServer.url,
          headers: {
            Authorization: this.mcpServer.authorizationToken || "",
          },
        },
      ],
      input: this.promptText,
      stream: true,
    });

    let content = "";

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
            const lastCall = this.toolCalls[toolName][this.toolCalls[toolName].length - 1];
            if (lastCall) {
              lastCall.result = (item as any).result || { id: `result_${Date.now()}`, status: "completed" };
            }
          }
        }
      }

      await this.processChunk(chunk);
    }

    return { usedTools: this.usedTools, content: this.content, toolCalls: this.toolCalls };
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
  protected normalizeChunk(chunk: any): NormalizedChunk | null {
    const timestamp = Date.now();

    // Handle response output item added (tool call start)
    if (chunk.type === "response.output_item.added") {
      const item = chunk.item;
      if (item.type === "mcp_call") {
        return {
          type: "tool_call_start",
          provider: "openai",
          timestamp,
          data: {
            toolName: item.name,
            toolArgs: item.arguments || {},
          },
          originalChunk: chunk,
        };
      }
    }

    // Handle response output item done (tool call done)
    if (chunk.type === "response.output_item.done") {
      const item = chunk.item;
      if (item.type === "mcp_call") {
        return {
          type: "tool_call_done",
          provider: "openai",
          timestamp,
          data: {
            toolName: item.name,
            toolResult: (item as any).result,
          },
          originalChunk: chunk,
        };
      }
    }

    // Handle response output item added (text content)
    if (chunk.type === "response.output_item.added") {
      const item = chunk.item;
      if (item.type === "text") {
        return {
          type: "text_delta",
          provider: "openai",
          timestamp,
          data: { text: item.text },
          originalChunk: chunk,
        };
      }
    }

    // Handle response start
    if (chunk.type === "response.start") {
      return {
        type: "message_start",
        provider: "openai",
        timestamp,
        data: { model: this.currentModel },
        originalChunk: chunk,
      };
    }

    // Handle response done
    if (chunk.type === "response.done") {
      return {
        type: "message_done",
        provider: "openai",
        timestamp,
        data: { model: this.currentModel },
        originalChunk: chunk,
      };
    }

    // Handle error
    if (chunk.type === "error") {
      return {
        type: "error",
        provider: "openai",
        timestamp,
        data: { error: chunk.error?.message || "Unknown error" },
        originalChunk: chunk,
      };
    }

    return null;
  }

  protected async processNormalizedChunk(
    normalizedChunk: NormalizedChunk,
  ): Promise<void> {
    await super.processNormalizedChunk(normalizedChunk);

    // Backward compatibility
    if (normalizedChunk.type === "tool_call_start") {
      const toolName = normalizedChunk.data.toolName;
      if (toolName) {
        this.usedTools.push(toolName);

        if (!this.config.silent) {
          process.stdout.write(
            JSON.stringify({
              type: "model_stream",
              model: this.currentModel,
              text: `Calling tool: ${toolName}\n`,
            }) + "\n"
          );
        }

        if (!this.toolCalls[toolName]) {
          this.toolCalls[toolName] = [];
        }

        this.toolCalls[toolName].push({
          args: normalizedChunk.data.toolArgs || {},
          result: null,
        });
      }
    } else if (normalizedChunk.type === "tool_call_done") {
      const toolName = normalizedChunk.data.toolName;
      if (
        toolName &&
        this.toolCalls[toolName] &&
        this.toolCalls[toolName].length > 0
      ) {
        const lastCall =
          this.toolCalls[toolName][this.toolCalls[toolName].length - 1];
        if (lastCall) {
          lastCall.result = { id: `result_${Date.now()}`, status: "completed" };

          if (!this.config.silent) {
            process.stdout.write(
              JSON.stringify({
                type: "model_stream",
                model: this.currentModel,
                text: `Tool ${toolName} completed\n`,
              }) + "\n"
            );
          }
        }
      }
    }

    // Handle OpenAI-specific chunk types
    if (normalizedChunk.originalChunk?.type === "response.output_item.added") {
      const handlers = this.getChunkHandlers();
      if (handlers.openai?.onResponseOutputItemAdded) {
        await handlers.openai.onResponseOutputItemAdded(normalizedChunk.originalChunk);
      }
    }

    if (normalizedChunk.originalChunk?.type === "response.output_item.done") {
      const handlers = this.getChunkHandlers();
      if (handlers.openai?.onResponseOutputItemDone) {
        await handlers.openai.onResponseOutputItemDone(normalizedChunk.originalChunk);
      }
    }

    // Handle text delta accumulation
    if (normalizedChunk.type === "text_delta") {
      const text = normalizedChunk.data.text;
      if (text) {
        this.content += text;
      }
    }

    // Delegate to parent class for standard processing
    await super.processNormalizedChunk(normalizedChunk);
  }
}
