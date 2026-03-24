import { describe, expect, it } from "vitest";
import {
  applyLiveNotification,
  applyNotification,
  buildLiveTranscriptTurn,
  buildTranscript,
  liveTranscriptItemStatus,
  liveTranscriptItemTitle,
  liveTurnStatusLabel,
  renderTranscriptItem,
  splitTranscriptView,
  transcriptTurnStatusLabel,
  transcriptTurnTone,
} from "./transcript";
import type { Thread } from "./protocol";

const thread = {
  id: "thr_1",
  preview: "hello",
  ephemeral: false,
  modelProvider: "openai",
  createdAt: 1,
  updatedAt: 2,
  status: { type: "idle" },
  path: null,
  cwd: "/repo",
  cliVersion: "0.0.0",
  source: "cli",
  agentNickname: null,
  agentRole: null,
  gitInfo: null,
  name: "Greeting",
  turns: [
    {
      id: "turn_1",
      status: "completed",
      error: null,
      items: [
        {
          type: "userMessage",
          id: "item_u",
          content: [{ type: "text", text: "hello", text_elements: [] }],
        },
        {
          type: "agentMessage",
          id: "item_a",
          text: "hi there",
          phase: null,
          memoryCitation: null,
        },
        {
          type: "reasoning",
          id: "item_r",
          summary: ["Inspecting repository"],
          content: ["Looking at the failing tests"],
        },
        {
          type: "commandExecution",
          id: "item_c",
          command: "cargo test",
          cwd: "/repo",
          processId: null,
          source: "agent",
          status: "completed",
          commandActions: [],
          aggregatedOutput: "ok",
          exitCode: 0,
          durationMs: 100,
        },
      ],
    },
  ],
} satisfies Thread;

