import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const uiDir = path.resolve(here, "..");
const repoRoot = path.resolve(uiDir, "..");

const appServerUrl = process.env.CODEX_APP_SERVER_URL ?? "ws://127.0.0.1:8765";

const cargo = spawn(
  "cargo",
  [
    "run",
    "--manifest-path",
    "codex-rs/Cargo.toml",
    "-p",
    "codex-app-server",
    "--bin",
    "codex-app-server",
    "--",
    "--listen",
    appServerUrl,
  ],
  {
    cwd: repoRoot,
    stdio: "inherit",
  },
);

function shutdown(exitCode = 0) {
  if (!cargo.killed) {
    cargo.kill("SIGINT");
  }

  setTimeout(() => {
    process.exit(exitCode);
  }, 150);
}

cargo.on("exit", (code, signal) => {
  if (signal) {
    console.error(`codex-app-server exited from ${signal}`);
  }
  shutdown(code ?? 0);
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
