export { client, McpServer } from "mcp-check-agents";

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

class Expectation {
  constructor(private actual: any) {}

  toBe(expected: any): void {
    if (this.actual !== expected) {
      throw new Error(`Expected ${this.actual} to be ${expected}`);
    }
  }

  toUse(expectedTools: string[]): void {
    const usedToolsDict = this.actual.usedTools as Record<string, string[]>;
    const allUsedTools = Object.values(usedToolsDict).flat();

    for (const tool of expectedTools) {
      if (!allUsedTools.includes(tool)) {
        throw new Error(
          `Expected tool '${tool}' to be used, but it wasn't. Used tools: ${allUsedTools.join(", ")}`,
        );
      }
    }

    console.log(`✓ All expected tools were used: ${expectedTools.join(", ")}`);
  }

  toBeCalledTimes(tool: string, times: number): void {
    const usedToolsDict = this.actual.usedTools as Record<string, string[]>;
    const allUsedTools = Object.values(usedToolsDict).flat();

    const timesUsed = allUsedTools.reduce((acc, current) => {
      if (current === tool) {
        return acc + 1;
      }

      return acc;
    }, 0);

    if (timesUsed !== times) {
      throw new Error(
        `Expected tool '${tool}' to be called ${times} times, but it was called ${timesUsed} times`,
      );
    }

    console.log(`✓ Tool '${tool}' was called ${times} times as expected`);
  }
}

export function expect(actual: any): Expectation {
  return new Expectation(actual);
}

class TestSuite {
  private tests: Array<{ name: string; fn: () => void | Promise<void> }> = [];
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

  test(name: string, fn: () => void | Promise<void>): this {
    this.tests.push({ name, fn });
    return this;
  }

  it(name: string, fn: () => void | Promise<void>): this {
    return this.test(name, fn);
  }

  async run(): Promise<SuiteResult> {
    const testResults: TestResult[] = [];

    for (const test of this.tests) {
      try {
        const result = test.fn();
        // Handle async tests
        if (result instanceof Promise) {
          await result;
        }
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

(globalThis as any).globalSuite = globalSuite;

export function describe(name: string, cb: () => void): void {
  globalSuite.describe(name, cb);
}

export function test(name: string, fn: () => void | Promise<void>): void {
  globalSuite.test(name, fn);
}

export function it(name: string, fn: () => void | Promise<void>): void {
  globalSuite.it(name, fn);
}