describe("transcript helpers", () => {
  it("builds a transcript from thread history", () => {
    const transcript = buildTranscript(thread);
    expect(transcript).toHaveLength(1);
    expect(transcript[0]?.items).toEqual([
      { id: "item_u", kind: "user", text: "hello" },
      { id: "item_a", kind: "assistant", text: "hi there", status: "done" },
      {
        id: "item_r",
        kind: "reasoning",
        summary: ["Inspecting repository"],
        content: ["Looking at the failing tests"],
        status: "done",
      },
      {
        id: "item_c",
        kind: "command",
        command: "cargo test",
        cwd: "/repo",
        output: "ok",
        exitCode: 0,
        terminalInputs: [],
        status: "done",
      },
    ]);
  });

  it("appends streaming assistant and command deltas", () => {
    const initial = buildTranscript(thread);
    const withAssistant = applyNotification(initial, {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        itemId: "item_b",
        delta: "stream",
      },
    });
    const withCommand = applyNotification(withAssistant, {
      method: "item/commandExecution/outputDelta",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        itemId: "item_c",
        delta: "\nmore",
      },
    });

    expect(withCommand[0]?.items.at(-1)).toEqual({
      id: "item_b",
      kind: "assistant",
      text: "stream",
      status: "streaming",
    });
    expect(renderTranscriptItem(withCommand[0]!.items[3]!)).toContain("more");
  });

  it("renders tool arguments for dynamic tool calls", () => {
    const transcript = buildTranscript({
      ...thread,
      turns: [
        {
          id: "turn_tool_args",
          status: "completed",
          error: null,
          items: [
            {
              type: "dynamicToolCall",
              id: "item_contacts",
              tool: "contacts",
              arguments: {
                mode: "send",
                target_id: "backend_engineer",
                message: "hello",
              },
              status: "completed",
              contentItems: [
                {
                  type: "inputText",
                  text: "delivered",
                },
              ],
              success: true,
              durationMs: 10,
            },
          ],
        },
      ],
    });

    const rendered = renderTranscriptItem(transcript[0]!.items[0]!);
    expect(rendered).toContain("Input:");
    expect(rendered).toContain('"mode": "send"');
    expect(rendered).toContain('"target_id": "backend_engineer"');
    expect(rendered).toContain("delivered");
  });

  it("renders tool arguments for mcp tool calls", () => {
    const transcript = buildTranscript({
      ...thread,
      turns: [
        {
          id: "turn_mcp_args",
          status: "completed",
          error: null,
          items: [
            {
              type: "mcpToolCall",
              id: "item_mcp",
              server: "browser",
              tool: "navigate",
              status: "completed",
              arguments: {
                intent: "agent-chat",
                name: "Developer Lead",
              },
              result: {
                content: [
                  {
                    type: "text",
                    text: "ok",
                  },
                ],
                structuredContent: null,
              },
              error: null,
              durationMs: 20,
            },
          ],
        },
      ],
    });

    const rendered = renderTranscriptItem(transcript[0]!.items[0]!);
    expect(rendered).toContain("Input:");
    expect(rendered).toContain('"intent": "agent-chat"');
    expect(rendered).toContain('"name": "Developer Lead"');
    expect(rendered).toContain("ok");
  });

  it("renders shell-like dynamic tool calls as command items", () => {
    const transcript = buildTranscript({
      ...thread,
      turns: [
        {
          id: "turn_shell_tool",
          status: "completed",
          error: null,
          items: [
            {
              type: "dynamicToolCall",
              id: "item_exec",
              tool: "exec_command",
              arguments: {
                cmd: "pwd",
                workdir: "/repo",
              },
              status: "completed",
              contentItems: [
                {
                  type: "inputText",
                  text: "Process exited with code 0\n/repo",
                },
              ],
              success: true,
              durationMs: 8,
            },
          ],
        },
      ],
    });

    expect(transcript[0]?.items[0]).toEqual({
      id: "item_exec",
      kind: "command",
      command: "pwd",
      cwd: "/repo",
      output: "/repo",
      exitCode: 0,
      terminalInputs: [],
      status: "done",
    });
  });

  it("renders generic dynamic tool labels as shell when payload is command-shaped", () => {
    const transcript = buildTranscript({
      ...thread,
      turns: [
        {
          id: "turn_shell_tool_generic",
          status: "completed",
          error: null,
          items: [
            {
              type: "dynamicToolCall",
              id: "item_exec_generic",
              tool: "tool",
              arguments: {
                cmd: "cat /tmp/file",
              },
              status: "completed",
              contentItems: [
                {
                  type: "inputText",
                  text: "Command: /bin/zsh -lc 'cat /tmp/file'\nProcess exited with code 0\nOutput:\nok",
                },
              ],
              success: true,
              durationMs: 8,
            },
          ],
        },
      ],
    });

    expect(transcript[0]?.items[0]).toMatchObject({
      id: "item_exec_generic",
      kind: "command",
      command: "cat /tmp/file",
      output: "ok",
      exitCode: 0,
      status: "done",
    });
  });

  it("extracts command and output from shell wrapper text", () => {
    const transcript = buildTranscript({
      ...thread,
      turns: [
        {
          id: "turn_shell_wrapped",
          status: "completed",
          error: null,
          items: [
            {
              type: "dynamicToolCall",
              id: "item_shell_wrapped",
              tool: "tool",
              arguments: {},
              status: "completed",
              contentItems: [
                {
                  type: "inputText",
                  text: "Command: /bin/zsh -lc 'cat /tmp/file'\nChunk ID: cac6b9\n<system-reminder>internal</system-reminder>\nProcess exited with code 0\nOutput:\nok",
                },
              ],
              success: true,
              durationMs: 8,
            },
          ],
        },
      ],
    });

    expect(transcript[0]?.items[0]).toEqual({
      id: "item_shell_wrapped",
      kind: "command",
      command: "/bin/zsh -lc 'cat /tmp/file'",
      cwd: "",
      output: "ok",
      exitCode: 0,
      terminalInputs: [],
      status: "done",
    });
  });

  it("keeps non-command generic tool calls as tool rows", () => {
    const transcript = buildTranscript({
      ...thread,
      turns: [
        {
          id: "turn_structured_tool",
          status: "completed",
          error: null,
          items: [
            {
              type: "dynamicToolCall",
              id: "item_structured_tool",
              tool: "tool",
              arguments: {
                path: "/tmp/file",
              },
              status: "completed",
              contentItems: [
                {
                  type: "inputText",
                  text: "No command information available",
                },
              ],
              success: true,
              durationMs: 8,
            },
          ],
        },
      ],
    });

    expect(transcript[0]?.items[0]).toEqual({
      id: "item_structured_tool",
      kind: "tool",
      label: "tool",
      category: "structured",
      input: '{\n  "path": "/tmp/file"\n}',
      output: "No command information available",
      error: null,
      status: "done",
    });
  });

  it("builds reasoning streams across summary and raw content deltas", () => {
    const initial = buildTranscript(null);
    const withSummary = applyNotification(initial, {
      method: "item/reasoning/summaryTextDelta",
      params: {
        threadId: "thr_1",
        turnId: "turn_2",
        itemId: "item_reasoning",
        summaryIndex: 0,
        delta: "Thinking",
      },
    });
    const withContent = applyNotification(withSummary, {
      method: "item/reasoning/textDelta",
      params: {
        threadId: "thr_1",
        turnId: "turn_2",
        itemId: "item_reasoning",
        contentIndex: 0,
        delta: "Checking files",
      },
    });

    expect(withContent[0]?.items[0]).toEqual({
      id: "item_reasoning",
      kind: "reasoning",
      summary: ["Thinking"],
      content: ["Checking files"],
      status: "streaming",
    });
  });

  it("keeps retryable stream errors out of transcript history", () => {
    const initial = buildTranscript(thread);
    const updated = applyNotification(initial, {
      method: "error",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        willRetry: true,
        error: {
          message: "stream disconnected before completion",
          codexErrorInfo: null,
          additionalDetails: null,
        },
      },
    });

    expect(updated).toEqual(initial);
  });

  it("appends interrupted turn parity messaging", () => {
    const initial = buildTranscript(null);
    const updated = applyNotification(initial, {
      method: "turn/aborted",
      params: {
        threadId: "thr_1",
        turnId: "turn_2",
        reason: "interrupted",
      },
    });

    expect(updated[0]).toMatchObject({
      id: "turn_2",
      status: "interrupted",
      items: [
        {
          id: "turn_2:terminal",
          kind: "event",
          label: "Conversation interrupted",
        },
      ],
    });
  });

  it("adds a terminal error event for failed replayed turns", () => {
    const failedTranscript = buildTranscript({
      ...thread,
      turns: [
        {
          id: "turn_failed",
          status: "failed",
          error: {
            message: "request failed",
            codexErrorInfo: null,
            additionalDetails: null,
          },
          items: [],
        },
      ],
    });

    expect(failedTranscript[0]?.items).toEqual([
      {
        id: "turn_failed:terminal",
        kind: "event",
        label: "Error",
        detail: "request failed",
        tone: "error",
      },
    ]);
  });

  it("splits committed and live turns into separate view state", () => {
    const view = splitTranscriptView(
      [
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
          items: [],
        },
      ],
      "turn_live",
    );

    expect(view.liveTurn?.id).toBe("turn_live");
    expect(view.committedTurns.map((turn) => turn.id)).toEqual(["turn_done"]);
  });

  it("does not infer a live turn without an active turn id", () => {
    const view = splitTranscriptView(
      [
        {
          id: "turn_stale_live",
          status: "inProgress",
          error: null,
          items: [],
        },
        {
          id: "turn_done",
          status: "completed",
          error: null,
          items: [
            {
              id: "item_done",
              kind: "assistant",
              text: "completed answer",
              status: "done",
            },
          ],
        },
      ],
      null,
    );

    expect(view.liveTurn).toBeNull();
    expect(view.committedTurns.map((turn) => turn.id)).toEqual([
      "turn_stale_live",
      "turn_done",
    ]);
  });

  it("builds a dedicated live turn from an in-progress thread turn", () => {
    const liveTurn = buildLiveTranscriptTurn(
      {
        ...thread,
        turns: [
          {
            id: "turn_live",
            status: "inProgress",
            error: null,
            items: [
              {
                type: "agentMessage",
                id: "item_live",
                text: "streaming",
                phase: null,
                memoryCitation: null,
              },
            ],
          },
        ],
      },
      "turn_live",
    );

    expect(liveTurn).toMatchObject({
      id: "turn_live",
      status: "inProgress",
      items: [{ id: "item_live", kind: "assistant", status: "streaming" }],
    });
  });

  it("clears live turn state when the active turn completes", () => {
    const liveTurn = applyLiveNotification(
      {
        id: "turn_live",
        status: "inProgress",
        error: null,
        events: [],
        items: [],
      },
      {
        method: "turn/completed",
        params: {
          threadId: "thr_1",
          turn: {
            id: "turn_live",
            status: "completed",
            error: null,
            items: [],
          },
        },
      },
    );

    expect(liveTurn).toBeNull();
  });

  it("uses live-only labels for streaming items", () => {
    const liveTurn = buildLiveTranscriptTurn(
      {
        ...thread,
        turns: [
          {
            id: "turn_live",
            status: "inProgress",
            error: null,
            items: [
              {
                type: "agentMessage",
                id: "item_live",
                text: "streaming",
                phase: null,
                memoryCitation: null,
              },
            ],
          },
        ],
      },
      "turn_live",
    );

    expect(liveTurn).not.toBeNull();
    expect(liveTranscriptItemTitle(liveTurn!.items[0]!)).toBe(
      "Drafting response",
    );
    expect(liveTranscriptItemStatus(liveTurn!.items[0]!)).toBe("Live");
    expect(liveTurnStatusLabel(liveTurn!)).toBe("Live");
  });

  it("adds live retry and progress events without touching committed transcript", () => {
    let liveTurn = applyLiveNotification(
      {
        id: "turn_live",
        status: "inProgress",
        error: null,
        events: [],
        items: [],
      },
      {
        method: "item/started",
        params: {
          threadId: "thr_1",
          turnId: "turn_live",
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
      },
    );

    expect(liveTurn?.events[0]).toMatchObject({
      label: "In progress",
      detail: "Running git status",
      tone: "info",
    });

    liveTurn = applyLiveNotification(liveTurn, {
      method: "error",
      params: {
        threadId: "thr_1",
        turnId: "turn_live",
        willRetry: true,
        error: {
          message: "stream disconnected before completion",
          codexErrorInfo: null,
          additionalDetails: null,
        },
      },
    });

    expect(liveTurn?.events.at(-1)).toMatchObject({
      label: "Retrying",
      tone: "warning",
    });
  });

  it("preserves live events when streaming item updates arrive", () => {
    let liveTurn = applyLiveNotification(
      {
        id: "turn_live",
        status: "inProgress",
        error: null,
        events: [
          {
            id: "cmd_1:progress",
            label: "In progress",
            detail: "Running git status",
            tone: "info",
          },
        ],
        items: [],
      },
      {
        method: "item/agentMessage/delta",
        params: {
          threadId: "thr_1",
          turnId: "turn_live",
          itemId: "item_assistant",
          delta: "hello",
        },
      },
    );

    expect(liveTurn?.events).toEqual([
      {
        id: "cmd_1:progress",
        label: "In progress",
        detail: "Running git status",
        tone: "info",
      },
    ]);

    liveTurn = applyLiveNotification(liveTurn, {
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_live",
        item: {
          type: "commandExecution",
          id: "cmd_1",
          command: "git status",
          cwd: "/repo",
          processId: null,
          source: "agent",
          status: "completed",
          commandActions: [],
          aggregatedOutput: "ok",
          exitCode: 0,
          durationMs: 10,
        },
      },
    });

    expect(liveTurn?.events).toEqual([]);
  });

  it("creates placeholder tool items when output deltas arrive first", () => {
    const initial = buildTranscript(null);
    const withCommand = applyNotification(initial, {
      method: "item/commandExecution/outputDelta",
      params: {
        threadId: "thr_1",
        turnId: "turn_live",
        itemId: "cmd_orphan",
        delta: "streamed output",
      },
    });
    const withFileChange = applyNotification(withCommand, {
      method: "item/fileChange/outputDelta",
      params: {
        threadId: "thr_1",
        turnId: "turn_live",
        itemId: "patch_orphan",
        delta: "patch output",
      },
    });

    expect(withFileChange[0]?.items).toEqual([
      {
        id: "cmd_orphan",
        kind: "command",
        command: "command",
        cwd: "",
        output: "streamed output",
        exitCode: null,
        terminalInputs: [],
        status: "streaming",
      },
      {
        id: "patch_orphan",
        kind: "file-change",
        changes: [],
        output: "patch output",
        status: "streaming",
      },
    ]);
  });

  it("formats replayed interrupted and failed turn status labels", () => {
    expect(
      transcriptTurnStatusLabel({
        id: "turn_interrupted",
        status: "interrupted",
        error: null,
        items: [],
      }),
    ).toBe("Interrupted turn");
    expect(
      transcriptTurnTone({
        id: "turn_interrupted",
        status: "interrupted",
        error: null,
        items: [],
      }),
    ).toBe("warning");

    expect(
      transcriptTurnStatusLabel({
        id: "turn_failed",
        status: "failed",
        error: "request failed",
        items: [],
      }),
    ).toBe("Failed turn");
    expect(
      transcriptTurnTone({
        id: "turn_failed",
        status: "failed",
        error: "request failed",
        items: [],
      }),
    ).toBe("error");
  });
});
