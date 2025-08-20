import type { McpServer } from "../index.js";
import type { AnthropicModel } from "./anthropic.js";
import type { OpenAIModel } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";
import type { ProviderConfig } from "./types.js";
import { Provider } from "./provider.js";
import { OpenRouterProvider, type OpenRouterModel } from "./openrouter.js";

/**
 * @fileoverview Provider factory and type exports for MCP AI providers.
 *
 * This module provides a factory function to create appropriate provider instances
 * based on model names, and exports type definitions for model names and providers.
 */

/**
 * Type alias for Anthropic Claude model names.
 *
 * @example
 * ```typescript
 * const model: AnthropicModel = "claude-3-haiku-20240307";
 * ```
 */
export type { AnthropicModel } from "./anthropic.js";

/**
 * Type alias for OpenAI model names.
 *
 * @example
 * ```typescript
 * const model: OpenAIModel = "gpt-4";
 * ```
 */
export type { OpenAIModel } from "./openai.js";

/**
 * Type alias for OpenRouter model names.
 *
 * @example
 * ```typescript
 * const model: OpenRouterModel = "meta-llama/llama-3.3-70b-instruct:free";
 * ```
 */
export type { OpenRouterModel } from "./openrouter.js";

/**
 * Union type of all supported model names.
 *
 * This type represents all available model identifiers that can be used
 * with the provider system.
 *
 * @example
 * ```typescript
 * const models: ModelName[] = ["claude-3-haiku-20240307", "gpt-4"];
 * ```
 */
export type ModelName =
  | `openai/${OpenAIModel}`
  | `anthropic/${AnthropicModel}`
  | `openrouter/${OpenRouterModel}`;

/**
 * Array type for model name collections.
 *
 * @example
 * ```typescript
 * const models: Models = ["anthropic/claude-3-sonnet-20240229", "openai/gpt-3.5-turbo"];
 * ```
 */
export type Models = ModelName[];

/**
 * Factory function to create appropriate provider instances based on model names.
 *
 * This function automatically determines the correct provider (Anthropic or OpenAI)
 * based on the model name prefix and creates a configured provider instance.
 *
 * @param model - The model name to create a provider for
 * @param mcpServer - The MCP server configuration
 * @param promptText - The prompt text to send to the model
 * @param config - Optional provider configuration (API keys, silent mode, etc.)
 * @returns A configured provider instance for the specified model
 *
 * @throws {Error} When the model name is not recognized or supported
 *
 * @example
 * ```typescript
 * // Create provider for Anthropic model
 * const anthropicProvider = createProvider(
 *   "anthropic/claude-3-haiku-20240307",
 *   mcpServer,
 *   "What tools are available?",
 *   { anthropicApiKey: process.env.ANTHROPIC_API_KEY }
 * );
 *
 * // Create provider for OpenAI model
 * const openaiProvider = createProvider(
 *   "openai/gpt-4",
 *   mcpServer,
 *   "What tools are available?",
 *   { openaiApiKey: process.env.OPENAI_API_KEY }
 * );
 *
 * // Use the providers
 * const anthropicResult = await anthropicProvider.stream("anthropic/claude-3-haiku-20240307");
 * const openaiResult = await openaiProvider.stream("openai/gpt-4");
 * ```
 */
export function createProvider(
  model: ModelName,
  mcpServer: McpServer,
  promptText: string,
  config: ProviderConfig = {},
): Provider {
  if (model.startsWith("anthropic/")) {
    return new AnthropicProvider(mcpServer, promptText, config);
  }

  if (model.startsWith("openai/")) {
    return new OpenAIProvider(mcpServer, promptText, config);
  }

  if (model.startsWith("openrouter/")) {
    return new OpenRouterProvider(mcpServer, promptText, config);
  }

  throw new Error(`Error: unknown provider for model: ${model}.`);
}
