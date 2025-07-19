import { expect, describe, test, run, printResults } from "../src/index.js";

describe("TestSuite functionality", () => {
  test("update block tool", async () => {
    const expectation = await expect(
      "change the hero title to `testing update block`",
    );

    expectation.toBe("Transaction Completed");
  });

  // test("expect toBe works with strings", () => {
  //   expect("hello").toBe("hello");
  //   expect("test" + "ing").toBe("testing");
  // });

  // test("expect toBe works with booleans", () => {
  //   expect(true).toBe(true);
  //   expect(false).toBe(false);
  // });
});

async function runTests() {
  const results = await run();
  printResults(results);
}

runTests().catch(console.error);
