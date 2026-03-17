import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AgentsPane from "./AgentsPane.vue";
import type { Thread } from "../lib/protocol";

const agents = [
  {
    id: "thr_agent",
    preview: "Audit the test failures",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 2,
    status: { type: "idle" },
    path: null,
    cwd: "/repo",
    cliVersion: "0.0.0",
    source: { subagent: { thread_spawn: { parent_thread_id: "thr_parent", depth: 1, agent_nickname: "Scout", agent_role: "explorer" } } },
    agentNickname: "Scout",
    agentRole: "explorer",
    gitInfo: null,
    name: "Scout",
    turns: [],
  },
] satisfies Thread[];

describe("AgentsPane", () => {
  it("renders agents and emits selection", async () => {
    const wrapper = mount(AgentsPane, {
      props: {
        loading: false,
        agents,
        selectedAgentId: null,
        selectedAgent: null,
        transcript: [],
      },
    });

    expect(wrapper.text()).toContain("Scout");
    await wrapper.find(".agent-row").trigger("click");
    expect(wrapper.emitted("select")).toEqual([["thr_agent"]]);
  });
});
