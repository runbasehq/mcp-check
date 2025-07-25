#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

// Try to find tsx
let tsxPath;
try {
  // Try to resolve tsx from this package's node_modules
  tsxPath = require.resolve('tsx/dist/cli.mjs');
} catch {
  try {
    // Try the CLI entry point
    tsxPath = require.resolve('tsx/cli');
  } catch {
    // Try global tsx via npx
    console.error('tsx not found. Please install tsx: npm install -g tsx');
    process.exit(1);
  }
}

// Path to the actual CLI source file
const cliPath = path.join(__dirname, '..', 'src', 'cli.ts');

// Execute tsx with the CLI file and pass through all arguments
const child = spawn('node', [tsxPath, cliPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env
});

child.on('close', (code) => {
  process.exit(code || 0);
});

child.on('error', (err) => {
  console.error('Error executing mcp-check:', err);
  process.exit(1);
});