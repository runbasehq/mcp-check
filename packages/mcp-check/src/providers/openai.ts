import OpenAI from "openai";
import type { ChatModel } from "openai/resources";
import { Provider } from "./provider.js";
import type { StreamResult, NormalizedChunk } from "../chunks/types.js";
import type { ProviderConfig } from "./types.js";
import type { McpServer } from "../index.js";

export type OpenAIModel = ChatModel;

export class OpenAIProvider extends Provider {
  private client: OpenAI | null;
  private usedTools: string[] = [];
  private toolCalls: Record<string, any[]> = {};
  private currentModel: string = "";

  constructor(
    mcpServer: McpServer,
    promptText: string,
    config: ProviderConfig = {},
  ) {
    super(mcpServer, promptText, config);
    const apiKey = config.openaiApiKey || process.env.OPENAI_API_KEY;
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  async stream(model: string): Promise<StreamResult> {
    if (!this.client) {
      throw new Error(
        "OpenAI client not initialized. Please set OPENAI_API_KEY environment variable or pass openaiApiKey in config.",
      );
    }

    this.usedTools = [];
    this.toolCalls = {};
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
            Authorization: this.mcpServer.authorizationToken,
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
            result: null
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

    return { usedTools: this.usedTools, content, toolCalls: this.toolCalls };
  }

  protected normalizeChunk(chunk: any): NormalizedChunk | null {
    const timestamp = Date.now();

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

    if (chunk.type === "response.output_item.done") {
      const item = chunk.item;

      if (item.type === "mcp_call") {
        return {
          type: "tool_call_done",
          provider: "openai",
          timestamp,
          data: {
            toolName: item.name,
            toolResult: item.result,
          },
          originalChunk: chunk,
        };
      }
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
  }
}
