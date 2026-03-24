import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import os from "node:os";
import { execFileSync, spawn } from "node:child_process";
import { chromium } from "playwright";
import yaml from "js-yaml";

const uiDir = path.resolve(import.meta.dirname, "..");
const stateDir = path.join(uiDir, ".browser-debug");
const statePath = path.join(stateDir, "session.json");
const intentsPath =
  process.env.CODEX_BROWSER_INTENTS_FILE ||
  path.join(uiDir, "browser", "intents", "navigation.yaml");

const defaultBaseUrl =
  process.env.CODEX_BROWSER_BASE_URL || "http://127.0.0.1:5174";

const SOURCE_USER_DATA_DIR =
  process.env.CODEX_BROWSER_SOURCE_USER_DATA_DIR ||
  "/Users/shahbajhussan/Library/Application Support/Google/Chrome";

const DEFAULT_USER_DATA_DIR =
  process.env.CODEX_BROWSER_USER_DATA_DIR ||
  path.join(stateDir, "chrome-user-data");

const DEFAULT_PROFILE_DIRECTORY =
  process.env.CODEX_BROWSER_PROFILE_DIRECTORY || "shahbajAI";

const DEFAULT_CDP_PORT = Number.parseInt(
  process.env.CODEX_BROWSER_CDP_PORT || "9222",
  10,
);

const AUTO_TAKEOVER_CHROME = process.env.CODEX_BROWSER_AUTO_TAKEOVER === "1";

const isHeaded = process.env.HEADLESS !== "1";

const consoleRecorderInitScript = `(() => {
  if (window.__codexBrowserDebugInstalled) return;
  Object.defineProperty(window, "__codexBrowserDebugInstalled", {
    value: true, configurable: false, enumerable: false, writable: false,
  });
  const limit = 200;
  const push = (entry) => {
    const list = window.__codexBrowserDebugConsole || [];
    list.push({ timestamp: new Date().toISOString(), ...entry });
    if (list.length > limit) list.splice(0, list.length - limit);
    window.__codexBrowserDebugConsole = list;
  };
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      push({
        type: "console",
        level,
        text: args.map((v) => {
          if (typeof v === "string") return v;
          try { return JSON.stringify(v); } catch { return String(v); }
        }).join(" "),
      });
      original(...args);
    };
  }
  window.addEventListener("error", (event) => {
    push({ type: "pageerror", level: "error", text: event.message });
  });
  window.addEventListener("unhandledrejection", (event) => {
    push({
      type: "unhandledrejection",
      level: "error",
      text: typeof event.reason === "string" ? event.reason : String(event.reason),
    });
  });
})();`;

