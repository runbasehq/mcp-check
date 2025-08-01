/**
 * Represents an MCP server configuration.
 * Contains the necessary information to connect to and authenticate with an MCP server.
 */
export class McpServer {
  public url: string;
  public authorizationToken?: string;
  public name: string;
  public type: string;

  /**
   * Creates a new McpServer instance.
   * 
   * @param url - The MCP server URL
   * @param authorizationToken - The authorization token for the server
   * @param name - The server name/identifier
   * @param type - The server type (e.g., "url")
   * 
   * @example
   * ```typescript
   * const mcpServer = new McpServer({
   *   url: "https://example.com/api/mcp",
   *   authorizationToken: process.env.MCP_TOKEN!,
   *   name: "example-server",
   *   type: "url"
   * });
   * ```
   */
  constructor({ url, authorizationToken, name, type }: { url: string; authorizationToken?: string; name: string; type: string }) {
    this.url = url;
    this.authorizationToken = authorizationToken;
    this.name = name;
    this.type = type;
  }
} 