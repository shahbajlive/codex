import { defineStore } from "pinia";
import {
  CodexAppServerClient,
  type ThreadRuntimeSettings,
} from "../lib/app-server-client";
import { AppServerWsTransport } from "../lib/app-server-ws-transport";
import type {
  CodexNotification,
  Config,
  ConfigProviderInfo,
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
import { setContactsClient } from "./contacts";

let client: CodexAppServerClient | null = null;
let unsubscribeNotifications: (() => void) | null = null;
let unsubscribeStatus: (() => void) | null = null;

function mergeProviders(
  ...providerSets: Array<Record<string, ConfigProviderInfo>>
): Record<string, ConfigProviderInfo> {
  const merged: Record<string, ConfigProviderInfo> = {};
  for (const providerSet of providerSets) {
    Object.assign(merged, providerSet);
  }
  return merged;
}

function providersFromConfig(
  config: Config | null,
): Record<string, ConfigProviderInfo> {
  const configuredProviders = config?.model_providers;
  if (!configuredProviders || typeof configuredProviders !== "object") {
    return {};
  }

  const providers: Record<string, ConfigProviderInfo> = {};
  for (const [id, provider] of Object.entries(configuredProviders)) {
    if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
      continue;
    }

    const providerRecord = provider as Record<string, unknown>;
    providers[id] = {
      name: typeof providerRecord.name === "string" ? providerRecord.name : id,
      baseUrl:
        typeof providerRecord.base_url === "string"
          ? providerRecord.base_url
          : null,
      requiresOpenaiAuth: providerRecord.requires_openai_auth === true,
      supportsWebsockets: providerRecord.supports_websockets === true,
    };
  }

  return providers;
}

function providersFromModels(
  models: Model[],
): Record<string, ConfigProviderInfo> {
  const providers: Record<string, ConfigProviderInfo> = {};
  for (const model of models) {
    const separatorIndex = model.id.indexOf("/");
    if (separatorIndex <= 0) {
      continue;
    }
    const providerId = model.id.slice(0, separatorIndex);
    providers[providerId] ??= {
      name: providerId,
      baseUrl: null,
      requiresOpenaiAuth: false,
      supportsWebsockets: false,
    };
  }
  return providers;
}

export const useCodexStore = defineStore("codex", {
  state: () => ({
    threads: [] as Thread[],
    selectedThreadId: null as string | null,
    selectedThread: null as Thread | null,
    transcript: buildTranscript(null),
    models: [] as Model[],
    providers: {} as Record<string, ConfigProviderInfo>,
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
      this.connectionStatus = "connecting";

      const settings = useSettingsStore();
      const transport = new AppServerWsTransport(settings.url);
      client = new CodexAppServerClient(transport);
      setAgentsClient(client);
      setContactsClient(client);

      try {
        await client.connect();
        this.initializeResponse = await client.initialize();
        unsubscribeStatus = client.onStatusChange((status) => {
          this.connectionStatus = status;
        });
        unsubscribeNotifications = client.onNotification((notification) =>
          this.handleNotification(notification),
        );
        const [modelsResult, providersResult, configResult] =
          await Promise.allSettled([
            client.listModels(),
            client.listConfigProviders(),
            client.readConfig(),
          ]);
        const models =
          modelsResult.status === "fulfilled" ? modelsResult.value : [];
        const providersFromRpc =
          providersResult.status === "fulfilled"
            ? (providersResult.value as Record<string, ConfigProviderInfo>)
            : {};
        const providersFromReadConfig =
          configResult.status === "fulfilled"
            ? providersFromConfig(configResult.value.config)
            : {};

        this.models = models;
        this.providers = mergeProviders(
          providersFromModels(models),
          providersFromReadConfig,
          providersFromRpc,
        );
        await this.refreshThreads();
        await this.refreshConfiguredAgents();
      } catch (error) {
        this.errorMessage =
          error instanceof Error ? error.message : String(error);
        this.connectionStatus = "disconnected";
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
      setContactsClient(null);
      this.connectionStatus = "disconnected";
      this.initializeResponse = null;
      this.providers = {};
      this.resumedThreadId = null;
    },

    async refreshThreads() {
      if (!client) {
        return;
      }
      // @ts-ignore Pinia state type recursion with complex protocol types
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
        // @ts-ignore Pinia deep type recursion
        this.selectedThread = thread;
        // @ts-ignore Pinia deep type recursion
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
        // @ts-ignore Pinia deep type recursion
        this.selectedThread = await client.readThread(threadId);
        // @ts-ignore Pinia deep type recursion
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
          // @ts-ignore Pinia deep type recursion
          this.selectedThread = thread;
          this.selectedThreadId = thread.id;
          this.resumedThreadId = thread.id;
        }

        if (
          this.selectedThread &&
          this.resumedThreadId !== this.selectedThread.id
        ) {
          // @ts-ignore Pinia deep type recursion
          this.selectedThread = await client.resumeThread(
            this.selectedThread.id,
            this.runtimeSettings(),
          );
          this.resumedThreadId = this.selectedThread.id;
          // @ts-ignore Pinia deep type recursion
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
        // @ts-ignore Pinia deep type recursion
        this.selectedThread = attachTurn(this.selectedThread, turn);
        // @ts-ignore Pinia deep type recursion
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
        modelProvider: null,
        personality: settings.personality,
        approvalPolicy: settings.approvalPolicy,
        sandboxMode: settings.sandboxMode,
      };
    },
  },
});
