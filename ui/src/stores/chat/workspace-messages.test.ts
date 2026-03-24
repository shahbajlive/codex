import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { CodexAppServerClient } from "../../lib/app-server-client";
import type { Model, Thread } from "../../lib/protocol";
import { slashCommands } from "../../lib/slash-commands";
import {
  ACTIVE_TURN_RECONCILE_INTERVAL_MS,
  INTERRUPT_MAX_RETRIES,
  INTERRUPT_RECONCILE_DELAY_MS,
  INTERRUPT_RETRY_INTERVAL_MS,
  setWorkspaceMessagesClient,
  useWorkspaceMessagesStore,
} from "./workspace-messages";
import { useSettingsStore } from "../settings";
import { useAgentsStore } from "../agents";

describe("workspace-messages store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    const settings = useSettingsStore();
    settings.updateSettings({
      url: "ws://127.0.0.1:8765",
      cwd: "/repo",
      model: "",
      personality: "friendly",
      approvalPolicy: "on-request",
      sandboxMode: "workspace-write",
      theme: "system",
      navCollapsed: false,
    });
    const agentsStore = useAgentsStore();
    agentsStore.$patch({
      agents: [makeAgentRow()],
      selectedAgentId: null,
      config: {
        name: "Scout",
        model: "",
        approvalPolicy: "on-request",
        sandboxMode: "workspace-write",
        workspace: "/repo",
        configFile: "",
        tools: { allowed: [], denied: [] },
        skills: [],
        files: [],
        contacts: { allowed: [], denied: [] },
      },
    });
  });

  it("keeps slash commands in the frontend", async () => {
    const startTurn = vi.fn();
    const startThreadForAgent = vi
      .fn()
      .mockResolvedValue(makeThread("thread_new"));

    setWorkspaceMessagesClient({
      startTurn,
      startThreadForAgent,
      readAgent: vi.fn().mockResolvedValue({}),
      getAgentWorkspaceFiles: vi.fn().mockResolvedValue({ files: [] }),
    } as unknown as CodexAppServerClient);

    const store = useWorkspaceMessagesStore();
    store.agents = [makeAgentRow()];
    store.selectedAgentId = "agent-1";

    await store.sendMessage("/new");

    expect(startTurn).not.toHaveBeenCalled();
    expect(startThreadForAgent).toHaveBeenCalledWith("agent-1");
    expect(store.selectedThreadId).toBe("thread_new");
    expect(store.transcript.at(-1)?.items[0]).toMatchObject({
      kind: "event",
      label: "Started new chat",
    });
  });

  it("starts a fresh thread for /clear even when a mapping exists", async () => {
    const startTurn = vi.fn();
    const startThreadForAgent = vi
      .fn()
      .mockResolvedValue(makeThread("thread_fresh"));

    setWorkspaceMessagesClient({
      startTurn,
      startThreadForAgent,
      readAgent: vi.fn().mockResolvedValue({}),
      getAgentWorkspaceFiles: vi.fn().mockResolvedValue({ files: [] }),
    } as unknown as CodexAppServerClient);

    const store = useWorkspaceMessagesStore();
    store.agents = [makeAgentRow()];
    store.selectedAgentId = "agent-1";
    store.threadByAgentId = { "agent-1": "thread_existing" };
    store.selectedThreadId = "thread_existing";

    await store.sendMessage("/clear");

    expect(startTurn).not.toHaveBeenCalled();
    expect(startThreadForAgent).toHaveBeenCalledWith("agent-1");
    expect(store.selectedThreadId).toBe("thread_fresh");
    expect(store.threadByAgentId["agent-1"]).toBe("thread_fresh");
    expect(store.transcript.at(-1)?.items[0]).toMatchObject({
      kind: "event",
      label: "Cleared chat",
    });
  });

  it("does not read turns for a freshly created agent thread", async () => {
    const readThread = vi.fn();
    const startThreadForAgent = vi
      .fn()
      .mockResolvedValue(makeThread("thread_new"));

    setWorkspaceMessagesClient({
      readThread,
      startThreadForAgent,
      readAgent: vi.fn().mockResolvedValue({}),
      getAgentWorkspaceFiles: vi.fn().mockResolvedValue({ files: [] }),
    } as unknown as CodexAppServerClient);

    const store = useWorkspaceMessagesStore();
    store.agents = [makeAgentRow()];

    await store.selectAgent("agent-1");

    expect(startThreadForAgent).toHaveBeenCalledOnce();
    expect(readThread).not.toHaveBeenCalled();
    expect(store.selectedThreadId).toBe("thread_new");
    expect(store.selectedThread?.id).toBe("thread_new");
  });

  it("updates the selected agent model for /model", async () => {
    const listModels = vi
      .fn()
      .mockResolvedValue([
        makeModel("gpt-5"),
        makeModel("gpt-5-mini"),
      ] satisfies Model[]);
    const readConfig = vi.fn().mockResolvedValue({
      config: {
        model: "gpt-5-mini",
        model_provider: "openai",
        model_context_window: 200000,
        model_auto_compact_token_limit: 120000,
      },
    });
    const updateAgent = vi.fn().mockResolvedValue(undefined);
    const saveAgentWorkspaceFiles = vi.fn().mockResolvedValue(undefined);
    const startTurn = vi.fn();

    setWorkspaceMessagesClient({
      listModels,
      readConfig,
      updateAgent,
      saveAgentWorkspaceFiles,
      startTurn,
    } as unknown as CodexAppServerClient);

    const store = useWorkspaceMessagesStore();
    const agentsStore = useAgentsStore();
    store.agents = [makeAgentRow()];
    store.selectedAgentId = "agent-1";
    agentsStore.selectedAgentId = "agent-1";
    agentsStore.originalConfig = JSON.parse(JSON.stringify(agentsStore.config));

    await store.sendMessage("/model gpt-5-mini");

    expect(startTurn).not.toHaveBeenCalled();
    expect(updateAgent).toHaveBeenCalled();
    expect(store.modelLabel).toBe("gpt-5-mini");
    expect(store.transcript.at(-1)?.items[0]).toMatchObject({
      kind: "event",
      label: "Model updated",
    });
  });

  it("intercepts the full slash command inventory locally", async () => {
    const client = makeSlashClient();
    setWorkspaceMessagesClient(client as unknown as CodexAppServerClient);

    const store = useWorkspaceMessagesStore();
    store.agents = [makeAgentRow()];
    store.selectedAgentId = "agent-1";
    store.selectedThreadId = "thread_existing";
    // @ts-expect-error Pinia deep type recursion with complex protocol types
    store.selectedThread = makeThread("thread_existing") as Thread;
    store.setTranscript([
      {
        id: "local-turn",
        status: "completed",
        error: null,
        items: [
          {
            id: "assistant-1",
            kind: "assistant",
            text: "Latest assistant output",
            status: "done",
          },
        ],
      },
    ]);

    const commandInputs = new Map<string, string>([
      ["/model", "/model gpt-5-mini"],
      ["/review", "/review focus on tests"],
      ["/rename", "/rename Renamed thread"],
      ["/resume", "/resume Existing thread"],
      ["/plan", "/plan roadmap"],
      ["/agent", "/agent Scout"],
      ["/mention", "/mention src/main.ts"],
      ["/theme", "/theme dark"],
      ["/feedback", "/feedback helpful output"],
      ["/personality", "/personality pragmatic"],
      ["/subagents", "/subagents Scout"],
    ]);

    for (const definition of slashCommands) {
      await store.sendMessage(
        commandInputs.get(definition.command) || definition.command,
      );
    }
    await store.sendMessage("/clean");

    expect(client.startTurn).not.toHaveBeenCalled();
    expect(client.listModels).toHaveBeenCalled();
    expect(client.startReview).toHaveBeenCalled();
    expect(client.setThreadName).toHaveBeenCalledWith(
      "thread_existing",
      "Renamed thread",
    );
    expect(client.listThreads).toHaveBeenCalled();
    expect(client.forkThread).toHaveBeenCalled();
    expect(client.compactThread).toHaveBeenCalled();
    expect(client.runThreadShellCommand).toHaveBeenCalled();
    expect(client.listExperimentalFeatures).toHaveBeenCalled();
    expect(client.listSkills).toHaveBeenCalled();
    expect(client.listMcpServers).toHaveBeenCalled();
    expect(client.listApps).toHaveBeenCalled();
    expect(client.listPlugins).toHaveBeenCalled();
    expect(client.logout).toHaveBeenCalled();
    expect(client.uploadFeedback).toHaveBeenCalled();
    expect(client.cleanBackgroundTerminals).toHaveBeenCalled();
  });

  it("surfaces turn start failures without leaving the store busy", async () => {
    const startTurn = vi.fn().mockRejectedValue(new Error("stream closed"));
    const startThreadForAgent = vi
      .fn()
      .mockResolvedValue(makeThread("thread_new"));

    setWorkspaceMessagesClient({
      startTurn,
      startThreadForAgent,
      readAgent: vi.fn().mockResolvedValue({}),
      getAgentWorkspaceFiles: vi.fn().mockResolvedValue({ files: [] }),
    } as unknown as CodexAppServerClient);

    const store = useWorkspaceMessagesStore();
    store.agents = [makeAgentRow()];
    store.selectedAgentId = "agent-1";

    await store.sendMessage("hello");

    expect(store.busy).toBe(false);
    expect(store.statusMessage).toBe("stream closed");
    expect(store.statusTone).toBe("error");
  });

  it("tracks resumed thread id when loading a thread", async () => {
    const readThread = vi.fn().mockResolvedValue(makeThread("thread_loaded"));

    setWorkspaceMessagesClient({
      readThread,
      readAgent: vi.fn().mockResolvedValue({}),
      getAgentWorkspaceFiles: vi.fn().mockResolvedValue({ files: [] }),
    } as unknown as CodexAppServerClient);

    const store = useWorkspaceMessagesStore();
    await store.loadThread("thread_loaded");

    expect(store.resumedThreadId).toBe("thread_loaded");
  });

  it("does not re-resume an already loaded thread on send", async () => {
    const startTurn = vi.fn().mockResolvedValue({
      id: "turn_1",
      status: "inProgress",
      error: null,
      items: [],
    });
    const resumeThread = vi.fn();

    setWorkspaceMessagesClient({
      startTurn,
      resumeThread,
      readAgent: vi.fn().mockResolvedValue({}),
      getAgentWorkspaceFiles: vi.fn().mockResolvedValue({ files: [] }),
    } as unknown as CodexAppServerClient);

    const store = useWorkspaceMessagesStore();
    store.agents = [makeAgentRow()];
    store.selectedAgentId = "agent-1";
    store.threadByAgentId = { "agent-1": "thread_existing" };
    store.selectedThreadId = "thread_existing";
    store.selectedThread = makeThread("thread_existing", "Existing thread");
    store.resumedThreadId = null;

    await store.sendMessage("hello");

    expect(resumeThread).not.toHaveBeenCalled();
    expect(startTurn).toHaveBeenCalledWith(
      "thread_existing",
      "hello",
      expect.objectContaining({
        cwd: "/repo",
      }),
    );
  });

  it("does not reuse another agent's selected thread", async () => {
    const readThread = vi.fn().mockResolvedValue(makeThread("thread_agent_2"));
    const startThreadForAgent = vi
      .fn()
      .mockResolvedValue(makeThread("thread_agent_2"));

    setWorkspaceMessagesClient({
      readThread,
      startThreadForAgent,
      readAgent: vi.fn().mockResolvedValue({}),
      getAgentWorkspaceFiles: vi.fn().mockResolvedValue({ files: [] }),
    } as unknown as CodexAppServerClient);

    const store = useWorkspaceMessagesStore();
    store.agents = [makeAgentRow(), makeAgentRow("agent-2", "Builder")];
    store.selectedThreadId = "thread_agent_1";
    store.threadByAgentId = { "agent-1": "thread_agent_1" };

    await store.selectAgent("agent-2");

    expect(startThreadForAgent).toHaveBeenCalledWith("agent-2");
    expect(store.selectedThreadId).toBe("thread_agent_2");
  });

  it("clears stale transcript when loading the selected agent thread fails", async () => {
    const readThread = vi
      .fn()
      .mockRejectedValue(new Error("thread not loaded: thread_agent_2"));

    setWorkspaceMessagesClient({
      readThread,
      readAgent: vi.fn().mockResolvedValue({}),
      getAgentWorkspaceFiles: vi.fn().mockResolvedValue({ files: [] }),
    } as unknown as CodexAppServerClient);

    const store = useWorkspaceMessagesStore();
    store.agents = [makeAgentRow(), makeAgentRow("agent-2", "Builder")];
    store.selectedAgentId = "agent-1";
    store.selectedThreadId = "thread_agent_1";
    store.selectedThread = makeThread("thread_agent_1");
    store.threadByAgentId = {
      "agent-1": "thread_agent_1",
      "agent-2": "thread_agent_2",
    };
    store.transcript = [{ id: "turn_prev" } as never];
    store.committedTranscript = [{ id: "turn_prev" } as never];

    await store.selectAgent("agent-2");

    expect(readThread).toHaveBeenCalledWith("thread_agent_2");
    expect(store.selectedThread).toBeNull();
    expect(store.transcript).toHaveLength(0);
    expect(store.committedTranscript).toHaveLength(0);
    expect(store.statusMessage).toBe("thread not loaded: thread_agent_2");
    expect(store.statusTone).toBe("error");
  });

  it("recreates a stale mapped thread before sending", async () => {
    const readThread = vi
      .fn()
      .mockRejectedValue(
        new Error("no rollout found for thread id thread_old"),
      );
    const startThreadForAgent = vi
      .fn()
      .mockResolvedValue(makeThread("thread_fresh"));
    const startTurn = vi.fn().mockResolvedValue({
      id: "turn_1",
      status: "inProgress",
      error: null,
      items: [],
    });

    setWorkspaceMessagesClient({
      readThread,
      startThreadForAgent,
      startTurn,
      readAgent: vi.fn().mockResolvedValue({}),
      getAgentWorkspaceFiles: vi.fn().mockResolvedValue({ files: [] }),
    } as unknown as CodexAppServerClient);

    const store = useWorkspaceMessagesStore();
    store.agents = [makeAgentRow()];
    store.selectedAgentId = "agent-1";
    store.threadByAgentId = { "agent-1": "thread_old" };
    store.threadIdsByAgentId = { "agent-1": ["thread_old", "thread_other"] };
    store.selectedThreadId = "thread_old";

    await store.sendMessage("hello");

    expect(readThread).toHaveBeenCalledWith("thread_old");
    expect(startThreadForAgent).toHaveBeenCalledWith("agent-1");
    expect(store.selectedThreadId).toBe("thread_fresh");
    expect(store.threadIdsByAgentId["agent-1"]).toEqual([
      "thread_fresh",
      "thread_other",
    ]);
    expect(startTurn).toHaveBeenCalledWith(
      "thread_fresh",
      "hello",
      expect.any(Object),
    );
  });

  it("falls back to a fresh thread when startTurn fails with thread not found", async () => {
    const readThread = vi.fn().mockResolvedValue(makeThread("thread_old"));
    const startThreadForAgent = vi
      .fn()
      .mockResolvedValue(makeThread("thread_fresh"));
    const startTurn = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("thread not found: 019d1efc-0b95-7ba1-bd64-c790cde503f9"),
      )
      .mockResolvedValueOnce({
        id: "turn_1",
        status: "inProgress",
        error: null,
        items: [],
      });

    setWorkspaceMessagesClient({
      readThread,
      startThreadForAgent,
      startTurn,
      readAgent: vi.fn().mockResolvedValue({}),
      getAgentWorkspaceFiles: vi.fn().mockResolvedValue({ files: [] }),
    } as unknown as CodexAppServerClient);

    const store = useWorkspaceMessagesStore();
    store.agents = [makeAgentRow()];
    store.selectedAgentId = "agent-1";
    store.threadByAgentId = { "agent-1": "thread_old" };
    store.threadIdsByAgentId = { "agent-1": ["thread_old", "thread_other"] };
    store.selectedThreadId = "thread_old";

    await store.sendMessage("hello");

    expect(readThread).toHaveBeenCalledWith("thread_old");
    expect(startThreadForAgent).toHaveBeenCalledWith("agent-1");
    expect(startTurn).toHaveBeenNthCalledWith(
      1,
      "thread_old",
      "hello",
      expect.any(Object),
    );
    expect(startTurn).toHaveBeenNthCalledWith(
      2,
      "thread_fresh",
      "hello",
      expect.any(Object),
    );
    expect(store.selectedThreadId).toBe("thread_fresh");
    expect(store.threadIdsByAgentId["agent-1"]).toEqual([
      "thread_fresh",
      "thread_other",
    ]);
  });

  it("falls back to a fresh thread when resume fails with missing rollout", async () => {
    const readThread = vi.fn().mockResolvedValue(makeThread("thread_old"));
    const startThreadForAgent = vi
      .fn()
      .mockResolvedValue(makeThread("thread_fresh"));
    const startTurn = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("no rollout found for thread id thread_old"),
      )
      .mockResolvedValueOnce({
        id: "turn_1",
        status: "inProgress",
        error: null,
        items: [],
      });

    setWorkspaceMessagesClient({
      readThread,
      startThreadForAgent,
      startTurn,
      readAgent: vi.fn().mockResolvedValue({}),
      getAgentWorkspaceFiles: vi.fn().mockResolvedValue({ files: [] }),
    } as unknown as CodexAppServerClient);

    const store = useWorkspaceMessagesStore();
    store.agents = [makeAgentRow()];
    store.selectedAgentId = "agent-1";
    store.threadByAgentId = { "agent-1": "thread_old" };
    store.selectedThreadId = "thread_old";

    await store.sendMessage("hello");

    expect(readThread).toHaveBeenCalledWith("thread_old");
    expect(startThreadForAgent).toHaveBeenCalledWith("agent-1");
    expect(startTurn).toHaveBeenNthCalledWith(
      1,
      "thread_old",
      "hello",
      expect.any(Object),
    );
    expect(startTurn).toHaveBeenNthCalledWith(
      2,
      "thread_fresh",
      "hello",
      expect.any(Object),
    );
    expect(store.selectedThreadId).toBe("thread_fresh");
  });

  it("loads non-materialized mapped threads without includeTurns", async () => {
    const thread = makeThread("thread_existing", "Fresh thread");
    const readThread = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          "thread thread_existing is not materialized yet; includeTurns is unavailable before first user message",
        ),
      )
      .mockResolvedValueOnce(thread);

    setWorkspaceMessagesClient({
      readThread,
      readAgent: vi.fn().mockResolvedValue({}),
      getAgentWorkspaceFiles: vi.fn().mockResolvedValue({ files: [] }),
    } as unknown as CodexAppServerClient);

    const store = useWorkspaceMessagesStore();
    store.agents = [makeAgentRow()];
    store.threadByAgentId = { "agent-1": "thread_existing" };

    await store.selectAgent("agent-1");

    expect(readThread).toHaveBeenNthCalledWith(1, "thread_existing");
    expect(readThread).toHaveBeenNthCalledWith(2, "thread_existing", false);
    expect(store.selectedThreadId).toBe("thread_existing");
    expect(store.selectedThread).toMatchObject({ id: "thread_existing" });
    expect(store.statusMessage).toBeNull();
  });

  it("loads mapped threads with missing rollout via includeTurns false", async () => {
    const thread = makeThread("thread_existing", "Recovered thread");
    const readThread = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("no rollout found for thread id thread_existing"),
      )
      .mockResolvedValueOnce(thread);

    setWorkspaceMessagesClient({
      readThread,
      readAgent: vi.fn().mockResolvedValue({}),
      getAgentWorkspaceFiles: vi.fn().mockResolvedValue({ files: [] }),
    } as unknown as CodexAppServerClient);

    const store = useWorkspaceMessagesStore();
    store.agents = [makeAgentRow()];
    store.threadByAgentId = { "agent-1": "thread_existing" };

    await store.selectAgent("agent-1");

    expect(readThread).toHaveBeenNthCalledWith(1, "thread_existing");
    expect(readThread).toHaveBeenNthCalledWith(2, "thread_existing", false);
    expect(store.selectedThreadId).toBe("thread_existing");
    expect(store.selectedThread).toMatchObject({ id: "thread_existing" });
    expect(store.statusMessage).toBeNull();
  });

  it("restores working status when loaded thread is active", async () => {
    const thread = makeThread("thread_active", "Active thread");
    thread.status = { type: "active", activeFlags: [] };
    const readThread = vi.fn().mockResolvedValue(thread);

    setWorkspaceMessagesClient({
      readThread,
      readAgent: vi.fn().mockResolvedValue({}),
      getAgentWorkspaceFiles: vi.fn().mockResolvedValue({ files: [] }),
    } as unknown as CodexAppServerClient);

    const store = useWorkspaceMessagesStore();
    store.agents = [makeAgentRow()];
    store.threadByAgentId = { "agent-1": "thread_active" };

    await store.selectAgent("agent-1");

    expect(store.activeTurnId).toBeNull();
    expect(store.statusMessage).toBe("Working");
    expect(store.statusTone).toBe("info");
  });

  it("reconstructs the latest persisted thread per agent on refresh", async () => {
    const latestScoutThread = makeThread("thread_scout_newer", "Scout latest");
    latestScoutThread.updatedAt = 20;
    latestScoutThread.preview = "Newest scout transcript";
    latestScoutThread.agentNickname = "Scout";
    latestScoutThread.source = {
      subAgent: {
        thread_spawn: {
          parent_thread_id: "parent-thread",
          depth: 1,
          agent_nickname: "Scout",
          agent_role: "researcher",
        },
      },
    };

    const olderScoutThread = makeThread("thread_scout_older", "Scout older");
    olderScoutThread.updatedAt = 10;
    olderScoutThread.agentNickname = "Scout";

    const builderThread = makeThread("thread_builder", "Builder latest");
    builderThread.updatedAt = 15;
    builderThread.agentRole = "Builder";

    const listAgents = vi.fn().mockResolvedValue([
      {
        id: "agent-1",
        name: "Scout",
        description: "Research agent",
        configFile: null,
        nicknameCandidates: ["Scout"],
        workspace: "/repo",
        hasWorkspace: true,
      },
      {
        id: "agent-2",
        name: "Builder",
        description: "Build agent",
        configFile: null,
        nicknameCandidates: ["Builder"],
        workspace: "/repo",
        hasWorkspace: true,
      },
    ]);
    const listThreads = vi
      .fn()
      .mockResolvedValue([olderScoutThread, builderThread, latestScoutThread]);
    const readThread = vi.fn().mockResolvedValue(latestScoutThread);
    const startThreadForAgent = vi.fn();

    setWorkspaceMessagesClient({
      listAgents,
      listThreads,
      readThread,
      startThreadForAgent,
      readConfig: vi.fn().mockResolvedValue({ config: {} }),
      readAgent: vi.fn().mockResolvedValue({}),
      getAgentWorkspaceFiles: vi.fn().mockResolvedValue({ files: [] }),
    } as unknown as CodexAppServerClient);

    const store = useWorkspaceMessagesStore();
    await store.refreshWorkspaceAgents();

    expect(store.threadByAgentId).toMatchObject({
      "agent-1": "thread_scout_newer",
      "agent-2": "thread_builder",
    });
    expect(store.agents[0]).toMatchObject({
      threadId: "thread_scout_newer",
      hasThread: true,
      preview: "Scout latest",
    });
    expect(readThread).toHaveBeenCalledWith("thread_scout_newer");
    expect(startThreadForAgent).not.toHaveBeenCalled();
  });

  it("keeps the currently mapped thread when it still exists on refresh", async () => {
    const currentThread = makeThread("thread_current", "Scout current");
    currentThread.updatedAt = 5;
    currentThread.agentNickname = "Scout";

    const newerMatched = makeThread("thread_newer", "Scout newer");
    newerMatched.updatedAt = 20;
    newerMatched.agentNickname = "Scout";

    const readThread = vi.fn().mockResolvedValue(currentThread);

    setWorkspaceMessagesClient({
      listAgents: vi.fn().mockResolvedValue([
        {
          id: "agent-1",
          name: "Scout",
          description: "Research agent",
          configFile: null,
          nicknameCandidates: ["Scout"],
          workspace: "/repo",
          hasWorkspace: true,
        },
      ]),
      listThreads: vi.fn().mockResolvedValue([newerMatched, currentThread]),
      readThread,
      readConfig: vi.fn().mockResolvedValue({ config: {} }),
      readAgent: vi.fn().mockResolvedValue({}),
      getAgentWorkspaceFiles: vi.fn().mockResolvedValue({ files: [] }),
    } as unknown as CodexAppServerClient);

    const store = useWorkspaceMessagesStore();
    store.selectedAgentId = "agent-1";
    store.threadByAgentId = { "agent-1": "thread_current" };

    await store.refreshWorkspaceAgents();

    expect(store.threadByAgentId["agent-1"]).toBe("thread_current");
    expect(store.threadIdsByAgentId["agent-1"]?.[0]).toBe("thread_current");
    expect(store.selectedThreadId).toBe("thread_current");
    expect(readThread).toHaveBeenCalledWith("thread_current");
  });

  it("keeps prior agent thread history on refresh when threads still exist", async () => {
    const currentThread = makeThread("thread_current", "Current");
    const previousThread = makeThread("thread_previous", "Previous");
    const unrelated = makeThread("thread_unrelated", "Unrelated");

    const readThread = vi.fn().mockResolvedValue(currentThread);

    setWorkspaceMessagesClient({
      listAgents: vi.fn().mockResolvedValue([
        {
          id: "agent-1",
          name: "Scout",
          description: "Research agent",
          configFile: null,
          nicknameCandidates: ["Scout"],
          workspace: "/repo",
          hasWorkspace: true,
        },
      ]),
      listThreads: vi
        .fn()
        .mockResolvedValue([unrelated, previousThread, currentThread]),
      readThread,
      readConfig: vi.fn().mockResolvedValue({ config: {} }),
      readAgent: vi.fn().mockResolvedValue({}),
      getAgentWorkspaceFiles: vi.fn().mockResolvedValue({ files: [] }),
    } as unknown as CodexAppServerClient);

    const store = useWorkspaceMessagesStore();
    store.selectedAgentId = "agent-1";
    store.threadByAgentId = { "agent-1": "thread_current" };
    store.threadIdsByAgentId = {
      "agent-1": ["thread_current", "thread_previous"],
    };

    await store.refreshWorkspaceAgents();

    expect(store.threadIdsByAgentId["agent-1"]).toEqual([
      "thread_current",
      "thread_previous",
    ]);
  });

  it("prefers reconstructed mapped thread over creating a new one", async () => {
    const readThread = vi.fn().mockResolvedValue(makeThread("thread_existing"));
    const startThreadForAgent = vi.fn();

    setWorkspaceMessagesClient({
      readThread,
      startThreadForAgent,
      readAgent: vi.fn().mockResolvedValue({}),
      getAgentWorkspaceFiles: vi.fn().mockResolvedValue({ files: [] }),
    } as unknown as CodexAppServerClient);

    const store = useWorkspaceMessagesStore();
    store.agents = [makeAgentRow()];
    store.threadByAgentId = { "agent-1": "thread_existing" };

    await store.selectAgent("agent-1");

    expect(startThreadForAgent).not.toHaveBeenCalled();
    expect(readThread).toHaveBeenCalledWith("thread_existing");
    expect(store.selectedThreadId).toBe("thread_existing");
  });

  it("matches persisted threads when agent and thread identities differ by separators", async () => {
    const thread = makeThread("thread_developer_lead", "Developer lead latest");
    thread.updatedAt = 25;
    thread.agentRole = "developer_lead";

    const listAgents = vi.fn().mockResolvedValue([
      {
        id: "developer-lead",
        name: "Developer Lead",
        description: "Lead agent",
        configFile: null,
        nicknameCandidates: ["developer lead"],
        workspace: "/repo",
        hasWorkspace: true,
      },
    ]);
    const listThreads = vi.fn().mockResolvedValue([thread]);
    const readThread = vi.fn().mockResolvedValue(thread);

    setWorkspaceMessagesClient({
      listAgents,
      listThreads,
      readThread,
      readConfig: vi.fn().mockResolvedValue({ config: {} }),
      readAgent: vi.fn().mockResolvedValue({}),
      getAgentWorkspaceFiles: vi.fn().mockResolvedValue({ files: [] }),
    } as unknown as CodexAppServerClient);

    const store = useWorkspaceMessagesStore();
    await store.refreshWorkspaceAgents();

    expect(store.threadByAgentId).toMatchObject({
      "developer-lead": "thread_developer_lead",
    });
    expect(readThread).toHaveBeenCalledWith("thread_developer_lead");
  });

  it("restores selected agent thread even when selected id already matches", async () => {
    const thread = makeThread("thread_existing", "Developer lead latest");
    thread.updatedAt = 40;
    thread.agentRole = "developer_lead";

    setWorkspaceMessagesClient({
      listAgents: vi.fn().mockResolvedValue([
        {
          id: "developer-lead",
          name: "Developer Lead",
          description: "Lead agent",
          configFile: null,
          nicknameCandidates: ["developer lead"],
          workspace: "/repo",
          hasWorkspace: true,
        },
      ]),
      listThreads: vi.fn().mockResolvedValue([thread]),
      readThread: vi.fn().mockResolvedValue(thread),
      readConfig: vi.fn().mockResolvedValue({ config: {} }),
      readAgent: vi.fn().mockResolvedValue({}),
      getAgentWorkspaceFiles: vi.fn().mockResolvedValue({ files: [] }),
    } as unknown as CodexAppServerClient);

    const store = useWorkspaceMessagesStore();
    store.selectedAgentId = "developer-lead";
    store.selectedThreadId = "thread_existing";
    store.selectedThread = null;

    await store.refreshWorkspaceAgents();

    expect(store.selectedThread).toMatchObject({ id: "thread_existing" });
    expect(store.committedTranscript).toBeTruthy();
  });

  it("recovers from stale mapped thread during refresh by starting a fresh thread", async () => {
    const staleThread = makeThread("thread_stale", "Backend stale thread");
    staleThread.updatedAt = 40;
    staleThread.agentRole = "backend_engineer";

    const freshThread = makeThread("thread_fresh_after_refresh", "Fresh chat");
    const readThread = vi
      .fn()
      .mockRejectedValue(
        new Error("no rollout found for thread id thread_stale"),
      );
    const startThreadForAgent = vi.fn().mockResolvedValue(freshThread);

    setWorkspaceMessagesClient({
      listAgents: vi.fn().mockResolvedValue([
        {
          id: "backend-engineer",
          name: "Backend Engineer",
          description: "Backend agent",
          configFile: null,
          nicknameCandidates: ["backend engineer"],
          workspace: "/repo",
          hasWorkspace: true,
        },
      ]),
      listThreads: vi.fn().mockResolvedValue([staleThread]),
      readThread,
      startThreadForAgent,
      readConfig: vi.fn().mockResolvedValue({ config: {} }),
      readAgent: vi.fn().mockResolvedValue({}),
      getAgentWorkspaceFiles: vi.fn().mockResolvedValue({ files: [] }),
    } as unknown as CodexAppServerClient);

    const store = useWorkspaceMessagesStore();
    store.selectedAgentId = "backend-engineer";
    store.threadByAgentId = { "backend-engineer": "thread_stale" };
    store.selectedThread = null;

    await store.refreshWorkspaceAgents();

    expect(readThread).toHaveBeenCalledWith("thread_stale");
    expect(startThreadForAgent).toHaveBeenCalledWith("backend-engineer");
    expect(store.selectedThreadId).toBe("thread_fresh_after_refresh");
    expect(store.threadByAgentId["backend-engineer"]).toBe(
      "thread_fresh_after_refresh",
    );
    expect(store.statusTone).toBe("warning");
  });

  it("preserves existing mapped thread when reconstruction is null but thread still exists", async () => {
    const thread = makeThread("thread_unrelated", "General workspace thread");
    thread.updatedAt = 50;
    thread.preview = "hi";
    thread.source = "vscode";

    const existingThread = makeThread(
      "thread_existing",
      "Existing developer lead",
    );
    const readThread = vi.fn().mockResolvedValue(existingThread);
    const startThreadForAgent = vi.fn();

    setWorkspaceMessagesClient({
      listAgents: vi.fn().mockResolvedValue([
        {
          id: "developer_lead",
          name: "Developer Lead",
          description: "Lead agent",
          configFile: null,
          nicknameCandidates: [],
          workspace: "/repo",
          hasWorkspace: true,
        },
      ]),
      listThreads: vi.fn().mockResolvedValue([thread, existingThread]),
      readThread,
      startThreadForAgent,
      readConfig: vi.fn().mockResolvedValue({ config: {} }),
      readAgent: vi.fn().mockResolvedValue({}),
      getAgentWorkspaceFiles: vi.fn().mockResolvedValue({ files: [] }),
    } as unknown as CodexAppServerClient);

    const store = useWorkspaceMessagesStore();
    store.selectedAgentId = "developer_lead";
    store.threadByAgentId = { developer_lead: "thread_existing" };
    store.selectedThread = null;

    await store.refreshWorkspaceAgents();

    expect(startThreadForAgent).not.toHaveBeenCalled();
    expect(store.threadByAgentId.developer_lead).toBe("thread_existing");
    expect(store.selectedThreadId).toBe("thread_existing");
    expect(readThread).toHaveBeenCalledWith("thread_existing");
    expect(store.selectedThread).toMatchObject({ id: "thread_existing" });
  });

  it("auto-selects a thread for the selected agent during refresh", async () => {
    const freshThread = makeThread("thread_fresh", "Fresh backend thread");
    const startThreadForAgent = vi.fn().mockResolvedValue(freshThread);

    setWorkspaceMessagesClient({
      listAgents: vi.fn().mockResolvedValue([
        {
          id: "backend_engineer",
          name: "Backend Engineer",
          description: "Backend agent",
          configFile: null,
          nicknameCandidates: [],
          workspace: "/repo",
          hasWorkspace: true,
        },
      ]),
      listThreads: vi.fn().mockResolvedValue([]),
      startThreadForAgent,
      readConfig: vi.fn().mockResolvedValue({ config: {} }),
      readAgent: vi.fn().mockResolvedValue({}),
      getAgentWorkspaceFiles: vi.fn().mockResolvedValue({ files: [] }),
    } as unknown as CodexAppServerClient);

    const store = useWorkspaceMessagesStore();
    store.selectedAgentId = "backend_engineer";

    await store.refreshWorkspaceAgents();

    expect(startThreadForAgent).toHaveBeenCalledWith("backend_engineer");
    expect(store.selectedThreadId).toBe("thread_fresh");
    expect(store.selectedThread).toMatchObject({ id: "thread_fresh" });
    expect(store.threadByAgentId.backend_engineer).toBe("thread_fresh");
  });

  it("falls back to thread title/preview matching when explicit agent metadata is absent", async () => {
    const thread = makeThread("thread_named", "Developer Lead investigation");
    thread.preview = "Developer lead latest transcript";
    thread.updatedAt = 30;

    setWorkspaceMessagesClient({
      listAgents: vi.fn().mockResolvedValue([
        {
          id: "developer-lead",
          name: "Developer Lead",
          description: "Lead agent",
          configFile: null,
          nicknameCandidates: [],
          workspace: "/repo",
          hasWorkspace: true,
        },
      ]),
      listThreads: vi.fn().mockResolvedValue([thread]),
      readThread: vi.fn().mockResolvedValue(thread),
      readConfig: vi.fn().mockResolvedValue({ config: {} }),
      readAgent: vi.fn().mockResolvedValue({}),
      getAgentWorkspaceFiles: vi.fn().mockResolvedValue({ files: [] }),
    } as unknown as CodexAppServerClient);

    const store = useWorkspaceMessagesStore();
    await store.refreshWorkspaceAgents();

    expect(store.threadByAgentId["developer-lead"]).toBe("thread_named");
  });

  it("interrupts the active turn through the app-server client", async () => {
    const interruptTurn = vi.fn().mockResolvedValue(undefined);

    setWorkspaceMessagesClient({
      interruptTurn,
    } as unknown as CodexAppServerClient);

    const store = useWorkspaceMessagesStore();
    store.selectedThreadId = "thread_existing";
    store.activeTurnId = "turn_active";

    await store.interruptActiveTurn();

    expect(interruptTurn).toHaveBeenCalledWith(
      "thread_existing",
      "turn_active",
    );
    expect(store.statusMessage).toBe("Interrupting...");
    expect(store.statusTone).toBe("warning");
    expect(store.interruptRequestedTurnId).toBe("turn_active");
  });

  it("reconciles interrupt state when terminal notification is missed", async () => {
    vi.useFakeTimers();
    try {
      const interruptTurn = vi.fn().mockResolvedValue(undefined);
      const interruptedThread = makeThread("thread_existing");
      interruptedThread.turns = [
        {
          id: "turn_active",
          status: "interrupted",
          error: null,
          items: [],
        },
      ];
      const readThread = vi.fn().mockResolvedValue(interruptedThread);

      setWorkspaceMessagesClient({
        interruptTurn,
        readThread,
      } as unknown as CodexAppServerClient);

      const store = useWorkspaceMessagesStore();
      store.selectedThreadId = "thread_existing";
      store.pendingUserDraft = "please try again";
      store.activeTurnId = "turn_active";

      await store.interruptActiveTurn();
      await vi.advanceTimersByTimeAsync(INTERRUPT_RECONCILE_DELAY_MS + 10);

      expect(readThread).toHaveBeenCalledWith("thread_existing");
      expect(store.statusMessage).toBe("Interrupted");
      expect(store.statusTone).toBe("warning");
      expect(store.activeTurnId).toBeNull();
      expect(store.interruptRequestedTurnId).toBeNull();
      expect(store.restoredDraft).toBe("please try again");
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries interrupt while turn remains in progress", async () => {
    vi.useFakeTimers();
    try {
      const interruptTurn = vi.fn().mockResolvedValue(undefined);
      const inProgressThread = makeThread("thread_existing");
      inProgressThread.turns = [
        {
          id: "turn_active",
          status: "inProgress",
          error: null,
          items: [],
        },
      ];
      const readThread = vi.fn().mockResolvedValue(inProgressThread);

      setWorkspaceMessagesClient({
        interruptTurn,
        readThread,
      } as unknown as CodexAppServerClient);

      const store = useWorkspaceMessagesStore();
      store.selectedThreadId = "thread_existing";
      store.activeTurnId = "turn_active";

      await store.interruptActiveTurn();
      expect(interruptTurn).toHaveBeenCalledTimes(1);

      store.interruptRequestedAt = Date.now() - INTERRUPT_RETRY_INTERVAL_MS;
      await store.reconcileActiveTurnSnapshot();

      expect(interruptTurn).toHaveBeenCalledTimes(2);
      expect(store.interruptRetryCount).toBe(2);

      store.interruptRequestedAt =
        Date.now() - INTERRUPT_RETRY_INTERVAL_MS * INTERRUPT_MAX_RETRIES;
      store.interruptRetryCount = INTERRUPT_MAX_RETRIES;
      await store.reconcileActiveTurnSnapshot();

      expect(interruptTurn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves interrupting status while work items continue", () => {
    const store = useWorkspaceMessagesStore();
    store.interruptRequestedTurnId = "turn_active";
    store.setStatus("Interrupting...", "warning");

    store.handleNotification({
      method: "item/started",
      params: {
        threadId: "thread_existing",
        turnId: "turn_active",
        item: {
          type: "commandExecution",
          id: "cmd_1",
          command: "git status",
          cwd: "/repo",
          processId: null,
          source: "agent",
          status: "inProgress",
          commandActions: [],
          aggregatedOutput: null,
          exitCode: null,
          durationMs: null,
        },
      },
    });

    expect(store.statusMessage).toBe("Interrupting...");
    expect(store.statusTone).toBe("warning");
  });

  it("restores the submitted draft after an interrupted turn", () => {
    const store = useWorkspaceMessagesStore();
    store.pendingUserDraft = "please try again";
    store.activeTurnId = "turn_active";

    store.handleNotification({
      method: "turn/aborted",
      params: {
        threadId: "thread_existing",
        turnId: "turn_active",
        reason: "interrupted",
      },
    });

    expect(store.restoredDraft).toBe("please try again");
    expect(store.restoredDraftVersion).toBe(1);
    expect(store.activeTurnId).toBeNull();
    expect(store.statusMessage).toBe("Interrupted");
    expect(store.statusTone).toBe("warning");
    expect(store.interruptRequestedTurnId).toBeNull();
  });

  it("shows completion warning when interrupted turn completes first", () => {
    const store = useWorkspaceMessagesStore();
    store.activeTurnId = "turn_active";
    store.interruptRequestedTurnId = "turn_active";

    store.handleNotification({
      method: "turn/completed",
      params: {
        threadId: "thread_existing",
        turn: {
          id: "turn_active",
          status: "completed",
          error: null,
          items: [],
        },
      },
    });

    expect(store.activeTurnId).toBeNull();
    expect(store.statusMessage).toBe("Interrupt requested; turn completed");
    expect(store.statusTone).toBe("warning");
    expect(store.interruptRequestedTurnId).toBeNull();
  });

  it("tracks live status for started turns and work items", () => {
    const store = useWorkspaceMessagesStore();

    store.handleNotification({
      method: "turn/started",
      params: {
        threadId: "thread_existing",
        turn: {
          id: "turn_active",
          status: "inProgress",
          error: null,
          items: [],
        },
      },
    });

    expect(store.statusMessage).toBe("Working");

    store.handleNotification({
      method: "item/started",
      params: {
        threadId: "thread_existing",
        turnId: "turn_active",
        item: {
          type: "commandExecution",
          id: "cmd_1",
          command: "git status",
          cwd: "/repo",
          processId: null,
          source: "agent",
          status: "inProgress",
          commandActions: [],
          aggregatedOutput: null,
          exitCode: null,
          durationMs: null,
        },
      },
    });

    expect(store.statusMessage).toBe("Running git status");
  });

  it("polls active turn state so live updates recover without refresh", async () => {
    vi.useFakeTimers();
    try {
      const inProgressThread = makeThread("thread_existing");
      inProgressThread.turns = [
        {
          id: "turn_active",
          status: "inProgress",
          error: null,
          items: [],
        },
      ];
      const completedThread = makeThread("thread_existing");
      completedThread.turns = [
        {
          id: "turn_active",
          status: "completed",
          error: null,
          items: [],
        },
      ];

      const readThread = vi
        .fn()
        .mockResolvedValueOnce(inProgressThread)
        .mockResolvedValueOnce(completedThread);

      setWorkspaceMessagesClient({
        readThread,
      } as unknown as CodexAppServerClient);

      const store = useWorkspaceMessagesStore();
      store.selectedThreadId = "thread_existing";
      store.activeTurnId = "turn_active";

      store.refreshActiveTurnReconcileLoop();
      await vi.advanceTimersByTimeAsync(ACTIVE_TURN_RECONCILE_INTERVAL_MS + 20);
      expect(readThread).toHaveBeenCalledTimes(1);
      expect(store.activeTurnId).toBe("turn_active");

      await vi.advanceTimersByTimeAsync(ACTIVE_TURN_RECONCILE_INTERVAL_MS + 20);
      expect(readThread).toHaveBeenCalledTimes(2);
      expect(store.activeTurnId).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("discovers active turn from snapshot when notifications are missed", async () => {
    vi.useFakeTimers();
    try {
      const inProgressThread = makeThread("thread_existing");
      inProgressThread.turns = [
        {
          id: "turn_active",
          status: "inProgress",
          error: null,
          items: [],
        },
      ];

      const readThread = vi.fn().mockResolvedValue(inProgressThread);

      setWorkspaceMessagesClient({
        readThread,
      } as unknown as CodexAppServerClient);

      const store = useWorkspaceMessagesStore();
      store.selectedThreadId = "thread_existing";
      store.statusMessage = "Working";
      store.statusTone = "info";
      store.activeTurnId = null;

      store.refreshActiveTurnReconcileLoop();
      await vi.advanceTimersByTimeAsync(ACTIVE_TURN_RECONCILE_INTERVAL_MS + 20);

      expect(readThread).toHaveBeenCalledWith("thread_existing");
      expect(store.activeTurnId).toBe("turn_active");
    } finally {
      vi.useRealTimers();
    }
  });

  it("updates token usage by selected thread id even without selected thread object", () => {
    const store = useWorkspaceMessagesStore();
    store.selectedThreadId = "thread_existing";

    store.handleNotification({
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread_existing",
        turnId: "turn_active",
        tokenUsage: {
          total: {
            totalTokens: 123,
            inputTokens: 50,
            cachedInputTokens: 0,
            outputTokens: 73,
            reasoningOutputTokens: 10,
          },
          last: {
            totalTokens: 60,
            inputTokens: 20,
            cachedInputTokens: 0,
            outputTokens: 40,
            reasoningOutputTokens: 5,
          },
          modelContextWindow: 200000,
        },
      },
    });

    expect(store.selectedTokenUsage?.total.totalTokens).toBe(123);
    expect(store.tokenUsageByThreadId.thread_existing?.total.totalTokens).toBe(
      123,
    );
  });

  it("recovers live updates when a turn delta arrives without turn/started", () => {
    const store = useWorkspaceMessagesStore();
    store.selectedThread = makeThread("thread_existing") as Thread;

    store.handleNotification({
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread_existing",
        turnId: "turn_live",
        itemId: "item_assistant",
        delta: "hello",
      },
    });

    expect(store.activeTurnId).toBe("turn_live");
    expect(store.liveTranscriptTurn?.id).toBe("turn_live");
    expect(store.transcript.some((turn) => turn.id === "turn_live")).toBe(true);
  });

  it("applies live deltas when selected thread id is set but thread object is missing", () => {
    const store = useWorkspaceMessagesStore();
    store.selectedThread = null;
    store.selectedThreadId = "thread_existing";

    store.handleNotification({
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread_existing",
        turnId: "turn_live",
        itemId: "item_assistant",
        delta: "hello",
      },
    });

    expect(store.activeTurnId).toBe("turn_live");
    expect(store.liveTranscriptTurn?.id).toBe("turn_live");
    expect(store.liveTranscriptTurn?.items).toEqual([
      {
        id: "item_assistant",
        kind: "assistant",
        text: "hello",
        status: "streaming",
      },
    ]);
  });

  it("keeps live and committed transcript state separate", () => {
    const store = useWorkspaceMessagesStore();

    store.activeTurnId = "turn_live";
    store.liveTranscriptTurn = {
      id: "turn_live",
      status: "inProgress",
      error: null,
      events: [],
      items: [
        {
          id: "item_live",
          kind: "assistant",
          text: "streaming",
          status: "streaming",
        },
      ],
    };
    store.setTranscript([
      {
        id: "turn_live",
        status: "inProgress",
        error: null,
        items: [
          {
            id: "item_live",
            kind: "assistant",
            text: "streaming",
            status: "streaming",
          },
        ],
      },
      {
        id: "turn_done",
        status: "completed",
        error: null,
        items: [
          {
            id: "item_done",
            kind: "assistant",
            text: "done",
            status: "done",
          },
        ],
      },
    ]);

    expect(store.liveTranscriptTurn?.id).toBe("turn_live");
    expect(store.committedTranscript.map((turn) => turn.id)).toEqual([
      "turn_done",
    ]);
  });

  it("moves the live turn into committed history when it completes", () => {
    const store = useWorkspaceMessagesStore();
    store.selectedThread = makeThread("thread_existing") as Thread;
    store.activeTurnId = "turn_live";
    store.setTranscript([
      {
        id: "turn_live",
        status: "inProgress",
        error: null,
        items: [
          {
            id: "item_live",
            kind: "assistant",
            text: "streaming",
            status: "streaming",
          },
        ],
      },
    ]);

    store.handleNotification({
      method: "turn/completed",
      params: {
        threadId: "thread_existing",
        turn: {
          id: "turn_live",
          status: "completed",
          error: null,
          items: [],
        },
      },
    });

    expect(store.activeTurnId).toBeNull();
    expect(store.liveTranscriptTurn).toBeNull();
    expect(store.committedTranscript.map((turn) => turn.id)).toEqual([
      "turn_live",
    ]);
  });

  it("does not resurrect stale in-progress turns after completion", () => {
    const store = useWorkspaceMessagesStore();
    store.activeTurnId = null;

    store.setTranscript([
      {
        id: "turn_done",
        status: "completed",
        error: null,
        items: [
          {
            id: "item_done",
            kind: "assistant",
            text: "final answer",
            status: "done",
          },
        ],
      },
      {
        id: "turn_stale_live",
        status: "inProgress",
        error: null,
        items: [],
      },
    ]);

    expect(store.liveTranscriptTurn).toBeNull();
    expect(store.committedTranscript.map((turn) => turn.id)).toEqual([
      "turn_done",
      "turn_stale_live",
    ]);
  });
});

function makeAgentRow(id = "agent-1", name = "Scout") {
  return {
    id,
    name,
    color: "#22c55e",
    description: "Test agent",
    workspace: "/repo",
    hasThread: false,
    threadId: null,
    updatedAt: 0,
    preview: "No messages yet",
  };
}

function makeThread(id: string, name: string | null = null): Thread {
  return {
    id,
    preview: name || "",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 1,
    status: { type: "idle" as const },
    path: null,
    cwd: "/repo",
    cliVersion: "0.1.0",
    source: "appServer" as const,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name,
    turns: [],
  };
}

function makeModel(id: string): Model {
  return {
    id,
    model: id,
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName: id,
    description: id,
    hidden: false,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "medium" as const,
    inputModalities: ["text"] as ("text" | "image")[],
    supportsPersonality: true,
    isDefault: false,
  };
}

function makeSlashClient() {
  return {
    startTurn: vi.fn(),
    startThreadForAgent: vi.fn().mockResolvedValue(makeThread("thread_new")),
    cleanBackgroundTerminals: vi.fn().mockResolvedValue(undefined),
    startReview: vi.fn().mockResolvedValue({
      turn: {
        id: "turn_review",
        status: "completed" as const,
        error: null,
        items: [],
      },
      reviewThreadId: "thread_existing",
    }),
    setThreadName: vi.fn().mockResolvedValue(undefined),
    listThreads: vi
      .fn()
      .mockResolvedValue([makeThread("thread_existing", "Existing thread")]),
    resumeThread: vi
      .fn()
      .mockResolvedValue(makeThread("thread_existing", "Existing thread")),
    readConfig: vi.fn().mockResolvedValue({
      config: {
        model: "gpt-5-mini",
        model_provider: "openai",
        model_context_window: 200000,
        model_auto_compact_token_limit: 120000,
      },
    }),
    listModels: vi
      .fn()
      .mockResolvedValue([makeModel("gpt-5"), makeModel("gpt-5-mini")]),
    listExperimentalFeatures: vi.fn().mockResolvedValue([
      {
        name: "realtime",
        stage: "beta",
        enabled: false,
        displayName: "Realtime",
        description: "Realtime support",
      },
    ]),
    listSkills: vi.fn().mockResolvedValue([{ name: "cockpit" }]),
    forkThread: vi
      .fn()
      .mockResolvedValue(makeThread("thread_fork", "Forked thread")),
    compactThread: vi.fn().mockResolvedValue(undefined),
    runThreadShellCommand: vi.fn().mockResolvedValue(undefined),
    listMcpServers: vi
      .fn()
      .mockResolvedValue([{ name: "docs", authStatus: "bearerToken" }]),
    listApps: vi
      .fn()
      .mockResolvedValue([{ name: "calendar", isEnabled: true }]),
    listPlugins: vi
      .fn()
      .mockResolvedValue([{ name: "notes", installed: true, enabled: true }]),
    logout: vi.fn().mockResolvedValue(undefined),
    uploadFeedback: vi.fn().mockResolvedValue(undefined),
    updateAgent: vi.fn().mockResolvedValue(undefined),
    saveAgentWorkspaceFiles: vi.fn().mockResolvedValue(undefined),
    readAgent: vi.fn().mockResolvedValue({}),
    getAgentWorkspaceFiles: vi.fn().mockResolvedValue({ files: [] }),
  };
}
