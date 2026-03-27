import { expect, test } from "@playwright/test";

test.describe("Codex Workspace - Slash Commands", () => {
  test("3. Slash command: /status", async ({ page }) => {
    console.log(">>> Navigating to /workspace/messages...");
    await page.goto("/workspace/messages");
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

    const lastTurn = historyAfter[historyAfter.length - 1];
    console.log(">>> Last turn:", JSON.stringify(lastTurn, null, 2));

    const lastItem = lastTurn?.items?.[0];
    const hasStatusEvent =
      lastItem?.kind === "system" &&
      (lastItem?.label === "Workspace status" ||
        lastItem?.detail?.includes("Agent:"));

    expect(hasStatusEvent).toBe(true);
    await expect(page.locator(".workspace-chat__bubble--system")).toBeVisible();

    console.log(">>> Refreshing page to verify persistence...");
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(5000);

    const refreshedHistory = await page.evaluate(() => {
      const stores = (window as any).__CODEX_STORES__;
      return stores ? (stores.getStore("chat")?.history ?? []) : [];
    });
    const refreshedLastTurn = refreshedHistory[refreshedHistory.length - 1];
    const refreshedLastItem = refreshedLastTurn?.items?.[0];

    expect(refreshedLastItem?.kind).toBe("system");
    await expect(page.locator(".workspace-chat__bubble--system")).toBeVisible();
    console.log(">>> PASSED: /status returned status info");
  });
});
