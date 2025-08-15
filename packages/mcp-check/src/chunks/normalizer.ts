import type OpenAI from "openai";
import type { NormalizedChunk, ChunkHandlerConfig } from "./types.js";

export class ChunkNormalizer {
  static async processChunk(normalizedChunk: NormalizedChunk, handlers: ChunkHandlerConfig): Promise<void> {
    // Provider-specific
    if (normalizedChunk.provider === "anthropic") {
      if (handlers.anthropic?.onContentBlockDelta && normalizedChunk.originalChunk?.type === "content_block_delta") {
        await handlers.anthropic.onContentBlockDelta(normalizedChunk.originalChunk);
      }
      if (handlers.anthropic?.onContentBlockStart && normalizedChunk.originalChunk?.type === "content_block_start") {
        await handlers.anthropic.onContentBlockStart(normalizedChunk.originalChunk);
      }
      if (handlers.anthropic?.onContentBlockStop && normalizedChunk.originalChunk?.type === "content_block_stop") {
        await handlers.anthropic.onContentBlockStop(normalizedChunk.originalChunk);
      }
    } else if (normalizedChunk.provider === "openai") {
      if (handlers.openai?.onResponseOutputItemAdded && normalizedChunk.originalChunk?.type === "response.output_item.added") {
        await handlers.openai.onResponseOutputItemAdded(normalizedChunk.originalChunk);
      }
      if (handlers.openai?.onResponseOutputItemDone && normalizedChunk.originalChunk?.type === "response.output_item.done") {
        await handlers.openai.onResponseOutputItemDone(normalizedChunk.originalChunk);
      }
    } else if (normalizedChunk.provider === "openrouter") {
      if (handlers.openrouter?.onChatCompletionChunk) {
        await handlers.openrouter.onChatCompletionChunk(normalizedChunk.originalChunk as OpenAI.Chat.ChatCompletionChunk);
      }
    }

    switch (normalizedChunk.type) {
      case "text_delta":
        if (handlers.onTextDelta) {
          await handlers.onTextDelta(normalizedChunk.data);
        }
        break;
      case "tool_call_start":
        if (handlers.onToolCallStart) {
          await handlers.onToolCallStart(normalizedChunk.data);
        }
        break;
      case "tool_call_done":
        if (handlers.onToolCallDone) {
          await handlers.onToolCallDone(normalizedChunk.data);
        }
        break;
      case "tool_result":
        if (handlers.onToolResult) {
          await handlers.onToolResult(normalizedChunk.data);
        }
        break;
      case "message_start":
        if (handlers.onMessageStart) {
          await handlers.onMessageStart(normalizedChunk.data);
        }
        break;
      case "message_done":
        if (handlers.onMessageDone) {
          await handlers.onMessageDone(normalizedChunk.data);
        }
        break;
      case "thinking_delta":
        if (handlers.onThinkingDelta) {
          await handlers.onThinkingDelta(normalizedChunk.data);
        }
        break;
      case "error":
        if (handlers.onError) {
          await handlers.onError(normalizedChunk.data);
        }
        break;
    }

    if (handlers.onAnyChunk) {
      await handlers.onAnyChunk(normalizedChunk);
    }
  }
}
