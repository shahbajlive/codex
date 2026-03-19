import { defineStore } from "pinia";
import {
  CodexAppServerClient,
  type ThreadRuntimeSettings,
} from "../lib/app-server-client";
import { AppServerWsTransport } from "../lib/app-server-ws-transport";
import type {
  CodexNotification,
  InitializeResponse,
  Model,
  Thread,
  AgentInfo,
  AgentReadResponse,
} from "../lib/protocol";
import {
  applyNotification,
  attachTurn,
  buildTranscript,
  latestActivity,
} from "../lib/transcript";
import { useSettingsStore } from "./settings";

let client: CodexAppServerClient | null = null;
let unsubscribeNotifications: (() => void) | null = null;
let unsubscribeStatus: (() => void) | null = null;

export const useCodexStore = defineStore("codex", {
  state: () => ({
    threads: [] as Thread[],
    selectedThreadId: null as string | null,
    selectedThread: null as Thread | null,
    transcript: buildTranscript(null),
    agentThreads: [] as Thread[],
    configuredAgents: [] as AgentInfo[],
    selectedAgentId: null as string | null,
    selectedAgentConfig: null as AgentReadResponse | null,
    selectedAgentWorkspaceFiles: [] as { filename: string; content: string }[],
    selectedAgent: null as Thread | null,
    agentTranscript: buildTranscript(null),
    models: [] as Model[],
    busy: false,
    connectionStatus: "idle",
    errorMessage: "",
    initializeResponse: null as InitializeResponse | null,
    resumedThreadId: null as string | null,
  }),
  getters: {
    isConnected: (state) => state.connectionStatus === "connected",
    selectedThreadName: (state) =>
      state.selectedThread?.name ||
      state.selectedThread?.preview ||
      "New conversation",
    currentActivity: (state) => latestActivity(state.transcript),
    platformSummary: (state) => {
      if (!state.initializeResponse) {
        return "No app-server session yet.";
      }
      return `${state.initializeResponse.platformFamily} · ${state.initializeResponse.platformOs} · ${state.initializeResponse.userAgent}`;
    },
  },
  actions: {
    async connect() {
      this.disconnect();
      this.errorMessage = "";

      const settings = useSettingsStore();
      const transport = new AppServerWsTransport(settings.url);
      client = new CodexAppServerClient(transport);
      unsubscribeStatus = client.onStatusChange((status) => {
        this.connectionStatus = status;
      });
      unsubscribeNotifications = client.onNotification((notification) =>
        this.handleNotification(notification),
      );

      try {
        await client.connect();
        this.initializeResponse = await client.initialize();
        this.models = await client.listModels();
        await this.refreshThreads();
        await this.refreshAgentThreads();
        await this.refreshConfiguredAgents();
      } catch (error) {
        this.errorMessage =
          error instanceof Error ? error.message : String(error);
      }
    },

    disconnect() {
      unsubscribeNotifications?.();
      unsubscribeNotifications = null;
      unsubscribeStatus?.();
      unsubscribeStatus = null;
      client?.disconnect();
      client = null;
      this.connectionStatus = "disconnected";
      this.initializeResponse = null;
      this.resumedThreadId = null;
    },

    async refreshThreads() {
      if (!client) {
        return;
      }
      this.threads = await client.listThreads();
      if (!this.selectedThreadId && this.threads.length > 0) {
        await this.selectThread(this.threads[0]!.id);
      }
    },

    async refreshAgentThreads() {
      if (!client) {
        return;
      }
      this.agentThreads = await client.listAgentThreads();
      if (!this.selectedAgentId && this.agentThreads.length > 0) {
        await this.selectAgent(this.agentThreads[0]!.id);
      }
    },

    async refreshConfiguredAgents() {
      if (!client) {
        return;
      }
      const settingsStore = useSettingsStore();
      const cwd = settingsStore.cwd || undefined;
      this.configuredAgents = await client.listAgents(cwd);
    },

    async createThread() {
      if (!client) {
        return;
      }

      try {
        this.busy = true;
        const thread = await client.startThread(this.runtimeSettings());
        this.resumedThreadId = thread.id;
        this.selectedThreadId = thread.id;
        this.selectedThread = thread;
        this.transcript = buildTranscript(thread);
        await this.refreshThreads();
      } catch (error) {
        this.errorMessage =
          error instanceof Error ? error.message : String(error);
      } finally {
        this.busy = false;
      }
    },

    async selectThread(threadId: string) {
      if (!client) {
        return;
      }

      try {
        this.busy = true;
        this.selectedThreadId = threadId;
        this.selectedThread = await client.readThread(threadId);
        this.transcript = buildTranscript(this.selectedThread);
      } catch (error) {
        this.errorMessage =
          error instanceof Error ? error.message : String(error);
      } finally {
        this.busy = false;
      }
    },

    async selectAgent(threadId: string) {
      if (!client) {
        return;
      }

      try {
        this.busy = true;
        this.selectedAgentId = threadId;
        this.selectedAgent = await client.readThread(threadId);
        this.agentTranscript = buildTranscript(this.selectedAgent);
      } catch (error) {
        this.errorMessage =
          error instanceof Error ? error.message : String(error);
      } finally {
        this.busy = false;
      }
    },

    async selectConfiguredAgent(agentId: string) {
      this.selectedAgentId = agentId;
      this.selectedAgentWorkspaceFiles = [];
      if (client && agentId) {
        try {
          const settingsStore = useSettingsStore();
          const cwd = settingsStore.cwd || undefined;
          const agentConfig = await client.readAgent(agentId, cwd);
          this.selectedAgentConfig = agentConfig;
          // Fetch workspace files
          const workspaceFiles = await client.getAgentWorkspaceFiles(
            agentId,
            cwd,
          );
          this.selectedAgentWorkspaceFiles = workspaceFiles.files;
        } catch (e) {
          console.error("Failed to fetch agent config:", e);
          this.selectedAgentConfig = null;
        }
      }
    },

    async updateAgent(
      id: string,
      model: string | null,
      developerInstructions: string | null,
      nicknameCandidates: string[] | null,
    ) {
      const settingsStore = useSettingsStore();
      const agentDir = settingsStore.cwd || undefined;
      console.log("Store updateAgent called:", {
        id,
        model,
        developerInstructions: developerInstructions?.slice(0, 50),
        nicknameCandidates,
        agentDir,
      });
      if (!client) {
        console.error("Client not connected!");
        return { success: false, message: "Not connected" };
      }

      try {
        const result = await client.updateAgent({
          id,
          agentDir,
          model,
          developerInstructions,
          nicknameCandidates,
        });
        console.log("Client updateAgent result:", result);
        if (result.success) {
          await this.refreshConfiguredAgents();
          await this.selectConfiguredAgent(id);
        }
        return result;
      } catch (e) {
        console.error("Failed to update agent:", e);
        return { success: false, message: String(e) };
      }
    },

    async sendMessage(message: string) {
      if (!client) {
        return;
      }

      try {
        this.busy = true;
        if (!this.selectedThread) {
          const thread = await client.startThread(this.runtimeSettings());
          this.selectedThread = thread;
          this.selectedThreadId = thread.id;
          this.resumedThreadId = thread.id;
        }

        if (
          this.selectedThread &&
          this.resumedThreadId !== this.selectedThread.id
        ) {
          this.selectedThread = await client.resumeThread(
            this.selectedThread.id,
            this.runtimeSettings(),
          );
          this.resumedThreadId = this.selectedThread.id;
          this.transcript = buildTranscript(this.selectedThread);
        }

        if (!this.selectedThread) {
          return;
        }

        const turn = await client.startTurn(
          this.selectedThread.id,
          message,
          this.runtimeSettings(),
        );
        this.selectedThread = attachTurn(this.selectedThread, turn);
        this.transcript = buildTranscript(this.selectedThread);
        await this.refreshThreads();
      } catch (error) {
        this.errorMessage =
          error instanceof Error ? error.message : String(error);
        this.busy = false;
      }
    },

    handleNotification(notification: CodexNotification) {
      if (
        this.selectedThread &&
        (!("threadId" in notification.params) ||
          notification.params.threadId === this.selectedThread.id)
      ) {
        this.transcript = applyNotification(this.transcript, notification);
      }

      if (
        this.selectedAgent &&
        (!("threadId" in notification.params) ||
          notification.params.threadId === this.selectedAgent.id)
      ) {
        this.agentTranscript = applyNotification(
          this.agentTranscript,
          notification,
        );
      }

      if (notification.method === "turn/completed") {
        this.busy = false;
      }
    },

    async openAgentConversation(threadId: string) {
      await this.selectThread(threadId);
    },

    runtimeSettings(): ThreadRuntimeSettings {
      const settings = useSettingsStore();
      return {
        cwd: settings.cwd,
        model: settings.model || null,
        personality: settings.personality,
        approvalPolicy: settings.approvalPolicy,
        sandboxMode: settings.sandboxMode,
      };
    },
  },
});
