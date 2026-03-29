import { defineConfig, devices } from "@playwright/test";

const uiDir = process.cwd();
const fixturePath = `${uiDir}/../codex-rs/core/tests/fixtures/turn_queue/01-shell_sleep.sse`;

const useFixture = process.env.USE_FIXTURE === "true";
const appServerPort = useFixture ? 8767 : 8766;
const appServerUrl = `ws://127.0.0.1:${appServerPort}`;

const config = defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  timeout: 120000,
  expect: {
    timeout: 10000,
  },
  use: {
    baseURL: "http://127.0.0.1:5174",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: useFixture
    ? {
        command: `CODEX_RS_SSE_FIXTURE="${fixturePath}" ${uiDir}/../codex-rs/target/debug/codex-app-server --listen ${appServerUrl}`,
        url: appServerUrl.replace("ws", "http"),
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
      }
    : {
        command: "npm run dev:web",
        url: "http://127.0.0.1:5174",
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
      },
});

export default config;
