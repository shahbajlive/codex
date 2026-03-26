import { describe, expect, it } from "vitest";
import {
  applyHistoryNotification,
  buildHistory,
  buildLiveHistoryTurn,
  splitHistoryView,
} from "./history";
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
          type: "systemMessage",
          id: "item_s",
          label: "Session status",
          detail: "Status updated.",
          tone: "info",
        },
      ],
    },
  ],
} satisfies Thread;

describe("history helpers", () => {
  it("builds semantic history from thread history", () => {
    expect(buildHistory(thread)).toEqual([
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          { id: "item_u", kind: "user", text: "hello" },
          { id: "item_a", kind: "assistant", text: "hi there", status: "done" },
          {
            id: "item_s",
            kind: "system",
            label: "Session status",
            detail: "Status updated.",
            tone: "info",
          },
        ],
      },
    ]);
  });

  it("splits out the active turn for view derivation", () => {
    const turns = buildHistory({
      ...thread,
      turns: [
        ...thread.turns,
        { ...thread.turns[0], id: "turn_2", status: "inProgress" },
      ],
    });

    const view = splitHistoryView(turns, "turn_2");
    expect(view.liveTurn?.id).toBe("turn_2");
    expect(view.committedTurns).toHaveLength(1);
  });

  it("applies streaming updates to semantic history", () => {
    const updated = applyHistoryNotification(buildHistory(thread), {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        itemId: "item_b",
        delta: "stream",
      },
    });

    expect(updated[0]?.items.at(-1)).toEqual({
      id: "item_b",
      kind: "assistant",
      text: "stream",
      status: "streaming",
    });
  });

  it("builds a live history turn from the active turn", () => {
    const liveTurn = buildLiveHistoryTurn(
      {
        ...thread,
        turns: [{ ...thread.turns[0], id: "turn_live", status: "inProgress" }],
      },
      null,
    );

    expect(liveTurn?.id).toBe("turn_live");
    expect(liveTurn?.items[0]).toEqual({
      id: "item_u",
      kind: "user",
      text: "hello",
    });
  });

  it("unwraps contact messages into semantic user history", () => {
    const history = buildHistory({
      ...thread,
      turns: [
        {
          ...thread.turns[0],
          items: [
            {
              type: "userMessage",
              id: "item_contact",
              content: [
                {
                  type: "text",
                  text: `<contact_message>\n{"senderAgentId":"planner","senderThreadId":"thr_sender","senderTurnId":"turn_sender","recipientAgentId":"reviewer","replyThreadId":"thr_reply","message":"please review this"}\n</contact_message>`,
                  text_elements: [],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(history[0]?.items[0]).toEqual({
      id: "item_contact",
      kind: "user",
      text: "please review this",
      source: "contact",
      contact: {
        senderAgentId: "planner",
        senderThreadId: "thr_sender",
        senderTurnId: "turn_sender",
        recipientAgentId: "reviewer",
        replyThreadId: "thr_reply",
      },
    });
  });
});
