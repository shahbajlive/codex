#!/usr/bin/env node
import process from "node:process";
import { spawn, execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const UI_DIR = resolve(import.meta.dirname, "..");
const LOG_FILE = join(UI_DIR, ".browser-debug", "test-log.json");

const BASE_URL = process.env.CODEX_BROWSER_BASE_URL || "http://127.0.0.1:5174";

const TA_TEXTAREA = "textarea[placeholder*='Message']";

const HELP = `
Codex Test Harness - Manual Testing with Debugging

Usage:
  npm run test:browser -- <command> [args...]

Commands:
  # === Core ===
  open [url]                    Open URL (default: /workspace/messages)
  status                        Show browser & store status
  
  # === Interaction ===
  click <selector>              Click element
  fill <selector> <text>        Fill input
  press <key>                   Press key
  wait <ms>                     Wait milliseconds
  
  # === Send Message ===
  send <text>                   Send message via textarea
  send:slash <command>          Send slash command
  
  # === Store Inspection ===
  store                          Show all store state (JSON)
  store:chat                     Show chat store
  store:contacts                Show contacts store
  store:agents                  Show agents store
  store:field <field>           Show specific field (e.g., "agentThreads")
  threads                       Show spawned agent threads
  history                       Show message history
  contacts                      Show contacts list
  
  # === Intent Flows ===
  intent <name> [args]          Run navigation intent (from YAML)
  
  # === Debugging ===
  console                       Show captured console logs
  screenshot [path]             Take screenshot
  html [selector]               Get HTML of element
  text [selector]               Get text of element
  
  # === Wait for Response ===
  wait:response [timeout]        Wait for response bubble (default: 30000ms)
  wait:turn [timeout]            Wait for turn to complete (default: 60000ms)
  
  # === Combined Flows ===
  # See navigation.yaml for intent definitions
  
Examples:
  npm run test:browser -- open
  npm run test:browser -- click ".workspace-msg-list__row:first-child"
  npm run test:browser -- send "hello world"
  npm run test:browser -- send:slash status
  npm run test:browser -- store:threads
  npm run test:browser -- intent developer-lead-chat-smoke
  npm run test:browser -- console
`;

function log(level, msg, data = null) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message: msg,
    data,
  };
  console[level === "error" ? "error" : "log"](
    `[${level.toUpperCase()}] ${msg}`,
    data ? JSON.stringify(data, null, 2) : "",
  );

  let logs = [];
  if (existsSync(LOG_FILE)) {
    try {
      logs = JSON.parse(readFileSync(LOG_FILE, "utf-8"));
    } catch {}
  }
  logs.push(entry);
  if (logs.length > 500) logs = logs.slice(-500);
  writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
}

function runBrowserCmd(cmd, args = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn("npm", ["run", "browser", "--", cmd, ...args], {
      cwd: UI_DIR,
      stdio: ["inherit", "pipe", "pipe"],
      env: { ...process.env, CODEX_BROWSER_BASE_URL: BASE_URL },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        log("error", `Browser cmd failed: ${cmd}`, { code, stderr });
        reject(new Error(`Command failed: ${stderr || stdout}`));
      }
    });
  });
}

function runBrowserCmdSync(cmd, args = []) {
  try {
    const result = execSync(
      `npm run browser -- ${cmd} ${args.map((a) => `"${a}"`).join(" ")}`,
      {
        cwd: UI_DIR,
        env: { ...process.env, CODEX_BROWSER_BASE_URL: BASE_URL },
        encoding: "utf-8",
      },
    );
    return result.trim();
  } catch (e) {
    return e.stdout?.trim() || e.message;
  }
}

const GET_STORE_EXPR = `(() => { if (window.__CODEX_STORES__) { const stores = {}; const all = window.__CODEX_STORES__.getAllStores() || []; for (const n of all) { stores[n] = window.__CODEX_STORES__.getStore(n); } return stores; } return { error: 'no stores' }; })()`;

async function getStore(storeName = null) {
  const result = await runBrowserCmd("eval", [GET_STORE_EXPR]);
  try {
    const stores = JSON.parse(result);
    if (storeName) {
      return stores[storeName] || null;
    }
    return stores;
  } catch {
    return { error: "Failed to parse store", raw: result };
  }
}

