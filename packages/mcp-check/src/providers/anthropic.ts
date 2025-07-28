import Anthropic from "@anthropic-ai/sdk";
import { Provider, type StreamResult } from "./provider.js";
import type { McpServer } from "../index.js";

export class AnthropicProvider extends Provider {
  private client: Anthropic | null;

  constructor(mcpServer: McpServer, promptText: string) {
    super(mcpServer, promptText);
    this.client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
  }

  isValidModel(model: string): boolean {
    return model.startsWith("claude") || model.startsWith("claude-");
  }

  async stream(model: string): Promise<StreamResult> {
    if (!this.client) {
      throw new Error(
        "Anthropic client not initialized. Please set ANTHROPIC_API_KEY environment variable.",
      );
    }

    const stream = this.client.beta.messages.stream({
      model: model as Anthropic.Model,
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: this.promptText,
        },
      ],
      mcp_servers: [
        {
          url: this.mcpServer.url,
          authorization_token: this.mcpServer.authorizationToken,
          name: this.mcpServer.name,
          type: "url",
        },
      ],
      betas: ["mcp-client-2025-04-04"],
    });

    let content = "";
    const usedTools: string[] = [];
    const toolCalls: Record<string, any[]> = {};

    for await (const chunk of stream) {
      if (
        chunk.type === "content_block_delta" &&
        chunk.delta.type === "text_delta"
      ) {
        content += chunk.delta.text;
        process.stdout.write(JSON.stringify(chunk.delta.text));
      } else if (
        chunk.type === "content_block_start" &&
        chunk.content_block.type === "mcp_tool_use"
      ) {
        const toolName = chunk.content_block.name;
        usedTools.push(toolName);

        if (!toolCalls[toolName]) {
          toolCalls[toolName] = [];
        }

        toolCalls[toolName].push({
          args: chunk.content_block.input || {},
          result: null,
        });
      } else if (chunk.type === "content_block_stop") {
        // Tool execution finished - we'll get the result from finalMessage
      }
    }

    const finalMessage = await stream.finalMessage();

    // Update tool call results from the final message
    if (finalMessage.content) {
      for (const block of finalMessage.content) {
        if (block.type === "mcp_tool_result") {
          // Find the tool call by matching with the order of tool executions
          const toolNames = Object.keys(toolCalls);
          for (const toolName of toolNames) {
            if (toolCalls[toolName] && toolCalls[toolName].length > 0) {
              const lastCall =
                toolCalls[toolName][toolCalls[toolName].length - 1];
              if (lastCall && lastCall.result === null) {
                lastCall.result = block.content;
                break;
              }
            }
          }
        }
      }
    }

    return { usedTools, content, toolCalls };
  }
}
