import type { McpServer } from "../index.js";
import type { ProviderConfig } from "./types.js";
import type { StreamResult, NormalizedChunk, ChunkHandlerConfig } from "../chunks/types.js";

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

  protected abstract normalizeChunk(chunk: any): NormalizedChunk | null;

  protected async processChunk(chunk: any): Promise<void> {
    const normalizedChunk = this.normalizeChunk(chunk);
    if (normalizedChunk && this.config.chunkHandlers) {
      await this.processNormalizedChunk(normalizedChunk);
    }
  }

  protected async processNormalizedChunk(normalizedChunk: NormalizedChunk): Promise<void> {
    if (this.config.chunkHandlers) {
      // Circular dependencies
      const { ChunkNormalizer } = await import("../chunks/normalizer.js");
      await ChunkNormalizer.processChunk(normalizedChunk, this.config.chunkHandlers);
    }
  }

  protected getChunkHandlers(): ChunkHandlerConfig {
    return this.config.chunkHandlers || {};
  }
}
