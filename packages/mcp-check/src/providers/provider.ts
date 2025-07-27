import type { McpServer } from "../index.js";

export interface ToolCall {
  args: Record<string, any>;
  result?: any;
}

export interface StreamResult {
  usedTools: string[];
  content: string;
  toolCalls: Record<string, ToolCall[]>;
}

export abstract class Provider {
  protected mcpServer: McpServer;
  protected promptText: string;

  constructor(mcpServer: McpServer, promptText: string) {
    this.mcpServer = mcpServer;
    this.promptText = promptText;
  }

  abstract stream(model: string): Promise<StreamResult>;
  abstract isValidModel(model: string): boolean;
}