import type { McpServer } from "../index.js";
import type { ProviderConfig } from "./types.js";
import { Provider } from "./base.js";
import { AIProvider } from "./client.js";

/**
 * @fileoverview Provider factory for MCP AI providers.
 *
 * Creates AI provider instances with automatic provider detection based on API keys.
 */

/**
 * Supported model name type.
 */
export type ModelName = string;

/**
 * Array of model names.
 */
export type Models = ModelName[];

/**
 * Creates an AI provider with automatic provider detection.
 *
 * Provider selection order (first available wins):
 * 1. OpenRouter - config.openrouterApiKey || OPENROUTER_API_KEY
 * 2. OpenAI - config.openaiApiKey || OPENAI_API_KEY
 * 3. Anthropic - config.anthropicApiKey || ANTHROPIC_API_KEY
 * 4. ai-gateway (default fallback)
 *
 * @param model - Model name
 * @param mcpServer - MCP server configuration
 * @param promptText - Prompt text
 * @param config - Provider configuration with API keys
 * @returns AIProvider instance
 */
export function createProvider(
  model: ModelName,
  mcpServer: McpServer,
  promptText: string,
  config: ProviderConfig = {},
): Provider {
  if (model) {
    return new AIProvider(mcpServer, promptText, config);
  }

  throw new Error(`Error: unknown provider for model: ${model}.`);
}
