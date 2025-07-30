import type { McpServer } from "../index.js";
import type { AnthropicModel } from "./anthropic.js";
import type { OpenAIModel } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";
import type { ProviderConfig } from "./types.js";
import { Provider } from "./provider.js";
// Re-export provider types for convenience
export type { AnthropicModel } from "./anthropic.js";
export type { OpenAIModel } from "./openai.js";

export type ModelName = AnthropicModel | OpenAIModel;
export type Models = ModelName[];

export function createProvider(
  model: ModelName,
  mcpServer: McpServer,
  promptText: string,
  config: ProviderConfig = {},
): Provider {
  // Anthropic models
  if (model.startsWith("claude-")) {
    return new AnthropicProvider(mcpServer, promptText, config);
  }

  // OpenAI models
  if (model.startsWith("gpt-") || model.startsWith("o") || model.startsWith("chatgpt-") || model.startsWith("codex-")) {
    return new OpenAIProvider(mcpServer, promptText, config);
  }

  throw new Error(`Error: unknown provider for model: ${model}.`);
}
