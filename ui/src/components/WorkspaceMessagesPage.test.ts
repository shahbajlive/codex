import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import WorkspaceMessagesPage from "./WorkspaceMessagesPage.vue";
import type { TranscriptTurn } from "../lib/transcript";
import type { WorkspaceAgentRow } from "../stores/chat/workspace-messages";
import type { Model, Thread } from "../lib/protocol";

const agents = [
  {
    id: "thr_agent",
    name: "Scout",
    description: "Audit the test failures",
    workspace: "/repo",
    hasThread: true,
    threadId: "thread_1",
    updatedAt: 2,
    preview: "Audit the test failures",
  },
] satisfies WorkspaceAgentRow[];

const transcript: TranscriptTurn[] = [
  {
    id: "turn_1",
    status: "in_progress",
    error: null,
    items: [
      {
        id: "item_1",
        kind: "assistant",
        text: "Working on it",
        status: "streaming",
      },
    ],
  },
];

const baseProps = {
  approvalPolicy: "on-request",
  autoCompactTokenLimit: 120000,
  connected: true,
  contextWindow: 200000,
  modelLabel: "gpt-5",
  models: [
    {
      id: "gpt-5",
      model: "gpt-5",
      upgrade: null,
      upgradeInfo: null,
      availabilityNux: null,
      displayName: "GPT-5",
      description: "Primary model",
      hidden: false,
      supportedReasoningEfforts: [],
      defaultReasoningEffort: "medium",
      inputModalities: ["text"],
      supportsPersonality: true,
      isDefault: true,
    },
    {
      id: "gpt-5-mini",
      model: "gpt-5-mini",
      upgrade: null,
      upgradeInfo: null,
      availabilityNux: null,
      displayName: "GPT-5 Mini",
      description: "Fast model",
      hidden: false,
      supportedReasoningEfforts: [],
      defaultReasoningEffort: "medium",
      inputModalities: ["text"],
      supportsPersonality: true,
      isDefault: false,
    },
  ] satisfies Model[],
  personality: "friendly",
  restoredDraft: null,
  restoredDraftVersion: 0,
  selectedModelProvider: "openai",
  statusMessage: null,
  statusTone: null,
  activeTurnId: "turn_1",
  committedTranscript: [] as TranscriptTurn[],
  liveTranscriptTurn:
    transcript[0] === undefined ? null : { ...transcript[0], events: [] },
  selectedTokenUsage: {
    total: {
      totalTokens: 42000,
      inputTokens: 20000,
      cachedInputTokens: 0,
      outputTokens: 22000,
      reasoningOutputTokens: 5000,
    },
    last: {
      totalTokens: 1200,
      inputTokens: 500,
      cachedInputTokens: 0,
      outputTokens: 700,
      reasoningOutputTokens: 200,
    },
    modelContextWindow: 200000,
  },
  sandboxMode: "workspace-write",
  theme: "system",
  threads: [
    {
      id: "thread_1",
      preview: "Audit the test failures",
      ephemeral: false,
      modelProvider: "openai",
      createdAt: 1,
      updatedAt: 2,
      status: { type: "idle" },
      path: null,
      cwd: "/repo",
      cliVersion: "0.1.0",
      source: "appServer",
      agentNickname: null,
      agentRole: null,
      gitInfo: null,
      name: "Existing thread",
      turns: [],
    },
  ] satisfies Thread[],
};

