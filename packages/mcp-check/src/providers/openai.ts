import OpenAI from "openai";
import type { ChatModel } from "openai/resources";
import { Provider } from "./provider.js";
import type { StreamResult, ProviderConfig } from "./types.js";
import type { McpServer } from "../index.js";

export type OpenAIModel = ChatModel;

export class OpenAIProvider extends Provider {
  private client: OpenAI | null;

  constructor(mcpServer: McpServer, promptText: string, config: ProviderConfig = {}) {
    super(mcpServer, promptText, config);
    const apiKey = config.openaiApiKey || process.env.OPENAI_API_KEY;
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  async stream(model: string): Promise<StreamResult> {
    if (!this.client) {
      throw new Error(
        "OpenAI client not initialized. Please set OPENAI_API_KEY environment variable or pass openaiApiKey in config."
      );
    }

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

    const usedTools: string[] = [];
    const toolCalls: Record<string, any[]> = {};
    let content = "";

    for await (const chunk of response) {
      if (chunk.type === "response.output_item.added") {
        const item = chunk.item;
        if (item.type === "mcp_call") {
          const toolName = item.name;
          usedTools.push(toolName);
          
          if (!toolCalls[toolName]) {
            toolCalls[toolName] = [];
          }
          
          toolCalls[toolName].push({
            args: item.arguments || {},
            result: null
          });
        }
      } else if (chunk.type === "response.output_item.done") {
        const item = chunk.item;
        if (item.type === "mcp_call") {
          // Update the most recent tool call result
          const toolName = item.name;
          if (toolCalls[toolName] && toolCalls[toolName].length > 0) {
            const lastCall = toolCalls[toolName][toolCalls[toolName].length - 1];
            if (lastCall) {
              lastCall.result = { id: `result_${Date.now()}`, status: "completed" };
            }
          }
        }
      }
    }

    return { usedTools, content, toolCalls };
  }
}
