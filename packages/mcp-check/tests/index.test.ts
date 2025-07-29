import { client, McpServer } from "../src/index";

const mcpServer = new McpServer({
  url: "https://basehub.com/api/mcp",
  authorizationToken: process.env.BASEHUB_TOKEN!,
  name: "basehub-marketing-website",
  type: "url",
});

describe("update block tool", function () {
  test("should use update block tools", async function () {
    const agent = await client(mcpServer, [
      "claude-3-haiku-20240307",
      // "claude-3-5-haiku-latest",
    ])
      .prompt("Change the hero title to testing update block on Basehub.")
      .execute();

    expect(agent.usedTools).toHaveProperty("claude-3-haiku-20240307");
    expect(agent.usedTools["claude-3-haiku-20240307"]!).toEqual(
      expect.arrayContaining([
        "query_content",
        "get_content_structure",
        "update_blocks",
      ]),
    );

    const queryCalls =
      agent.toolCalls?.["claude-3-haiku-20240307"]?.["query_content"] ?? [];
    expect(queryCalls.length).toBe(1);

    const updateBlocks =
      agent.toolCalls?.["claude-3-haiku-20240307"]?.["update_blocks"] ?? [];
    const firstResult = updateBlocks[0]?.result;
    expect(typeof firstResult?.id).toBe("string");
  }, 120000);
});
