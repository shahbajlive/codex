import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import WorkspaceTranscriptView from "./WorkspaceTranscriptView.vue";
import type { TranscriptTurn } from "../../lib/transcript";

const transcript: TranscriptTurn[] = [
  {
    id: "turn_1",
    status: "completed",
    error: null,
    items: [
      {
        id: "item_1",
        kind: "system",
        label: "Session status",
        detail: "Your operational mode has changed from plan to build.",
        tone: "info",
      },
    ],
  },
];

describe("WorkspaceTranscriptView", () => {
  it("renders system messages as bubbles", () => {
    const wrapper = mount(WorkspaceTranscriptView, {
      props: {
        selectedAgentId: "agent-1",
        selectedAgentName: "Developer Lead",
        selectedAgentColor: null,
        selectedThreadId: "turn_1",
        committedTranscript: transcript,
        liveTranscriptTurn: null,
        activeTurnId: null,
        pendingUserDraft: null,
        collapseOverrides: {},
        statusMessage: null,
        statusTone: null,
      },
    });

    expect(wrapper.html()).toContain("workspace-chat__bubble--system");
    expect(wrapper.text()).toContain(
      "Your operational mode has changed from plan to build.",
    );
  });
});
