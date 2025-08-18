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

    const mcp = await this.connectMcp();

    const tools = await this.listAndConvertTools(mcp);

    const openrouter = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY! ?? this.config.openrouterApiKey,
      baseURL: "https://openrouter.ai/api/v1",
      timeout: 60_000,
    });

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: "user",
        content: this.promptText,
      },
    ];

    const stream = await openrouter.chat.completions.create({
      model: model.replace("openrouter/", ""),
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0,
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

    const acc = { content: "", tool_calls: [] as AccToolCall[] };

    for await (const chunk of stream) {
      // log de chunk crudo
      console.log("[CHUNK]", JSON.stringify(chunk, null, 2));
      const delta = chunk?.choices?.[0]?.delta;
      if (delta) this.accumulateDelta(acc, delta);
      // await this.processChunk(chunk);
    }

    const tcalls = acc.tool_calls ?? [];
    console.log(`[LLM] Got ${tcalls.length} tool call(s).`);

    messages.push({
      role: "assistant",
      content: acc.content || "",
      tool_calls: tcalls.map((t, index) => ({
        id: t.id ?? `call_${index}`,
        type: "function",
        function: {
          name: t.function?.name ?? "",
          arguments: t.function?.arguments ?? "{}",
        },
      })),
    } as any);

    for (const [i, call] of tcalls.entries()) {
      const id = call.id ?? `call_${i}`;
      const name = call.function?.name ?? "";
      const argsStr = call.function?.arguments ?? "{}";
      let args: Record<string, any> = {};
      try {
        args = JSON.parse(argsStr);
      } catch {
        // algunos modelos envían JSON parcial → último intento
        try {
          args = JSON.parse(
            argsStr.replace(/}\s*$/, "}}").replace(/^{\s*$/, "{}"),
          );
        } catch {}
      }

      console.log(`[MCP] Executing tool '${name}' with args:`, args);
      try {
        const result = await mcp.callTool({ name, arguments: args });
        messages.push({
          role: "tool",
          tool_call_id: id,
          content: this.renderToolResult(result as any),
        });
      } catch (err: any) {
        console.error("[MCP] Tool error:", err?.message ?? err);
        messages.push({
          role: "tool",
          tool_call_id: id,
          content: JSON.stringify({ error: String(err?.message ?? err) }),
        });
      }
    }

    await mcp.close();

    return {
      usedTools: this.usedTools,
      content: this.content,
      toolCalls: this.toolCalls,
    };
  }

  async listAndConvertTools(mcp: Client) {
    console.log("[MCP] Listing tools...");
    const listed = await mcp.listTools();
    console.log(`[MCP] Tools available: ${listed.tools.length}`);
    return listed.tools.map(this.convertTool);
  }

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
    console.log(`[MCP] Connecting to ${this.mcpServer.url} ...`);
    await mcp.connect(transport);
    console.log("[MCP] Connected.");
    return mcp;
  }

  accumulateDelta(
    acc: { content: string; tool_calls: AccToolCall[] },
    delta: any,
  ) {
    const piece = delta?.content;
    if (typeof piece === "string") acc.content += piece;

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
        timestamp,
        index: -1,
        type: "error",
        data: { error: chunk.message },
        originalChunk: chunk,
      };
    }

    const baseChunk: Pick<
      NormalizedChunkOpenAI,
      "provider" | "timestamp" | "index" | "originalChunk"
    > = {
      provider: "openrouter",
      timestamp,
      index: chunk.output_index || 0,
      originalChunk: chunk,
    };

    // text_start
    if (
      chunk.type === "response.content_part.added" &&
      chunk.part?.type === "output_text"
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
      chunk.item?.type === "mcp_call"
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
      chunk.item?.type === "mcp_call"
    ) {
      return {
        ...baseChunk,
        type: "tool_result",
        data: {
          toolId: chunk.item.id,
          isError: !!chunk.item.error,
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
