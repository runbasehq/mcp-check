import { client, McpServer } from "../src/index";

const mcpServer = new McpServer({
  url: "https://basehub.com/api/mcp",
  authorizationToken: process.env.BASEHUB_TOKEN!,
  name: "basehub-marketing-website",
  type: "url",
});

describe("get branches tool", function () {
  test("should retrieve available branches from Basehub", async function () {
    const result = await client(
      mcpServer,
      ["openrouter/qwen/qwen3-coder:free"],
      { silent: false },
    )
      .scorers([
        {
          name: "contains id",
          tool: "list_branches",
          scorer: (output) => {
            try {
              const resultText = output[0]?.text;
              const branches = JSON.parse(resultText);
              return branches.some((branch: { id: string }) => branch.id)
                ? 1
                : 0;
            } catch (e) {
              console.log("Parse error:", e);
              return 0;
            }
          },
        },
      ])
      .prompt("What branches are available in this Basehub repo?");

    expect(
      result.hasUsedTool("openrouter/qwen/qwen3-coder:free", "list_branches"),
    ).toBe(true);
    expect(result.getUsedTools("openrouter/qwen/qwen3-coder:free")).toEqual(
      expect.arrayContaining(["list_branches"]),
    );

    expect(
      result.getToolCallCount(
        "openrouter/qwen/qwen3-coder:free",
        "list_branches",
      ),
    ).toBeGreaterThan(0);

    const response = result.getResponse("openrouter/qwen/qwen3-coder:free");

    expect(response).toBeDefined();
    expect(response?.content).toBeDefined();
    expect(response?.metadata?.duration).toBeGreaterThan(0);

    const executionResult = result.getExecutionResult();
    expect(executionResult.summary.totalModels).toBe(1);
    expect(executionResult.summary.successfulExecutions).toBeGreaterThan(0);
    expect(executionResult.summary.executionTime).toBeGreaterThan(0);

    expect(
      executionResult.responses["openrouter/qwen/qwen3-coder:free"],
    ).toBeDefined();
    expect(
      executionResult.responses["openrouter/qwen/qwen3-coder:free"],
    ).toBeDefined();

    expect(
      result.getResponse("openrouter/qwen/qwen3-coder:free"),
    ).toBeDefined();
    expect(result.getAgentNames()).toContain(
      "openrouter/qwen/qwen3-coder:free",
    );
    expect(result.getAgentNames()).toContain(
      "openrouter/qwen/qwen3-coder:free",
    );
    expect(result.getSuccessfulAgents()).toHaveLength(1);
    expect(result.getFailedAgents()).toHaveLength(0);

    const allAgents = result.getAllResponses();
    expect(Object.keys(allAgents)).toHaveLength(1);
    // expect(allAgents["anthropic/claude-3-haiku-20240307"]).toBeDefined();
    expect(allAgents["openrouter/qwen/qwen3-coder:free"]).toBeDefined();
  }, 120000);
});

// const mcpServer = new McpServer({
//   url: "https://api.githubcopilot.com/mcp/",
//   authorizationToken: process.env.GITHUB_PAT ?? "",
//   name: "github",
//   type: "url",
// });

// describe("GitHub MCP Scorer", function () {
//   test("search_repositories returns repos with full_name", async function () {
//     const result = await client(
//       mcpServer,
//       [
//         "openrouter/qwen/qwen3-coder:free",
//         "openrouter/z-ai/glm-4.5-air:free",
//         "anthropic/claude-3-5-haiku-20241022",
//       ],
//       { silent: false },
//     )
//       .scorers([
//         {
//           name: "valid_repos",
//           tool: "search_repositories",
//           scorer: ({ output }) => {
//             const text =
//               output?.content?.find((p: any) => p?.type === "text")?.text ?? "";
//             let parsed: any;
//             try {
//               parsed = JSON.parse(text);
//             } catch {
//               return 0;
//             }

//             const items = Array.isArray(parsed?.items) ? parsed.items : [];

//             return items.some(
//               (r: any) =>
//                 (r.clone_url || "").toLowerCase() ===
//                 "https://github.com/microsoft/typescript.git",
//             )
//               ? 1
//               : 0;
//           },
//         },
//       ])
//       .prompt(
//         "Use the 'search_repositories' tool with query: typescript. Find the official TypeScript repository by Microsoft and return exactly how many stars it has. Return only the JSON result.",
//       );

//     expect(
//       result.hasUsedTool(
//         "openrouter/qwen/qwen3-coder:free",
//         "search_repositories",
//       ),
//     ).toBe(true);

//     expect(
//       result.hasUsedTool(
//         "openrouter/qwen/qwen3-coder:free",
//         "search_repositories",
//       ),
//     ).toBe(true);

//     const scores = result.getScores("openrouter/qwen/qwen3-coder:free");

//     const validReposScore = scores.find(
//       (s) => s.name === "valid_repos" && s.tool === "search_repositories",
//     );

//     expect(validReposScore?.score).toBe(1);

//     // console.log(
//     //   "tool calls",
//     //   result.getResponse("openrouter/qwen/qwen3-coder:free")?.toolCalls[
//     //     "search_repositories"
//     //   ][0].result,
//     // );
//   }, 240000);
// });
