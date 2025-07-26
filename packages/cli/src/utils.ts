export function formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    } else if (ms < 60000) {
      return `${(ms / 1000).toFixed(2)}s`;
    } else {
      const minutes = Math.floor(ms / 60000);
      const seconds = ((ms % 60000) / 1000).toFixed(2);
      return `${minutes}m ${seconds}s`;
    }
  }
  
export function showHelp(): void {
    console.log(`
  Usage: mcp-check [options]
  
  Options:
    --pattern, -p <pattern>  Test file pattern (default: "**/*.{test,spec}.?(c|m)[jt]s?(x)")
    --help, -h               Show this help message
  
  Environment Variables:
    OPENAI_API_KEY="sk-...YOUR-OPENAI-KEY..." or
    ANTHROPIC_API_KEY="anth-...YOUR-ANTHROPIC-KEY..."
  
  Example:
    mcp-check
    mcp-check --pattern "tests/**/*.test.ts"
  `);
  }