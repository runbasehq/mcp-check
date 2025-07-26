import Anthropic from "@anthropic-ai/sdk";
import type { ChatModel } from "openai/resources";
import { createProvider } from "./utils.js";

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
      const provider = createProvider(model, this.mcpServer!, this.promptText);
      const result = await provider.stream(model);
      this.usedTools[model] = result.usedTools;
      return this;
    });

    await Promise.all(this.executionPromises);

    console.log("\nUsed tools:", this.usedTools);

    return this;
  }

}
