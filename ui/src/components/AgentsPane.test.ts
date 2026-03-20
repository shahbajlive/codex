import { mount, type VueWrapper } from "@vue/test-utils";
import { describe, expect, it, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import AgentsPane from "./AgentsPane.vue";
import type { Thread, AgentReadResponse } from "../lib/protocol";

const mockAgents = [
  {
    id: "thr_agent",
    preview: "Audit the test failures",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 2,
    status: { type: "idle" as const },
    path: null,
    cwd: "/repo",
    cliVersion: "0.0.0",
    source: {
      subagent: {
        thread_spawn: {
          parent_thread_id: "thr_parent",
          depth: 1,
          agent_nickname: "Scout",
          agent_role: "explorer",
        },
      },
    },
    agentNickname: "Scout",
    agentRole: "explorer",
    gitInfo: null,
    name: "Scout",
    turns: [],
  },
] satisfies Thread[];

describe("AgentsPane", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    setActivePinia(createPinia());
    wrapper = mount(AgentsPane, {
      props: {
        loading: false,
        agents: mockAgents,
        selectedAgentId: null,
        selectedAgentConfig: null,
        workspaceFiles: [],
        models: [],
      },
    });
  });

  it("renders agents and emits selection", async () => {
    expect(wrapper.text()).toContain("Scout");
    await wrapper.find(".agent-row").trigger("click");
    expect(wrapper.emitted("select")).toEqual([["thr_agent"]]);
  });

  it("shows agent header when agent is selected", async () => {
    await wrapper.find(".agent-row").trigger("click");
    expect(wrapper.text()).toContain("Scout");
    expect(wrapper.find(".agent-header")).toBeTruthy();
  });
});
