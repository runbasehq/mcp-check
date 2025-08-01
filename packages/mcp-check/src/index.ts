import type { ModelName } from "./providers";
import type { ProviderConfig } from "./providers/types";
<<<<<<< HEAD
import { McpServer } from "./server";
import { AgentsClient } from "./agents";
=======
import type { ModelName, Models } from "./providers";
import type { AgentResponse, AgentsExecutionResult, ToolCallStats } from "./chunks/types";
>>>>>>> origin/dev

export type { ModelName, Models } from "./providers";

export {
  ChunkNormalizer,
  type NormalizedChunk,
  type NormalizedChunkType,
  type ChunkHandlerConfig,
  type ChunkCallback,
  type ChunkTypeCallback,
  type AgentResponse,
  type AgentsExecutionResult,
  type ToolCallStats,
} from "./chunks";

<<<<<<< HEAD
export { McpServer } from "./server";
export { AgentsClient, AgentsResult } from "./agents";

/**
 * Creates a new AgentsClient instance for executing prompts against MCP servers.
 * 
 * @template T - The type of model names to use
 * @param mcpServer - The MCP server configuration
 * @param models - Array of model names to execute
 * @param config - Optional provider configuration (API keys, silent mode, etc.)
 * @returns A configured AgentsClient instance
 * 
 * @example
 * ```typescript
 * const client = client(mcpServer, ["claude-3-haiku-20240307", "gpt-4"], {
 *   silent: true,
 *   anthropicApiKey: process.env.ANTHROPIC_API_KEY
 * });
 * 
 * const result = await client
 *   .prompt("What tools are available?")
 *   .execute();
 * ```
 */
export function client<T extends ModelName>(mcpServer: McpServer, models: T[], config: ProviderConfig = {}): AgentsClient<T> {
  return new AgentsClient(mcpServer, models, config);
=======
export function client<T extends ModelName>(mcpServer: McpServer, models: T[], config: ProviderConfig = {}): AgentsClient<T> {
  return new AgentsClient(mcpServer, models, config);
}

export class McpServer {
  public url: string;
  public authorizationToken: string;
  public name: string;
  public type: string;

  constructor({ url, authorizationToken, name, type }: { url: string; authorizationToken: string; name: string; type: string }) {
    this.url = url;
    this.authorizationToken = authorizationToken;
    this.name = name;
    this.type = type;
  }
}

export class AgentsResult<T extends ModelName = ModelName> {
  private responses: Record<T, AgentResponse> = {} as Record<T, AgentResponse>;
  private executionStartTime: number;
  private executionEndTime: number;
  private models: T[];
  private agentsInstance: AgentsClient<T> | null = null;

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

  getResponse(model: T): AgentResponse | undefined {
    return this.responses[model];
  }

  getAllResponses(): Record<T, AgentResponse> {
    return { ...this.responses };
  }

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

  getContent(model: T): string | undefined {
    return this.responses[model]?.content;
  }

  getUsedTools(model: T): string[] | undefined {
    return this.responses[model]?.usedTools;
  }

  hasUsedTool(model: T, tool: string): boolean {
    return this.responses[model]?.usedTools.includes(tool) || false;
  }

  getToolCallCount(model: T, tool: string): number {
    return this.responses[model]?.toolCalls[tool]?.length || 0;
  }



  getAgentNames(): T[] {
    return this.models;
  }

  getSuccessfulAgents(): T[] {
    return Object.keys(this.responses) as T[];
  }

  getFailedAgents(): T[] {
    return this.models.filter((model) => !this.responses[model]);
  }


}

export class AgentsClient<T extends ModelName = ModelName> {
  private promptText: string = "";
  private allowedTools: string[] = [];
  public usedTools: Partial<Record<T, string[]>> = {};
  public toolCalls: Partial<Record<T, Record<string, any[]>>> = {};
  private models: T[] = [];
  private mcpServer: McpServer | null = null;
  private executionPromises: Promise<AgentResponse>[] = [];
  private config: ProviderConfig;

  constructor(mcpServer: McpServer, models: T[], config: ProviderConfig = {}) {
    this.models = models;
    this.mcpServer = mcpServer;
    this.config = config;
  }

  prompt(text: string): this {
    this.promptText = text;
    return this;
  }

  allowTools(tools: string[]): this {
    this.allowedTools = tools;
    return this;
  }

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
>>>>>>> origin/dev
}
