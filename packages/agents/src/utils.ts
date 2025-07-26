import { AnthropicProvider } from "./providers/anthropic.js";
import { OpenAIProvider } from "./providers/openai.js";
import type { Provider } from "./providers/provider.js";
import type { McpServer } from "./index.js";

export function createProvider(model: string, mcpServer: McpServer, promptText: string): Provider {
  if (model.startsWith("claude") || model.startsWith("claude-")) {
    return new AnthropicProvider(mcpServer, promptText);
  } else {
    return new OpenAIProvider(mcpServer, promptText);
  }
}