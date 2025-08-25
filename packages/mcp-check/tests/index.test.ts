import { createClient, McpServer } from "../src/index";

// const mcpServer = new McpServer({
//   url: "https://basehub.com/api/mcp",
//   authorizationToken: process.env.BASEHUB_TOKEN!,
//   name: "basehub-marketing-website",
//   type: "url",
// });

// describe("get branches tool", function () {
//   test("should retrieve available branches from Basehub", async function () {
//     const result = await createClient(mcpServer, ["z-ai/glm-4.5-air:free"], {
//       silent: false,
//     })
//       .scorers([
//         {
//           name: "contains id",
//           tool: "list_branches",
//           scorer: (output) => {
//             try {
//               const resultText = output[0]?.text;
//               const branches = JSON.parse(resultText);
//               return branches.some((branch: { id: string }) => branch.id)
//                 ? 1
//                 : 0;
//             } catch (e) {
//               console.log("Parse error:", e);
//               return 0;
//             }
//           },
//         },
//       ])
//       .prompt("What branches are available in this Basehub repo?");

//     expect(result.hasUsedTool("z-ai/glm-4.5-air:free", "list_branches")).toBe(
//       true,
//     );
//     expect(result.getUsedTools("z-ai/glm-4.5-air:free")).toEqual(
//       expect.arrayContaining(["list_branches"]),
//     );

//     expect(
//       result.getToolCallCount("z-ai/glm-4.5-air:free", "list_branches"),
//     ).toBeGreaterThan(0);

//     const response = result.getResponse("z-ai/glm-4.5-air:free");

//     expect(response).toBeDefined();
//     expect(response?.content).toBeDefined();
//     expect(response?.metadata?.duration).toBeGreaterThan(0);

//     const executionResult = result.getExecutionResult();
//     expect(executionResult.summary.totalModels).toBe(1);
//     expect(executionResult.summary.successfulExecutions).toBeGreaterThan(0);
//     expect(executionResult.summary.executionTime).toBeGreaterThan(0);

//     expect(executionResult.responses["z-ai/glm-4.5-air:free"]).toBeDefined();
//     expect(executionResult.responses["z-ai/glm-4.5-air:free"]).toBeDefined();

//     expect(result.getResponse("z-ai/glm-4.5-air:free")).toBeDefined();
//     expect(result.getAgentNames()).toContain("z-ai/glm-4.5-air:free");
//     expect(result.getAgentNames()).toContain("z-ai/glm-4.5-air:free");
//     expect(result.getSuccessfulAgents()).toHaveLength(1);
//     expect(result.getFailedAgents()).toHaveLength(0);

//     const allAgents = result.getAllResponses();
//     expect(Object.keys(allAgents)).toHaveLength(1);
//     expect(allAgents["z-ai/glm-4.5-air:free"]).toBeDefined();
//   }, 120000);
// });

const mcpServer = new McpServer({
  url: "https://api.githubcopilot.com/mcp/",
  authorizationToken: process.env.GITHUB_PAT ?? "",
  name: "github",
  type: "url",
});

describe("GitHub MCP Scorer", function () {
  test("search_repositories returns repos with full_name", async function () {
    const result = await createClient(mcpServer, ["z-ai/glm-4.5-air:free"], {
      silent: false,
    })
      .scorers([
        {
          name: "valid_repos",
          tool: "search_repositories",
          scorer: ({ output }) => {
            const text =
              output?.content?.find((p: any) => p?.type === "text")?.text ?? "";
            let parsed: any;
            try {
              parsed = JSON.parse(text);
            } catch {
              return 0;
            }

            const items = Array.isArray(parsed?.items) ? parsed.items : [];

            return items.some(
              (r: any) =>
                (r.clone_url || "").toLowerCase() ===
                "https://github.com/microsoft/typescript.git",
            )
              ? 1
              : 0;
          },
        },
      ])
      .prompt(
        "Use the 'search_repositories' tool with query: typescript. Find the official TypeScript repository by Microsoft and return exactly how many stars it has. Return only the JSON result.",
      );

    expect(
      result.hasUsedTool("z-ai/glm-4.5-air:free", "search_repositories"),
    ).toBe(true);

    expect(
      result.hasUsedTool("z-ai/glm-4.5-air:free", "search_repositories"),
    ).toBe(true);

    const scores = result.getScores("z-ai/glm-4.5-air:free");

    const validReposScore = scores.find(
      (s) => s.name === "valid_repos" && s.tool === "search_repositories",
    );

    expect(validReposScore?.score).toBe(1);

    // console.log(
    //   "tool calls",
    //   result.getResponse("z-ai/glm-4.5-air:free")?.toolCalls["search_repositories"][0]
    //     .result,
    // );
  }, 240000);
});
