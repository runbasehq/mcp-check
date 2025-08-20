import Anthropic from "@anthropic-ai/sdk";
import { Provider } from "./provider.js";
import type {
  StreamResult,
  NormalizedChunk,
  NormalizedChunkAnthropic,
} from "../chunks/types.js";
import type { McpServer } from "../index.js";
import type { ProviderConfig } from "./types.js";
import type {
  BetaRawContentBlockDeltaEvent,
  BetaRawContentBlockStartEvent,
  BetaRawContentBlockStopEvent,
} from "@anthropic-ai/sdk/resources/beta.js";
import type { BetaRateLimitError } from "@anthropic-ai/sdk/resources";

type AnthropicChunk =
  | BetaRawContentBlockDeltaEvent
  | BetaRawContentBlockStartEvent
  | BetaRawContentBlockStopEvent
  | BetaRateLimitError;
/**
 * Type alias for Anthropic model names.
 *
 * This type represents all available Anthropic Claude model identifiers
 * that can be used with the AnthropicProvider.
 *
 * @example
 * ```typescript
 * const model: AnthropicModel = "claude-3-haiku-20240307";
 * ```
 */

type OnlyLiteralStrings<T> = T extends string
  ? string extends T
    ? never
    : T
  : never;

export type AnthropicModel = OnlyLiteralStrings<Anthropic.Model>;

/**
 * Provider for Anthropic Claude models.
 *
 * This class handles interactions with Anthropic's Claude models through
 * their official SDK. It supports streaming responses, MCP tool calls,
 * and chunk normalization for the Anthropic API format.
 *
 * @example
 * ```typescript
 * const provider = new AnthropicProvider(mcpServer, "What tools are available?", {
 *   anthropicApiKey: process.env.ANTHROPIC_API_KEY,
 *   silent: true
 * });
 *
 * const result = await provider.stream("claude-3-haiku-20240307");
 * console.log("Content:", result.content);
 * console.log("Used tools:", result.usedTools);
 * ```
 */
export class AnthropicProvider extends Provider {
  /** Anthropic SDK client instance */
  private client: Anthropic | null;
  /** Currently active tool name during tool call processing */
  private currentToolName: string | null = null;
  /** Array of tool names used during the current session */
  private usedTools: string[] = [];
  /** Record of tool calls organized by tool name */
  private toolCalls: Record<string, any[]> = {};
  /** Accumulated content from the model response */
  private content: string = "";
  /** Current model being used for the request */
  private currentModel: string = "";

  /**
   * Creates a new AnthropicProvider instance.
   *
   * @param mcpServer - The MCP server configuration
   * @param promptText - The prompt text to send to Claude
   * @param config - Optional provider configuration including API key
   *
   * @example
   * ```typescript
   * const provider = new AnthropicProvider(mcpServer, "Hello Claude!", {
   *   anthropicApiKey: process.env.ANTHROPIC_API_KEY,
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
    const apiKey = config.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  /**
   * Streams a response from the specified Anthropic Claude model.
   *
   * This method establishes a streaming connection to the Anthropic API,
   * processes the response chunks, tracks tool usage, and returns the
   * final result with content and tool call information.
   *
   * @param model - The Anthropic model name to use (e.g., "claude-3-haiku-20240307")
   * @returns Promise that resolves to a StreamResult containing the response
   *
   * @throws {Error} When the Anthropic client is not initialized (missing API key)
   *
   * @example
   * ```typescript
   * const result = await provider.stream("claude-3-sonnet-20240229");
   * console.log("Final content:", result.content);
   * console.log("Tools used:", result.usedTools);
   * console.log("Tool calls:", result.toolCalls);
   * ```
   */
  async stream(model: string): Promise<StreamResult> {
    if (!this.client) {
      throw new Error(
        "Anthropic client not initialized. Please set ANTHROPIC_API_KEY environment variable or pass anthropicApiKey in config.",
      );
    }

    this.usedTools = [];
    this.toolCalls = {};
    this.currentToolName = null;
    this.content = "";
    this.currentModel = model;

    const stream = this.client.beta.messages.stream({
      model: model.replace("anthropic/", "") as Anthropic.Model,
      //TODO: Use max_tokens from config
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: this.promptText,
        },
      ],
      mcp_servers: [
        {
          url: this.mcpServer.url,
          name: this.mcpServer.name,
          type: "url",
          ...(this.mcpServer.authorizationToken && {
            authorization_token: this.mcpServer.authorizationToken,
          }),
        },
      ],
      betas: ["mcp-client-2025-04-04"],
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

    for await (const chunk of stream) {
      if (
        chunk.type === "content_block_start" &&
        chunk.content_block.type === "mcp_tool_use"
      ) {
        const toolName = chunk.content_block.name;
        this.usedTools.push(toolName);

        if (!this.toolCalls[toolName]) {
          this.toolCalls[toolName] = [];
        }

        this.toolCalls[toolName].push({
          args: chunk.content_block.input || {},
          result: null,
        });
      }

      await this.processChunk(chunk);
    }

    const finalMessage = await stream.finalMessage();

    //TODO: Implement this with normalized chunks and avoid provider-specific logic
    if (finalMessage.content) {
      for (const block of finalMessage.content) {
        if (block.type === "mcp_tool_result") {
          // Find the tool call by matching with the order of tool executions
          const toolNames = Object.keys(this.toolCalls);
          for (const toolName of toolNames) {
            const toolCalls = this.toolCalls[toolName];
            for (const toolCall of toolCalls) {
              if (!toolCall.result) {
                toolCall.result = block.content;
                break;
              }
            }
          }
        }
      }
    }

    return {
      content: this.content,
      usedTools: this.usedTools,
      toolCalls: this.toolCalls,
    };
  }

