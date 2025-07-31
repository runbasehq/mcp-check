export interface ToolCall {
  args: Record<string, any>;
  result?: any;
}

export interface StreamResult {
  content: string;
  usedTools: string[];
  toolCalls: Record<string, ToolCall[]>;
}

export interface AgentResponse {
  model: string;
  content: string;
  usedTools: string[];
  toolCalls: Record<string, ToolCall[]>;
  metadata?: {
    timestamp: number;
    duration?: number;
    tokensUsed?: number;
    [key: string]: any;
  };
}

export interface AgentsExecutionResult {
  responses: Record<string, AgentResponse>;
  summary: {
    totalModels: number;
    successfulExecutions: number;
    failedExecutions: number;
    commonTools: string[];
    executionTime: number;
  };
}

export interface TypedToolCall<TArgs = Record<string, any>, TResult = any> {
  args: TArgs;
  result?: TResult;
  timestamp: number;
  duration?: number;
}

export interface ToolCallStats {
  toolName: string;
  callCount: number;
  totalDuration?: number;
  averageDuration?: number;
  lastCalled?: number;
}

export type NormalizedChunkType =
  | "text_delta"
  | "tool_call_start"
  | "tool_call_done"
  | "tool_result"
  | "message_start"
  | "message_done"
  | "thinking_delta"
  | "error";

export interface NormalizedChunk {
  type: NormalizedChunkType;
  provider: "anthropic" | "openai";
  timestamp: number;
  data: {
    text?: string;
    toolName?: string;
    toolArgs?: Record<string, any>;
    toolResult?: any;
    error?: string;
    [key: string]: any;
  };
  originalChunk?: any;
}

export type ChunkCallback = (chunk: NormalizedChunk) => void | Promise<void>;
export type ChunkTypeCallback = (data: NormalizedChunk["data"]) => void | Promise<void>;

export interface ChunkHandlerConfig {
  onTextDelta?: ChunkTypeCallback;
  onToolCallStart?: ChunkTypeCallback;
  onToolCallDone?: ChunkTypeCallback;
  onToolResult?: ChunkTypeCallback;
  onMessageStart?: ChunkTypeCallback;
  onMessageDone?: ChunkTypeCallback;
  onThinkingDelta?: ChunkTypeCallback;
  onError?: ChunkTypeCallback;
  onAnyChunk?: ChunkCallback;

  // Provider-specific handlers
  anthropic?: {
    onContentBlockDelta?: (chunk: any) => void | Promise<void>;
    onContentBlockStart?: (chunk: any) => void | Promise<void>;
    onContentBlockStop?: (chunk: any) => void | Promise<void>;
  };
  openai?: {
    onResponseOutputItemAdded?: (chunk: any) => void | Promise<void>;
    onResponseOutputItemDone?: (chunk: any) => void | Promise<void>;
  };
}
