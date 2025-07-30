import { client, McpServer } from "../src/index";

const mcpServer = new McpServer({
  url: "https://basehub.com/api/mcp",
  authorizationToken: process.env.BASEHUB_TOKEN!,
  name: "basehub-marketing-website",
  type: "url",
});

// describe("update block tool", function () {
//   test("should use update block tools", async function () {
//     const agent = await client(mcpServer, [
//       "claude-3-haiku-20240307",
//       // "claude-3-5-haiku-latest",
//     ])
//       .prompt("Change the hero title to testing update block on Basehub.")
//       .execute();

//     expect(agent.usedTools).toHaveProperty("claude-3-haiku-20240307");
//     expect(agent.usedTools["claude-3-haiku-20240307"]!).toEqual(
//       expect.arrayContaining([
//         "query_content",
//         "get_content_structure",
//         "update_blocks",
//       ]),
//     );

//     const queryCalls =
//       agent.toolCalls?.["claude-3-haiku-20240307"]?.["query_content"] ?? [];
//     expect(queryCalls.length).toBe(1);

//     const updateBlocks =
//       agent.toolCalls?.["claude-3-haiku-20240307"]?.["update_blocks"] ?? [];
//     const firstResult = updateBlocks[0]?.result;
//     expect(typeof firstResult?.id).toBe("string");
//   }, 120000);
// });

describe("get branches tool", function () {
  test("should retrieve available branches from Basehub", async function () {
    const agent = await client(mcpServer, [
      "claude-3-haiku-20240307",
      "claude-3-5-haiku-20241022",
    ])
      .prompt("What branches are available in this Basehub repo?")
      .execute();

    expect(agent.usedTools).toHaveProperty("claude-3-5-haiku-20241022");
    expect(agent.usedTools["claude-3-5-haiku-20241022"]!).toEqual(
      expect.arrayContaining(["list_branches"]),
    );

    const getBranchesCalls =
      agent.toolCalls?.["claude-3-5-haiku-20241022"]?.["list_branches"] ?? [];

    expect(getBranchesCalls.length).toBeGreaterThan(0);

    // const result = getBranchesCalls[0]?.result;
    // expect(Array.isArray(result)).toBe(true);
    // expect(typeof result[0]?.name).toBe("string");
  }, 120000);
});
