import { client, McpServer } from "@mcp-check/agents";
import { expect, describe, test, run, printResults } from "../src/index.js";

const mcpServer = new McpServer({
  url: "https://mcp.deepwiki.com/mcp",
  authorizationToken: process.env.BASEHUB_TOKEN!,
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

async function runTests() {
  console.log("Starting test run...");
  try {
    const results = await run();
    console.log("Tests completed, printing results...");
    printResults(results);
  } catch (error) {
    console.error("Error running tests:", error);
  }
}

runTests().catch(console.error);
