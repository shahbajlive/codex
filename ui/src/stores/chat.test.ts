import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setAgentsClient } from "./agents";
import { useChatStore } from "./chat";

const queuedTurn = {
  id: "turn-queued",
  status: "inProgress",
  error: null,
  items: [],
};

const selectedThread = {
  id: "thread-1",
  turns: [],
  preview: "",
  updatedAt: 0,
} as any;

describe("useChatStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    setAgentsClient({} as any);
  });

  it("keeps queued submissions out of the transcript draft state", async () => {
    const store = useChatStore();

    store.activeTurnId = "turn-running";
    store.getSelectedAgentId = vi.fn(() => "agent-1") as any;
    store.handleSlashCommand = vi.fn().mockResolvedValue(false) as any;
    store.ensureSelectedThread = vi.fn().mockResolvedValue("thread-1") as any;
    store.attachThread = vi.fn().mockResolvedValue("thread-1") as any;
    store.startTurnWithRecovery = vi
      .fn()
      .mockResolvedValue({ threadId: "thread-1", turn: queuedTurn }) as any;
    store.getSelectedThread = vi.fn(() => selectedThread) as any;
    store.replaceThread = vi.fn() as any;
    store.setHistory = vi.fn() as any;
    store.threadActivityMessage = vi.fn(() => null) as any;
    store.refreshPendingInput = vi.fn().mockResolvedValue(undefined) as any;
    store.refreshActiveTurnReconcileLoop = vi.fn() as any;

    const result = await store.sendMessage("Please queue this");

    expect(result).toBe(true);
    expect(store.pendingUserDraft).toBeNull();
  });

  it("stores the first submitted draft for the running turn", async () => {
    const store = useChatStore();

    store.activeTurnId = null;
    store.getSelectedAgentId = vi.fn(() => "agent-1") as any;
    store.handleSlashCommand = vi.fn().mockResolvedValue(false) as any;
    store.ensureSelectedThread = vi.fn().mockResolvedValue("thread-1") as any;
    store.attachThread = vi.fn().mockResolvedValue("thread-1") as any;
    store.startTurnWithRecovery = vi
      .fn()
      .mockResolvedValue({ threadId: "thread-1", turn: queuedTurn }) as any;
    store.getSelectedThread = vi.fn(() => selectedThread) as any;
    store.replaceThread = vi.fn() as any;
    store.setHistory = vi.fn() as any;
    store.threadActivityMessage = vi.fn(() => null) as any;
    store.refreshPendingInput = vi.fn().mockResolvedValue(undefined) as any;
    store.refreshActiveTurnReconcileLoop = vi.fn() as any;

    const result = await store.sendMessage("Start now");

    expect(result).toBe(true);
    expect(store.pendingUserDraft).toBe("Start now");
  });
});
