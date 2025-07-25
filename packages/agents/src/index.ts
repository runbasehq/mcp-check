import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { ChatModel } from "openai/resources";

// Only initialize clients if API keys are available
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
const openai = process.env.OPENAI_API_KEY ? new OpenAI() : null;

export type AnthropicModel = Anthropic.Model;
export type OpenAIModel = ChatModel;

export type Models = (AnthropicModel | OpenAIModel)[];

export function client(mcpServer: McpServer, tools: Models): Agents {
  return new Agents(mcpServer, tools);
}

export class McpServer {
  public url: string;
  public authorizationToken: string;
  public name: string;
  public type: string;

  constructor({
    url,
    authorizationToken,
    name,
    type,
  }: {
    url: string;
    authorizationToken: string;
    name: string;
    type: string;
  }) {
    this.url = url;
    this.authorizationToken = authorizationToken;
    this.name = name;
    this.type = type;
  }
}

export class Agents {
  private promptText: string = "";
  private allowedTools: string[] = [];
  public usedTools: Record<string, string[]> = {};
  private models: Models = [];
  private mcpServer: McpServer | null = null;
  private executionPromises: Promise<this>[] = [];

  constructor(mcpServer: McpServer, models: (AnthropicModel | OpenAIModel)[]) {
    this.models = models;
    this.mcpServer = mcpServer;
  }

  prompt(text: string): this {
    this.promptText = text;
    return this;
  }

  allowTools(tools: string[]): this {
    this.allowedTools = tools;
    return this;
  }

  async execute(): Promise<this> {
    if (!this.mcpServer) {
      throw new Error("MCP server not set");
    }

    this.executionPromises = this.models.map(async (model) => {
      if (model.startsWith("claude") || model.startsWith("claude-")) {
        return this.executeAnthropic(model as AnthropicModel);
      } else {
        return this.executeOpenAi(model as OpenAIModel);
      }
    });

    await Promise.all(this.executionPromises);

    console.log("\nUsed tools:", this.usedTools);

    return this;
  }

  private async executeAnthropic(model: AnthropicModel): Promise<this> {
    if (!this.mcpServer) {
      throw new Error("MCP server not set");
    }

    if (!anthropic) {
      throw new Error(
        "Anthropic client not initialized. Please set ANTHROPIC_API_KEY environment variable.",
      );
    }

    const stream = anthropic.beta.messages.stream({
      model,
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

    const response = await stream.finalMessage();
    this.usedTools[model] = usedTools;

    return this;
  }

  private async executeOpenAi(model: OpenAIModel): Promise<this> {
    if (!this.mcpServer) {
      throw new Error("MCP server not set");
    }

    if (!openai) {
      throw new Error(
        "OpenAI client not initialized. Please set OPENAI_API_KEY environment variable.",
      );
    }

    const response = await openai.responses.create({
      model,
      tools: [
        {
          type: "mcp",
          require_approval: "never",
          server_label: this.mcpServer.name,
          server_url: this.mcpServer.url,
          headers: {
            Authorization: `${this.mcpServer.authorizationToken}`,
          },
        },
      ],
      input: this.promptText,
      stream: true,
    });

    const usedTools: string[] = [];

    for await (const chunk of response) {
      if (chunk.type === "response.output_item.added") {
        const item = chunk.item;
        if (item.type === "mcp_call") {
          usedTools.push(item.name);
        }
      }
    }

    this.usedTools[model] = usedTools;

    return this;
  }
}
