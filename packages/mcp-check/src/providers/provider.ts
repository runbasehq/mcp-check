import type { McpServer } from "../index.js";
import type { ProviderConfig, StreamResult } from "./types.js";

export abstract class Provider {
  protected mcpServer: McpServer;
  protected promptText: string;
  protected config: ProviderConfig;

  constructor(mcpServer: McpServer, promptText: string, config: ProviderConfig = {}) {
    this.mcpServer = mcpServer;
    this.promptText = promptText;
    this.config = config;
  }

  abstract stream(model: string): Promise<StreamResult>;
}
