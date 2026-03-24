# Browser Tool Runbook

This repo has a persistent local browser automation tool for UI debugging:

- Script: `ui/scripts/browser-debug.mjs`
- Command: `npm run browser -- <command>`

## Defaults

- Base URL: `http://127.0.0.1:5174`
- Profile name: `shahbajAI`
- CDP endpoint: `http://127.0.0.1:9222`
- User data dir: `ui/.browser-debug/chrome-user-data`

The first run clones the `shahbajAI` profile from your main Chrome data into the dedicated
automation user-data dir so normal Chrome can stay open independently.

## Standard workflow (for any agent)

1. Ensure session status:

   ```bash
   npm run browser -- status
   ```

2. Ensure browser + target page (safe to run repeatedly):

   ```bash
   npm run browser -- open /workspace/messages
   ```

3. Navigate using an intent (recommended):

   ```bash
   npm run browser -- navigate workspace-messages
   npm run browser -- navigate agent-chat --arg name="Developer Lead"
   ```

4. Interact/debug:

   ```bash
   npm run browser -- click "text=Something"
   npm run browser -- fill "textarea" "hello"
   npm run browser -- reload
   npm run browser -- text body
   npm run browser -- eval "window.location.href"
   ```

## Why this is stable

- `open` is idempotent: it reuses existing CDP/browser session when available.
- Commands reconnect through the persisted session state in `ui/.browser-debug/session.json`.
- A fixed CDP port (`9222`) avoids guessing random ports.
- Special navigation is data-driven from `ui/browser/intents/navigation.yaml`.

## Intents (YAML)

- Intents are defined in `ui/browser/intents/navigation.yaml`.
- Use one generic command for special navigation cases:

  ```bash
  npm run browser -- navigate <intent> [--arg key=value ...]
  ```

- Example:

  ```bash
  npm run browser -- navigate agent-chat --arg name="Developer Lead"
  ```

- Developer Lead smoke flow:

  ```bash
  npm run browser -- navigate developer-lead-chat-smoke
  npm run browser -- console
  npm run browser -- text body
  ```

- Fast interpretation:

  - `No transcript loaded for this agent yet.` = agent has no persisted history yet.
  - `FAILED TURN` / `stream disconnected before completion` = message sent, backend stream failed.

- No-ponder recipe:

  ```bash
  npm run browser -- open /workspace/messages
  npm run browser -- click ".workspace-msg-list__row:has-text('Developer Lead')"
  npm run browser -- fill "textarea[placeholder='Message the selected workspace agent...']" "hi"
  npm run browser -- press Enter
  npm run browser -- text body
  npm run browser -- console
  ```

- Vue DevTools/Pinia check:

  ```bash
  npm run browser -- eval "(() => { const app = window.__VUE_DEVTOOLS_GLOBAL_HOOK__?.apps?.[0]; const p = app?._context?.provides || {}; const k = Reflect.ownKeys(p).find(x => String(x).toLowerCase().includes('pinia')); const pinia = k ? p[k] : null; return { hasHook: !!window.__VUE_DEVTOOLS_GLOBAL_HOOK__, storeIds: pinia?._s ? Array.from(pinia._s.keys()) : [] }; })()"
  ```

- Add new navigation flows by editing YAML, not by adding new CLI commands.

## Useful commands

- `npm run browser -- status`
- `npm run browser -- open [url]`
- `npm run browser -- navigate <intent> [--arg key=value ...]`
- `npm run browser -- goto <url>`
- `npm run browser -- agent <name>` (legacy alias for `navigate agent-chat`)
- `npm run browser -- click <selector>`
- `npm run browser -- fill <selector> <text>`
- `npm run browser -- press <key>`
- `npm run browser -- eval <expression>`
- `npm run browser -- text [selector]`
- `npm run browser -- html [selector]`
- `npm run browser -- console`
- `npm run browser -- screenshot [path]`
- `npm run browser -- close`

## Replay responses logs (readable)

- Replay a captured `POST /v1/responses` payload from `.codex/logs_1.sqlite` with compact SSE output:

  ```bash
  npm run replay:responses -- --id 151029
  ```

- Optional overrides:

  ```bash
  npm run replay:responses -- --id 151029 --replace-model lmstudio/qwen3.5-4b
  npm run replay:responses -- --id 151029 --save-payload /tmp/replayed-payload.json
  npm run replay:responses -- --id 151029 --raw-events
  ```

## Live endpoint tap

- Watch outbound OpenAI-compatible endpoint hits live from `.codex/logs_1.sqlite`:

  ```bash
  npm run tap:endpoints
  ```

- Show all `/v1/*` paths (not only tracked standard endpoints):

  ```bash
  npm run tap:endpoints -- --all-paths
  ```

## Environment overrides

- `CODEX_BROWSER_BASE_URL`
- `CODEX_BROWSER_SOURCE_USER_DATA_DIR`
- `CODEX_BROWSER_USER_DATA_DIR`
- `CODEX_BROWSER_PROFILE_DIRECTORY`
- `CODEX_BROWSER_CDP_PORT`
- `CODEX_BROWSER_INTENTS_FILE`
- `HEADLESS=1`
- `CODEX_BROWSER_AUTO_TAKEOVER=1`
