import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const useFixture = process.env.USE_FIXTURE === "true";
const appServerPort = useFixture ? 8767 : 8766;
const appServerUrl =
  process.env.CODEX_APP_SERVER_URL ?? `ws://127.0.0.1:${appServerPort}`;
const repoRoot = path.resolve(process.cwd(), "..");

test.beforeEach(async ({ page }) => {
  page.on("console", (msg) =>
    console.log(`BROWSER CONSOLE: ${msg.type()}: ${msg.text()}`),
  );
  page.on("pageerror", (err) => console.log(`BROWSER ERROR: ${err}`));
});

async function openWorkspace(page: Page) {
  await page.addInitScript(
    ({ url, cwd }) => {
      const key = "codex-web-ui-settings";
      const current = JSON.parse(window.localStorage.getItem(key) || "{}");
      window.localStorage.setItem(
        key,
        JSON.stringify({ ...current, url, cwd: current.cwd || cwd }),
      );
    },
    { url: appServerUrl, cwd: repoRoot },
  );
  await page.goto("/workspace/messages");
  await page.waitForLoadState("networkidle");
}

async function selectDeveloperLead(page: Page) {
  await page.goto("/agents");
  await page.waitForLoadState("networkidle");
  await expect(
    page.getByText("Developer Lead", { exact: false }).first(),
  ).toBeVisible({
    timeout: 30000,
  });
  await page.getByText("Developer Lead", { exact: false }).first().click();
  await page.waitForTimeout(1500);
  await page.goto("/workspace/messages");
  await page.waitForLoadState("networkidle");
}

