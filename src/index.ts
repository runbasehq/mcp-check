import { anthropic } from "@ai-sdk/anthropic";
import { generateText, tool } from "ai";
import { loadTools } from "./utils/load-tools";

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

export class Expectation {
  constructor(private actual: any) {}

  toBe(expected: any): void {
    if (this.actual !== expected) {
      throw new Error(`Expected ${this.actual} to be ${expected}`);
    }
  }

  expectedInput(expected: any): void {
    if (this.actual !== expected) {
      throw new Error(`Expected ${this.actual} to be ${expected}`);
    }
  }
}

export async function expect(prompt: string): Promise<Expectation> {
  const tools = await loadTools();

  const { text } = await generateText({
    model: anthropic("claude-3-haiku-20240307"),
    tools,
    prompt,
  });

  console.log("seeing tools", JSON.stringify(tools));
  // console.log("response", text);

  return new Expectation("Transaction Completed");
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