async function waitForResponse(timeout = 30000) {
  const selectors = [
    ".bubble--user .bubble__body",
    ".bubble--assistant .bubble__body",
    "text=LIVE TURN",
    "text=FAILED TURN",
    "text=Error",
    "text=agent_id",
    "text=submission_id",
  ];

  const expr = `
    (() => {
      ${selectors.map((s, i) => `const el${i} = document.querySelector('${s}');`).join("\n")}
      return [${selectors.map((_, i) => `el${i}`).join(",")}].some(e => e);
    })()
  `;

  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await runBrowserCmd("eval", [expr]);
    if (result === "true") return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const commands = {
  async "open"(args) {
    const url = args[0] || "/workspace/messages";
    log("info", `Opening ${url}`);
    await runBrowserCmd("open", [url]);
  },

  async "status"() {
    const status = runBrowserCmdSync("status");
    const stores = await getStore();
    console.log("=== Browser Status ===");
    console.log(status);
    console.log("=== Stores ===");
    console.log(JSON.stringify(Object.keys(stores), null, 2));
  },

  async "click"(args) {
    if (!args[0]) throw new Error("Missing selector");
    log("info", `Clicking: ${args[0]}`);
    await runBrowserCmd("click", [args[0]]);
  },

  async "fill"(args) {
    if (!args[0]) throw new Error("Missing selector");
    const text = args.slice(1).join(" ");
    log("info", `Filling: ${args[0]} = "${text}"`);
    await runBrowserCmd("fill", [args[0], text]);
  },

  async "press"(args) {
    if (!args[0]) throw new Error("Missing key");
    log("info", `Pressing: ${args[0]}`);
    await runBrowserCmd("press", [args[0]]);
  },

  async "wait"(args) {
    const ms = parseInt(args[0]) || 1000;
    log("info", `Waiting ${ms}ms`);
    await new Promise((r) => setTimeout(r, ms));
  },

  async "send"(args) {
    const text = args.join(" ");
    log("info", `Sending: "${text}"`);
    await runBrowserCmd("fill", [TA_TEXTAREA, text]);
    await runBrowserCmd("press", ["Enter"]);
    log("info", "Message sent, waiting for response...");
  },

  async "send:slash"(args) {
    const cmd = args.join(" ");
    log("info", `Sending slash command: /${cmd}`);
    await runBrowserCmd("fill", [TA_TEXTAREA, `/${cmd}`]);
    await runBrowserCmd("press", ["Enter"]);
  },

  async "store:chat"() {
    const store = await getStore("chat");
    console.log(JSON.stringify(store, null, 2));
  },

  async "store:contacts"() {
    const store = await getStore("contacts");
    console.log(JSON.stringify(store, null, 2));
  },

  async "store:agents"() {
    const store = await getStore("agents");
    console.log(JSON.stringify(store, null, 2));
  },

  async "store:field"(args) {
    const field = args[0];
    const stores = await getStore();
    for (const [name, store] of Object.entries(stores)) {
      if (store.state[field] !== undefined) {
        console.log(`=== ${name}.${field} ===`);
        console.log(JSON.stringify(store.state[field], null, 2));
        return;
      }
    }
    console.log(`Field "${field}" not found`);
  },

  async "store"() {
    const stores = await getStore();
    console.log(JSON.stringify(stores, null, 2));
  },

  async "threads"() {
    const chat = await getStore("chat");
    const threads = chat?.state?.agentThreads || [];
    console.log("=== Agent Threads ===");
    console.log(
      JSON.stringify(
        threads.map((t) => ({
          id: t.id,
          name: t.name,
          updatedAt: t.updatedAt,
        })),
        null,
        2,
      ),
    );
  },

  async "history"() {
    const chat = await getStore("chat");
    const history = chat?.state?.history || [];
    console.log("=== Message History ===");
    console.log(JSON.stringify(history.slice(-10), null, 2));
  },

  async "contacts"() {
    const contacts = await getStore("contacts");
    console.log("=== Contacts ===");
    console.log(JSON.stringify(contacts?.state?.contacts || [], null, 2));
  },

  async "intent"(args) {
    const intentName = args[0];
    const intentArgs = args.slice(1);
    if (!intentName) throw new Error("Missing intent name");
    log("info", `Running intent: ${intentName}`, { args: intentArgs });
    await runBrowserCmd("navigate", [intentName, ...intentArgs]);
  },

  async "console"() {
    const result = runBrowserCmdSync("console");
    try {
      const logs = JSON.parse(result);
      console.log("=== Console Logs ===");
      logs.forEach((l) => {
        console.log(`[${l.timestamp}] [${l.level}] ${l.text}`);
      });
    } catch {
      console.log(result);
    }
  },

  async "screenshot"(args) {
    const path = args[0] || `screenshot-${Date.now()}.png`;
    log("info", `Taking screenshot: ${path}`);
    await runBrowserCmd("screenshot", [path]);
  },

  async "html"(args) {
    const selector = args[0] || "body";
    const result = runBrowserCmdSync("html", [selector]);
    console.log(result);
  },

  async "text"(args) {
    const selector = args[0] || "body";
    const result = runBrowserCmdSync("text", [selector]);
    console.log(result);
  },

  async "wait:response"(args) {
    const timeout = parseInt(args[0]) || 30000;
    log("info", `Waiting for response (${timeout}ms)...`);
    const found = await waitForResponse(timeout);
    console.log(found ? "Response detected" : "Timeout waiting for response");
  },

  async "wait:turn"(args) {
    const timeout = parseInt(args[0]) || 60000;
    log("info", `Waiting for turn completion (${timeout}ms)...`);
    const expr = `(() => { 
      const el = document.querySelector('.turn--live'); 
      return el ? 'live' : 'done';
    })()`;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = await runBrowserCmd("eval", [expr]);
      if (result === '"done"') {
        console.log("Turn completed");
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    console.log("Timeout waiting for turn");
  },
};

async function main() {
  // npm run adds: "node", "script", "test:browser", "--", "cmd", "args..."
  // We need to skip: node, script, test:browser, --
  // But when run via `npm run test:browser -- status`, npm inserts `--`
  // so argv = [node, script, test:browser, --, status]
  // We want: status

  // Handle npm run format: node scripts/codex-test.mjs test:browser -- status
  let args = process.argv.slice(2);

  // Remove the "test:browser" script name if present
  if (args[0] === "test:browser") {
    args = args.slice(1);
  }

  // If there's a "--" separator from npm, remove it
  const dashDashIdx = args.indexOf("--");
  if (dashDashIdx !== -1) {
    args = args.slice(dashDashIdx + 1);
  }

  const [cmd, ...cmdArgs] = args;

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(HELP);
    return;
  }

  const handler = commands[cmd];
  if (!handler) {
    console.error(`Unknown command: ${cmd}`);
    console.log(HELP);
    process.exit(1);
  }

  try {
    log("debug", `Executing: ${cmd}`, { cmdArgs });
    await handler(cmdArgs);
    log("debug", `Completed: ${cmd}`);
  } catch (e) {
    log("error", `Failed: ${cmd}`, { error: e.message });
    console.error(e);
    process.exit(1);
  }
}

main();
