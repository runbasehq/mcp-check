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
      case "text_start":
        if (handlers.onTextStart) {
          await handlers.onTextStart(normalizedChunk.data);
        }
        break;
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
      case "tool_call_delta":
        if (handlers.onToolCallDelta) {
          await handlers.onToolCallDelta(normalizedChunk.data);
        }
        break;
      case "tool_result":
        if (handlers.onToolResult) {
          await handlers.onToolResult(normalizedChunk.data);
        }
        break;
      case "block_stop":
        if (handlers.onBlockStop) {
          await handlers.onBlockStop(normalizedChunk.data);
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
