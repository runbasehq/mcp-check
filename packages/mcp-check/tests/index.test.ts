import { client, McpServer } from "../src/index";

const mcpServer = new McpServer({
  url: "https://basehub.com/api/mcp",
  authorizationToken: process.env.BASEHUB_TOKEN!,
  name: "basehub-marketing-website",
  type: "url",
});

describe("get branches tool", function () {
  test("should retrieve available branches from Basehub", async function () {
    const result = await client(mcpServer, [
      "anthropic/claude-3-haiku-20240307",
      "anthropic/claude-3-5-haiku-20241022",
    ])
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
      result.hasUsedTool(
        "anthropic/claude-3-5-haiku-20241022",
        "list_branches",
      ),
    ).toBe(true);
    expect(result.getUsedTools("anthropic/claude-3-5-haiku-20241022")).toEqual(
      expect.arrayContaining(["list_branches"]),
    );

    expect(
      result.getToolCallCount(
        "anthropic/claude-3-5-haiku-20241022",
        "list_branches",
      ),
    ).toBeGreaterThan(0);

    const response = result.getResponse("anthropic/claude-3-5-haiku-20241022");

    expect(response).toBeDefined();
    expect(response?.content).toBeDefined();
    expect(response?.metadata?.duration).toBeGreaterThan(0);

    const executionResult = result.getExecutionResult();
    expect(executionResult.summary.totalModels).toBe(2);
    expect(executionResult.summary.successfulExecutions).toBeGreaterThan(0);
    expect(executionResult.summary.executionTime).toBeGreaterThan(0);

    expect(
      executionResult.responses["anthropic/claude-3-haiku-20240307"],
    ).toBeDefined();
    expect(
      executionResult.responses["anthropic/claude-3-5-haiku-20241022"],
    ).toBeDefined();

    expect(
      result.getResponse("anthropic/claude-3-5-haiku-20241022"),
    ).toBeDefined();
    expect(result.getAgentNames()).toContain(
      "anthropic/claude-3-haiku-20240307",
    );
    expect(result.getAgentNames()).toContain(
      "anthropic/claude-3-5-haiku-20241022",
    );
    expect(result.getSuccessfulAgents()).toHaveLength(2);
    expect(result.getFailedAgents()).toHaveLength(0);

    const allAgents = result.getAllResponses();
    expect(Object.keys(allAgents)).toHaveLength(2);
    expect(allAgents["anthropic/claude-3-haiku-20240307"]).toBeDefined();
    expect(allAgents["anthropic/claude-3-5-haiku-20241022"]).toBeDefined();
  }, 120000);
});
