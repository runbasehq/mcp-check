import OpenAI from "openai";
import type { ChatModel } from "openai/resources";
import { Provider } from "./provider.js";
import type { StreamResult, NormalizedChunk } from "../chunks/types.js";
import type { ProviderConfig } from "./types.js";
import type { McpServer } from "../index.js";

interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    properties: Record<string, any>;
    required: string[];
  };
}

/**
 * Type alias for OpenRouter model names.
 *
 * This type represents all available OpenRouter model identifiers
 * that can be used with the OpenRouterProvider.
 *
 * @example
 * ```typescript
 * const model: OpenRouterModel = "deepseek/deepseek-r1-0528:free";
 * ```
 */
export type OpenRouterModel =
  | "z-ai/glm-4.5-air:free"
  | "qwen/qwen3-coder:free"
  | "moonshotai/kimi-k2:free"
  | "mistralai/mistral-small-3.2-24b-instruct:free"
  | "mistralai/devstral-small-2505:free"
  | "qwen/qwen3-4b:free"
  | "qwen/qwen3-235b-a22b:free"
  | "google/gemini-2.5-pro-exp-03-25"
  | "deepseek/deepseek-chat-v3-0324:free"
  | "mistralai/mistral-small-3.1-24b-instruct:free"
  | "google/gemini-2.0-flash-exp:free"
  | "meta-llama/llama-3.3-70b-instruct:free"
  | "mistralai/mistral-7b-instruct:free";
/**
 * Provider for OpenRouter models.
 *
 * This class handles interactions with OpenRouter's models through their
 * API. It supports streaming responses, MCP tool calls,
 * and chunk normalization for the OpenRouter API format.
 *
 * @example
 * ```typescript
 * const provider = new OpenRouterProvider(mcpServer, "What tools are available?", {
 *   openrouterApiKey: process.env.OPENROUTER_API_KEY,
 *   silent: true
 * });
 *
 * const result = await provider.stream("moonshotai/kimi-k2:free");
 * console.log("Content:", result.content);
 * console.log("Used tools:", result.usedTools);
 * ```
 */
export class OpenRouterProvider extends Provider {
  /** OpenRouter SDK client instance */
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
   * Creates a new OpenRouterProvider instance.
   *
   * @param mcpServer - The MCP server configuration
   * @param promptText - The prompt text to send to the OpenRouter model
   * @param config - Optional provider configuration including API key
   *
   * @example
   * ```typescript
   * const provider = new OpenRouterProvider(mcpServer, "Hello OpenRouter!", {
   *   openrouterApiKey: process.env.OPENROUTER_API_KEY,
   *   silent: false,
   *   chunkHandlers: {
   *     onTextDelta: (data) => console.log("Text:", data.text)
   *   }
   * });
   * ```
   */
  constructor(mcpServer: McpServer, promptText: string, config: ProviderConfig = {}) {
    super(mcpServer, promptText, config);
    const apiKey = config.openrouterApiKey || process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      throw new Error(
        "OpenRouter API key is required. Set OPENROUTER_API_KEY environment variable or pass openrouterApiKey in config."
      );
    }