  /**
   * Normalizes Anthropic-specific chunks into the unified NormalizedChunk format.
   *
   * This method converts Anthropic's streaming response chunks into a standardized
   * format that can be processed by the chunk handling system.
   *
   * @param chunk - The raw chunk from Anthropic's streaming API
   * @returns NormalizedChunk if the chunk can be normalized, null otherwise
   *
   * @example
   * ```typescript
   * const normalized = this.normalizeChunk(anthropicChunk);
   * if (normalized) {
   *   console.log("Normalized chunk type:", normalized.type);
   *   console.log("Provider:", normalized.provider);
   * }
   * ```
   */
  protected normalizeChunk(chunk: AnthropicChunk): NormalizedChunk | null {
    const timestamp = Date.now();

    if (chunk.type === "rate_limit_error") {
      return {
        provider: "anthropic",
        timestamp,
        index: -1,
        type: "error",
        data: { error: chunk.message },
        originalChunk: chunk,
      };
    }

    const baseChunk: Pick<
      NormalizedChunkAnthropic,
      "provider" | "timestamp" | "index" | "originalChunk"
    > = {
      provider: "anthropic",
      timestamp,
      index: chunk.index,
      originalChunk: chunk,
    };

    if (
      chunk.type === "content_block_start" &&
      chunk.content_block.type === "text"
    ) {
      return {
        ...baseChunk,
        type: "text_start",
        data: {
          text: chunk.content_block.text,
        },
      };
    }

    if (
      chunk.type === "content_block_delta" &&
      chunk.delta.type === "text_delta"
    ) {
      if (!this.config.silent) {
        process.stdout.write(
          JSON.stringify({
            type: "model_stream",
            model: this.currentModel,
            text: chunk.delta.text,
          }) + "\n",
        );
      }
      return {
        ...baseChunk,
        type: "text_delta",
        data: { textDelta: chunk.delta.text },
      };
    }

    if (
      chunk.type === "content_block_start" &&
      chunk.content_block.type === "mcp_tool_use"
    ) {
      this.currentToolName = chunk.content_block.name;
      if (!this.config.silent) {
        process.stdout.write(
          JSON.stringify({
            type: "model_stream",
            model: this.currentModel,
            text: `Calling tool: ${chunk.content_block.name}\n`,
          }) + "\n",
        );
      }
      return {
        ...baseChunk,
        type: "tool_call_start",
        data: {
          toolName: chunk.content_block.name,
          toolId: chunk.content_block.id,
        },
      };
    }

    if (
      chunk.type === "content_block_delta" &&
      chunk.delta.type === "input_json_delta"
    ) {
      return {
        ...baseChunk,
        type: "tool_call_delta",
        data: {
          toolDelta: chunk.delta.partial_json,
        },
      };
    }

    if (
      chunk.type === "content_block_start" &&
      chunk.content_block.type === "mcp_tool_result"
    ) {
      return {
        ...baseChunk,
        type: "tool_result",
        data: {
          toolId: chunk.content_block.tool_use_id,
          isError: chunk.content_block.is_error,
          toolResult: chunk.content_block.content,
        },
      };
    }

    if (chunk.type === "content_block_stop") {
      if (!this.config.silent) {
        process.stdout.write(
          JSON.stringify({
            type: "model_stream",
            model: this.currentModel,
            text: `Tool ${this.currentToolName} completed\n`,
          }) + "\n",
        );
      }
      return {
        ...baseChunk,
        type: "block_stop",
        data: {},
      };
    }

    return null;
  }

  /**
   * Processes a normalized chunk with provider-specific handling.
   *
   * This method extends the base chunk processing to include Anthropic-specific
   * chunk handling before delegating to the parent class.
   *
   * @param normalizedChunk - The normalized chunk to process
   * @returns Promise that resolves when processing is complete
   *
   * @example
   * ```typescript
   * const normalized = this.normalizeChunk(rawChunk);
   * if (normalized) {
   *   await this.processNormalizedChunk(normalized);
   * }
   * ```
   */
  protected async processNormalizedChunk(
    normalizedChunk: NormalizedChunk,
  ): Promise<void> {
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
