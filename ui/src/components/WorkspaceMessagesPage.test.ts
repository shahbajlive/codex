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
    color: "#22c55e",
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
  modelProviders: ["openai", "lmstudio"],
  restoredDraft: null,
  restoredDraftVersion: 0,
  selectedModelProvider: "openai",
  collapseOverrides: {},
  selectedAgentThreadIds: ["thread_1"],
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

    expect(wrapper.text()).toContain("No messages in this thread yet.");
  });

  it("emits selectThread when thread dropdown changes", async () => {
    const wrapper = mount(WorkspaceMessagesPage, {
      props: {
        ...baseProps,
        loading: false,
        agents,
        pendingRequest: null,
        selectedAgentId: "thr_agent",
        selectedThreadId: "thread_1",
        threads: [
          ...baseProps.threads,
          {
            ...baseProps.threads[0],
            id: "thread_2",
            name: "Older thread",
            preview: "Past transcript",
            updatedAt: 1,
          },
        ],
        selectedAgentThreadIds: ["thread_1", "thread_2"],
      },
    });

    await wrapper.find(".workspace-msg-thread__select").setValue("thread_2");
    expect(wrapper.emitted("selectThread")).toEqual([["thread_2"]]);
  });

  it("sorts thread dropdown from latest to oldest", () => {
    const wrapper = mount(WorkspaceMessagesPage, {
      props: {
        ...baseProps,
        loading: false,
        agents,
        pendingRequest: null,
        selectedAgentId: "thr_agent",
        selectedThreadId: "thread_2",
        threads: [
          {
            ...baseProps.threads[0],
            id: "thread_1",
            updatedAt: 1,
            name: "Older",
          },
          {
            ...baseProps.threads[0],
            id: "thread_2",
            updatedAt: 3,
            name: "Newest",
          },
          {
            ...baseProps.threads[0],
            id: "thread_3",
            updatedAt: 2,
            name: "Middle",
          },
        ],
        selectedAgentThreadIds: ["thread_1", "thread_2", "thread_3"],
      },
    });

    const optionValues = wrapper
      .findAll(".workspace-msg-thread__select option")
      .map((option) => (option.element as HTMLOptionElement).value)
      .filter(Boolean);

    expect(optionValues).toEqual(["thread_2", "thread_3", "thread_1"]);
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

    expect(wrapper.find(".workspace-chat__chip").exists()).toBe(true);
    expect(wrapper.text()).toContain("Working");
    await wrapper.find('[aria-label="Interrupt turn"]').trigger("click");
    expect(wrapper.emitted("interrupt")).toEqual([[]]);
  });

  it("renders the active turn inline with committed history", () => {
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

    expect(wrapper.text()).toContain("Turn turn_1");
    expect(wrapper.text()).toContain("Drafting response");
    expect(wrapper.text()).toContain("Live");
    expect(wrapper.text()).toContain("Done already");
    expect(
      wrapper.findAll(".turn-stack--live .workspace-msg-item"),
    ).toHaveLength(1);
    expect(wrapper.findAll(".workspace-chat__body > .turn-stack")).toHaveLength(
      2,
    );
  });

  it("shows compact recent tool output for streaming command items", () => {
    const wrapper = mount(WorkspaceMessagesPage, {
      props: {
        ...baseProps,
        loading: false,
        agents,
        pendingRequest: null,
        selectedAgentId: "thr_agent",
        selectedThreadId: "thread_1",
        committedTranscript: [],
        liveTranscriptTurn: {
          id: "turn_live_tools",
          status: "inProgress",
          error: null,
          events: [],
          items: [
            {
              id: "cmd_1",
              kind: "command",
              command: "npm test",
              cwd: "/repo",
              output: "line 1\nline 2\nline 3",
              exitCode: null,
              terminalInputs: [],
              status: "streaming",
            },
          ],
        },
      },
    });

    expect(wrapper.find(".workspace-chat__tool-strip").exists()).toBe(true);
    expect(wrapper.text()).toContain("npm test");
    expect(wrapper.text()).toContain("line 2");
    expect(wrapper.text()).toContain("line 3");
  });

  it("shows waiting indicator when a tool is streaming without output", () => {
    const wrapper = mount(WorkspaceMessagesPage, {
      props: {
        ...baseProps,
        loading: false,
        agents,
        pendingRequest: null,
        selectedAgentId: "thr_agent",
        selectedThreadId: "thread_1",
        committedTranscript: [],
        liveTranscriptTurn: {
          id: "turn_waiting_tools",
          status: "inProgress",
          error: null,
          events: [],
          items: [
            {
              id: "cmd_1",
              kind: "command",
              command: "npm run lint",
              cwd: "/repo",
              output: "",
              exitCode: null,
              terminalInputs: [],
              status: "streaming",
            },
          ],
        },
      },
    });

    expect(wrapper.text()).toContain("Waiting for tool output...");
    expect(wrapper.find(".workspace-chat__tool-strip").exists()).toBe(false);
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

  it("auto-collapses completed tool-like and reasoning items", () => {
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
            id: "turn_dense",
            status: "completed",
            error: null,
            items: [
              {
                id: "item_reasoning",
                kind: "reasoning",
                summary: ["alpha", "beta", "gamma", "delta"],
                content: [],
                status: "done",
              },
            ],
          },
        ],
        liveTranscriptTurn: null,
        activeTurnId: null,
      },
    });

    expect(wrapper.text()).toContain("Expand");
    expect(wrapper.find(".workspace-msg-item__preview").exists()).toBe(true);
  });

  it("supports collapse-all and expand-all actions", async () => {
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
            id: "turn_dense",
            status: "completed",
            error: null,
            items: [
              {
                id: "item_cmd",
                kind: "command",
                command: "npm test",
                cwd: "/repo",
                output: "a\nb\nc\nd\ne",
                exitCode: 0,
                terminalInputs: [],
                status: "done",
              },
            ],
          },
        ],
        liveTranscriptTurn: null,
        activeTurnId: null,
      },
    });

    const buttons = wrapper.findAll(".workspace-chat__view-actions .btn");
    await buttons[1]!.trigger("click");
    expect(wrapper.text()).toContain("Collapse");

    await buttons[0]!.trigger("click");
    expect(wrapper.text()).toContain("Expand");
  });

  it("auto-scrolls transcript to the latest message", async () => {
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
                id: "item_1",
                kind: "assistant",
                text: "First message",
                status: "done",
              },
            ],
          },
        ],
        liveTranscriptTurn: null,
      },
    });

    const transcriptBody = wrapper.find(".workspace-chat__body")
      .element as HTMLElement;
    let measuredScrollHeight = 420;
    Object.defineProperty(transcriptBody, "scrollHeight", {
      configurable: true,
      get: () => measuredScrollHeight,
    });
    transcriptBody.scrollTop = 0;

    await wrapper.setProps({
      committedTranscript: [
        {
          id: "turn_1",
          status: "completed",
          error: null,
          items: [
            {
              id: "item_1",
              kind: "assistant",
              text: "First message",
              status: "done",
            },
          ],
        },
        {
          id: "turn_2",
          status: "completed",
          error: null,
          items: [
            {
              id: "item_2",
              kind: "assistant",
              text: "Newest message",
              status: "done",
            },
          ],
        },
      ],
    });

    measuredScrollHeight = 880;
    await wrapper.vm.$nextTick();

    expect(transcriptBody.scrollTop).toBe(880);
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
    expect(wrapper.find(".workspace-chat__chip--error").exists()).toBe(true);
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

    expect(wrapper.text()).toContain("Settling turn");
    expect(wrapper.findAll(".workspace-chat__body > .turn-stack")).toHaveLength(
      1,
    );

    vi.advanceTimersByTime(500);
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).not.toContain("Settling turn");
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
    expect(wrapper.find(".workspace-chat__chip--warning").exists()).toBe(true);
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
    expect(wrapper.find(".workspace-chat__chip--error").exists()).toBe(true);
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

  it("shows model/context metadata and opens command control with slash", async () => {
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

    expect(wrapper.text()).toContain("gpt-5 - 42k/200k");
    expect(wrapper.text()).toContain("Auto-compact 120k");

    const textarea = wrapper.find("textarea");
    await textarea.trigger("keydown", { key: "/" });
    expect(wrapper.find(".workspace-command-control").exists()).toBe(true);
    expect(wrapper.text()).toContain("/new");
    expect(wrapper.text()).toContain("/clear");
    expect(wrapper.text()).toContain("/status");

    await wrapper.find(".workspace-chat__composer-icon").trigger("click");
    expect(
      (wrapper.find("textarea").element as HTMLTextAreaElement).value,
    ).toBe("/mention ");
  });

  it("supports keyboard navigation in the command control", async () => {
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
    await textarea.trigger("keydown", { key: "/" });

    const control = wrapper.find(".workspace-command-control__search");
    await control.trigger("keydown", { key: "ArrowDown" });
    await control.trigger("keydown", { key: "Enter" });

    expect(wrapper.emitted("send")).toEqual([["/fast"]]);
  });

  it("runs exact slash commands from command control with Enter", async () => {
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

    await wrapper.find("textarea").trigger("keydown", { key: "/" });
    const control = wrapper.find(".workspace-command-control__search");
    await control.setValue("/status");
    await control.trigger("keydown", { key: "Enter" });

    expect(wrapper.emitted("send")).toEqual([["/status"]]);
  });

  it("shows contextual command panels for rich commands", async () => {
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

    await wrapper.find("textarea").trigger("keydown", { key: "/" });
    const control = wrapper.find(".workspace-command-control__search");

    await control.setValue("/model");
    expect(wrapper.text()).toContain("Choose provider");
    expect(wrapper.text()).toContain("openai");

    await control.trigger("keydown", { key: "Enter" });
    expect((control.element as HTMLInputElement).value).toBe("/model openai");

    await control.setValue("/model openai");
    expect(wrapper.text()).toContain("Choose model");
    expect(wrapper.text()).toContain("GPT-5 Mini");

    await control.trigger("keydown", { key: "ArrowDown" });
    await control.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("send")?.at(-1)).toEqual(["/model gpt-5-mini"]);

    await wrapper.find("textarea").trigger("keydown", { key: "/" });
    const controlAgain = wrapper.find(".workspace-command-control__search");
    await controlAgain.setValue("/settings");
    expect(wrapper.text()).toContain("Quick settings");
    expect(wrapper.text()).toContain("Theme dark");

    await controlAgain.trigger("keydown", { key: "Escape" });
    expect(wrapper.find(".workspace-command-control").exists()).toBe(false);
  });
});