test.describe("Codex Workspace - Turn Queue", () => {
  test("queues messages while a turn is active", async ({ page }) => {
    await openWorkspace(page);
    await selectDeveloperLead(page);

    const textarea = page.locator("textarea");
    await textarea.fill("sleep 5");
    await page.keyboard.press("Enter");

    // Wait for the user message to appear (turn started)
    await expect(
      page.locator(".workspace-chat__bubble:has-text('sleep 5')"),
    ).toBeVisible({
      timeout: 10000,
    });

    // Wait a bit to ensure the turn is processing
    await page.waitForTimeout(2000);

    // Now send second message while turn should be active - should get queued
    await textarea.fill("say queued");
    await page.keyboard.press("Enter");

    // Wait a moment for the queue to update
    await page.waitForTimeout(1000);

    await expect(
      page
        .locator(".workspace-chat__queue-item-text")
        .filter({ hasText: "say queued" }),
    ).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator(".workspace-chat__queue-item")).toHaveCount(1);
    await expect(
      page.locator(".workspace-chat__queue-drawer-count"),
    ).toHaveText("1");

    await expect(page.locator(".workspace-chat__queue-item")).toHaveCount(0, {
      timeout: 30000,
    });
  });

  test("steers a queued message into the active turn", async ({ page }) => {
    await openWorkspace(page);
    await selectDeveloperLead(page);

    const textarea = page.locator("textarea");
    await textarea.fill("sleep 5");
    await page.keyboard.press("Enter");

    // Wait for the user message to appear (turn started)
    await expect(
      page.locator(".workspace-chat__bubble:has-text('sleep 5')"),
    ).toBeVisible({
      timeout: 10000,
    });
    await page.waitForTimeout(2000);

    // Now send second message while turn should be active - should get queued
    await textarea.fill("say steer me");
    await page.keyboard.press("Enter");

    await expect(
      page
        .locator(".workspace-chat__queue-item-text")
        .filter({ hasText: "say steer me" }),
    ).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.getByRole("button", { name: "Steer" }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Steer" }).first().click();

    await expect(page.locator(".workspace-chat__queue-item")).toHaveCount(0, {
      timeout: 15000,
    });
  });

  test("deletes queued messages from the drawer", async ({ page }) => {
    await openWorkspace(page);
    await selectDeveloperLead(page);

    const textarea = page.locator("textarea");
    await textarea.fill("sleep 5");
    await page.keyboard.press("Enter");

    // Wait for the user message to appear (turn started)
    await expect(
      page.locator(".workspace-chat__bubble:has-text('sleep 5')"),
    ).toBeVisible({
      timeout: 10000,
    });
    await page.waitForTimeout(2000);

    // Now send second message while turn should be active - should get queued
    await textarea.fill("delete me");
    await page.keyboard.press("Enter");

    await expect(
      page
        .locator(".workspace-chat__queue-item-text")
        .filter({ hasText: "delete me" }),
    ).toBeVisible({
      timeout: 15000,
    });
    await page.getByRole("button", { name: "Delete" }).first().click();

    await expect(page.locator(".workspace-chat__queue-item")).toHaveCount(0, {
      timeout: 15000,
    });
  });

  test("queues 10 messages while a turn is active", async ({ page }) => {
    await openWorkspace(page);
    await selectDeveloperLead(page);

    const textarea = page.locator("textarea");

    // Start the first turn (will be delayed)
    await textarea.fill("sleep 5");
    await page.keyboard.press("Enter");

    // Wait for turn to start
    await expect(
      page.locator(".workspace-chat__bubble:has-text('sleep 5')"),
    ).toBeVisible({
      timeout: 10000,
    });
    await page.waitForTimeout(1000);

    // Queue 10 messages
    for (let i = 1; i <= 10; i++) {
      await textarea.fill(`message ${i}`);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);
    }

    // Verify all 10 are in the queue
    await expect(
      page.locator(".workspace-chat__queue-drawer-count"),
    ).toHaveText("10");
    await expect(page.locator(".workspace-chat__queue-item")).toHaveCount(10);

    // Verify specific messages are queued (exact match to avoid "message 10" matching "message 1")
    await expect(
      page
        .locator(".workspace-chat__queue-item-text")
        .getByText("message 1", { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .locator(".workspace-chat__queue-item-text")
        .getByText("message 10", { exact: true }),
    ).toBeVisible();

    // Wait for at least one message to be picked up (first turn completes after 20s delay)
    // The first message should be picked up, reducing queue from 10 to 9
    await expect(
      page.locator(".workspace-chat__queue-drawer-count"),
    ).toHaveText("9", {
      timeout: 25000,
    });

    // Verify message 1 is now being processed (in chat, not in queue)
    await expect(
      page.locator(".workspace-chat__bubble:has-text('message 1')").first(),
    ).toBeVisible();
  });

  test("steered message appears in chat not in queue (no duplication)", async ({
    page,
  }) => {
    await openWorkspace(page);
    await selectDeveloperLead(page);

    const textarea = page.locator("textarea");

    // Start the first turn (will be delayed)
    await textarea.fill("sleep 5");
    await page.keyboard.press("Enter");

    // Wait for turn to start
    await expect(
      page.locator(".workspace-chat__bubble:has-text('sleep 5')"),
    ).toBeVisible({
      timeout: 10000,
    });
    await page.waitForTimeout(1000);

    // Queue a message
    await textarea.fill("steer this into turn");
    await page.keyboard.press("Enter");

    // Verify it's in the queue
    await expect(
      page
        .locator(".workspace-chat__queue-item-text")
        .filter({ hasText: "steer this into turn" }),
    ).toBeVisible();
    await expect(
      page.locator(".workspace-chat__queue-drawer-count"),
    ).toHaveText("1");

    // Steer the message
    await page.getByRole("button", { name: "Steer" }).first().click();

    // Wait longer for the UI to update (steer RPC + queue delete)
    await page.waitForTimeout(3000);

    // Verify it's NOT in queue anymore
    await expect(
      page.locator(".workspace-chat__queue-drawer-count"),
    ).toHaveText("0");
    await expect(page.locator(".workspace-chat__queue-item")).toHaveCount(0);

    // Verify it's now in the chat (as pending input, not yet responded)
    // The message should appear in the transcript as user input
    const history = await page.evaluate(() => {
      const stores = (window as any).__CODEX_STORES__;
      return stores?.getStore("chat")?.history || [];
    });
    const hasSteeredMessage = history.some((turn: any) =>
      turn.items?.some(
        (item: any) =>
          item.kind === "user-input" &&
          item.text?.includes("steer this into turn"),
      ),
    );
    expect(hasSteeredMessage).toBe(true);
  });

  test("interrupt continues to next queued message", async ({ page }) => {
    await openWorkspace(page);
    await selectDeveloperLead(page);

    const textarea = page.locator("textarea");

    // Start the first turn (will be delayed)
    await textarea.fill("sleep 5");
    await page.keyboard.press("Enter");

    // Wait for turn to start
    await expect(
      page.locator(".workspace-chat__bubble:has-text('sleep 5')"),
    ).toBeVisible({
      timeout: 10000,
    });
    await page.waitForTimeout(1000);

    // Queue some messages
    await textarea.fill("message 1");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);

    await textarea.fill("message 2");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);

    await textarea.fill("message 3");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);

    // Verify queue has 3 items
    await expect(
      page.locator(".workspace-chat__queue-drawer-count"),
    ).toHaveText("3");

    // Interrupt the current turn (click interrupt button)
    const interruptBtn = page.locator(
      "[title='Interrupt turn'], [aria-label='Interrupt turn']",
    );
    await interruptBtn.click();

    // Wait for the interrupt to process and auto-continue to start
    // The auto-continue should pop from the queue immediately
    await page.waitForTimeout(3000);

    // The first message should now be picked up as the next turn
    // Queue should now have 2 items (message 2 and 3)
    await expect(
      page.locator(".workspace-chat__queue-drawer-count"),
    ).toHaveText("2", { timeout: 10000 });
  });
});

