import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "bin/cli.tsx"],
  format: ["cjs", "esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  bundle: true,
  external: ["@anthropic-ai/sdk", "@modelcontextprotocol/sdk", "openai"],
  noExternal: ["@mcp-check/agents"],
});
