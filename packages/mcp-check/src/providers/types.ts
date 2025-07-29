export interface ToolCall {
  args: Record<string, any>;
  result?: any;
}

export interface StreamResult {
  usedTools: string[];
  content: string;
  toolCalls: Record<string, ToolCall[]>;
}

export interface ProviderConfig {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  [key: string]: any;
} 