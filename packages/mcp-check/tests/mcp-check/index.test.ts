import { client, McpServer, expect, describe, test } from "../../src/index.js";

const mcpServer = new McpServer({
  url: "https://basehub.com/api/mcp",
  authorizationToken: `Bearer ${process.env.BASEHUB_TOKEN!}`,
  name: "basehub-marketing-website",
  type: "url",
});

describe("update block tool", function () {
  test("should use update block tools", async function () {
    const agent = await client(mcpServer, ["gpt-4o"])
      .prompt(
        "change the hero title to `testing update block` from mcp-testing-library",
      )
      .allowTools(["query_content", "update_blocks", "get_content_structure"])
      .execute();

    expect(agent).toUse([
      "query_content",
      "get_content_structure",
      "update_blocks",
    ]);

    expect(agent).toBeCalledTimes("update_blocks", 1);
  });
});
