import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ThreadSidebar from "./ThreadSidebar.vue";
import type { Thread } from "../lib/protocol";

const threads = [
  {
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
    turns: [],
  },
] satisfies Thread[];

describe("ThreadSidebar", () => {
  it("renders threads and emits selection", async () => {
    const wrapper = mount(ThreadSidebar, {
      props: {
        threads,
        selectedThreadId: null,
        connected: true,
      },
    });

    expect(wrapper.text()).toContain("Greeting");
    await wrapper.find(".thread-row").trigger("click");
    expect(wrapper.emitted("select")).toEqual([["thr_1"]]);
  });
});
