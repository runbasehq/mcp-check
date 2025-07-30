import { createProvider } from "./providers";
import type { ProviderConfig } from "./providers/types";
import type { ModelName, Models } from "./providers";

export type { ModelName, Models } from "./providers";

export {
  ChunkNormalizer,
  type NormalizedChunk,
  type NormalizedChunkType,
  type ChunkHandlerConfig,
  type ChunkCallback,
  type ChunkTypeCallback,
} from "./chunks";

export function client(mcpServer: McpServer, tools: Models, config: ProviderConfig = {}): Agents {
  return new Agents(mcpServer, tools, config);
}

export class McpServer {
  public url: string;
  public authorizationToken: string;
  public name: string;
  public type: string;

  constructor({ url, authorizationToken, name, type }: { url: string; authorizationToken: string; name: string; type: string }) {
    this.url = url;
    this.authorizationToken = authorizationToken;
    this.name = name;
    this.type = type;
  }
}

export class Agents {
  private promptText: string = "";
  private allowedTools: string[] = [];
  public usedTools: Partial<Record<ModelName, string[]>> = {};
  public toolCalls: Partial<Record<ModelName, Record<string, any[]>>> = {};
  private models: Models = [];
  private mcpServer: McpServer | null = null;
  private executionPromises: Promise<this>[] = [];
  private config: ProviderConfig;

  constructor(mcpServer: McpServer, models: ModelName[], config: ProviderConfig = {}) {
    this.models = models;
    this.mcpServer = mcpServer;
    this.config = config;
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
      const provider = createProvider(model, this.mcpServer!, this.promptText, this.config);
      const result = await provider.stream(model);
      this.usedTools[model] = result.usedTools;
      this.toolCalls[model] = result.toolCalls;

      return this;
    });

    await Promise.all(this.executionPromises);

    return this;
  }
}
