import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { describe, expect, it } from "vitest";
import WorkspaceQueuedMessagesDrawer from "./WorkspaceQueuedMessagesDrawer.vue";

const queuedMessages = [
  {
    id: "queued-1",
    threadId: "thread-1",
    text: "Please revise the last answer and keep going.",
    createdAt: 1,
  },
  {
    id: "queued-2",
    threadId: "thread-1",
    text: "Also check the failing test snapshot.",
    createdAt: 2,
  },
];

describe("WorkspaceQueuedMessagesDrawer", () => {
  it("renders queued messages and actions", () => {
    const wrapper = mount(WorkspaceQueuedMessagesDrawer, {
      global: {
        plugins: [createPinia()],
      },
      props: {
        queuedMessages,
        expanded: true,
      },
    });

    expect(wrapper.text()).toContain("Queued messages");
    expect(wrapper.text()).toContain("Please revise the last answer");
    expect(wrapper.text()).toContain("Also check the failing test snapshot.");
    expect(wrapper.findAll(".workspace-chat__queue-item")).toHaveLength(2);
  });

  it("emits edit and delete events", async () => {
    const wrapper = mount(WorkspaceQueuedMessagesDrawer, {
      global: {
        plugins: [createPinia()],
      },
      props: {
        queuedMessages,
        expanded: true,
      },
    });

    await wrapper
      .findAll(".workspace-chat__queue-item-action")
      .at(0)
      ?.trigger("click");
    await wrapper
      .findAll(".workspace-chat__queue-item-action")
      .at(1)
      ?.trigger("click");

    expect(wrapper.emitted("editQueuedMessage")?.[0]).toEqual(["queued-1"]);
    expect(wrapper.emitted("deleteQueuedMessage")?.[0]).toEqual(["queued-1"]);
  });
});
