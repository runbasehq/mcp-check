import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

interface TestResult {
  name: string;
  passed: boolean;
  error?: Error;
}

interface SuiteResult {
  name: string;
  tests: TestResult[];
  suites: SuiteResult[];
}

// let client: Client | undefined = undefined;
// const baseUrl = new URL("http://127.0.0.1:3005/mcp");
const anthropic = new Anthropic();

export class Agent {
  private promptText: string = "";
  private allowedTools: string[] = [];
  public usedTools: string[] = [];
  private response: any = null;

  prompt(text: string): this {
    this.promptText = text;
    return this;
  }

  allowTools(tools: string[]): this {
    this.allowedTools = tools;
    return this;
  }

  async execute(): Promise<this> {
    const response = await anthropic.beta.messages.create({
      model: "claude-3-5-sonnet-20240620",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: this.promptText,
        },
      ],
      mcp_servers: [
        {
          url: "https://basehub.com/api/mcp",
          authorization_token: process.env.BASEHUB_TOKEN!,
          name: "basehub-marketing-website",
          type: "url",
        },
      ],
      betas: ["mcp-client-2025-04-04"],
    });

    this.response = response;

    this.usedTools = response.content
      .filter((item: any) => item.type === "mcp_tool_use")
      .map((item: any) => item.name);

    console.log("Used tools:", this.usedTools);

    return this;
  }
}

export class Expectation {
  constructor(private actual: any) {}

  toBe(expected: any): void {
    if (this.actual !== expected) {
      throw new Error(`Expected ${this.actual} to be ${expected}`);
    }
  }

  toUse(expectedTools: string[]): void {
    if (!Array.isArray(this.actual)) {
      throw new Error(
        `Expected an array of used tools, got ${typeof this.actual}`,
      );
    }

    const usedTools = this.actual as string[];

    for (const tool of expectedTools) {
      if (!usedTools.includes(tool)) {
        throw new Error(
          `Expected tool '${tool}' to be used, but it wasn't. Used tools: ${usedTools.join(", ")}`,
        );
      }
    }

    console.log(`✓ All expected tools were used: ${expectedTools.join(", ")}`);
  }
}

export function request(app?: any): Agent {
  return new Agent();
}

export function expect(actual: any): Expectation {
  return new Expectation(actual);
}

export class TestSuite {
  private tests: Array<{ name: string; fn: () => void }> = [];
  private suites: Array<{ name: string; suite: TestSuite }> = [];
  private currentSuite: TestSuite | null = null;

  describe(name: string, cb: () => void): this {
    const suite = new TestSuite();
    this.suites.push({ name, suite });

    const originalSuite = this.currentSuite;
    this.currentSuite = suite;
    cb();
    this.currentSuite = originalSuite;

    return this;
  }

  test(name: string, fn: () => void): this {
    this.tests.push({ name, fn });
    return this;
  }

  it(name: string, fn: () => void): this {
    return this.test(name, fn);
  }

  async run(): Promise<SuiteResult> {
    const testResults: TestResult[] = [];

    for (const test of this.tests) {
      try {
        test.fn();
        testResults.push({ name: test.name, passed: true });
      } catch (error) {
        testResults.push({
          name: test.name,
          passed: false,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }

    const suiteResults: SuiteResult[] = [];
    for (const suite of this.suites) {
      suiteResults.push(await suite.suite.run());
    }

    return {
      name: "TestSuite",
      tests: testResults,
      suites: suiteResults,
    };
  }

  printResults(result: SuiteResult, indent: string = ""): void {
    if (result.name !== "TestSuite") {
      console.log(`${indent}${result.name}`);
      indent += "  ";
    }

    for (const test of result.tests) {
      const status = test.passed ? "✓" : "✗";
      console.log(`${indent}${status} ${test.name}`);
      if (!test.passed && test.error) {
        console.log(`${indent}  Error: ${test.error.message}`);
      }
    }

    for (const suite of result.suites) {
      this.printResults(suite, indent);
    }
  }
}

const globalSuite = new TestSuite();

export function describe(name: string, cb: () => void): void {
  globalSuite.describe(name, cb);
}

export function test(name: string, fn: () => void): void {
  globalSuite.test(name, fn);
}

export function it(name: string, fn: () => void): void {
  globalSuite.it(name, fn);
}

export async function run(): Promise<SuiteResult> {
  return globalSuite.run();
}

export function printResults(result?: SuiteResult, indent?: string): void {
  if (result) {
    globalSuite.printResults(result, indent);
  } else {
    globalSuite.run().then((results) => globalSuite.printResults(results));
  }
}
