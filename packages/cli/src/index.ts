#!/usr/bin/env node

import { config } from "dotenv";
import { glob } from "glob";
import { pathToFileURL } from "url";
import * as path from "path";
import { formatDuration, showHelp } from "./utils";

config({ path: path.resolve(process.cwd(), ".env") });

interface CliOptions {
  pattern?: string;
  help?: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case "--pattern":
      case "-p":
        options.pattern = nextArg;
        i++;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
    }
  }

  return options;
}

async function discoverTestFiles(pattern: string): Promise<string[]> {
  try {
    const files = await glob(pattern, {
      cwd: process.cwd(),
      absolute: true,
      ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
    });
    return files;
  } catch (error) {
    console.error("Error discovering test files:", error);
    return [];
  }
}

async function importTestFile(filePath: string): Promise<void> {
  try {
    console.log(
      `\n📄 Running tests from: ${path.relative(process.cwd(), filePath)}`,
    );

    // Dynamic import - tsx should handle TypeScript files when CLI is run with tsx
    const fileUrl = pathToFileURL(filePath).href;
    await import(fileUrl);
  } catch (error) {
    console.error(`❌ Error loading test file ${filePath}:`, error);
    throw error;
  }
}

async function runTests(pattern: string): Promise<void> {
  const totalStartTime = Date.now();

  console.log("🔍 Discovering test files...");
  const testFiles = await discoverTestFiles(pattern);

  if (testFiles.length === 0) {
    console.log(`❌ No test files found matching pattern: ${pattern}`);
    process.exit(1);
  }

  console.log(`✅ Found ${testFiles.length} test file(s)`);

  for (const testFile of testFiles) {
    await importTestFile(testFile);
  }

  const globalSuite = (globalThis as any).globalSuite;
  if (globalSuite && globalSuite.suites.length > 0) {
    console.log("\n🧪 Running tests...\n");
    const testStartTime = Date.now();
    const results = await globalSuite.run();
    const testDuration = Date.now() - testStartTime;

    globalSuite.printResults(results);

    const hasFailures = checkForFailures(results);
    const totalDuration = Date.now() - totalStartTime;

    console.log(`\n⏱️  Test execution time: ${formatDuration(testDuration)}`);
    console.log(`⏱️  Total execution time: ${formatDuration(totalDuration)}`);

    if (hasFailures) {
      process.exit(1);
    } else {
      console.log("\n✅ All tests passed!");
    }
  } else {
    const totalDuration = Date.now() - totalStartTime;
    console.log("❌ No tests were registered");
    console.log(`⏱️  Total execution time: ${formatDuration(totalDuration)}`);
    process.exit(1);
  }
}

function checkForFailures(result: any): boolean {
  let hasFailures = false;

  for (const test of result.tests || []) {
    if (!test.passed) {
      hasFailures = true;
    }
  }

  for (const suite of result.suites || []) {
    if (checkForFailures(suite)) {
      hasFailures = true;
    }
  }

  return hasFailures;
}

async function main(): Promise<void> {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  const pattern = options.pattern || "**/*.{test,spec}.?(c|m)[jt]s?(x)";

  try {
    await runTests(pattern);
  } catch (error) {
    console.error("❌ Test execution failed:", error);
    process.exit(1);
  }
}

// Check if this is the main module being executed
const isMain = process.argv[1] && process.argv[1].includes("cli");

if (isMain) {
  main().catch((error) => {
    console.error("Unexpected error:", error);
    process.exit(1);
  });
}
