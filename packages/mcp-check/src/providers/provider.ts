import type { McpServer } from "../index.js";
import type { ProviderConfig } from "./types.js";
import type { StreamResult, NormalizedChunk, ChunkHandlerConfig } from "../chunks/types.js";

/**
 * Abstract base class for AI providers.
 * 
 * This class provides a common interface for different AI providers (Anthropic, OpenAI)
 * to handle MCP server interactions and streaming responses. It includes functionality
 * for chunk processing, normalization, and handler management.
 * 
 * @example
 * ```typescript
 * class CustomProvider extends Provider {
 *   async stream(model: string): Promise<StreamResult> {
 *     // Implementation for custom provider
 *   }
 * 
 *   protected normalizeChunk(chunk: any): NormalizedChunk | null {
 *     // Custom chunk normalization logic
 *   }
 * }
 * ```
 */
export abstract class Provider {
  /** The MCP server configuration */
  protected mcpServer: McpServer;
  /** The prompt text to send to the AI model */
  protected promptText: string;
  /** Provider configuration including API keys and handlers */
  protected config: ProviderConfig;

  /**
   * Creates a new Provider instance.
   * 
   * @param mcpServer - The MCP server configuration
   * @param promptText - The prompt text to send to the AI model
   * @param config - Optional provider configuration
   * 
   * @example
   * ```typescript
   * const provider = new CustomProvider(mcpServer, "What tools are available?", {
   *   silent: true,
   *   chunkHandlers: { onTextDelta: console.log }
   * });
   * ```
   */
  constructor(mcpServer: McpServer, promptText: string, config: ProviderConfig = {}) {
    this.mcpServer = mcpServer;
    this.promptText = promptText;
    this.config = { silent: true, ...config };
  }

  /**
   * Streams a response from the AI model.
   * 
   * This method must be implemented by concrete provider classes to handle
   * the specific streaming implementation for their respective AI services.
   * 
   * @param model - The model name to use for the request
   * @returns Promise that resolves to a StreamResult containing the response
   * 
   * @example
   * ```typescript
   * const result = await provider.stream("claude-3-haiku-20240307");
   * console.log("Content:", result.content);
   * console.log("Used tools:", result.usedTools);
   * ```
   */
  abstract stream(model: string): Promise<StreamResult>;

  /**
   * Normalizes a raw chunk from the AI provider into a standardized format.
   * 
   * This method must be implemented by concrete provider classes to convert
   * provider-specific chunk formats into the unified NormalizedChunk format.
   * 
   * @param chunk - The raw chunk from the AI provider
   * @returns NormalizedChunk if the chunk can be normalized, null otherwise
   * 
   * @example
   * ```typescript
   * const normalized = this.normalizeChunk(rawChunk);
   * if (normalized) {
   *   await this.processNormalizedChunk(normalized);
   * }
   * ```
   */
  protected abstract normalizeChunk(chunk: any): NormalizedChunk | null;

  /**
   * Processes a raw chunk from the AI provider.
   * 
   * This method normalizes the chunk and processes it through configured
   * chunk handlers if available.
   * 
   * @param chunk - The raw chunk to process
   * @returns Promise that resolves when processing is complete
   * 
   * @example
   * ```typescript
   * for await (const chunk of stream) {
   *   await this.processChunk(chunk);
   * }
   * ```
   */
  protected async processChunk(chunk: any): Promise<void> {
    const normalizedChunk = this.normalizeChunk(chunk);
    if (normalizedChunk && this.config.chunkHandlers) {
      await this.processNormalizedChunk(normalizedChunk);
    }
  }

  /**
   * Processes a normalized chunk through configured handlers.
   * 
   * This method routes the normalized chunk to appropriate handlers
   * based on the chunk type and provider-specific configurations.
   * 
   * @param normalizedChunk - The normalized chunk to process
   * @returns Promise that resolves when processing is complete
   * 
   * @example
   * ```typescript
   * const normalized = this.normalizeChunk(rawChunk);
   * if (normalized) {
   *   await this.processNormalizedChunk(normalized);
   * }
   * ```
   */
  protected async processNormalizedChunk(normalizedChunk: NormalizedChunk): Promise<void> {
    if (this.config.chunkHandlers) {
      // Circular dependencies
      const { ChunkNormalizer } = await import("../chunks/normalizer.js");
      await ChunkNormalizer.processChunk(normalizedChunk, this.config.chunkHandlers);
    }
  }

  /**
   * Gets the configured chunk handlers.
   * 
   * @returns The chunk handler configuration, or an empty object if none configured
   * 
   * @example
   * ```typescript
   * const handlers = this.getChunkHandlers();
   * if (handlers.onTextDelta) {
   *   await handlers.onTextDelta(data);
   * }
   * ```
   */
  protected getChunkHandlers(): ChunkHandlerConfig {
    return this.config.chunkHandlers || {};
  }
}
