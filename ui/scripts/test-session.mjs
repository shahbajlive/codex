#!/usr/bin/env node
import process from "node:process";
import { spawn, execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const UI_DIR = process.cwd();
const STATE_FILE = join(UI_DIR, ".browser-debug", "session.json");

const HELP = `
Codex Test Session - Persistent browser session

Usage:
  node scripts/test-session.mjs <command> [args...]

Commands:
  open [url]              Open URL and stay connected
  close                   Close browser session
  status                  Show session status
  
  # Interaction
  click <selector>       Click element
  fill <selector> <text> Fill input
  press <key>            Press key
  
  # Send text (convenience)
  type <text>            Type in textarea and press Enter
  
  # Store access
  get <path>             Get store value (e.g., "codex.selectedThreadId")
  store                  Show all stores
  threads                Show agent threads
  history                Show chat history
  
  # Debug
  console                Show console logs
  eval <js>              Evaluate JavaScript
  text [selector]        Get text content
  html [selector]       Get HTML
  
  # Intents
  intent <name>          Run navigation intent

Examples:
  node scripts/test-session.mjs open /workspace/messages
  node scripts/test-session.mjs click ".workspace-msg-list__row:first-child"
  node scripts/test-session.mjs fill textarea "hello"
  node scripts/test-session.mjs get codex.selectedThreadId
  node scripts/test-session.mjs type "/status"
  node scripts/test-session.mjs console
`;

let browser = null;
let page = null;

async function connectBrowser() {
  const { chromium } = await import("playwright");

  // Read state to get CDP URL
  let state = null;
  if (existsSync(STATE_FILE)) {
    try {
      state = JSON.parse(readFileSync(STATE_FILE, "utf-8"));
    } catch {}
  }

  const cdpUrlVal = state?.cdpUrl || "http://127.0.0.1:9222";
  console.error(`Connecting to CDP: ${cdpUrlVal}`);

  try {
    browser = await chromium.connectOverCDP(cdpUrlVal);
    console.error("Connected successfully");
  } catch (e) {
    console.error(`Failed to connect: ${e.message}`);
    process.exit(1);
  }

  const cdpUrl = state?.cdpUrl || "http://127.0.0.1:9222";

  try {
    browser = await chromium.connectOverCDP(cdpUrl);
  } catch (e) {
    console.error(
      "Failed to connect to browser. Run `npm run browser -- open` first.",
    );
    process.exit(1);
  }

  // Get or create page
  const contexts = browser.contexts();
  const allPages = contexts.flatMap((c) => c.pages());
  page =
    allPages.find((p) => p.url() && !p.url().startsWith("chrome")) ||
    allPages[0] ||
    (await contexts[0].newPage());

  return { browser, page };
}

async function ensureConnected() {
  if (!browser || !page) {
    await connectBrowser();
  }
}

const commands = {
  async open(args) {
    await ensureConnected();
    const url = args[0] || "/workspace/messages";
    const fullUrl = url.startsWith("http")
      ? url
      : `http://127.0.0.1:5174${url}`;
    await page.goto(fullUrl, { waitUntil: "domcontentloaded" });
    console.log(`Opened: ${page.url()}`);
  },

  async close() {
    if (browser) {
      await browser.close();
      browser = null;
      page = null;
    }
    console.log("Closed");
  },

  async status() {
    if (browser) {
      console.log(`Connected: ${page?.url() || "no page"}`);
    } else {
      console.log("Not connected");
    }
  },

  async click(args) {
    await ensureConnected();
    const selector = args[0];
    if (!selector) throw new Error("Missing selector");
    await page.click(selector);
    console.log(`Clicked: ${selector}`);
  },

  async fill(args) {
    await ensureConnected();
    const [selector, ...textParts] = args;
    if (!selector) throw new Error("Missing selector");
    const text = textParts.join(" ");
    await page.fill(selector, text);
    console.log(`Filled: ${selector} = "${text}"`);
  },

  async press(args) {
    await ensureConnected();
    const key = args[0];
    if (!key) throw new Error("Missing key");
    await page.keyboard.press(key);
    console.log(`Pressed: ${key}`);
  },

  async type(args) {
    await ensureConnected();
    const text = args.join(" ");
    const textarea = await page.$("textarea");
    if (textarea) {
      await textarea.fill(text);
      await page.keyboard.press("Enter");
      console.log(`Sent: ${text}`);
    }
  },

  async get(args) {
    await ensureConnected();
    const path = args[0];
    if (!path) throw new Error("Missing path");

    const result = await page.evaluate((p) => {
      const stores = window.__CODEX_STORES__;
      if (!stores) return { error: "No stores" };

      const parts = p.split(".");
      let value = stores.getStore(parts[0]);

      for (let i = 1; i < parts.length; i++) {
        if (value === undefined || value === null) break;
        value = value[parts[i]];
      }

      return value;
    }, path);

    console.log(JSON.stringify(result, null, 2));
  },

  async store() {
    await ensureConnected();
    const result = await page.evaluate(() => {
      const stores = window.__CODEX_STORES__;
      if (!stores) return { error: "No stores" };

      const all = {};
      const names = stores.getAllStores();
      for (const name of names) {
        all[name] = stores.getStore(name);
      }
      return all;
    });

    console.log(JSON.stringify(result, null, 2));
  },

  async threads() {
    await ensureConnected();
    const result = await page.evaluate(() => {
      const codex = window.__CODEX_STORES__?.getStore("codex");
      return codex?.threads || [];
    });

    console.log(
      JSON.stringify(
        result.map((t) => ({
          id: t.id,
          role: t.agentRole,
          preview: t.preview,
        })),
        null,
        2,
      ),
    );
  },

  async history() {
    await ensureConnected();
    const result = await page.evaluate(() => {
      const codex = window.__CODEX_STORES__?.getStore("codex");
      return codex?.transcript || [];
    });

    console.log(
      JSON.stringify(
        result.slice(-5).map((t) => ({
          id: t.id,
          status: t.status,
          items: t.items?.length,
        })),
        null,
        2,
      ),
    );
  },

  async console() {
    await ensureConnected();
    const result = await page.evaluate(
      () => window.__codexBrowserDebugConsole || [],
    );
    console.log(JSON.stringify(result.slice(-20), null, 2));
  },

  async eval(args) {
    await ensureConnected();
    const expr = args.join(" ");
    const result = await page.evaluate((e) => (0, eval)(e), expr);
    console.log(
      typeof result === "string" ? result : JSON.stringify(result, null, 2),
    );
  },

  async text(args) {
    await ensureConnected();
    const selector = args[0] || "body";
    const el = await page.$(selector);
    if (el) {
      console.log(await el.innerText());
    }
  },

  async html(args) {
    await ensureConnected();
    const selector = args[0] || "body";
    const el = await page.$(selector);
    if (el) {
      console.log(await el.innerHTML());
    }
  },

  async intent(args) {
    await ensureConnected();
    const intentName = args[0];
    if (!intentName) throw new Error("Missing intent name");

    // Load intents
    const yaml = await import("js-yaml");
    const intentsPath = join(UI_DIR, "browser", "intents", "navigation.yaml");
    const intents = yaml.load(
      await import("node:fs/promises").then((m) =>
        m.readFile(intentsPath, "utf-8"),
      ),
    );

    const intent = intents.intents[intentName];
    if (!intent) throw new Error(`Unknown intent: ${intentName}`);

    // Navigate to startUrl
    if (intent.startUrl) {
      const fullUrl = intent.startUrl.startsWith("http")
        ? intent.startUrl
        : `http://127.0.0.1:5174${intent.startUrl}`;
      await page.goto(fullUrl, { waitUntil: "domcontentloaded" });
    }

    // Execute steps
    for (const step of intent.steps || []) {
      switch (step.action) {
        case "waitFor":
          await page.waitForSelector(step.selector, {
            timeout: step.timeoutMs || 10000,
          });
          break;
        case "fill":
          await page.fill(step.selector, step.text);
          break;
        case "click":
          await page.click(step.selector);
          break;
        case "press":
          await page.keyboard.press(step.key);
          break;
        case "focus":
          await page.focus(step.selector);
          break;
      }
    }

    console.log(`Executed intent: ${intentName}`);
  },
};

async function main() {
  const args = process.argv.slice(2);

  if (!args.length || args[0] === "help" || args[0] === "--help") {
    console.log(HELP);
    return;
  }

  const [cmd, ...cmdArgs] = args;

  const handler = commands[cmd];
  if (!handler) {
    console.error(`Unknown command: ${cmd}`);
    console.log(HELP);
    process.exit(1);
  }

  try {
    await handler(cmdArgs);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

main();
