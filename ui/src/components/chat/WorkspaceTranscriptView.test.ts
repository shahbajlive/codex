import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkspaceTranscriptView from "./WorkspaceTranscriptView.vue";
import type { TranscriptTurn } from "../../lib/transcript";

const completedTranscript: TranscriptTurn[] = [
  {
    id: "turn_1",
    status: "completed",
    error: null,
    items: [
      {
        id: "item_u",
        kind: "user",
        text: "/status",
      },
      {
        id: "item_1",
        kind: "system",
        label: "Session status",
        detail: "Your operational mode has changed from plan to build.",
        tone: "info",
      },
      {
        id: "item_a",
        kind: "assistant",
        text: "ready",
        status: "done",
      },
    ],
  },
];

const liveTranscriptTurn = {
  id: "turn_live",
  status: "inProgress",
  error: null,
  items: [
    {
      id: "item_u",
      kind: "user",
      text: "/status",
    },
  ],
};

const scrollTo = vi.fn();

beforeEach(() => {
  setActivePinia(createPinia());
  scrollTo.mockClear();
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: scrollTo,
  });
});

describe("WorkspaceTranscriptView", () => {
  it("renders items in transcript order", () => {
    const wrapper = mount(WorkspaceTranscriptView, {
      global: {
        plugins: [createPinia()],
      },
      props: {
        selectedAgentId: "agent-1",
        selectedAgentName: "Developer Lead",
        selectedAgentColor: null,
        selectedThreadId: "turn_1",
        committedTranscript: completedTranscript,
        liveTranscriptTurn: null,
        activeTurnId: null,
        pendingUserDraft: null,
        collapseOverrides: {},
        statusMessage: null,
        statusTone: null,
      },
    });

    expect(wrapper.html()).toContain("workspace-chat__bubble--system");
    expect(wrapper.html()).toContain("workspace-msg-list__avatar--system");
    expect(wrapper.html().indexOf("/status")).toBeLessThan(
      wrapper.html().indexOf("Your operational mode has changed"),
    );
    expect(wrapper.text()).toContain(
      "Your operational mode has changed from plan to build.",
    );
  });

  it("shows a jump-to-latest button when scrolled up", async () => {
    const wrapper = mount(WorkspaceTranscriptView, {
      global: {
        plugins: [createPinia()],
      },
      props: {
        selectedAgentId: "agent-1",
        selectedAgentName: "Developer Lead",
        selectedAgentColor: null,
        selectedThreadId: "turn_1",
        committedTranscript: completedTranscript,
        liveTranscriptTurn: null,
        activeTurnId: null,
        pendingUserDraft: null,
        collapseOverrides: {},
        statusMessage: null,
        statusTone: null,
      },
    });

    const body = wrapper.find(".workspace-chat__body").element as HTMLElement;
    Object.defineProperties(body, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1000 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });

    body.dispatchEvent(new Event("scroll"));
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".workspace-chat__jump-latest").exists()).toBe(true);

    await wrapper.find(".workspace-chat__jump-latest").trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "auto" });
  });

  it("shows a double tick while the live turn is running", () => {
    const wrapper = mount(WorkspaceTranscriptView, {
      global: {
        plugins: [createPinia()],
      },
      props: {
        selectedAgentId: "agent-1",
        selectedAgentName: "Developer Lead",
        selectedAgentColor: null,
        selectedThreadId: "turn_live",
        committedTranscript: completedTranscript,
        liveTranscriptTurn,
        activeTurnId: "turn_live",
        pendingUserDraft: null,
        collapseOverrides: {},
        statusMessage: null,
        statusTone: null,
      },
    });

    expect(
      wrapper.find(".workspace-chat__bubble-status--running").exists(),
    ).toBe(true);
    expect(
      wrapper
        .find(
          ".workspace-chat__bubble-status--running .workspace-chat__bubble-status-icon--double.is-active",
        )
        .exists(),
    ).toBe(true);
  });

  it("shows a completed double tick after the turn finishes", () => {
    const wrapper = mount(WorkspaceTranscriptView, {
      global: {
        plugins: [createPinia()],
      },
      props: {
        selectedAgentId: "agent-1",
        selectedAgentName: "Developer Lead",
        selectedAgentColor: null,
        selectedThreadId: "turn_1",
        committedTranscript: completedTranscript,
        liveTranscriptTurn: null,
        activeTurnId: null,
        pendingUserDraft: null,
        collapseOverrides: {},
        statusMessage: null,
        statusTone: null,
      },
    });

    expect(
      wrapper.find(".workspace-chat__bubble-status--completed").exists(),
    ).toBe(true);
    expect(
      wrapper
        .find(
          ".workspace-chat__bubble-status--completed .workspace-chat__bubble-status-icon--double.is-active",
        )
        .exists(),
    ).toBe(true);
  });
});
