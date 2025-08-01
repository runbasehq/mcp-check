import type { ModelName } from "../providers";
import type { AgentResponse, AgentsExecutionResult, ToolCallStats } from "../chunks/types";
import type { AgentsClient } from ".";

/**
 * Represents the execution results from multiple AI agents/models.
 * Provides methods to access individual responses, execution statistics, and tool usage data.
 *
 * @template T - The type of model names used in the execution
 */
export class AgentsResult<T extends ModelName = ModelName> {
  private responses: Record<T, AgentResponse> = {} as Record<T, AgentResponse>;
  private executionStartTime: number;
  private executionEndTime: number;
  private models: T[];
  private agentsInstance: AgentsClient<T> | null = null;

  /**
   * Creates a new AgentsResult instance.
   *
   * @param responses - Record of model responses indexed by model name
   * @param startTime - Execution start timestamp in milliseconds
   * @param endTime - Execution end timestamp in milliseconds
   * @param models - Array of model names that were executed
   * @param agentsInstance - Optional reference to the original AgentsClient instance
   */
  constructor(
    responses: Record<T, AgentResponse>,
    startTime: number,
    endTime: number,
    models: T[],
    agentsInstance?: AgentsClient<T>
  ) {
    this.responses = responses;
    this.executionStartTime = startTime;
    this.executionEndTime = endTime;
    this.models = models;
    this.agentsInstance = agentsInstance || null;
  }

  /**
   * Gets the response for a specific model.
   *
   * @param model - The model name to get the response for
   * @returns The AgentResponse for the specified model, or undefined if not found
   *
   * @example
   * ```typescript
   * const response = result.getResponse("claude-3-haiku-20240307");
   * console.log(response?.content); // Model's response content
   * console.log(response?.usedTools); // Tools used by the model
   * ```
   */
  getResponse(model: T): AgentResponse | undefined {
    return this.responses[model];
  }

  /**
   * Gets all model responses as a record.
   *
   * @returns A copy of all responses indexed by model name
   *
   * @example
   * ```typescript
   * const allResponses = result.getAllResponses();
   * Object.entries(allResponses).forEach(([model, response]) => {
   *   console.log(`${model}: ${response.content}`);
   * });
   * ```
   */
  getAllResponses(): Record<T, AgentResponse> {
    return { ...this.responses };
  }

