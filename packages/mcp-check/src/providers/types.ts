import type { ChunkHandlerConfig } from "../chunks/types.js";

export interface ProviderConfig {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  chunkHandlers?: ChunkHandlerConfig;
  silent?: boolean;
  [key: string]: any;
}
