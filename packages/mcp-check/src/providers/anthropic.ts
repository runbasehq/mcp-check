import Anthropic from "@anthropic-ai/sdk";
import { Provider } from "./provider.js";
import type { StreamResult, NormalizedChunk } from "../chunks/types.js";
import type { McpServer } from "../index.js";
import type { ProviderConfig } from "./types.js";

export type AnthropicModel = Anthropic.Model;

export class AnthropicProvider extends Provider {
  private client: Anthropic | null;
  private currentToolName: string | null = null;
  private usedTools: string[] = [];
  private toolCalls: Record<string, any[]> = {};
  private content: string = "";
  private currentModel: string = "";

  constructor(
    mcpServer: McpServer,
    promptText: string,
    config: ProviderConfig = {},
  ) {
    super(mcpServer, promptText, config);
    const apiKey = config.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

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
            if (
              this.toolCalls[toolName] &&
              this.toolCalls[toolName].length > 0
            ) {
              const lastCall =
                this.toolCalls[toolName][this.toolCalls[toolName].length - 1];
              if (lastCall && lastCall.result === null) {
                lastCall.result = block.content;
                break;
              }
            }
          }
        }
      }
    }

    return {
      usedTools: this.usedTools,
      content: this.content,
      toolCalls: this.toolCalls,
    };
  }

  protected normalizeChunk(chunk: any): NormalizedChunk | null {
    const timestamp = Date.now();

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
      }
    }

    if (chunk.type === "content_block_start") {
        if (chunk.content_block.type === "mcp_tool_use") {
        this.currentToolName = chunk.content_block.name;
        return {
          type: "tool_call_start",
          provider: "anthropic",
          timestamp,
          data: {
            toolName: chunk.content_block.name,
            toolArgs: chunk.content_block.input || {},
            serverName: chunk.content_block.server_name,
          },
          originalChunk: chunk,
        };
      }
    }

    if (chunk.type === "content_block_stop") {
      if (this.currentToolName) {
        const toolName = this.currentToolName;
        this.currentToolName = null;
        return {
          type: "tool_call_done",
          provider: "anthropic",
          timestamp,
          data: {
            toolName: toolName,
          },
          originalChunk: chunk,
        };
      }
      return null;
    }

    if (chunk.type === "message_start") {
      return {
        type: "message_start",
        provider: "anthropic",
        timestamp,
        data: { message: chunk.message },
        originalChunk: chunk,
      };
    }

    if (chunk.type === "message_stop") {
      return {
        type: "message_done",
        provider: "anthropic",
        timestamp,
        data: {},
        originalChunk: chunk,
      };
    }

    return null;
  }

  protected async processNormalizedChunk(
    normalizedChunk: NormalizedChunk,
  ): Promise<void> {
    await super.processNormalizedChunk(normalizedChunk);

    if (normalizedChunk.type === "text_delta") {
      const text = normalizedChunk.data.text;
      if (text) {
        this.content += text;
      }
    } else if (normalizedChunk.type === "tool_call_start") {
      const toolName = normalizedChunk.data.toolName;
      if (toolName) {
        this.usedTools.push(toolName);

        if (!this.toolCalls[toolName]) {
          this.toolCalls[toolName] = [];
        }

        this.toolCalls[toolName].push({
          args: normalizedChunk.data.toolArgs || {},
          result: null,
        });
      }
    }
  }
}
