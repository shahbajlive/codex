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
} from "../lib/protocol";
import {
  applyNotification,
  attachTurn,
  buildTranscript,
  latestActivity,
} from "../lib/transcript";
import { useSettingsStore } from "./settings";
import { useAgentsStore } from "./agents";
import { setAgentsClient } from "./agents";

let client: CodexAppServerClient | null = null;
let unsubscribeNotifications: (() => void) | null = null;
let unsubscribeStatus: (() => void) | null = null;

export const useCodexStore = defineStore("codex", {
  state: () => ({
    threads: [] as Thread[],
    selectedThreadId: null as string | null,
    selectedThread: null as Thread | null,
    transcript: buildTranscript(null),
    models: [] as Model[],
    busy: false,
    connectionStatus: "idle" as
      | "idle"
      | "connecting"
      | "connected"
      | "disconnected",
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
      setAgentsClient(client);

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
      setAgentsClient(null);
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

    async refreshConfiguredAgents() {
      const agentsStore = useAgentsStore();
      await agentsStore.refreshAgents();
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

      if (notification.method === "turn/completed") {
        this.busy = false;
      }
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