test.describe("Codex Workspace - Slash Commands", () => {
  test("3. Slash command: /status", async ({ page }) => {
    console.log(">>> Navigating to /workspace/messages...");
    await openWorkspace(page);
    console.log(">>> Page loaded, waiting for render...");
    await page.waitForTimeout(2000);

    console.log(">>> TEST: /status command");
    console.log(
      ">>> Connection status:",
      await page.evaluate(() => {
        const stores = (window as any).__CODEX_STORES__;
        return stores?.getStore("codex")?.connectionStatus ?? "unknown";
      }),
    );

    await page.getByText("Developer Lead", { exact: false }).first().click();
    console.log(">>> Selected agent");
    await page.waitForTimeout(2000);

    const textarea = page.locator("textarea");
    const historyBefore = await page.evaluate(() => {
      const stores = (window as any).__CODEX_STORES__;
      return stores?.getStore("chat")?.history?.length ?? 0;
    });
    console.log(">>> Chat history length before:", historyBefore);

    await textarea.fill("/status");
    await page.keyboard.press("Enter");
    console.log(">>> Sent /status, waiting for response...");
    await page.waitForTimeout(5000);

    const allStores = await page.evaluate(() => {
      const stores = (window as any).__CODEX_STORES__;
      return {
        codex: stores?.getStore("codex"),
        chat: stores?.getStore("chat"),
      };
    });
    console.log(
      ">>> Connection status after:",
      allStores.codex?.connectionStatus,
    );
    console.log(
      ">>> Chat history:",
      JSON.stringify(allStores.chat?.history, null, 2),
    );

    const historyAfter = allStores.chat?.history || [];
    console.log(">>> Chat history length after:", historyAfter?.length);
    expect(historyAfter?.length).toBeGreaterThan(historyBefore);

    const hasStatusEvent = historyAfter.some((turn: any) =>
      (turn.items ?? []).some(
        (item: any) =>
          item.kind === "system" &&
          (item.label === "Session status" ||
            item.label === "Workspace status" ||
            item.detail?.includes("Agent:")),
      ),
    );

    expect(hasStatusEvent).toBe(true);
    await expect(
      page.locator(".workspace-chat__bubble--system").first(),
    ).toBeVisible();

    console.log(">>> Refreshing page to verify persistence...");
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(5000);

    const refreshedHistory = await page.evaluate(() => {
      const stores = (window as any).__CODEX_STORES__;
      return stores ? (stores.getStore("chat")?.history ?? []) : [];
    });
    expect(
      refreshedHistory.some((turn: any) =>
        (turn.items ?? []).some((item: any) => item.kind === "system"),
      ),
    ).toBe(true);
    await expect(
      page.locator(".workspace-chat__bubble--system").first(),
    ).toBeVisible();
    console.log(">>> PASSED: /status returned status info");
  });
});
