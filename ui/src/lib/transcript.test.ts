import { describe, expect, it } from "vitest";
import { applyNotification, buildTranscript } from "./transcript";
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
    ]);
  });

  it("appends streaming assistant deltas", () => {
    const initial = buildTranscript(thread);
    const next = applyNotification(initial, {
      method: "item/agentMessage/delta",
      params: { threadId: "thr_1", turnId: "turn_1", itemId: "item_b", delta: "stream" },
    });
    expect(next[0]?.items.at(-1)).toEqual({
      id: "item_b",
      kind: "assistant",
      text: "stream",
      status: "streaming",
    });
  });
});
