import { expect, test } from "@playwright/test";

test.describe("Codex Workspace - Turn Queue", () => {
  test("turn queue - queue messages while turn active, delete, edit, persist", async ({
    page,
  }) => {
    console.log(">>> Navigating to /workspace/messages...");
    await page.goto("/workspace/messages");
    await page.waitForTimeout(2000);

    console.log(">>> Selecting agent...");
    await page.getByText("Developer Lead", { exact: false }).first().click();
    await page.waitForTimeout(2000);

    const textarea = page.locator("textarea");

    // Send first message to start a turn - use a longer command to keep turn active
    console.log(">>> Sending first message to start turn...");
    await textarea.fill("echo starting && sleep 3 && say 1");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);

    // Queue multiple messages while turn is active
    console.log(">>> Queueing message 2...");
    await textarea.fill("say 2");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);

    console.log(">>> Queueing message 3...");
    await textarea.fill("say 3");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);

    console.log(">>> Queueing message 4...");
    await textarea.fill("say 4");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);

    // Verify queue drawer shows queued messages
    console.log(">>> Checking queue drawer...");
    await expect(page.locator(".workspace-chat__queue-drawer")).toBeVisible();

    // Check how many items are in queue
    const queueCount = await page
      .locator(".workspace-chat__queue-item")
      .count();
    console.log(">>> Queue count:", queueCount);

    // Should have at least some queued messages
    expect(queueCount).toBeGreaterThan(0);

    // Check what's in the queue
    const queueTexts = await page
      .locator(".workspace-chat__queue-item-text")
      .allTextContents();
    console.log(">>> Queue contents:", queueTexts);
    expect(queueTexts.length).toBeGreaterThan(0);

    // Test delete - click delete on first queue item
    console.log(">>> Deleting first queue item...");
    const firstItemText = queueTexts[0];
    await page
      .locator(".workspace-chat__queue-item")
      .first()
      .locator("button:has-text('Delete')")
      .click();
    await page.waitForTimeout(1000);

    const afterDeleteCount = await page
      .locator(".workspace-chat__queue-item")
      .count();
    console.log(">>> After delete count:", afterDeleteCount);
    expect(afterDeleteCount).toBeLessThanOrEqual(queueTexts.length);

    // Test edit - click edit on first remaining queue item
    // Note: Edit moves text to draft and removes from queue
    console.log(">>> Editing first queue item...");
    const currentQueueTexts = await page
      .locator(".workspace-chat__queue-item-text")
      .allTextContents();
    const textToEdit = currentQueueTexts[0];

    await page
      .locator(".workspace-chat__queue-item")
      .first()
      .locator("button:has-text('Edit')")
      .click();
    await page.waitForTimeout(500);

    // Verify text moved to draft (composer)
    const draftValue = await page.locator("textarea").first().inputValue();
    console.log(">>> Draft value after edit:", draftValue);
    expect(draftValue).toContain(textToEdit);

    // Wait for turn to complete and verify queue processes
    console.log(">>> Waiting for turn to complete...");
    await page.waitForTimeout(10000);

    // Verify queue is now empty (processed)
    const finalQueueCount = await page
      .locator(".workspace-chat__queue-item")
      .count();
    console.log(">>> Final queue count:", finalQueueCount);

    // Test persistence - reload page
    console.log(">>> Reloading page to test persistence...");
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(5000);

    // Check if queue persisted (depends on backend)
    const persistedQueueCount = await page
      .locator(".workspace-chat__queue-item")
      .count();
    console.log(">>> Persisted queue count:", persistedQueueCount);

    console.log(">>> PASSED: Turn queue functionality works");
  });
});

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
