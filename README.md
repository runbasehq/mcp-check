# mcp-check
⚠️ It's not usable yet, but docs and a stable release are coming in the next few weeks. Stay tuned.

<p align="center">
  <a href="https://x.com/fveiras_">
  <img width="1033" height="204" alt="ascii-art-image (1)" src="https://github.com/user-attachments/assets/e77a1383-c0af-4c04-92f6-ed4b941043a3" />
  </a>
</p>
<p align="center">The TypeScript MCP testing library.</p>
<p align="center">
  <a href="https://www.npmjs.com/package/mcp-check"><img alt="npm" src="https://img.shields.io/npm/v/mcp-check?style=flat-square" /></a>
</p>

A TypeScript library for testing MCP (Model Context Protocol) servers with AI models. This library allows you to execute prompts against MCP servers using various AI models (Claude, GPT) and verify tool usage and results with comprehensive streaming support and chunk handling.

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

// Execute a prompt with multiple AI models
const result = await client(mcpServer, ["claude-3-haiku-20240307", "gpt-4"])
  .prompt("What tools are available and how do they work?");

// Get comprehensive results
const executionResult = result.getExecutionResult();
console.log("Execution time:", executionResult.summary.executionTime);
console.log("Successful models:", result.getSuccessfulAgents());
console.log("Common tools used:", executionResult.summary.commonTools);

// Check specific model responses
const claudeResponse = result.getResponse("claude-3-haiku-20240307");
console.log("Claude content:", claudeResponse?.content);
console.log("Tools used by Claude:", claudeResponse?.usedTools);
```

## API Reference

### McpServer

Configure your MCP server connection:

```typescript
const mcpServer = new McpServer({
  url: string,              // MCP server URL
  authorizationToken?: string, // Optional authorization token  
  name: string,             // Server name
  type: string,             // Server type (e.g., "url")
});
```

### client(mcpServer, models, scorers?, config?)

Create a client instance to execute prompts:

```typescript
const result = await client(mcpServer, ["claude-3-haiku-20240307", "gpt-4"], {
  silent: true, // Suppress console output
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY,
  chunkHandlers: {
    onTextDelta: (data) => console.log("Text:", data.text),
    onToolCallStart: (data) => console.log("Tool started:", data.toolName),
    onError: (data) => console.error("Error:", data.error)
  }
})
  .scorers([
    {
      name: "contains id",
      tool: "list_branches",
      scorer: ({ output }) => {
        try {
          const branches = JSON.parse(output[0]?.text);
          return branches.some(branch => branch.id) ? 1 : 0;
        } catch {
          return 0;
        }
      }
    }
  ])
  .prompt("Your prompt here");
```

**Parameters:**
- `mcpServer`: Configured MCP server instance
- `models`: Array of AI model names to use
- `scorers?`: Optional array of Scorer instances for tool evaluation
- `config?`: Optional configuration including API keys, silent mode, and chunk handlers

**Supported Models:**
- Claude models: `claude-3-haiku-20240307`, `claude-3-5-sonnet-20240620`, etc.
- OpenAI models: `gpt-4`, `gpt-3.5-turbo`, etc.

### Agent Methods

#### `.prompt(text: string)`
Execute the prompt against the MCP server and return results. This method automatically executes the prompt.

#### `.scorers(scorers: Array<{name: string; tool: string; scorer: Function}>)`
Configure scorers to evaluate tool call results:
```typescript
.scorers([
  {
    name: "contains_data",
    tool: "fetch_data", 
    scorer: ({ output, input }) => {
      return output?.data ? 1 : 0;
    }
  }
])
```

#### `.allowTools(tools: string[])`
Restrict which tools can be used by the models.

### Result Methods

The `prompt()` method returns an `AgentsResult` object with these methods:

#### `getResponse(model)`
Get the response for a specific model:
```typescript
const response = result.getResponse("claude-3-haiku-20240307");
console.log(response?.content, response?.usedTools);
```

#### `getAllResponses()`
Get all model responses as a record.

#### `getExecutionResult()`
Get comprehensive execution statistics:
```typescript
const execution = result.getExecutionResult();
console.log("Total models:", execution.summary.totalModels);
console.log("Successful:", execution.summary.successfulExecutions);
console.log("Common tools:", execution.summary.commonTools);
console.log("Execution time:", execution.summary.executionTime);
```

#### `getToolStats()`
Get detailed tool usage statistics:
```typescript
const stats = result.getToolStats();
stats.forEach(stat => {
  console.log(`${stat.toolName}: ${stat.callCount} calls`);
});
```

#### `getContent(model)`
Get the content from a specific model.

#### `getUsedTools(model)`
Get tools used by a specific model.

#### `hasUsedTool(model, tool)`
Check if a model used a specific tool.

#### `getToolCallCount(model, tool)`
Get the number of times a tool was called by a model.

#### `getSuccessfulAgents()`
Get list of models that executed successfully.

#### `getFailedAgents()`
Get list of models that failed to execute.

#### `getScores(model)`
Get evaluation scores for a specific model's tool calls:
```typescript
const scores = result.getScores("claude-3-haiku-20240307");
scores.forEach(score => {
  console.log(`${score.name}: ${score.score} for tool ${score.tool}`);
});
```

## Scorer System

The scorer system allows you to evaluate and validate tool call results automatically:

```typescript
const result = await client(mcpServer, ["claude-3-haiku-20240307"])
  .scorers([
    {
      name: "valid_branches",
      tool: "list_branches",
      scorer: ({ output, input }) => {
        try {
          const branches = JSON.parse(output[0]?.text);
          return branches.every(b => b.id && b.name) ? 1 : 0;
        } catch {
          return 0;
        }
      }
    },
    {
      name: "has_results",
      tool: "search_content", 
      scorer: ({ output }) => {
        return output?.results?.length > 0 ? 1 : 0;
      }
    }
  ])
  .prompt("List all branches and search for content");

// Get scores for evaluation
const scores = result.getScores("claude-3-haiku-20240307");
console.log("Evaluation results:", scores);
```

Scorer functions receive:
- `output`: The tool's result/response
- `input`: The tool's input arguments

Return a number (typically 0-1) representing the evaluation score.

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
  test("should use expected tools across multiple models", async () => {
    const result = await client(mcpServer, ["claude-3-haiku-20240307", "gpt-4"])
      .scorers([
        {
          name: "tool_success",
          tool: "update_blocks",
          scorer: ({ output }) => output?.success ? 1 : 0
        }
      ])
      .prompt("Update the content using the available tools.");

    // Verify execution summary
    const execution = result.getExecutionResult();
    expect(execution.summary.totalModels).toBe(2);
    expect(execution.summary.successfulExecutions).toBe(2);
    expect(execution.summary.commonTools).toContain("query_content");

    // Verify specific model responses
    const claudeResponse = result.getResponse("claude-3-haiku-20240307");
    expect(claudeResponse?.usedTools).toEqual(
      expect.arrayContaining(["query_content", "update_blocks"])
    );

    const gptResponse = result.getResponse("gpt-4");
    expect(gptResponse?.usedTools).toEqual(
      expect.arrayContaining(["query_content", "update_blocks"])
    );

    // Verify tool call details
    expect(result.hasUsedTool("claude-3-haiku-20240307", "query_content")).toBe(true);
    expect(result.getToolCallCount("claude-3-haiku-20240307", "update_blocks")).toBeGreaterThan(0);

    // Verify successful agents
    expect(result.getSuccessfulAgents()).toContain("claude-3-haiku-20240307");
    expect(result.getSuccessfulAgents()).toContain("gpt-4");
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
