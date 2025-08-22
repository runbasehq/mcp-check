import OpenAI from "openai";
import { Provider } from "./provider.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  ListToolsResult,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

import type { ProviderConfig } from "./types.js";
import type { McpServer } from "../index.js";
import type {
  StreamResult,
  NormalizedChunk,
  NormalizedChunkOpenAI,
} from "../chunks/types.js";
import { nanoid } from "../utils/nanoid.js";

/**
 * Type alias for OpenRouter model names.
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

type AccToolCall = {
  id?: string;
  type?: "function";
  function?: { name?: string; arguments?: string };
};

/**
 * Provider for OpenRouter models.
 *
 * This class handles interactions with OpenRouter models through their
 * official SDK. It supports streaming responses, MCP tool calls,
 * and chunk normalization for the OpenAI API format.
 *
 * @example
 * ```typescript
 * const provider = new OpenRouterProvider(mcpServer, "What tools are available?", {
 *   openrouterApiKey: process.env.OPENROUTER_API_KEY,
 *   silent: true
 * });
 *
 * const result = await provider.stream("z-ai/glm-4.5-air:free");
 * console.log("Content:", result.content);
 * console.log("Used tools:", result.usedTools);
 * ```
 */
export class OpenRouterProvider extends Provider {
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
   * Creates a new OpenRouterProvider instance.
   *
   * @param mcpServer - The MCP server configuration
   * @param promptText - The prompt text to send to the OpenRouter model
   * @param config - Optional provider configuration including API key
   *
   * @example
   * ```typescript
   * const provider = new OpenRouterProvider(mcpServer, "Hello!", {
   *   openrouterApiKey: process.env.OPENROUTER_API_KEY,
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
    const apiKey = config.openrouterApiKey || process.env.OPENROUTER_API_KEY;
    if (!apiKey)
      throw new Error(
        "Please set OPENROUTER_API_KEY environment variable or pass openrouterApiKey in config.",
      );
    this.client = apiKey
      ? new OpenAI({
          apiKey,
          baseURL: "https://openrouter.ai/api/v1",
          timeout: 60_000,
        })
      : null;
  }

  /**
   * Streams a response from the specified OpenRouter model.
   *
   * This method establishes a streaming connection to the OpenRouter API,
   * processes the response chunks, tracks tool usage, and returns the
   * final result with content and tool call information.
   *
   * @param model - The OpenRouter model name to use (e.g., "z-ai/glm-4.5-air:free")
   * @returns Promise that resolves to a StreamResult containing the response
   *
   * @throws {Error} When the OpenRouter client is not initialized (missing API key)
   *
   * @example
   * ```typescript
   * const result = await provider.stream("z-ai/glm-4.5-air:free");
   * console.log("Final content:", result.content);
   * console.log("Tools used:", result.usedTools);
   * console.log("Tool calls:", result.toolCalls);
   * ```
   */
  async stream(model: string): Promise<StreamResult> {
    if (!this.client) throw new Error("OpenRouter client not initialized.");

    this.usedTools = [];
    this.toolCalls = {};
    this.content = "";
    this.currentModel = model;
    this.executionId = nanoid();

    const mcp = await this.connectMcp();
    const tools = await this.listAndConvertTools(mcp);

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "user", content: this.promptText },
    ];

    const MAX_ITERATIONS = 10000;

    for (let round = 1; round <= MAX_ITERATIONS; round++) {
      const acc = { content: "", tool_calls: [] as AccToolCall[] };

      const stream = await this.withBackoff(
        () =>
          this.client!.chat.completions.create({
            model: model.replace("openrouter/", ""),
            messages,
            tools,
            tool_choice: "auto",
            temperature: 0,
            stream: true,
          }),
        { retries: 5, base: 600 },
      );

      for await (const chunk of stream) {
        const delta = chunk?.choices?.[0]?.delta;
        if (delta) {
          this.accumulateDelta(acc, delta);

          if (delta.content && !this.config.silent) {
            process.stdout.write(
              JSON.stringify({
                type: "model_stream",
                model: this.currentModel,
                text: delta.content,
              }) + "\n",
            );
          }
        }
      }

      const tcalls = acc.tool_calls ?? [];

      if (!tcalls.length) {
        await mcp.close();
        return {
          usedTools: this.usedTools,
          content: this.content || acc.content,
          toolCalls: this.toolCalls,
        };
      }

      const assistantWithCalls = {
        role: "assistant" as const,
        content: acc.content || "",
        tool_calls: tcalls.map((t, i) => ({
          id: t.id ?? `call_${i}`,
          type: "function" as const,
          function: {
            name: t.function?.name ?? "",
            arguments: t.function?.arguments ?? "{}",
          },
        })),
      };
      if (!this.config.silent && assistantWithCalls) {
        process.stdout.write(
          "[ASSISTANT tool_calls]" +
            JSON.stringify(assistantWithCalls, null, 2),
        );
      }
      messages.push(assistantWithCalls as any);

      for (const [i, call] of tcalls.entries()) {
        const id = call.id ?? `call_${i}`;
        const name = call.function?.name ?? "";
        const argsStr = call.function?.arguments ?? "{}";
        let args: Record<string, any> = {};
        try {
          args = JSON.parse(argsStr);
        } catch {}

        this.usedTools.push(name);
        const toolCallEntry = {
          id,
          args,
          round,
          ts: Date.now(),
          result: undefined as any,
        };
        (this.toolCalls[name] ??= []).push(toolCallEntry);

        try {
          // Notify CLI that tool is starting
          if (!this.config.silent) {
            process.stdout.write(
              JSON.stringify({
                type: "model_stream",
                model: this.currentModel,
                text: `Calling tool: ${name}\n`,
              }) + "\n",
            );
          }

          const result = await mcp.callTool({ name, arguments: args });
          toolCallEntry.result = result;

          // Notify CLI that tool completed
          if (!this.config.silent) {
            process.stdout.write(
              JSON.stringify({
                type: "model_stream",
                model: this.currentModel,
                text: `Tool ${name} completed\n`,
              }) + "\n",
            );
          }

          const toolMsg = {
            role: "tool" as const,
            tool_call_id: id,
            content: this.renderToolResult(result as any),
          };
          messages.push(toolMsg);
        } catch (err: any) {
          // Notify CLI about tool error
          if (!this.config.silent) {
            process.stdout.write(
              JSON.stringify({
                type: "model_stream",
                model: this.currentModel,
                text: `Tool ${name} failed: ${err?.message ?? err}\n`,
              }) + "\n",
            );
          }

          const errorResult = { error: String(err?.message ?? err) };
          toolCallEntry.result = errorResult;
          const toolErr = {
            role: "tool" as const,
            tool_call_id: id,
            content: JSON.stringify(errorResult),
          };
          messages.push(toolErr);
        }
      }

      if (round === MAX_ITERATIONS) {
        if (!this.config.silent) {
          process.stdout.write(
            JSON.stringify({
              type: "model_stream",
              model: this.currentModel,
              text: `Reached MAX_ITERATIONS ${MAX_ITERATIONS} without final answer.\n`,
            }) + "\n",
          );
        }
        await mcp.close();
        return {
          usedTools: this.usedTools,
          content: this.content,
          toolCalls: this.toolCalls,
        };
      }
    }

    await mcp.close();
    return {
      usedTools: this.usedTools,
      content: this.content,
      toolCalls: this.toolCalls,
    };
  }

  /**
   * Executes a function with exponential backoff retry logic.
   *
   * This method implements a robust retry mechanism for handling transient failures,
   * particularly useful for API calls that may fail due to rate limits or temporary
   * server issues. The backoff strategy uses exponential delays with optional jitter
   * to prevent thundering herd problems.
   *
   * @param fn - The async function to execute with retry logic
   * @param options - Configuration options for the backoff behavior
   * @param options.retries - Maximum number of retry attempts (default: 5)
   * @param options.base - Base delay in milliseconds for the first retry (default: 500)
   * @param options.factor - Multiplier for exponential backoff (default: 2)
   * @param options.jitter - Whether to add random jitter to delays (default: true)
   * @param options.isRetryable - Function to determine if an error should trigger a retry
   * @param options.onRetry - Callback function called on each retry attempt
   * @returns Promise that resolves with the function result or rejects with the final error
   *
   * @throws {Error} When all retry attempts are exhausted or the error is not retryable
   *
   * @example
   * ```typescript
   * const result = await provider.withBackoff(
   *   () => api.createCompletion(params),
   *   { retries: 3, base: 1000 }
   * );
   * ```
   */
  async withBackoff<T>(
    fn: () => Promise<T>,
    {
      retries = 5,
      base = 500,
      factor = 2,
      jitter = true,
      isRetryable = (e: any) =>
        e?.status === 429 ||
        e?.status === 529 ||
        /Provider returned error/i.test(String(e?.message)),
      onRetry = (e: any, attempt: number, delay: number) => {
        if (!this.config.silent) {
          process.stdout.write(
            JSON.stringify({
              type: "model_stream",
              model: this.currentModel,
              text: `[LLM] retry ${attempt}/${retries} in ${delay}ms: ${e?.status || ""} ${e?.message || e}\n`,
            }) + "\n",
          );
        }
      },
    } = {},
  ): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (e: any) {
        attempt++;
        if (attempt > retries || !isRetryable(e)) throw e;
        const delay = Math.min(10_000, base * Math.pow(factor, attempt - 1));
        const wait = jitter ? Math.floor(delay * (0.5 + Math.random())) : delay;
        onRetry(e, attempt, wait);

        await new Promise((res) => setTimeout(res, wait));
      }
    }
  }

  /**
   * Lists available MCP tools and converts them to OpenAI function format.
   *
   * @param mcp - The connected MCP client
   * @returns Array of tools formatted for OpenAI API
   */
  async listAndConvertTools(mcp: Client) {
    const listed = await mcp.listTools();
    if (!this.config.silent) {
      process.stdout.write(
        JSON.stringify({
          type: "model_stream",
          model: this.currentModel,
          text: `[MCP] Tools available: ${listed.tools.length}\n`,
        }) + "\n",
      );
    }
    return listed.tools.map((t) => this.convertTool(t));
  }

  /**
   * Converts an MCP tool to OpenAI function format.
   *
   * @param tool - The MCP tool to convert
   * @returns OpenAI-formatted function definition
   */
  convertTool(tool: ListToolsResult["tools"][number]) {
    const inputSchema =
      tool.inputSchema ??
      ({ type: "object", properties: {}, required: [] } as any);
    return {
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description ?? "",
        parameters: {
          type: "object",
          properties: inputSchema.properties ?? {},
          required: inputSchema.required ?? [],
          additionalProperties: false,
        },
      },
    };
  }

  /**
   * Establishes a connection to the MCP server.
   *
   * @returns Promise that resolves to a connected MCP client
   * @throws {Error} When authorization token is missing
   */
  async connectMcp(): Promise<Client> {
    if (!this.mcpServer.authorizationToken)
      throw new Error("Missing authorization token");
    const transport = new StreamableHTTPClientTransport(
      new URL(this.mcpServer.url),
      {
        requestInit: {
          headers: {
            Authorization: `Bearer ${this.mcpServer.authorizationToken}`,
            Accept: "application/json",
          },
        },
      },
    );
    const mcp = new Client({ name: "openrouter-agent", version: "1.0.0" });
    await mcp.connect(transport);
    if (!this.config.silent) {
      process.stdout.write(
        JSON.stringify({
          type: "model_stream",
          model: this.currentModel,
          text: "[MCP] Connected to server\n",
        }) + "\n",
      );
    }
    return mcp;
  }

  /**
   * Accumulates streaming delta changes from OpenRouter responses.
   *
   * @param acc - The accumulator object for content and tool calls
   * @param delta - The delta object from the streaming response
   * @returns The updated accumulator object
   */
  accumulateDelta(
    acc: { content: string; tool_calls: AccToolCall[] },
    delta: any,
  ) {
    const piece = delta?.content;
    if (typeof piece === "string") {
      acc.content += piece;
      this.content += piece;
    }

    const tcalls = delta?.tool_calls as any[] | undefined;
    if (tcalls && tcalls.length) {
      for (const t of tcalls) {
        const idx =
          typeof t.index === "number" ? t.index : acc.tool_calls.length;
        if (!acc.tool_calls[idx])
          acc.tool_calls[idx] = {
            type: "function",
            function: { name: "", arguments: "" },
          };
        const dst = acc.tool_calls[idx];

        if (t.id) dst.id = t.id;
        if (t.type) dst.type = t.type;

        const fn = t.function;
        if (fn?.name) dst.function!.name = fn.name;
        if (typeof fn?.arguments === "string") {
          dst.function!.arguments =
            (dst.function!.arguments ?? "") + fn.arguments;
        }
      }
    }
    return acc;
  }

  /**
   * Renders a tool call result as a string for the conversation.
   *
   * @param r - The tool call result to render
   * @returns String representation of the result
   */
  renderToolResult(r: CallToolResult): string {
    try {
      return JSON.stringify(r, null, 2);
    } catch {
      return String(r as any);
    }
  }

  /**
   * Normalizes OpenRouter-specific chunks into the unified NormalizedChunk format.
   *
   * This method converts OpenRouter's streaming response chunks into a standardized
   * format that can be processed by the chunk handling system. Since OpenRouter
   * uses the same API format as OpenAI, this implementation mirrors the OpenAI
   * chunk normalization logic.
   *
   * @param chunk - The raw chunk from OpenRouter's streaming API
   * @returns NormalizedChunk if the chunk can be normalized, null otherwise
   */
  protected normalizeChunk(chunk: any): NormalizedChunk | null {
    const timestamp = Date.now();

    if (chunk.type === "error") {
      return {
        provider: "openrouter",
        executionId: this.executionId,
        timestamp,
        index: -1,
        type: "error",
        data: { error: chunk.message },
        originalChunk: chunk,
      };
    }

    const baseChunk: Pick<
      NormalizedChunkOpenAI,
      "provider" | "executionId" | "timestamp" | "index" | "originalChunk"
    > = {
      provider: "openrouter",
      executionId: this.executionId,
      timestamp,
      index: chunk.output_index,
      originalChunk: chunk,
    };

    // text_start
    if (
      chunk.type === "response.content_part.added" &&
      chunk.part.type === "output_text"
    ) {
      return {
        ...baseChunk,
        type: "text_start",
        data: {
          text: "",
        },
      };
    }

    // text_delta
    if (chunk.type === "response.output_text.delta") {
      return {
        ...baseChunk,
        type: "text_delta",
        data: {
          textDelta: chunk.delta,
        },
      };
    }

    // tool_call_start
    if (
      chunk.type === "response.output_item.added" &&
      chunk.item.type === "mcp_call"
    ) {
      return {
        ...baseChunk,
        type: "tool_call_start",
        data: {
          toolName: chunk.item.name,
          toolId: chunk.item.id,
        },
      };
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
    if (
      chunk.type === "response.output_item.done" &&
      chunk.item.type === "mcp_call"
    ) {
      return {
        ...baseChunk,
        type: "tool_result",
        data: {
          toolId: chunk.item.id,
          isError: !chunk.item.error,
          toolResult: chunk.item.output,
        },
      };
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
}
