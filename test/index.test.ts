import {
  expect,
  describe,
  test,
  run,
  printResults,
  request,
} from "../src/index.js";

describe("update block tool", function () {
  test("responds with json", async function () {
    const agent = await request()
      .prompt(
        "change the hero title to `testing update block` from mcp-testing-library",
      )
      .allowTools(["query_content", "update_blocks", "get_content_structure"])
      .execute();

    expect(agent.usedTools).toUse([
      "query_content",
      "get_content_structure",
      "update_blocks",
    ]);
  });
});

async function runTests() {
  const results = await run();
  printResults(results);
}

runTests().catch(console.error);
