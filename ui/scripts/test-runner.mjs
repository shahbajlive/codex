#!/usr/bin/env node
import process from "node:process";
import { spawn } from "node:child_process";

const UI_DIR = process.cwd();

function run(cmd, args = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn("npm", ["run", "browser", "--", cmd, ...args], {
      cwd: UI_DIR,
      stdio: "inherit",
    });
    proc.on("close", (code) => resolve(code));
    proc.on("error", reject);
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
Codex Test Runner - Simple command runner

Usage:
  node scripts/test-runner.mjs <command> [args...]

Examples:
  node scripts/test-runner.mjs open /workspace/messages
  node scripts/test-runner.mjs fill textarea /status
  node scripts/test-runner.mjs press Enter
  node scripts/test-runner.mjs eval "window.__CODEX_STORES__.getStore('codex').selectedThreadId"
  node scripts/test-runner.mjs console
    `);
    return;
  }

  const [cmd, ...cmdArgs] = args;
  console.log(`> ${cmd} ${cmdArgs.join(" ")}`);
  await run(cmd, cmdArgs);
}

main();
