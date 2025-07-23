import {
  expect,
  describe,
  test,
  run,
  printResults,
  request,
} from "../src/index.js";

describe("update block tool", function () {
  test("should use update block tools", async function () {
    const agent = await request()
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