function printHelp() {
  console.log(`codex ui browser debug

Usage:
  npm run browser -- open [url]
  npm run browser -- navigate <intent> [--arg key=value ...]
  npm run browser -- goto <url>
  npm run browser -- reload
  npm run browser -- click <selector>
  npm run browser -- fill <selector> <text>
  npm run browser -- press <key>
  npm run browser -- eval <expression>
  npm run browser -- text [selector]
  npm run browser -- html [selector]
  npm run browser -- console
  npm run browser -- screenshot [path]
  npm run browser -- status
  npm run browser -- close

Environment variables:
  CODEX_BROWSER_BASE_URL          URL to open (default: ${defaultBaseUrl})
  CODEX_BROWSER_SOURCE_USER_DATA_DIR
                                  Source Chrome user data (default: ${SOURCE_USER_DATA_DIR})
  CODEX_BROWSER_USER_DATA_DIR     Chrome user data directory
                                  (default: ${DEFAULT_USER_DATA_DIR})
  CODEX_BROWSER_PROFILE_DIRECTORY Chrome profile directory name
                                  (default: ${DEFAULT_PROFILE_DIRECTORY})
  CODEX_BROWSER_CDP_PORT          Remote debugging port (default: ${DEFAULT_CDP_PORT})
  CODEX_BROWSER_INTENTS_FILE      YAML intents file path (default: ${intentsPath})
  HEADLESS=1                      Run in headless mode
  CODEX_BROWSER_AUTO_TAKEOVER=1   Auto-close existing Chrome if needed

Notes:
  - Browser opens headed by default (visible).
  - Relative URLs resolve against ${defaultBaseUrl}.
  - Uses a dedicated automation profile cloned from shahbajAI once.
  - Selectors are standard Playwright selectors.`);
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function resolveUrl(raw, baseUrl = defaultBaseUrl) {
  if (!raw) return baseUrl;
  try {
    return new URL(raw).toString();
  } catch {
    return new URL(raw, baseUrl).toString();
  }
}

async function ensureStateDir() {
  await fsp.mkdir(stateDir, { recursive: true });
}

async function readState() {
  try {
    const raw = await fsp.readFile(statePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeState(state) {
  await ensureStateDir();
  await fsp.writeFile(statePath, JSON.stringify(state, null, 2));
}

async function removeState() {
  await fsp.rm(statePath, { force: true });
}

async function waitForCdpEndpoint(cdpUrl, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${cdpUrl}/json/version`);
      if (response.ok) {
        return;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for Chrome CDP endpoint at ${cdpUrl}.`);
}

async function pathExists(targetPath) {
  try {
    await fsp.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function seedProfileIfNeeded(userDataDir, profileDirectory) {
  await fsp.mkdir(userDataDir, { recursive: true });
  const destProfilePath = path.join(userDataDir, profileDirectory);
  if (await pathExists(destProfilePath)) {
    return;
  }

  const srcProfilePath = path.join(SOURCE_USER_DATA_DIR, profileDirectory);
  if (!(await pathExists(srcProfilePath))) {
    await fsp.mkdir(destProfilePath, { recursive: true });
    return;
  }

  await fsp.cp(srcProfilePath, destProfilePath, { recursive: true });

  const sharedFiles = ["Local State", "First Run"];
  for (const file of sharedFiles) {
    const src = path.join(SOURCE_USER_DATA_DIR, file);
    const dest = path.join(userDataDir, file);
    if (await pathExists(src)) {
      await fsp.copyFile(src, dest).catch(() => {});
    }
  }
}

function waitForProcessExit(proc) {
  return new Promise((resolve) => {
    proc.once("error", (error) => resolve({ error }));
    proc.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function quitChromeBestEffort() {
  try {
    execFileSync(
      "osascript",
      ["-e", 'tell application "Google Chrome" to quit'],
      {
        stdio: "ignore",
      },
    );
  } catch {}

  try {
    execFileSync(
      "pkill",
      ["-f", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
      {
        stdio: "ignore",
      },
    );
  } catch {}
}

async function launchChromeAndWaitForCdp(chromeBin, chromeArgs, cdpUrl) {
  try {
    await launchChromeAndWaitForCdp(chromeBin, chromeArgs, cdpUrl);
  } catch (error) {
    if (!AUTO_TAKEOVER_CHROME) {
      throw error;
    }
    quitChromeBestEffort();
    await sleep(1200);
    await launchChromeAndWaitForCdp(chromeBin, chromeArgs, cdpUrl);
  }
}

async function connectBrowser() {
  const state = await readState();
  const fallbackCdpUrl = `http://127.0.0.1:${DEFAULT_CDP_PORT}`;
  const cdpUrl = state?.cdpUrl || fallbackCdpUrl;

  if (!state?.cdpUrl) {
    try {
      await waitForCdpEndpoint(cdpUrl, 500);
    } catch {
      throw new Error(
        "No browser session. Run `npm run browser -- open` first.",
      );
    }
  }

  try {
    const browser = await chromium.connectOverCDP(cdpUrl);
    return {
      browser,
      state: state || {
        userDataDir: DEFAULT_USER_DATA_DIR,
        profileDirectory: DEFAULT_PROFILE_DIRECTORY,
        cdpUrl,
        baseUrl: defaultBaseUrl,
      },
    };
  } catch (error) {
    await removeState();
    throw new Error(
      `Stored browser session is unavailable. Run ` +
        `\`npm run browser -- open\` to start a new session. ` +
        `Original error: ${error}`,
    );
  }
}

async function getOrCreatePage(browser) {
  const contexts = browser.contexts();
  for (const context of contexts) {
    await context.addInitScript(consoleRecorderInitScript);
  }

  const allPages = contexts.flatMap((context) => context.pages());
  const existingPage =
    allPages.find((page) => page.url() && page.url() !== "about:blank") ||
    allPages[0];
  if (existingPage) {
    return { page: existingPage };
  }

  const ctx =
    contexts[0] ??
    (await browser.newContext({ viewport: { width: 1440, height: 960 } }));
  await ctx.addInitScript(consoleRecorderInitScript);
  return { page: await ctx.newPage() };
}

async function runWithPage(action) {
  const { browser, state } = await connectBrowser();
  try {
    const { page } = await getOrCreatePage(browser);
    return await action({ browser, page, state });
  } finally {
    await browser.close();
  }
}

async function loadIntents() {
  let parsed;
  try {
    const raw = await fsp.readFile(intentsPath, "utf8");
    parsed = yaml.load(raw);
  } catch (error) {
    throw new Error(`Could not read intents file at ${intentsPath}: ${error}`);
  }

  if (!parsed || typeof parsed !== "object" || !parsed.intents) {
    throw new Error(
      `Invalid intents file at ${intentsPath}: missing top-level 'intents'.`,
    );
  }
  return parsed.intents;
}

function parseIntentArgs(args) {
  const intent = args[0];
  if (!intent) {
    throw new Error("Missing intent name.");
  }

  const values = {};
  let i = 1;
  while (i < args.length) {
    const token = args[i];
    if (token === "--arg") {
      const pair = args[i + 1];
      if (!pair) {
        throw new Error("Expected key=value after --arg.");
      }
      const eq = pair.indexOf("=");
      if (eq < 1) {
        throw new Error(`Invalid --arg value: ${pair}. Use key=value.`);
      }
      values[pair.slice(0, eq)] = pair.slice(eq + 1);
      i += 2;
      continue;
    }

    if (token.startsWith("--arg=")) {
      const pair = token.slice("--arg=".length);
      const eq = pair.indexOf("=");
      if (eq < 1) {
        throw new Error(`Invalid --arg value: ${pair}. Use key=value.`);
      }
      values[pair.slice(0, eq)] = pair.slice(eq + 1);
      i += 1;
      continue;
    }

    throw new Error(`Unknown option for navigate: ${token}`);
  }

  return { intent, values };
}

function resolveTemplate(value, vars) {
  if (typeof value !== "string") {
    return value;
  }
  return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    if (!(key in vars)) {
      throw new Error(`Missing intent argument: ${key}`);
    }
    return String(vars[key]);
  });
}

function validateIntentArgs(intentName, intentDef, values) {
  const requiredArgs = Array.isArray(intentDef.args)
    ? intentDef.args.map((entry) =>
        typeof entry === "string"
          ? entry
          : typeof entry?.name === "string"
            ? entry.name
            : null,
      )
    : [];

  for (const argName of requiredArgs) {
    if (!argName) {
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(values, argName)) {
      throw new Error(`Intent '${intentName}' requires --arg ${argName}=...`);
    }
  }
}

async function runIntentStep({ page, state }, step, vars) {
  const action = resolveTemplate(step.action, vars);
  const timeoutMs = Number.isFinite(step.timeoutMs) ? step.timeoutMs : 5000;

  switch (action) {
    case "goto": {
      const url = resolveUrl(
        resolveTemplate(step.url, vars),
        state.baseUrl || defaultBaseUrl,
      );
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs,
      });
      return;
    }
    case "click": {
      const selector = resolveTemplate(step.selector, vars);
      if (!selector) throw new Error("Intent step click requires selector.");
      await page.locator(selector).first().click({ timeout: timeoutMs });
      return;
    }
    case "fill": {
      const selector = resolveTemplate(step.selector, vars);
      const text = resolveTemplate(step.text ?? "", vars);
      if (!selector) throw new Error("Intent step fill requires selector.");
      await page.locator(selector).first().fill(text, { timeout: timeoutMs });
      return;
    }
    case "press": {
      const key = resolveTemplate(step.key, vars);
      if (!key) throw new Error("Intent step press requires key.");
      await page.keyboard.press(key);
      return;
    }
    case "focus": {
      const selector = resolveTemplate(step.selector, vars);
      if (!selector) throw new Error("Intent step focus requires selector.");
      await page.locator(selector).first().focus({ timeout: timeoutMs });
      return;
    }
    case "pressOn": {
      const selector = resolveTemplate(step.selector, vars);
      const key = resolveTemplate(step.key, vars);
      if (!selector) throw new Error("Intent step pressOn requires selector.");
      if (!key) throw new Error("Intent step pressOn requires key.");
      const locator = page.locator(selector).first();
      await locator.focus({ timeout: timeoutMs });
      await locator.press(key, { timeout: timeoutMs });
      return;
    }
    case "waitFor": {
      const selector = resolveTemplate(step.selector, vars);
      const waitState = resolveTemplate(step.state || "visible", vars);
      if (!selector) throw new Error("Intent step waitFor requires selector.");
      await page
        .locator(selector)
        .first()
        .waitFor({ state: waitState, timeout: timeoutMs });
      return;
    }
    case "waitForAny": {
      const selectors = Array.isArray(step.selectors)
        ? step.selectors.map((s) => resolveTemplate(s, vars)).filter(Boolean)
        : [];
      if (selectors.length === 0) {
        throw new Error("Intent step waitForAny requires selectors[].");
      }
      const waits = selectors.map((selector) =>
        page
          .locator(selector)
          .first()
          .waitFor({ state: "visible", timeout: timeoutMs }),
      );
      try {
        await Promise.any(waits);
      } catch {
        throw new Error(
          `Intent waitForAny timed out for selectors: ${selectors.join(", ")}`,
        );
      }
      return;
    }
    default:
      throw new Error(`Unknown intent action: ${String(action)}`);
  }
}

async function executeIntent(intentName, values) {
  const intents = await loadIntents();
  const intentDef = intents[intentName];
  if (!intentDef || typeof intentDef !== "object") {
    throw new Error(`Unknown intent '${intentName}' in ${intentsPath}.`);
  }

  validateIntentArgs(intentName, intentDef, values);

  const steps = Array.isArray(intentDef.steps) ? intentDef.steps : [];
  if (steps.length === 0) {
    throw new Error(`Intent '${intentName}' has no steps.`);
  }

  await runWithPage(async ({ page, state }) => {
    if (intentDef.startUrl) {
      const startUrl = resolveUrl(
        resolveTemplate(intentDef.startUrl, values),
        state.baseUrl || defaultBaseUrl,
      );
      await page.goto(startUrl, { waitUntil: "domcontentloaded" });
    }

    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      if (!step || typeof step !== "object") {
        throw new Error(
          `Invalid step at index ${i} for intent '${intentName}'.`,
        );
      }
      const actionName = resolveTemplate(step.action, values);
      console.log(
        `[intent:${intentName}] step ${i + 1}/${steps.length}: ${actionName}`,
      );
      try {
        await runIntentStep({ page, state }, step, values);
      } catch (error) {
        if (step.optional === true) {
          console.log(`[intent:${intentName}] optional step skipped`);
          continue;
        }
        throw error;
      }
    }

    await writeState({ ...state, url: page.url() });
    console.log(`Navigated via intent ${intentName}: ${page.url()}`);
  });
}

function findChromeExecutable() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    path.join(
      os.homedir(),
      "Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ),
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    path.join(
      os.homedir(),
      "Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    ),
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    path.join(
      os.homedir(),
      "Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ),
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    path.join(
      os.homedir(),
      "Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ),
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    path.join(
      os.homedir(),
      "Applications/Chromium.app/Contents/MacOS/Chromium",
    ),
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

async function commandOpen(args) {
  const rawUrl = args[0];
  const url = resolveUrl(rawUrl);

  const userDataDir =
    process.env.CODEX_BROWSER_USER_DATA_DIR || DEFAULT_USER_DATA_DIR;
  const profileDir =
    process.env.CODEX_BROWSER_PROFILE_DIRECTORY || DEFAULT_PROFILE_DIRECTORY;
  const cdpPort = Number.isFinite(DEFAULT_CDP_PORT) ? DEFAULT_CDP_PORT : 9222;
  const cdpUrl = `http://127.0.0.1:${cdpPort}`;

  const chromeBin = findChromeExecutable();
  if (!chromeBin) {
    throw new Error(
      "Could not find Google Chrome or Chromium on this system. " +
        "Install Chrome or set CODEX_BROWSER_USER_DATA_DIR to a Playwright-managed path.",
    );
  }

  await seedProfileIfNeeded(userDataDir, profileDir);

  const existing = await readState();
  if (existing?.cdpUrl) {
    try {
      const existingBrowser = await chromium.connectOverCDP(existing.cdpUrl);
      const { page } = await getOrCreatePage(existingBrowser);
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await writeState({ ...existing, url: page.url() });
      console.log(`Opened ${page.url()}`);
      await existingBrowser.close();
      return;
    } catch (error) {
      await removeState();
    }
  }

  try {
    await waitForCdpEndpoint(cdpUrl, 400);
    const runningBrowser = await chromium.connectOverCDP(cdpUrl);
    try {
      const { page } = await getOrCreatePage(runningBrowser);
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await writeState({
        userDataDir,
        profileDirectory: profileDir,
        cdpUrl,
        baseUrl: defaultBaseUrl,
        openedAt: new Date().toISOString(),
        url: page.url(),
      });
      console.log(`Opened ${page.url()}`);
      return;
    } finally {
      await runningBrowser.close();
    }
  } catch {}

  await ensureStateDir();

  const chromeArgs = [
    `--user-data-dir=${userDataDir}`,
    `--profile-directory=${profileDir}`,
    `--remote-debugging-port=${cdpPort}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1440,960",
  ];
  if (!isHeaded) {
    chromeArgs.push("--headless=new", "--disable-gpu");
  }

  const proc = spawn(chromeBin, chromeArgs, {
    detached: true,
    stdio: "ignore",
  });
  const exitPromise = waitForProcessExit(proc);
  await Promise.race([
    waitForCdpEndpoint(cdpUrl, 15000),
    exitPromise.then((result) => {
      const details = result.error
        ? `error=${String(result.error)}`
        : `code=${String(result.code ?? "null")}, signal=${String(result.signal ?? "null")}`;
      throw new Error(
        `Chrome exited before CDP became available (${details}). ` +
          `If Chrome is already running, quit it first and retry.`,
      );
    }),
  ]);
  proc.unref();

  let browser;
  try {
    browser = await chromium.connectOverCDP(cdpUrl);
  } catch (error) {
    throw new Error(
      `Could not connect to Chrome via CDP at ${cdpUrl}. ` +
        `Make sure no other instance of Chrome is running with the same profile, ` +
        `or close all Chrome windows and try again. Original error: ${error}`,
    );
  }

  try {
    const { page } = await getOrCreatePage(browser);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await writeState({
      userDataDir,
      profileDirectory: profileDir,
      cdpUrl,
      baseUrl: defaultBaseUrl,
      openedAt: new Date().toISOString(),
      url: page.url(),
    });
    console.log(`Opened ${page.url()}`);
  } finally {
    await browser.close();
  }
}

async function commandGoto(args) {
  const rawUrl = args[0];
  if (!rawUrl) throw new Error("Missing URL.");
  await runWithPage(async ({ page, state }) => {
    const url = resolveUrl(rawUrl, state.baseUrl || defaultBaseUrl);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await writeState({ ...state, url: page.url() });
    console.log(page.url());
  });
}

async function commandReload() {
  await runWithPage(async ({ page, state }) => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await writeState({ ...state, url: page.url() });
    console.log(page.url());
  });
}

async function commandClick(args) {
  const selector = args[0];
  if (!selector) throw new Error("Missing selector.");
  await runWithPage(async ({ page }) => {
    await page.click(selector);
    console.log(`Clicked ${selector}`);
  });
}

async function commandFill(args) {
  const selector = args[0];
  const text = args[1] ?? "";
  if (!selector) throw new Error("Missing selector.");
  await runWithPage(async ({ page }) => {
    await page.fill(selector, text);
    console.log(`Filled ${selector}`);
  });
}

async function commandPress(args) {
  const key = args[0];
  if (!key) throw new Error("Missing key.");
  await runWithPage(async ({ page }) => {
    await page.keyboard.press(key);
    console.log(`Pressed ${key}`);
  });
}

async function commandNavigate(args) {
  const { intent, values } = parseIntentArgs(args);
  await executeIntent(intent, values);
}

async function commandAgent(args) {
  const name = args.join(" ").trim();
  if (!name) throw new Error("Missing agent name.");
  await executeIntent("agent-chat", { name });
}

async function commandEval(args) {
  const expression = args.join(" ").trim();
  if (!expression) throw new Error("Missing expression.");
  await runWithPage(async ({ page }) => {
    const value = await page.evaluate((expr) => {
      return (0, eval)(expr);
    }, expression);
    if (typeof value === "string") {
      console.log(value);
      return;
    }
    console.log(JSON.stringify(value, null, 2));
  });
}

async function commandText(args) {
  const selector = args[0] || "body";
  await runWithPage(async ({ page }) => {
    const text = await page.locator(selector).innerText();
    console.log(text);
  });
}

async function commandHtml(args) {
  const selector = args[0] || "body";
  await runWithPage(async ({ page }) => {
    const html = await page.locator(selector).innerHTML();
    console.log(html);
  });
}

async function commandConsole() {
  await runWithPage(async ({ page }) => {
    const messages = await page.evaluate(
      () => window.__codexBrowserDebugConsole || [],
    );
    console.log(JSON.stringify(messages, null, 2));
  });
}

async function commandScreenshot(args) {
  const outputPath = path.resolve(
    uiDir,
    args[0] || `browser-${Date.now()}.png`,
  );
  await runWithPage(async ({ page }) => {
    await page.screenshot({ path: outputPath, fullPage: true });
    console.log(outputPath);
  });
}

async function commandClose() {
  const state = await readState();
  if (!state?.cdpUrl) {
    console.log("No browser session is active.");
    return;
  }

  const cdpUrl = state.cdpUrl || `http://127.0.0.1:${DEFAULT_CDP_PORT}`;
  try {
    const browser = await chromium.connectOverCDP(cdpUrl);
    await browser.close();
  } catch {}

  const isExternalProfile =
    state.userDataDir !== path.join(stateDir, "profile");

  await removeState();

  if (!isExternalProfile && state.userDataDir) {
    await fsp.rm(state.userDataDir, { recursive: true, force: true });
  } else if (isExternalProfile) {
    console.log(
      `Closed browser session. ` +
        `Your profile at "${state.userDataDir}" was NOT deleted.`,
    );
    return;
  }

  console.log("Closed browser session.");
}

const commands = new Map([
  [
    "status",
    async () => {
      const state = await readState();
      const cdpUrl = state?.cdpUrl || `http://127.0.0.1:${DEFAULT_CDP_PORT}`;
      try {
        await waitForCdpEndpoint(cdpUrl, 400);
        console.log(
          JSON.stringify(
            {
              running: true,
              cdpUrl,
              userDataDir: state?.userDataDir || DEFAULT_USER_DATA_DIR,
              profileDirectory:
                state?.profileDirectory || DEFAULT_PROFILE_DIRECTORY,
              url: state?.url || null,
            },
            null,
            2,
          ),
        );
      } catch {
        console.log(
          JSON.stringify(
            {
              running: false,
              cdpUrl,
              userDataDir: state?.userDataDir || DEFAULT_USER_DATA_DIR,
              profileDirectory:
                state?.profileDirectory || DEFAULT_PROFILE_DIRECTORY,
            },
            null,
            2,
          ),
        );
      }
    },
  ],
  ["open", commandOpen],
  ["navigate", commandNavigate],
  ["goto", commandGoto],
  ["reload", commandReload],
  ["click", commandClick],
  ["fill", commandFill],
  ["press", commandPress],
  ["agent", commandAgent],
  ["eval", commandEval],
  ["text", commandText],
  ["html", commandHtml],
  ["console", commandConsole],
  ["screenshot", commandScreenshot],
  ["close", commandClose],
]);

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (
    !command ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    printHelp();
    return;
  }

  const run = commands.get(command);
  if (!run) throw new Error(`Unknown command: ${command}`);
  await run(args);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
