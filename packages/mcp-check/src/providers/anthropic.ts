import Anthropic from "@anthropic-ai/sdk";
import { Provider } from "./provider.js";
import type { StreamResult, NormalizedChunk } from "../chunks/types.js";
import type { McpServer } from "../index.js";
import type { ProviderConfig } from "./types.js";

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
export type AnthropicModel = Anthropic.Model;

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
      model: model as Anthropic.Model,
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
          authorization_token: this.mcpServer.authorizationToken,
          name: this.mcpServer.name,
          type: "url",
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
          result: null
        });
      }
      
      await this.processChunk(chunk);
    }

    const finalMessage = await stream.finalMessage();

    // Update tool call results from the final message
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
  protected normalizeChunk(chunk: any): NormalizedChunk | null {
    const timestamp = Date.now();

<<<<<<< HEAD
    // Handle content block delta (text streaming)
    if (chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta") {
      if (!this.config.silent) {
        process.stdout.write(
          JSON.stringify({
            type: "model_stream",
            model: this.currentModel,
            text: chunk.delta.text,
          }) + "\n"
        );
=======
    if (chunk.type === "content_block_delta") {
      if (chunk.delta.type === "text_delta") {
        if (!this.config.silent) {
          process.stdout.write(
            JSON.stringify({
              type: "model_stream",
              model: this.currentModel,
              text: chunk.delta.text,
            }) + "\n"
          );
        }
        return {
          type: "text_delta",
          provider: "anthropic",
          timestamp,
          data: { text: chunk.delta.text },
          originalChunk: chunk,
        };
      } else if (chunk.delta.type === "thinking_delta") {
        return {
          type: "thinking_delta",
          provider: "anthropic",
          timestamp,
          data: { thinking: chunk.delta.thinking },
          originalChunk: chunk,
        };
>>>>>>> origin/dev
      }
      return {
        type: "text_delta",
        provider: "anthropic",
        timestamp,
        data: { text: chunk.delta.text },
        originalChunk: chunk,
      };
    }

    // Handle content block start (tool call start)
    if (chunk.type === "content_block_start" && chunk.content_block?.type === "mcp_tool_use") {
      this.currentToolName = chunk.content_block.name;
      if (!this.config.silent) {
        process.stdout.write(
          JSON.stringify({
            type: "model_stream",
            model: this.currentModel,
            text: `Calling tool: ${chunk.content_block.name}\n`,
          }) + "\n"
        );
      }
      return {
        type: "tool_call_start",
        provider: "anthropic",
        timestamp,
        data: {
          toolName: chunk.content_block.name,
          toolArgs: chunk.content_block.input || {},
        },
        originalChunk: chunk,
      };
    }

    // Handle content block stop (tool call done)
    if (chunk.type === "content_block_stop" && chunk.content_block?.type === "mcp_tool_use") {
      if (!this.config.silent) {
        process.stdout.write(
          JSON.stringify({
            type: "model_stream",
            model: this.currentModel,
            text: `Tool ${this.currentToolName} completed\n`,
          }) + "\n"
        );
      }
      return {
        type: "tool_call_done",
        provider: "anthropic",
        timestamp,
        data: {
          toolName: this.currentToolName || "",
        },
        originalChunk: chunk,
      };
    }

    // Handle message start
    if (chunk.type === "message_start") {
      return {
        type: "message_start",
        provider: "anthropic",
        timestamp,
        data: { model: this.currentModel },
        originalChunk: chunk,
      };
    }

    // Handle message delta (thinking)
    if (chunk.type === "message_delta" && chunk.delta?.thinking) {
      if (!this.config.silent) {
        process.stdout.write(
          JSON.stringify({
            type: "model_stream",
            model: this.currentModel,
            text: `Thinking: ${chunk.delta.thinking}\n`,
          }) + "\n"
        );
      }
      return {
        type: "thinking_delta",
        provider: "anthropic",
        timestamp,
        data: { thinking: chunk.delta.thinking },
        originalChunk: chunk,
      };
    }

    // Handle message stop (message done)
    if (chunk.type === "message_stop") {
      return {
        type: "message_done",
        provider: "anthropic",
        timestamp,
        data: { model: this.currentModel },
        originalChunk: chunk,
      };
    }

    // Handle error
    if (chunk.type === "error") {
      return {
        type: "error",
        provider: "anthropic",
        timestamp,
        data: { error: chunk.error?.message || "Unknown error" },
        originalChunk: chunk,
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
    // Handle Anthropic-specific chunk types
    if (normalizedChunk.originalChunk?.type === "content_block_delta") {
      const handlers = this.getChunkHandlers();
      if (handlers.anthropic?.onContentBlockDelta) {
        await handlers.anthropic.onContentBlockDelta(normalizedChunk.originalChunk);
      }
    }

    if (normalizedChunk.originalChunk?.type === "content_block_start") {
      const handlers = this.getChunkHandlers();
      if (handlers.anthropic?.onContentBlockStart) {
        await handlers.anthropic.onContentBlockStart(normalizedChunk.originalChunk);
      }
    }

    if (normalizedChunk.originalChunk?.type === "content_block_stop") {
      const handlers = this.getChunkHandlers();
      if (handlers.anthropic?.onContentBlockStop) {
        await handlers.anthropic.onContentBlockStop(normalizedChunk.originalChunk);
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
