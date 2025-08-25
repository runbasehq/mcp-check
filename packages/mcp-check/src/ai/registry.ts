import { type LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { ProviderConfig } from "./types.js";

/**
 * Abstract base class for AI provider configurations
 */
abstract class BaseAIProvider {
  abstract readonly name: "ai-gateway" | "openai" | "openrouter" | "anthropic";
  abstract isAvailable(config: ProviderConfig): boolean;
  abstract createModel(
    config: ProviderConfig,
    modelName: string,
  ): LanguageModel;

  protected getApiKey(configKey: string | undefined, envKey: string): string {
    const key = configKey ?? process.env[envKey];
    if (!key) {
      throw new Error(
        `API key not found for ${this.name}. Set ${envKey} or provide ${configKey} in config.`,
      );
    }
    return key;
  }
}

/**
 * OpenRouter provider implementation
 */
class OpenRouterProvider extends BaseAIProvider {
  readonly name = "openrouter";

  isAvailable(config: ProviderConfig): boolean {
    return !!(config.openrouterApiKey || process.env.OPENROUTER_API_KEY);
  }

  createModel(config: ProviderConfig, modelName: string): LanguageModel {
    const apiKey = this.getApiKey(
      config.openrouterApiKey,
      "OPENROUTER_API_KEY",
    );
    const client = createOpenRouter({ apiKey });
    return client.chat(modelName);
  }
}

/**
 * OpenAI provider implementation
 */
class OpenAIProvider extends BaseAIProvider {
  readonly name = "openai";

  isAvailable(config: ProviderConfig): boolean {
    return !!(config.openaiApiKey || process.env.OPENAI_API_KEY);
  }

  createModel(config: ProviderConfig, modelName: string): LanguageModel {
    const apiKey = this.getApiKey(config.openaiApiKey, "OPENAI_API_KEY");
    const client = createOpenAI({ apiKey });
    return client.chat(modelName);
  }
}

/**
 * Anthropic provider implementation
 */
class AnthropicProvider extends BaseAIProvider {
  readonly name = "anthropic";

  isAvailable(config: ProviderConfig): boolean {
    return !!(config.anthropicApiKey || process.env.ANTHROPIC_API_KEY);
  }

  createModel(config: ProviderConfig, modelName: string): LanguageModel {
    const apiKey = this.getApiKey(config.anthropicApiKey, "ANTHROPIC_API_KEY");
    const client = createAnthropic({ apiKey });
    return client.chat(modelName);
  }
}

/**
 * AI providers registry
 */
export class AIProviderRegistry {
  private static providers: BaseAIProvider[] = [
    new OpenRouterProvider(),
    new OpenAIProvider(),
    new AnthropicProvider(),
  ];

  /**
   * Find the first available provider based on configuration
   */
  static findAvailableProvider(config: ProviderConfig): BaseAIProvider | null {
    return (
      this.providers.find((provider) => provider.isAvailable(config)) ?? null
    );
  }

  /**
   * Create a model instance using the first available provider
   */
  static createModel(
    config: ProviderConfig,
    modelName: string,
  ): {
    model: LanguageModel | string;
    providerName: "ai-gateway" | "openai" | "openrouter" | "anthropic";
  } {
    const provider = this.findAvailableProvider(config);

    if (provider) {
      return {
        model: provider.createModel(config, modelName),
        providerName: provider.name,
      };
    }

    return {
      model: modelName,
      providerName: "ai-gateway",
    };
  }

  /**
   * Get all registered provider names
   */
  static getProviderNames(): string[] {
    return this.providers.map((p) => p.name);
  }

  /**
   * Register a new provider
   */
  static registerProvider(provider: BaseAIProvider): void {
    this.providers.unshift(provider);
  }
}