describe("WorkspaceMessagesPage", () => {
  it("renders agents and emits selection", async () => {
    const wrapper = mount(WorkspaceMessagesPage, {
      props: {
        ...baseProps,
        loading: false,
        agents,
        pendingRequest: null,
        selectedAgentId: null,
        selectedThreadId: null,
        committedTranscript: [],
        liveTranscriptTurn: null,
      },
    });

    expect(wrapper.text()).toContain("Messages");
    await wrapper.find(".workspace-msg-list__item").trigger("click");
    expect(wrapper.emitted("select")).toEqual([["thr_agent"]]);
  });

  it("shows a selected-agent empty state when no transcript is loaded yet", () => {
    const wrapper = mount(WorkspaceMessagesPage, {
      props: {
        ...baseProps,
        loading: false,
        agents,
        pendingRequest: null,
        selectedAgentId: "thr_agent",
        selectedThreadId: "thread_1",
        committedTranscript: [],
        liveTranscriptTurn: null,
        activeTurnId: null,
      },
    });

    expect(wrapper.text()).toContain(
      "No transcript loaded for this agent yet.",
    );
  });

  it("emits send from the workspace composer", async () => {
    const wrapper = mount(WorkspaceMessagesPage, {
      props: {
        ...baseProps,
        loading: false,
        agents,
        pendingRequest: null,
        selectedAgentId: "thr_agent",
        selectedThreadId: "thread_1",
      },
    });

    await wrapper.find("textarea").setValue("Follow up");
    await wrapper.find("form").trigger("submit");

    expect(wrapper.emitted("send")).toEqual([["Follow up"]]);
  });

  it("renders live status and emits interrupt", async () => {
    const wrapper = mount(WorkspaceMessagesPage, {
      props: {
        ...baseProps,
        loading: false,
        agents,
        pendingRequest: null,
        selectedAgentId: "thr_agent",
        selectedThreadId: "thread_1",
        transcript,
      },
    });

    expect(wrapper.find(".workspace-chat__status").exists()).toBe(false);
    expect(wrapper.text()).toContain("Live turn");
    await wrapper.find('[aria-label="Interrupt turn"]').trigger("click");
    expect(wrapper.emitted("interrupt")).toEqual([[]]);
  });

  it("renders the active turn separately from committed history", () => {
    const wrapper = mount(WorkspaceMessagesPage, {
      props: {
        ...baseProps,
        loading: false,
        agents,
        pendingRequest: null,
        selectedAgentId: "thr_agent",
        selectedThreadId: "thread_1",
        committedTranscript: [
          {
            id: "turn_done",
            status: "completed",
            error: null,
            items: [
              {
                id: "item_done",
                kind: "assistant",
                text: "Done already",
                status: "done",
              },
            ],
          },
        ],
        liveTranscriptTurn:
          transcript[0] === undefined ? null : { ...transcript[0], events: [] },
      },
    });

    expect(wrapper.text()).toContain("Live turn");
    expect(wrapper.text()).toContain("Drafting response");
    expect(wrapper.text()).toContain("Live");
    expect(wrapper.text()).toContain("Done already");
    expect(wrapper.findAll(".workspace-chat__live-turn .bubble")).toHaveLength(
      1,
    );
    expect(wrapper.findAll(".workspace-chat__body > .turn-stack")).toHaveLength(
      1,
    );
  });

  it("renders replayed interrupted and failed turns with terminal treatment", () => {
    const wrapper = mount(WorkspaceMessagesPage, {
      props: {
        ...baseProps,
        loading: false,
        agents,
        pendingRequest: null,
        selectedAgentId: "thr_agent",
        selectedThreadId: "thread_1",
        committedTranscript: [
          {
            id: "turn_interrupted",
            status: "interrupted",
            error: null,
            items: [
              {
                id: "turn_interrupted:terminal",
                kind: "event",
                label: "Conversation interrupted",
                detail: "Tell the model what to do differently.",
                tone: "error",
              },
            ],
          },
          {
            id: "turn_failed",
            status: "failed",
            error: "request failed",
            items: [
              {
                id: "turn_failed:terminal",
                kind: "event",
                label: "Error",
                detail: "request failed",
                tone: "error",
              },
            ],
          },
        ],
        liveTranscriptTurn: null,
        activeTurnId: null,
      },
    });

    expect(wrapper.text()).toContain("Interrupted turn");
    expect(wrapper.text()).toContain("Failed turn");
    expect(wrapper.findAll(".turn-stack--warning")).toHaveLength(1);
    expect(wrapper.findAll(".turn-stack--error")).toHaveLength(1);
  });

  it("renders live retry and progress event rows", () => {
    const wrapper = mount(WorkspaceMessagesPage, {
      props: {
        ...baseProps,
        loading: false,
        agents,
        pendingRequest: null,
        selectedAgentId: "thr_agent",
        selectedThreadId: "thread_1",
        liveTranscriptTurn: {
          ...(transcript[0] ?? {
            id: "turn_1",
            status: "inProgress",
            error: null,
            items: [],
          }),
          events: [
            {
              id: "cmd_1:progress",
              label: "In progress",
              detail: "Running git status",
              tone: "info",
            },
            {
              id: "turn_1:retry",
              label: "Retrying",
              detail: "stream disconnected before completion",
              tone: "warning",
            },
          ],
        },
      },
    });

    expect(wrapper.text()).toContain("In progress");
    expect(wrapper.text()).toContain("Running git status");
    expect(wrapper.text()).toContain("Retrying");
  });

  it("keeps the status banner for non-live status messages", () => {
    const wrapper = mount(WorkspaceMessagesPage, {
      props: {
        ...baseProps,
        loading: false,
        agents,
        pendingRequest: null,
        selectedAgentId: "thr_agent",
        selectedThreadId: "thread_1",
        liveTranscriptTurn: null,
        activeTurnId: null,
        statusMessage: "Disconnected from app-server",
        statusTone: "error",
      },
    });

    expect(wrapper.text()).toContain("Disconnected from app-server");
    expect(wrapper.find(".workspace-chat__status").exists()).toBe(true);
  });

  it("keeps a settling live turn briefly during terminal transition", async () => {
    vi.useFakeTimers();
    const wrapper = mount(WorkspaceMessagesPage, {
      props: {
        ...baseProps,
        loading: false,
        agents,
        pendingRequest: null,
        selectedAgentId: "thr_agent",
        selectedThreadId: "thread_1",
        committedTranscript: [
          {
            id: "turn_1",
            status: "completed",
            error: null,
            items: [
              {
                id: "item_done",
                kind: "assistant",
                text: "Done already",
                status: "done",
              },
            ],
          },
        ],
        liveTranscriptTurn:
          transcript[0] === undefined ? null : { ...transcript[0], events: [] },
      },
    });

    await wrapper.setProps({ liveTranscriptTurn: null, activeTurnId: null });

    expect(wrapper.find(".workspace-chat__live-turn--settling").exists()).toBe(
      true,
    );
    expect(wrapper.findAll(".workspace-chat__body > .turn-stack")).toHaveLength(
      0,
    );

    vi.advanceTimersByTime(500);
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".workspace-chat__live-turn--settling").exists()).toBe(
      false,
    );
    expect(wrapper.findAll(".workspace-chat__body > .turn-stack")).toHaveLength(
      1,
    );
    vi.useRealTimers();
  });

  it("shows interruption-specific settling treatment", async () => {
    vi.useFakeTimers();
    const wrapper = mount(WorkspaceMessagesPage, {
      props: {
        ...baseProps,
        loading: false,
        agents,
        pendingRequest: null,
        selectedAgentId: "thr_agent",
        selectedThreadId: "thread_1",
        liveTranscriptTurn: {
          id: "turn_1",
          status: "interrupted",
          error: null,
          events: [],
          items: [
            {
              id: "item_live",
              kind: "assistant",
              text: "Stopped",
              status: "done",
            },
          ],
        },
      },
    });

    await wrapper.setProps({ liveTranscriptTurn: null, activeTurnId: null });

    expect(wrapper.text()).toContain("Interrupted turn");
    expect(
      wrapper.find(".workspace-chat__live-turn--settling-warning").exists(),
    ).toBe(true);
    vi.useRealTimers();
  });

  it("shows failure-specific settling treatment", async () => {
    vi.useFakeTimers();
    const wrapper = mount(WorkspaceMessagesPage, {
      props: {
        ...baseProps,
        loading: false,
        agents,
        pendingRequest: null,
        selectedAgentId: "thr_agent",
        selectedThreadId: "thread_1",
        liveTranscriptTurn: {
          id: "turn_1",
          status: "failed",
          error: "request failed",
          events: [],
          items: [
            {
              id: "item_live",
              kind: "event",
              label: "Error",
              detail: "request failed",
              tone: "error",
            },
          ],
        },
      },
    });

    await wrapper.setProps({ liveTranscriptTurn: null, activeTurnId: null });

    expect(wrapper.text()).toContain("Failed turn");
    expect(
      wrapper.find(".workspace-chat__live-turn--settling-error").exists(),
    ).toBe(true);
    vi.useRealTimers();
  });

  it("restores the composer draft when provided", async () => {
    const wrapper = mount(WorkspaceMessagesPage, {
      props: {
        ...baseProps,
        loading: false,
        agents,
        pendingRequest: null,
        selectedAgentId: "thr_agent",
        selectedThreadId: "thread_1",
        transcript,
      },
    });

    await wrapper.setProps({
      restoredDraft: "tell the model what to do differently",
      restoredDraftVersion: 1,
    });

    expect(wrapper.find("textarea").element.value).toBe(
      "tell the model what to do differently",
    );
  });

  it("renders pending approvals and resolves them", async () => {
    const wrapper = mount(WorkspaceMessagesPage, {
      props: {
        ...baseProps,
        loading: false,
        agents,
        pendingRequest: {
          kind: "command",
          title: "Command approval required",
          threadId: "thr_agent",
          turnId: "turn_1",
          itemId: "item_1",
          reason: "Needs shell access",
          command: "git status",
          cwd: "/repo",
          choices: [{ label: "Allow once", value: "accept" }],
        },
        selectedAgentId: "thr_agent",
        selectedThreadId: "thread_1",
        transcript,
      },
    });

    expect(wrapper.text()).toContain("Command approval required");
    await wrapper.find(".workspace-request .btn").trigger("click");
    expect(wrapper.emitted("resolveRequest")).toEqual([["accept"]]);
  });

  it("collects prompt answers and submits them", async () => {
    const wrapper = mount(WorkspaceMessagesPage, {
      props: {
        ...baseProps,
        loading: false,
        agents,
        pendingRequest: {
          kind: "prompt",
          title: "User input requested",
          threadId: "thr_agent",
          turnId: "turn_1",
          itemId: "item_1",
          questions: [
            {
              id: "q1",
              header: "Environment",
              question: "Which environment should I use?",
              isOther: true,
              isSecret: false,
              options: [{ label: "staging", description: "Use staging" }],
            },
          ],
        },
        selectedAgentId: "thr_agent",
        selectedThreadId: "thread_1",
        transcript,
      },
    });

    await wrapper.find(".workspace-request__choices .btn").trigger("click");
    await wrapper.find(".workspace-request--prompt").trigger("submit");

    expect(wrapper.emitted("resolveRequest")).toEqual([
      [{ answers: { q1: { answers: ["staging"] } } }],
    ]);
  });

  it("submits MCP elicitation form values", async () => {
    const wrapper = mount(WorkspaceMessagesPage, {
      props: {
        ...baseProps,
        loading: false,
        agents,
        pendingRequest: {
          kind: "mcp-form",
          title: "MCP form from docs",
          threadId: "thr_agent",
          turnId: "turn_1",
          serverName: "docs",
          message: "Need a value",
          fields: [
            {
              key: "answer",
              label: "Answer",
              description: null,
              type: "text",
              required: true,
              defaultValue: null,
            },
          ],
        },
        selectedAgentId: "thr_agent",
        selectedThreadId: "thread_1",
        transcript,
      },
    });

    await wrapper.find(".workspace-request__input").setValue("42");
    await wrapper.find(".workspace-request--prompt").trigger("submit");

    expect(wrapper.emitted("resolveRequest")).toEqual([
      [{ action: "accept", content: { answer: "42" }, _meta: null }],
    ]);
  });

  it("submits dynamic tool responses", async () => {
    const wrapper = mount(WorkspaceMessagesPage, {
      props: {
        ...baseProps,
        loading: false,
        agents,
        pendingRequest: {
          kind: "dynamic-tool",
          title: "Dynamic tool call: notes",
          threadId: "thr_agent",
          turnId: "turn_1",
          callId: "call_1",
          tool: "notes",
          argumentsJson: '{"q":"hi"}',
        },
        selectedAgentId: "thr_agent",
        selectedThreadId: "thread_1",
        transcript,
      },
    });

    await wrapper.find(".workspace-request__input").setValue("tool output");
    await wrapper.find(".workspace-request--prompt").trigger("submit");

    expect(wrapper.emitted("resolveRequest")).toEqual([
      [
        {
          contentItems: [{ type: "inputText", text: "tool output" }],
          success: true,
        },
      ],
    ]);
  });

  it("shows model/context metadata and slash commands", async () => {
    const wrapper = mount(WorkspaceMessagesPage, {
      props: {
        ...baseProps,
        loading: false,
        agents,
        pendingRequest: null,
        selectedAgentId: "thr_agent",
        selectedThreadId: "thread_1",
        transcript,
      },
    });

    expect(wrapper.text()).toContain("Model gpt-5");
    expect(wrapper.text()).toContain("Provider openai");
    expect(wrapper.text()).toContain("Tokens 42k");
    expect(wrapper.text()).toContain("Last 1k");
    expect(wrapper.text()).toContain("Window 200k");

    await wrapper.find("textarea").setValue("/");
    expect(wrapper.text()).toContain("/new");
    expect(wrapper.text()).toContain("/clear");
    expect(wrapper.text()).toContain("/status");

    await wrapper.find(".workspace-chat__composer-icon").trigger("click");
    expect(
      (wrapper.find("textarea").element as HTMLTextAreaElement).value,
    ).toBe("/");
  });

  it("supports keyboard navigation in the slash command menu", async () => {
    const wrapper = mount(WorkspaceMessagesPage, {
      props: {
        ...baseProps,
        loading: false,
        agents,
        pendingRequest: null,
        selectedAgentId: "thr_agent",
        selectedThreadId: "thread_1",
        transcript,
      },
    });

    const textarea = wrapper.find("textarea");
    await textarea.setValue("/");
    await textarea.trigger("keydown", { key: "ArrowDown" });
    await textarea.trigger("keydown", { key: "Enter" });

    expect((textarea.element as HTMLTextAreaElement).value).toBe("/fast");
  });

  it("shows contextual slash panels for rich commands", async () => {
    const wrapper = mount(WorkspaceMessagesPage, {
      props: {
        ...baseProps,
        loading: false,
        agents,
        pendingRequest: null,
        selectedAgentId: "thr_agent",
        selectedThreadId: "thread_1",
        transcript,
      },
    });

    const textarea = wrapper.find("textarea");
    await textarea.setValue("/model");
    expect(wrapper.text()).toContain("Choose model");
    expect(wrapper.text()).toContain("GPT-5 Mini");

    await textarea.trigger("keydown", { key: "ArrowDown" });
    await textarea.trigger("keydown", { key: "Enter" });
    expect((textarea.element as HTMLTextAreaElement).value).toBe(
      "/model gpt-5-mini",
    );

    await textarea.setValue("/settings");
    expect(wrapper.text()).toContain("Quick settings");
    expect(wrapper.text()).toContain("Theme dark");

    await textarea.trigger("keydown", { key: "Escape" });
    expect((textarea.element as HTMLTextAreaElement).value).toBe("");
  });
});
