import { createProvider } from "../providers";
import type { ModelName } from "../providers";
import type { ProviderConfig } from "../providers/types";
import type { AgentResponse } from "../chunks/types";
import type { McpServer } from "..";
import { AgentsResult } from "./result";

/**
 * Client for executing prompts against MCP servers using multiple AI models.
 * Provides a fluent API for configuring and executing multi-model tests.
 *
 * @template T - The type of model names to use
 */
export class AgentsClient<T extends ModelName = ModelName> {
  private promptText: string = "";
  private allowedTools: string[] = [];
  public usedTools: Partial<Record<T, string[]>> = {};
  public toolCalls: Partial<Record<T, Record<string, any[]>>> = {};
  private models: T[] = [];
  private mcpServer: McpServer | null = null;
  private executionPromises: Promise<AgentResponse>[] = [];
  private config: ProviderConfig;

  /**
   * Creates a new AgentsClient instance.
   *
   * @param mcpServer - The MCP server configuration
   * @param models - Array of model names to execute
   * @param config - Optional provider configuration (API keys, silent mode, etc.)
   */
  constructor(mcpServer: McpServer, models: T[], config: ProviderConfig = {}) {
    this.models = models;
    this.mcpServer = mcpServer;
    this.config = { silent: true, ...config };
  }

  /**
   * Sets the prompt text to execute against the MCP server.
   *
   * @param text - The prompt text to send to all models
   * @returns The client instance for method chaining
   *
   * @example
   * ```typescript
   * const client = new AgentsClient(mcpServer, ["claude-3-haiku-20240307"]);
   * client.prompt("What tools are available?");
   * ```
   */
  prompt(text: string): this {
    this.promptText = text;
    return this;
  }

  /**
   * Sets the list of tools that are allowed to be used by the models.
   *
   * @param tools - Array of tool names that are allowed
   * @returns The client instance for method chaining
   *
   * @example
   * ```typescript
   * const client = new AgentsClient(mcpServer, ["claude-3-haiku-20240307"]);
   * client.allowTools(["list_branches", "query_content"]);
   * ```
   */
  allowTools(tools: string[]): this {
    this.allowedTools = tools;
    return this;
  }

  /**
   * Executes the configured prompt against all models and returns comprehensive results.
   *
   * @returns Promise that resolves to an AgentsResult containing all model responses and execution statistics
   *
   * @example
   * ```typescript
   * const result = await client
   *   .prompt("What tools are available?");
   *
   * console.log("Execution time:", result.getExecutionResult().summary.executionTime);
   * console.log("Successful models:", result.getSuccessfulAgents());
   * ```
   *
   * @throws {Error} When MCP server is not configured
   */
  async execute(): Promise<AgentsResult<T>> {
    if (!this.mcpServer) {
      throw new Error("MCP server not set");
    }

    const executionStartTime = Date.now();

    this.executionPromises = this.models.map(async (model) => {
      const provider = createProvider(model, this.mcpServer!, this.promptText, this.config);
      const result = await provider.stream(model);

      this.usedTools[model] = result.usedTools;
      this.toolCalls[model] = result.toolCalls;

      return {
        model,
        content: result.content,
        usedTools: result.usedTools,
        toolCalls: result.toolCalls,
        metadata: {
          timestamp: Date.now(),
          duration: Date.now() - executionStartTime,
        },
      } as AgentResponse;
    });

    const responses = await Promise.all(this.executionPromises);
    const executionEndTime = Date.now();

    const responsesMap = responses.reduce(
      (acc, response) => {
        acc[response.model as T] = response;
        return acc;
      },
      {} as Record<T, AgentResponse>
    );

    return new AgentsResult(responsesMap, executionStartTime, executionEndTime, this.models, this);
  }
}
