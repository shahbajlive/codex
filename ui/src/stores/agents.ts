import { defineStore } from "pinia";
import { toRaw } from "vue";
import type { AgentInfo, SkillMetadata } from "../lib/protocol";
import type { CodexAppServerClient } from "../lib/app-server-client";
import { useSettingsStore } from "./settings";

let clientRef: { client: CodexAppServerClient | null } = { client: null };

export function setAgentsClient(client: CodexAppServerClient | null) {
  clientRef.client = client;
}

type AgentConfig = {
  name: string;
  model: string;
  workspace: string;
  configFile: string;
  tools: { allowed: string[]; denied: string[] };
  skills: string[];
  files: { filename: string; content: string }[];
};

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(toRaw(obj)));
}

export const useAgentsStore = defineStore("agents", {
  state: () => ({
    agents: [] as AgentInfo[],
    selectedAgentId: null as string | null,
    config: null as AgentConfig | null,
    originalConfig: null as AgentConfig | null,
    activeFile: "",
    skillCatalog: [] as SkillMetadata[],
    skillsLoading: false,
    activeTab: "overview" as
      | "overview"
      | "files"
      | "tools"
      | "skills"
      | "channels"
      | "cron",
  }),

  getters: {
    selectedAgent: (state) =>
      state.agents.find((a) => a.id === state.selectedAgentId) || null,
    dirty: (state) => {
      if (!state.config || !state.originalConfig) return false;

      const c = state.config;
      const o = state.originalConfig;

      if (c.name !== o.name) return true;
      if (c.model !== o.model) return true;
      if (JSON.stringify(c.tools) !== JSON.stringify(o.tools)) return true;
      if (JSON.stringify(c.skills) !== JSON.stringify(o.skills)) return true;
      if (JSON.stringify(c.files) !== JSON.stringify(o.files)) return true;

      return false;
    },
    enabledToolCount: (state) => {
      if (!state.config) return 0;
      if (state.config.tools.allowed.length > 0) {
        return state.config.tools.allowed.length;
      }
      return 20 - state.config.tools.denied.length;
    },
  },

  actions: {
    async refreshAgents() {
      if (!clientRef?.client) return;
      const settingsStore = useSettingsStore();
      const cwd = settingsStore.cwd || undefined;
      this.agents = await clientRef.client.listAgents(cwd);
    },

    async selectAgent(agentId: string) {
      this.selectedAgentId = agentId;
      if (!clientRef?.client || !agentId) return;

      this.config = {
        name: "",
        model: "",
        workspace: "",
        configFile: "",
        tools: { allowed: [], denied: [] },
        skills: [],
        files: [],
      };
      this.originalConfig = null;

      this.skillsLoading = true;
      try {
        const settingsStore = useSettingsStore();
        const cwd = settingsStore.cwd || undefined;

        const [agentConfig, workspaceFiles] = await Promise.all([
          clientRef.client.readAgent(agentId, cwd),
          clientRef.client.getAgentWorkspaceFiles(agentId, cwd),
        ]);

        const config: AgentConfig = {
          name: agentConfig.name || "",
          model: agentConfig.model || "",
          workspace: agentConfig.workspace || "",
          configFile: agentConfig.configFile || "inline",
          tools: {
            allowed: agentConfig.tools?.allow || [],
            denied: agentConfig.tools?.deny || [],
          },
          skills: agentConfig.skills || [],
          files: workspaceFiles.files,
        };

        this.config = deepClone(config);
        this.originalConfig = deepClone(config);
        this.activeFile = workspaceFiles.files[0]?.filename || "";
      } catch (e) {
        console.error("Failed to fetch agent config:", e);
        this.config = null;
        this.originalConfig = null;
      } finally {
        this.skillsLoading = false;
      }
    },

    async loadSkillCatalog() {
      if (!clientRef?.client) return;
      try {
        const settingsStore = useSettingsStore();
        const cwd = settingsStore.cwd || undefined;
        this.skillCatalog = await clientRef.client.listSkills(cwd);
      } catch (e) {
        console.error("Failed to load skill catalog:", e);
        this.skillCatalog = [];
      }
    },

    discard() {
      if (this.originalConfig) {
        this.config = deepClone(this.originalConfig);
      }
    },

    async save() {
      if (!clientRef?.client || !this.selectedAgentId || !this.config) return;

      const settingsStore = useSettingsStore();
      const cwd = settingsStore.cwd || undefined;

      const originalConfig = this.originalConfig;
      const currentConfig = this.config;

      const configDirty =
        originalConfig &&
        (currentConfig.name !== originalConfig.name ||
          currentConfig.model !== originalConfig.model ||
          JSON.stringify(currentConfig.tools) !==
            JSON.stringify(originalConfig.tools) ||
          JSON.stringify(currentConfig.skills) !==
            JSON.stringify(originalConfig.skills));

      const filesDirty =
        originalConfig &&
        JSON.stringify(currentConfig.files) !==
          JSON.stringify(originalConfig.files);

      if (filesDirty) {
        await clientRef.client.saveAgentWorkspaceFiles(
          this.selectedAgentId,
          this.config.files,
          cwd,
        );
      }

      if (configDirty) {
        await clientRef.client.updateAgent({
          id: this.selectedAgentId,
          agentDir: cwd,
          name: this.config.name || null,
          description: null,
          model: this.config.model || null,
          developerInstructions: null,
          nicknameCandidates: null,
          tools: {
            allow:
              this.config.tools.allowed.length > 0
                ? this.config.tools.allowed
                : null,
            deny:
              this.config.tools.denied.length > 0
                ? this.config.tools.denied
                : null,
          },
          skills: this.config.skills.length > 0 ? this.config.skills : null,
        });
      }

      this.originalConfig = deepClone(this.config);
    },

    setActiveFile(filename: string) {
      this.activeFile = filename;
    },

    updateFileContent(filename: string, content: string) {
      if (!this.config) return;
      const idx = this.config.files.findIndex((f) => f.filename === filename);
      if (idx >= 0) {
        this.config.files[idx]!.content = content;
      }
    },

    toggleTool(toolId: string) {
      if (!this.config) return;
      const idx = this.config.tools.denied.indexOf(toolId);
      if (idx >= 0) {
        this.config.tools.denied.splice(idx, 1);
      } else {
        this.config.tools.denied.push(toolId);
      }
    },

    isToolEnabled(toolId: string): boolean {
      if (!this.config) return false;
      if (this.config.tools.allowed.length > 0) {
        return this.config.tools.allowed.includes(toolId);
      }
      return !this.config.tools.denied.includes(toolId);
    },

    toggleSkill(skillName: string) {
      if (!this.config) return;
      const idx = this.config.skills.indexOf(skillName);
      if (idx >= 0) {
        this.config.skills.splice(idx, 1);
      } else {
        this.config.skills.push(skillName);
      }
    },

    isSkillEnabled(skillName: string): boolean {
      if (!this.config) return false;
      return this.config.skills.includes(skillName);
    },
  },

  persist: true,
});