    this.client = new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
    });
  }

  /**
   * Fetches available tools from the MCP server.
   *
   * @returns Promise that resolves to an array of MCP tools
   */
  private async fetchMCPTools(): Promise<MCPTool[]> {
    try {
      const response = await fetch(this.mcpServer.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: this.mcpServer.authorizationToken || "",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "1",
          method: "tools/list",
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      if (result.error) {
        throw new Error(`MCP Error: ${result.error.message}`);
      }

      return result.result?.tools || [];
    } catch (error) {
      console.error("Error fetching MCP tools:", error);
      return [];
    }
  }

  /**
   * Streams a response from the specified OpenRouter model.
   *
   * This method establishes a streaming connection to the OpenRouter API,
   * processes the response chunks, tracks tool usage, and returns the
   * final result with content and tool call information.
   *
   * @param model - The OpenRouter model name to use (e.g., "moonshotai/kimi-k2:free", "mistralai/mistral-7b-instruct:free")
   * @returns Promise that resolves to a StreamResult containing the response
   *
   * @throws {Error} When the OpenRouter client is not initialized (missing API key)
   *
   * @example
   * ```typescript
   * const result = await provider.stream("moonshotai/kimi-k2:free");
   * console.log("Final content:", result.content);
   * console.log("Tools used:", result.usedTools);
   * console.log("Tool calls:", result.toolCalls);
   * ```
   */
  async stream(model: OpenRouterModel | string): Promise<StreamResult> {
    if (!this.client) {
      throw new Error(
        "OpenRouter client not initialized. Please set OPENROUTER_API_KEY environment variable or pass openrouterApiKey in config."
      );
    }

    this.usedTools = [];
    this.toolCalls = {};
    this.content = "";
    this.currentModel = model;

    // First, fetch the available tools from the MCP server
    const availableTools = await this.fetchMCPTools();

    // Convert MCP tools to OpenAI function format
    const openaiTools = availableTools.map((tool: MCPTool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "object" as const,
          properties: tool.inputSchema.properties,
          required: tool.inputSchema.required,
        },
      },
    }));

    const response = await this.client.chat.completions.create({
      model: model.replace("openrouter/", "") as ChatModel,
      messages: [
        {
          role: "user",
          content: this.promptText,
        },
      ],
      tools: openaiTools,
      stream: true,
    });

    if (!this.config.silent) {
      process.stdout.write(
        JSON.stringify({
          type: "model_stream",
          model: model,
          text: `Starting ${model} execution...\n`,
        }) + "\n"
      );
    }

    for await (const chunk of response) {
      // Handle tool calls
      if (chunk.choices[0]?.delta?.tool_calls) {
        const toolCall = chunk.choices[0].delta.tool_calls[0];
        if (toolCall?.function?.name) {
          const toolName = toolCall.function.name;
          if (!this.usedTools.includes(toolName)) {
            this.usedTools.push(toolName);
          }

          if (!this.toolCalls[toolName]) {
            this.toolCalls[toolName] = [];
          }

          // Initialize tool call if not exists
          if (this.toolCalls[toolName].length === 0) {
            this.toolCalls[toolName].push({
              args: {},
              result: null,
            });
          }

          // Update arguments
          const currentCall = this.toolCalls[toolName][this.toolCalls[toolName].length - 1];
          if (currentCall && toolCall.function.arguments) {
            try {
              const args = JSON.parse(toolCall.function.arguments);
              currentCall.args = { ...currentCall.args, ...args };
            } catch (e) {
              // Partial arguments, continue accumulating
            }
          }
        }
      }

      // Handle content
      if (chunk.choices[0]?.delta?.content) {
        this.content += chunk.choices[0].delta.content;
      }

      if (!this.config.silent) {
        console.log(chunk);
      }

      await this.processChunk(chunk);
    }

    return { usedTools: this.usedTools, content: this.content, toolCalls: this.toolCalls };
  }

  /**
   * Normalizes OpenRouter-specific chunks into the unified NormalizedChunk format.
   *
   * This method converts OpenRouter's streaming response chunks into a standardized
   * format that can be processed by the chunk handling system.
   *
   * @param chunk - The raw chunk from OpenRouter's streaming API
   * @returns NormalizedChunk if the chunk can be normalized, null otherwise
   *
   * @example
   * ```typescript
   * const normalized = this.normalizeChunk(openrouterChunk);
   * if (normalized) {
   *   console.log("Normalized chunk type:", normalized.type);
   *   console.log("Provider:", normalized.provider);
   * }
   * ```
   */
  protected normalizeChunk(chunk: any): NormalizedChunk | null {
    const timestamp = Date.now();

    // Handle tool calls
    if (chunk.choices[0]?.delta?.tool_calls) {
      const toolCall = chunk.choices[0].delta.tool_calls[0];
      if (toolCall?.function?.name) {
        return {
          type: "tool_call_start",
          provider: "openrouter",
          timestamp,
          data: {
            toolName: toolCall.function.name,
            toolArgs: toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {},
          },
          originalChunk: chunk,
        };
      }
    }

    // Handle text content
    if (chunk.choices[0]?.delta?.content) {
      return {
        type: "text_delta",
        provider: "openrouter",
        timestamp,
        data: { text: chunk.choices[0].delta.content },
        originalChunk: chunk,
      };
    }

    // Handle message start (first chunk)
    if (chunk.choices[0]?.delta && Object.keys(chunk.choices[0].delta).length > 0) {
      return {
        type: "message_start",
        provider: "openrouter",
        timestamp,
        data: { model: this.currentModel },
        originalChunk: chunk,
      };
    }

    // Handle message done (last chunk with finish_reason)
    if (chunk.choices[0]?.finish_reason) {
      return {
        type: "message_done",
        provider: "openrouter",
        timestamp,
        data: { model: this.currentModel },
        originalChunk: chunk,
      };
    }

    return null;
  }

  protected async processNormalizedChunk(normalizedChunk: NormalizedChunk): Promise<void> {
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
            }) + "\n"
          );
        }
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
