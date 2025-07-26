# @mcp-check/agents

Multi-provider AI agent framework for Model Context Protocol (MCP) servers.

## Installation

```bash
npm install @mcp-check/agents
```

## Usage

```typescript
import { client, McpServer } from '@mcp-check/agents';

// Create an MCP server configuration
const mcpServer = new McpServer({
  url: 'your-mcp-server-url',
  authorizationToken: 'your-auth-token',
  name: 'your-server-name',
  type: 'your-server-type'
});

// Initialize client with models
const agents = client(mcpServer, ['claude-3-haiku-20240307', 'gpt-4']);

// Execute with prompt
const result = await agents
  .prompt('Your prompt here')
  .allowTools(['tool1', 'tool2'])
  .execute();

console.log(result.usedTools);
```

## API

### `McpServer`

Configuration class for MCP server connection.

#### Constructor

```typescript
new McpServer({
  url: string;
  authorizationToken: string;
  name: string;
  type: string;
})
```

### `client(mcpServer, models)`

Creates an `Agents` instance.

- `mcpServer`: McpServer instance
- `models`: Array of AI model identifiers

### `Agents`

Main agent execution class.

#### Methods

- `prompt(text: string)`: Set the prompt text
- `allowTools(tools: string[])`: Specify allowed tools
- `execute()`: Execute the agent with configured models

## Supported Models

- Anthropic models (Claude)
- OpenAI models (GPT)

## License

MIT