import Anthropic from "@anthropic-ai/sdk";
import { Provider, type StreamResult } from "./provider.js";
import type { McpServer } from "../index.js";

export class AnthropicProvider extends Provider {
  private client: Anthropic | null;

  constructor(mcpServer: McpServer, promptText: string) {
    super(mcpServer, promptText);
    this.client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
  }

  isValidModel(model: string): boolean {
    return model.startsWith("claude") || model.startsWith("claude-");
  }

  async stream(model: string): Promise<StreamResult> {
    if (!this.client) {
      throw new Error(
        "Anthropic client not initialized. Please set ANTHROPIC_API_KEY environment variable.",
      );
    }

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

    let content = "";
    const usedTools: string[] = [];

    for await (const chunk of stream) {
      if (
        chunk.type === "content_block_delta" &&
        chunk.delta.type === "text_delta"
      ) {
        content += chunk.delta.text;
        process.stdout.write(chunk.delta.text);
      } else if (
        chunk.type === "content_block_start" &&
        chunk.content_block.type === "mcp_tool_use"
      ) {
        usedTools.push(chunk.content_block.name);
      }
    }

    await stream.finalMessage();
    return { usedTools, content };
  }
}