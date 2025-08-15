import type { Scorer } from "src/index.js";
import type { ChunkHandlerConfig } from "../chunks/types.js";

/**
 * Configuration object for AI providers.
 * 
 * This interface defines the configuration options that can be passed to
 * AI providers for authentication, chunk handling, and other settings.
 * 
 * @example
 * ```typescript
 * const config: ProviderConfig = {
 *   anthropicApiKey: process.env.ANTHROPIC_API_KEY,
 *   openaiApiKey: process.env.OPENAI_API_KEY,
 *   silent: true,
 *   chunkHandlers: {
 *     onTextDelta: (data) => console.log("Text:", data.text),
 *     onToolCallStart: (data) => console.log("Tool started:", data.toolName)
 *   }
 * };
 * ```
 */
export interface ProviderConfig {
  /** API key for Anthropic services (Claude models) */
  anthropicApiKey?: string;
  /** API key for OpenAI services (GPT models) */
  openaiApiKey?: string;
  /** Configuration for handling streaming chunks */
  chunkHandlers?: ChunkHandlerConfig;
  /** Whether to suppress console output during execution */
  silent?: boolean;
  /** Scorers to score the output of the tools */
  scorers?: Scorer[];
}