  /**
   * Gets comprehensive execution statistics and results.
   *
   * @returns An AgentsExecutionResult containing all responses and execution summary
   *
   * @example
   * ```typescript
   * const executionResult = result.getExecutionResult();
   * console.log(`Total models: ${executionResult.summary.totalModels}`);
   * console.log(`Successful executions: ${executionResult.summary.successfulExecutions}`);
   * console.log(`Execution time: ${executionResult.summary.executionTime}ms`);
   * console.log(`Common tools: ${executionResult.summary.commonTools.join(', ')}`);
   * ```
   */
  getExecutionResult(): AgentsExecutionResult {
    const successfulExecutions = Object.keys(this.responses).length;
    const failedExecutions = this.models.length - successfulExecutions;

    const allTools = (Object.values(this.responses) as AgentResponse[]).flatMap((r) => r.usedTools);
    const toolCounts = allTools.reduce(
      (acc, tool) => {
        acc[tool] = (acc[tool] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const commonTools = Object.entries(toolCounts)
      .filter(([_, count]) => (count as number) > 1)
      .map(([tool]) => tool);

    return {
      responses: this.getAllResponses() as Record<string, AgentResponse>,
      summary: {
        totalModels: this.models.length,
        successfulExecutions,
        failedExecutions,
        commonTools,
        executionTime: this.executionEndTime - this.executionStartTime,
      },
    };
  }

  /**
   * Gets aggregated statistics for all tool calls across all models.
   *
   * @returns Array of ToolCallStats with aggregated data for each tool
   *
   * @example
   * ```typescript
   * const toolStats = result.getToolStats();
   * toolStats.forEach(stat => {
   *   console.log(`${stat.toolName}: called ${stat.callCount} times`);
   *   if (stat.averageDuration) {
   *     console.log(`  Average duration: ${stat.averageDuration}ms`);
   *   }
   * });
   * ```
   */
  getToolStats(): ToolCallStats[] {
    const stats: Record<string, ToolCallStats> = {};

    (Object.values(this.responses) as AgentResponse[]).forEach((response) => {
      Object.entries(response.toolCalls).forEach(([toolName, calls]) => {
        if (!stats[toolName]) {
          stats[toolName] = {
            toolName,
            callCount: 0,
            totalDuration: 0,
            lastCalled: 0,
          };
        }

        stats[toolName].callCount += (calls as any[]).length;
        stats[toolName].lastCalled = Math.max(stats[toolName].lastCalled || 0, response.metadata?.timestamp || 0);
      });
    });

    return Object.values(stats).map((stat) => ({
      ...stat,
      averageDuration: stat.totalDuration ? stat.totalDuration / stat.callCount : undefined,
    }));
  }

  /**
   * Gets the content/text response from a specific model.
   *
   * @param model - The model name to get content for
   * @returns The text content from the model's response, or undefined if not found
   *
   * @example
   * ```typescript
   * const content = result.getContent("claude-3-haiku-20240307");
   * if (content) {
   *   console.log("Model response:", content);
   * }
   * ```
   */
  getContent(model: T): string | undefined {
    return this.responses[model]?.content;
  }

  /**
   * Gets the list of tools used by a specific model.
   *
   * @param model - The model name to get used tools for
   * @returns Array of tool names used by the model, or undefined if not found
   *
   * @example
   * ```typescript
   * const usedTools = result.getUsedTools("claude-3-haiku-20240307");
   * if (usedTools) {
   *   console.log("Tools used:", usedTools.join(', '));
   * }
   * ```
   */
  getUsedTools(model: T): string[] | undefined {
    return this.responses[model]?.usedTools;
  }

  /**
   * Checks if a specific model used a particular tool.
   *
   * @param model - The model name to check
   * @param tool - The tool name to check for usage
   * @returns True if the model used the specified tool, false otherwise
   *
   * @example
   * ```typescript
   * if (result.hasUsedTool("claude-3-haiku-20240307", "list_branches")) {
   *   console.log("Model used the list_branches tool");
   * }
   * ```
   */
  hasUsedTool(model: T, tool: string): boolean {
    return this.responses[model]?.usedTools.includes(tool) || false;
  }

  /**
   * Gets the number of times a specific tool was called by a model.
   *
   * @param model - The model name to check
   * @param tool - The tool name to count calls for
   * @returns The number of times the tool was called by the model
   *
   * @example
   * ```typescript
   * const callCount = result.getToolCallCount("claude-3-haiku-20240307", "list_branches");
   * console.log(`Tool was called ${callCount} times`);
   * ```
   */
  getToolCallCount(model: T, tool: string): number {
    return this.responses[model]?.toolCalls[tool]?.length || 0;
  }

  /**
   * Gets all model names that were executed.
   *
   * @returns Array of all model names that were part of the execution
   *
   * @example
   * ```typescript
   * const modelNames = result.getAgentNames();
   * console.log("Executed models:", modelNames.join(', '));
   * ```
   */
  getAgentNames(): T[] {
    return this.models;
  }

  /**
   * Gets the names of models that successfully completed execution.
   *
   * @returns Array of model names that have responses
   *
   * @example
   * ```typescript
   * const successfulModels = result.getSuccessfulAgents();
   * console.log("Successful models:", successfulModels.join(', '));
   * ```
   */
  getSuccessfulAgents(): T[] {
    return Object.keys(this.responses) as T[];
  }

  /**
   * Gets the names of models that failed to complete execution.
   *
   * @returns Array of model names that don't have responses
   *
   * @example
   * ```typescript
   * const failedModels = result.getFailedAgents();
   * if (failedModels.length > 0) {
   *   console.log("Failed models:", failedModels.join(', '));
   * }
   * ```
   */
  getFailedAgents(): T[] {
    return this.models.filter((model) => !this.responses[model]);
  }
}
