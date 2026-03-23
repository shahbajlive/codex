import { mount, type VueWrapper } from "@vue/test-utils";
import { describe, expect, it, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import AgentsPane from "./AgentsPane.vue";
import { useAgentsStore } from "../stores/agents";
import type { AgentInfo } from "../lib/protocol";

const mockAgents = [
  {
    id: "agent-1",
    name: "Scout",
    description: "Test agent",
    configFile: null,
    nicknameCandidates: null,
    workspace: null,
    extends: null,
    color: null,
    hasWorkspace: false,
  },
] satisfies AgentInfo[];

describe("AgentsPane", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    setActivePinia(createPinia());
    const agentsStore = useAgentsStore();
    agentsStore.agents = mockAgents;
    wrapper = mount(AgentsPane, {
      props: {
        models: [],
      },
    });
  });

  it("renders agents and emits selection", async () => {
    expect(wrapper.text()).toContain("Scout");
    await wrapper.find(".agent-row").trigger("click");
    expect(wrapper.emitted("select")).toEqual([["agent-1"]]);
  });

  it("shows agent header when agent is selected", async () => {
    await wrapper.find(".agent-row").trigger("click");
    expect(wrapper.text()).toContain("Scout");
    expect(wrapper.find(".agent-header")).toBeTruthy();
  });
});
