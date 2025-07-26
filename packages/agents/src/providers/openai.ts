import OpenAI from "openai";
import type { ChatModel } from "openai/resources";
import { Provider, type StreamResult } from "./provider.js";
import type { McpServer } from "../index.js";

export class OpenAIProvider extends Provider {
  private client: OpenAI | null;

  constructor(mcpServer: McpServer, promptText: string) {
    super(mcpServer, promptText);
    this.client = process.env.OPENAI_API_KEY ? new OpenAI() : null;
  }

  isValidModel(model: string): boolean {
    return !model.startsWith("claude") && !model.startsWith("claude-");
  }

  async stream(model: string): Promise<StreamResult> {
    if (!this.client) {
      throw new Error(
        "OpenAI client not initialized. Please set OPENAI_API_KEY environment variable.",
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
    let content = "";

    for await (const chunk of response) {
      if (chunk.type === "response.output_item.added") {
        const item = chunk.item;
        if (item.type === "mcp_call") {
          usedTools.push(item.name);
        }
      }
    }

    return { usedTools, content };
  }
}
