# mcp-check

<p align="center">
  <a href="https://x.com/fveiras_">
  <img width="1033" height="204" alt="ascii-art-image (1)" src="https://github.com/user-attachments/assets/e77a1383-c0af-4c04-92f6-ed4b941043a3" />
  </a>
</p>
<p align="center">The TypeScript MCP testing library.</p>
<p align="center">
  <a href="https://www.npmjs.com/package/mcp-check"><img alt="npm" src="https://img.shields.io/npm/v/mcp-check?style=flat-square" /></a>
</p>

A TypeScript library for testing MCP (Model Context Protocol) servers with AI models. This library allows you to execute prompts against MCP servers using various AI models (Claude, GPT) and verify tool usage and results.

## Installation

```bash
npm install mcp-check
# or
pnpm add mcp-check
```

## Quick Start

```typescript
import { client, McpServer } from "mcp-check";

// Configure your MCP server
const mcpServer = new McpServer({
  url: "https://example.com/api/mcp",
  authorizationToken: process.env.MCP_TOKEN!,
  name: "example-server",
  type: "url",
});

// Execute a prompt with AI models
const agent = await client(mcpServer, ["claude-3-haiku-20240307"])
  .prompt("Update the content using the available tools.")
  .execute();

// Check which tools were used
console.log("Used tools:", agent.usedTools);
console.log("Tool calls:", agent.toolCalls);
```

## API Reference

### McpServer

Configure your MCP server connection:

```typescript
const mcpServer = new McpServer({
  url: string,              // MCP server URL
  authorizationToken: string, // Authorization token
  name: string,             // Server name
  type: string,             // Server type (e.g., "url")
});
```

### client(mcpServer, models)

Create a client instance to execute prompts:

```typescript
const agent = client(mcpServer, ["claude-3-haiku-20240307", "gpt-4"])
  .prompt("Your prompt here")
  .execute();
```

**Parameters:**
- `mcpServer`: Configured MCP server instance
- `models`: Array of AI model names to use

**Supported Models:**
- Claude models: `claude-3-haiku-20240307`, `claude-3-5-sonnet-20240620`, etc.
- OpenAI models: `gpt-4`, `gpt-3.5-turbo`, etc.

### Agent Methods

#### `.prompt(text: string)`
Set the prompt to execute against the MCP server.

#### `.execute()`
Execute the prompt and return results with tool usage tracking.

### Agent Properties

After execution, the agent provides:

#### `usedTools`
Record of tools used by each model:
```typescript
agent.usedTools["claude-3-haiku-20240307"] // ["query_content", "update_blocks"]
```

#### `toolCalls`
Detailed tool call information including arguments and results:
```typescript
agent.toolCalls["claude-3-haiku-20240307"]["update_blocks"][0].result
```

## Testing Example

```typescript
import { client, McpServer } from "mcp-check";

const mcpServer = new McpServer({
  url: "https://example.com/api/mcp",
  authorizationToken: process.env.MCP_TOKEN!,
  name: "example-server",
  type: "url",
});

describe("MCP Server Tests", () => {
  test("should use expected tools", async () => {
    const agent = await client(mcpServer, ["claude-3-haiku-20240307"])
      .prompt("Update the content using the available tools.")
      .execute();

    // Verify tools were used
    expect(agent.usedTools).toHaveProperty("claude-3-haiku-20240307");
    expect(agent.usedTools["claude-3-haiku-20240307"]!).toEqual(
      expect.arrayContaining([
        "query_content",
        "get_content_structure",
        "update_blocks",
      ]),
    );

    // Verify tool calls
    const queryCalls =
      agent.toolCalls?.["claude-3-haiku-20240307"]?.["query_content"] ?? [];
    expect(queryCalls.length).toBeGreaterThan(0);

    const updateBlocks =
      agent.toolCalls?.["claude-3-haiku-20240307"]?.["update_blocks"] ?? [];
    expect(updateBlocks.length).toBeGreaterThan(0);
    expect(updateBlocks[0]?.result).toBeDefined();
  }, 90000);
});
```

## Environment Variables

Set the following environment variables for AI model authentication:

```bash
ANTHROPIC_API_KEY=your_anthropic_key_here
OPENAI_API_KEY=your_openai_key_here
MCP_TOKEN=your_mcp_server_token_here
```
