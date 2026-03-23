import { defineStore } from "pinia";
import type {
  AgentInfo,
  ApprovalPolicy,
  CodexNotification,
  CommandExecutionRequestApprovalParams,
  CommandExecutionRequestApprovalResponse,
  DynamicToolCallParams,
  FileChangeRequestApprovalParams,
  FileChangeRequestApprovalResponse,
  GrantedPermissionProfile,
  McpServerElicitationRequestParams,
  PermissionsRequestApprovalParams,
  PermissionsRequestApprovalResponse,
  Thread,
  ThreadTokenUsage,
  ToolRequestUserInputQuestion,
  ToolRequestUserInputParams,
} from "../../lib/protocol";
import {
  applyLiveNotification,
  attachTurn,
  applyNotification,
  buildLiveTranscriptTurn,
  buildTranscript,
  splitTranscriptView,
  type LiveTranscriptTurn,
  type TranscriptTurn,
} from "../../lib/transcript";
import { slashCommands } from "../../lib/slash-commands";
import { useSettingsStore } from "../settings";
import { useAgentsStore, clientRef, setAgentsClient } from "../agents";

export function setWorkspaceMessagesClient(
  client: Parameters<typeof setAgentsClient>[0],
) {
  setAgentsClient(client);
}

const knownSlashCommands = new Set([
  ...slashCommands.map((entry) => entry.command),
  "/clean",
]);

export type WorkspaceAgentRow = {
  id: string;
  name: string;
  description: string;
  workspace: string | null;
  hasThread: boolean;
  threadId: string | null;
  updatedAt: number;
  preview: string;
};

export type WorkspaceApprovalRequest =
  | {
      kind: "command";
      title: string;
      threadId: string;
      turnId: string;
      itemId: string;
      reason: string | null;
      command: string | null;
      cwd: string | null;
      choices: Array<{
        label: string;
        value: CommandExecutionRequestApprovalResponse["decision"];
      }>;
    }
  | {
      kind: "file-change";
      title: string;
      threadId: string;
      turnId: string;
      itemId: string;
      reason: string | null;
      grantRoot: string | null;
      choices: Array<{
        label: string;
        value: FileChangeRequestApprovalResponse["decision"];
      }>;
    }
  | {
      kind: "permissions";
      title: string;
      threadId: string;
      turnId: string;
      itemId: string;
      reason: string | null;
      permissionSummary: string[];
      choices: Array<{
        label: string;
        value: PermissionsRequestApprovalResponse;
      }>;
    };

export type WorkspacePromptRequest = {
  kind: "prompt";
  title: string;
  threadId: string;
  turnId: string;
  itemId: string;
  questions: ToolRequestUserInputQuestion[];
};

export type WorkspaceElicitationRequest =
  | {
      kind: "mcp-url";
      title: string;
      threadId: string;
      turnId: string | null;
      serverName: string;
      message: string;
      url: string;
      elicitationId: string;
    }
  | {
      kind: "mcp-form";
      title: string;
      threadId: string;
      turnId: string | null;
      serverName: string;
      message: string;
      fields: Array<{
        key: string;
        label: string;
        description: string | null;
        type: "text" | "number" | "boolean";
        required: boolean;
        defaultValue: string | number | boolean | null;
      }>;
    };

export type WorkspaceDynamicToolRequest = {
  kind: "dynamic-tool";
  title: string;
  threadId: string;
  turnId: string;
  callId: string;
  tool: string;
  argumentsJson: string;
};

export type WorkspacePendingRequest =
  | WorkspaceApprovalRequest
  | WorkspacePromptRequest
  | WorkspaceElicitationRequest
  | WorkspaceDynamicToolRequest;

let resolvePendingRequest: ((value: unknown) => void) | null = null;
let rejectPendingRequest: ((reason?: unknown) => void) | null = null;

export const useWorkspaceMessagesStore = defineStore("workspaceMessages", {
  state: () => ({
    agents: [] as WorkspaceAgentRow[],
    selectedAgentId: null as string | null,
    selectedThreadId: null as string | null,
    selectedThread: null as Thread | null,
    transcript: buildTranscript(null),
    committedTranscript: buildTranscript(null),
    liveTranscriptTurn: null as LiveTranscriptTurn | null,
    pendingRequest: null as WorkspacePendingRequest | null,
    busy: false,
    statusMessage: null as string | null,
    statusTone: null as "info" | "warning" | "error" | null,
    activeTurnId: null as string | null,
    pendingUserDraft: null as string | null,
    restoredDraft: null as string | null,
    restoredDraftVersion: 0,
    resumedThreadId: null as string | null,
    initialized: false,
    threadByAgentId: {} as Record<string, string | null>,
    modelLabel: "" as string,
    contextWindow: null as number | null,
    autoCompactTokenLimit: null as number | null,
    selectedModelProvider: null as string | null,
    selectedTokenUsage: null as ThreadTokenUsage | null,
  }),

  actions: {
    async initialize() {
      const client = clientRef.client;
      if (!client || this.initialized) {
        return;
      }

      const agentsStore = useAgentsStore();
      if (agentsStore.selectedAgentId && !this.selectedAgentId) {
        this.selectedAgentId = agentsStore.selectedAgentId;
      }

      this.initialized = true;
      this.registerRequestHandlers();
      client.onNotification((notification) =>
        this.handleNotification(notification),
      );
      await this.refreshRuntimeMetadata();
      await this.refreshWorkspaceAgents();
    },

    async refreshRuntimeMetadata() {
      const client = clientRef.client;
      const settings = useSettingsStore();
      const agentsStore = useAgentsStore();
      this.modelLabel =
        agentsStore.config?.model || settings.model || "default";
      if (!client) {
        return;
      }

      try {
        const response = await client.readConfig(settings.cwd || undefined);
        const agentModel = agentsStore.config?.model || "";
        const agentProvider = agentsStore.config?.modelProvider || "";
        this.modelLabel =
          agentModel || settings.model || response.config.model || "default";
        this.selectedModelProvider =
          agentProvider ||
          (agentModel.includes("/")
            ? agentModel.slice(0, agentModel.indexOf("/"))
            : null) ||
          response.config.model_provider ||
          null;
        this.contextWindow = toNumber(response.config.model_context_window);
        this.autoCompactTokenLimit = toNumber(
          response.config.model_auto_compact_token_limit,
        );
      } catch {
        this.contextWindow = null;
        this.autoCompactTokenLimit = null;
      }
    },

    async refreshWorkspaceAgents() {
      const client = clientRef.client;
      if (!client) {
        return;
      }

      const settings = useSettingsStore();
      const [isolatedAgents, threads] = await Promise.all([
        client.listAgents(settings.cwd || undefined),
        client.listThreads(),
      ]);
      const reconstructedThreads = mapLatestThreadsByAgent(
        isolatedAgents,
        threads,
      );
      this.threadByAgentId = {
        ...this.threadByAgentId,
        ...reconstructedThreads,
      };
      const currentRows = new Map(
        this.agents.map((agent) => [agent.id, agent]),
      );
      this.agents = isolatedAgents.map((agent) => {
        const current = currentRows.get(agent.id);
        return buildWorkspaceAgentRow(
          agent,
          this.threadByAgentId[agent.id] ?? current?.threadId ?? null,
          current,
          threads.find(
            (thread) => thread.id === this.threadByAgentId[agent.id],
          ) ?? null,
        );
      });

      if (!this.selectedAgentId) {
        const agentsStore = useAgentsStore();
        this.selectedAgentId = agentsStore.selectedAgentId;
      }

      if (!this.selectedAgentId && this.agents.length > 0) {
        await this.selectAgent(this.agents[0]!.id);
      } else if (this.selectedAgentId) {
        const threadId = this.threadByAgentId[this.selectedAgentId] ?? null;
        if (
          threadId &&
          (this.selectedThreadId !== threadId || !this.selectedThread)
        ) {
          this.selectedThreadId = threadId;
          await this.loadThread(threadId);
        }
      }
    },

    async selectAgent(agentId: string) {
      const agentsStore = useAgentsStore();
      this.selectedAgentId = agentId;
      await agentsStore.selectAgent(agentId);
      await this.refreshRuntimeMetadata();
      try {
        let threadId = this.threadByAgentId[agentId] ?? null;

        if (!threadId) {
          threadId = await this.ensureSelectedThread();
        }

        this.selectedThreadId = threadId;
        this.selectedTokenUsage = null;
        if (!threadId) {
          this.selectedThread = null;
          this.activeTurnId = null;
          this.liveTranscriptTurn = null;
          this.setTranscript(buildTranscript(null));
          return;
        }

        if (this.selectedThread?.id === threadId) {
          return;
        }

        await this.loadThread(threadId);
      } catch (error) {
        this.setStatus(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    },

    async ensureSelectedThread(): Promise<string | null> {
      const client = clientRef.client;
      if (!client || !this.selectedAgentId) {
        return null;
      }

      const mappedThreadId = this.threadByAgentId[this.selectedAgentId] ?? null;
      if (mappedThreadId) {
        this.selectedThreadId = mappedThreadId;
        return mappedThreadId;
      }

      const thread = await client.startThreadForAgent(this.selectedAgentId);
      this.threadByAgentId = {
        ...this.threadByAgentId,
        [this.selectedAgentId]: thread.id,
      };
      this.selectedThreadId = thread.id;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).selectedThread = thread;
      this.resumedThreadId = thread.id;
      this.selectedModelProvider = thread.modelProvider || null;
      this.selectedTokenUsage = null;
      this.activeTurnId = findActiveTurnId(thread);
      this.updateAgentThread(this.selectedAgentId, thread);
      return thread.id;
    },

    async sendMessage(message: string) {
      const client = clientRef.client;
      if (!client || !this.selectedAgentId) {
        return;
      }

      const trimmed = message.trim();

      try {
        this.busy = true;
        this.statusMessage = null;
        this.statusTone = null;
        if (await this.handleSlashCommand(trimmed)) {
          return;
        }

        const threadId = await this.ensureSelectedThread();
        if (!threadId) {
          return;
        }

        if (this.resumedThreadId !== threadId) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (this as any).selectedThread = await client.resumeThread(
            threadId,
            this.runtimeSettings(),
          );
          this.resumedThreadId = threadId;
          this.selectedModelProvider =
            this.selectedThread?.modelProvider ?? null;
          this.selectedTokenUsage = null;
          // @ts-ignore Pinia deep type recursion with complex protocol types
          this.liveTranscriptTurn = buildLiveTranscriptTurn(
            this.selectedThread,
            this.activeTurnId,
          );
          // @ts-ignore Pinia deep type recursion with complex protocol types
          this.setTranscript(buildTranscript(this.selectedThread));
        }

        const turn = await client.startTurn(
          threadId,
          message,
          this.runtimeSettings(),
        );
        this.activeTurnId = turn.id;
        this.pendingUserDraft = trimmed;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).selectedThread = attachTurn(
          this.selectedThread as Thread,
          turn,
        );
        this.selectedTokenUsage = null;
        // @ts-ignore Pinia deep type recursion with complex protocol types
        this.liveTranscriptTurn = buildLiveTranscriptTurn(
          this.selectedThread,
          this.activeTurnId,
        );
        this.setTranscript(buildTranscript(this.selectedThread));
      } catch (error) {
        this.setStatus(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      } finally {
        this.busy = false;
      }
    },

    async interruptActiveTurn() {
      const client = clientRef.client;
      if (!client || !this.selectedThreadId || !this.activeTurnId) {
        return;
      }

      try {
        await client.interruptTurn(this.selectedThreadId, this.activeTurnId);
      } catch (error) {
        this.setStatus(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    },

    async openConversationInMainChat() {
      return this.ensureSelectedThread();
    },

    async loadThread(threadId: string) {
      const client = clientRef.client;
      if (!client) {
        return;
      }

      this.busy = true;
      try {
        this.statusMessage = null;
        this.statusTone = null;
        this.selectedThread = (await client.readThread(threadId)) as Thread;
        this.selectedModelProvider = this.selectedThread?.modelProvider ?? null;
        this.selectedTokenUsage = null;
        this.activeTurnId = findActiveTurnId(this.selectedThread);
        // @ts-ignore Pinia deep type recursion with complex protocol types
        this.liveTranscriptTurn = buildLiveTranscriptTurn(
          this.selectedThread,
          this.activeTurnId,
        );
        this.setTranscript(buildTranscript(this.selectedThread));
      } catch (error) {
        this.setStatus(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      } finally {
        this.busy = false;
      }
    },

    handleNotification(notification: CodexNotification) {
      if (
        notification.method === "thread/tokenUsage/updated" &&
        this.selectedThread &&
        notification.params.threadId === this.selectedThread.id
      ) {
        this.selectedTokenUsage = notification.params.tokenUsage;
        this.contextWindow = notification.params.tokenUsage.modelContextWindow;
      }

      if (
        this.selectedThread &&
        (!("threadId" in notification.params) ||
          notification.params.threadId === this.selectedThread.id)
      ) {
        this.liveTranscriptTurn = applyLiveNotification(
          this.liveTranscriptTurn,
          notification,
        );
        this.setTranscript(applyNotification(this.transcript, notification));
      }

      if (notification.method === "turn/started") {
        this.activeTurnId = notification.params.turn.id;
        this.refreshTranscriptView();
        this.setStatus("Working", "info");
      }

      if (notification.method === "item/started") {
        this.setStatus(describeStartedItem(notification.params.item), "info");
      }

      if (notification.method === "error" && notification.params.willRetry) {
        this.setStatus(notification.params.error.message, "warning");
      }

      if (notification.method === "turn/aborted") {
        if (
          this.pendingUserDraft &&
          (notification.params.reason === "interrupted" ||
            notification.params.reason === "reviewEnded")
        ) {
          this.restoredDraft = this.pendingUserDraft;
          this.restoredDraftVersion += 1;
        }
        this.pendingUserDraft = null;
        this.activeTurnId = null;
        this.refreshTranscriptView();
        this.statusMessage = null;
        this.statusTone = null;
      }

      if (notification.method === "turn/completed") {
        this.busy = false;
        this.statusMessage = null;
        this.statusTone = null;
        this.pendingUserDraft = null;
        if (notification.params.turn.id === this.activeTurnId) {
          this.activeTurnId = null;
          this.refreshTranscriptView();
        }
      }
    },

    registerRequestHandlers() {
      const client = clientRef.client;
      if (!client) {
        return;
      }

      client.onServerRequest(
        "item/commandExecution/requestApproval",
        async (params: unknown) =>
          this.waitForPendingRequest(
            buildCommandApprovalRequest(
              params as CommandExecutionRequestApprovalParams,
            ),
          ),
      );
      client.onServerRequest(
        "item/fileChange/requestApproval",
        async (params: unknown) =>
          this.waitForPendingRequest(
            buildFileChangeApprovalRequest(
              params as FileChangeRequestApprovalParams,
            ),
          ),
      );
      client.onServerRequest(
        "item/permissions/requestApproval",
        async (params: unknown) =>
          this.waitForPendingRequest(
            buildPermissionsApprovalRequest(
              params as PermissionsRequestApprovalParams,
            ),
          ),
      );
      client.onServerRequest(
        "item/tool/requestUserInput",
        async (params: unknown) =>
          this.waitForPendingRequest(
            buildPromptRequest(params as ToolRequestUserInputParams),
          ),
      );
      client.onServerRequest(
        "mcpServer/elicitation/request",
        async (params: unknown) =>
          this.waitForPendingRequest(
            buildWorkspaceElicitationRequest(
              params as McpServerElicitationRequestParams,
            ),
          ),
      );
      client.onServerRequest("item/tool/call", async (params: unknown) =>
        this.waitForPendingRequest(
          buildWorkspaceDynamicToolRequest(params as DynamicToolCallParams),
        ),
      );
    },

    async waitForPendingRequest(request: WorkspacePendingRequest) {
      await this.selectThreadForRequest(request.threadId);
      this.pendingRequest = request;
      return new Promise((resolve, reject) => {
        rejectPendingRequest?.(new Error("Superseded by newer request"));
        resolvePendingRequest = resolve;
        rejectPendingRequest = reject;
      });
    },

    async selectThreadForRequest(threadId: string) {
      this.selectedThreadId = threadId;
      await this.loadThread(threadId);
    },

    resolvePendingRequest(response: unknown) {
      resolvePendingRequest?.(response);
      this.pendingRequest = null;
      resolvePendingRequest = null;
      rejectPendingRequest = null;
    },

    rejectPendingRequest(message = "Request cancelled") {
      rejectPendingRequest?.(new Error(message));
      this.pendingRequest = null;
      resolvePendingRequest = null;
      rejectPendingRequest = null;
    },

    updateAgentThread(agentId: string, thread: Thread) {
      this.agents = this.agents.map((agent) =>
        agent.id === agentId
          ? {
              ...agent,
              hasThread: true,
              threadId: thread.id,
              updatedAt: thread.updatedAt,
              preview: thread.preview || agent.preview,
            }
          : agent,
      );
    },

    async handleSlashCommand(message: string) {
      if (!message.startsWith("/")) {
        return false;
      }

      const client = clientRef.client;
      if (!client) {
        return true;
      }

      const parsed = parseSlashCommand(message);
      if (!parsed) {
        return false;
      }

      const { command, args } = parsed;

      switch (command) {
        case "/new":
        case "/clear": {
          this.resumedThreadId = null;
          this.selectedThreadId = null;
          this.selectedThread = null;
          this.selectedTokenUsage = null;
          this.activeTurnId = null;
          this.liveTranscriptTurn = null;
          this.setTranscript(buildTranscript(null));
          await this.ensureSelectedThread();
          this.addLocalEvent(
            command === "/new" ? "Started new chat" : "Cleared chat",
            `Active agent: ${this.selectedAgentName()}`,
          );
          return true;
        }
        case "/clean":
        case "/stop": {
          if (!this.selectedThreadId) {
            this.addLocalEvent(
              "No active thread",
              `${command} needs an active thread.`,
              "warning",
            );
            return true;
          }
          if (command === "/clean") {
            await client.cleanBackgroundTerminals(this.selectedThreadId);
            this.addLocalEvent(
              "Stopped background terminals",
              `Requested cleanup for ${this.selectedThreadId}.`,
            );
          } else {
            this.addLocalEvent(
              "Background terminals",
              "Use /clean to stop background terminals in the web UI.",
            );
          }
          return true;
        }
        case "/agent":
        case "/subagents": {
          if (!args) {
            this.addLocalEvent(
              "Switch agent",
              `Use the sidebar to switch agent threads. Current agent: ${this.selectedAgentName()}`,
            );
            return true;
          }
          const matches = this.findAgents(args);
          if (matches.length === 1) {
            const [agent] = matches;
            await this.selectAgent(agent.id);
            this.addLocalEvent(
              "Switched agent",
              `Now chatting with ${agent.name}.`,
            );
            return true;
          }
          if (matches.length === 0) {
            this.addLocalEvent(
              "Unknown agent",
              `No agent matches "${args}".`,
              "warning",
            );
            return true;
          }
          this.addLocalEvent(
            "Multiple agent matches",
            matches.map((agent) => agent.name).join(", "),
            "warning",
          );
          return true;
        }
        case "/review": {
          const threadId = this.selectedThreadId;
          if (!threadId) {
            this.addLocalEvent(
              "Review unavailable",
              "Start or resume a chat before running /review.",
              "warning",
            );
            return true;
          }
          const review = await client.startReview(
            threadId,
            args
              ? { type: "custom", instructions: args }
              : { type: "uncommittedChanges" },
          );
          const currentThread = this.selectedThread;
          if (currentThread && review.reviewThreadId === currentThread.id) {
            const updated = attachTurn(currentThread, review.turn) as Thread;
            this.selectedThread = updated;
            // @ts-ignore Pinia deep type recursion with complex protocol types
            this.liveTranscriptTurn = buildLiveTranscriptTurn(
              updated,
              this.activeTurnId,
            );
            this.setTranscript(buildTranscript(updated));
          }
          this.addLocalEvent(
            "Review started",
            args || "Started review for uncommitted changes.",
          );
          return true;
        }
        case "/rename": {
          if (!this.selectedThreadId) {
            this.addLocalEvent(
              "Rename unavailable",
              "Start or resume a chat before renaming it.",
              "warning",
            );
            return true;
          }
          if (!args) {
            this.addLocalEvent(
              "Rename chat",
              "Usage: /rename <new thread name>",
              "warning",
            );
            return true;
          }
          await client.setThreadName(this.selectedThreadId, args);
          if (this.selectedThread) {
            this.selectedThread = {
              ...this.selectedThread,
              name: args,
            } as Thread;
          }
          this.addLocalEvent("Renamed chat", args);
          return true;
        }
        case "/resume": {
          const threads = await client.listThreads();
          if (!args) {
            const recent = threads
              .slice(0, 5)
              .map((thread) => thread.name || thread.preview || thread.id);
            this.addLocalEvent(
              "Resume chat",
              recent.length > 0
                ? `Recent chats: ${recent.join(" | ")}`
                : "No saved chats available.",
            );
            return true;
          }
          const matches = findMatchingThreads(threads, args);
          if (matches.length !== 1) {
            this.addLocalEvent(
              matches.length === 0 ? "Unknown chat" : "Multiple chat matches",
              matches.length === 0
                ? `No chat matches "${args}".`
                : matches
                    .map((thread) => thread.name || thread.preview || thread.id)
                    .join(", "),
              "warning",
            );
            return true;
          }
          const [thread] = matches;
          const resumedThread = (await client.resumeThread(
            thread.id,
            this.runtimeSettings(),
          )) as Thread;
          this.selectedThreadId = thread.id;
          this.selectedThread = resumedThread;
          this.resumedThreadId = thread.id;
          this.selectedModelProvider = resumedThread.modelProvider ?? null;
          this.selectedTokenUsage = null;
          this.activeTurnId = findActiveTurnId(resumedThread);
          // @ts-ignore Pinia deep type recursion with complex protocol types
          this.liveTranscriptTurn = buildLiveTranscriptTurn(
            resumedThread,
            this.activeTurnId,
          );
          this.setTranscript(buildTranscript(resumedThread));
          if (this.selectedAgentId) {
            this.threadByAgentId = {
              ...this.threadByAgentId,
              [this.selectedAgentId]: thread.id,
            };
            this.updateAgentThread(this.selectedAgentId, resumedThread);
          }
          this.addLocalEvent(
            "Resumed chat",
            resumedThread.name || resumedThread.preview || thread.id,
          );
          return true;
        }
        case "/status": {
          this.addLocalEvent(
            "Workspace status",
            [
              `Agent: ${this.selectedAgentName()}`,
              `Thread: ${this.selectedThreadId || "none"}`,
              `Model: ${this.modelLabel || "default"}`,
              `Provider: ${this.selectedModelProvider || "unknown"}`,
              `Context: ${this.contextWindow ?? "unknown"}`,
              `Tokens: ${this.selectedTokenUsage?.total.totalTokens ?? 0}`,
            ].join("\n"),
          );
          return true;
        }
        case "/debug-config": {
          const response = await client.readConfig(
            this.runtimeSettings().cwd || undefined,
          );
          this.addLocalEvent(
            "Debug config",
            JSON.stringify(response.config, null, 2),
          );
          return true;
        }
        case "/model": {
          const agentsStore = useAgentsStore();
          if (!args) {
            const models = await client.listModels();
            const summary = models
              .slice(0, 8)
              .map((m) => m.id)
              .join(", ");
            this.addLocalEvent(
              "Available models",
              summary || "No models returned by the server.",
            );
            return true;
          }
          const models = await client.listModels();
          const model = models.find((m) => m.id === args);
          if (!model) {
            this.addLocalEvent(
              "Unknown model",
              `No model matches "${args}".`,
              "warning",
            );
            return true;
          }
          if (agentsStore.config) {
            agentsStore.config.model = model.id;
            await agentsStore.save();
          }
          this.modelLabel = model.id;
          await this.refreshRuntimeMetadata();
          this.addLocalEvent("Model updated", `Now using ${model.id}.`);
          return true;
        }
        case "/personality": {
          const settings = useSettingsStore();
          if (!args) {
            this.addLocalEvent(
              "Personality",
              `Current: ${settings.personality}. Options: friendly, pragmatic, none.`,
            );
            return true;
          }
          if (!["friendly", "pragmatic", "none"].includes(args)) {
            this.addLocalEvent(
              "Unknown personality",
              `Unsupported personality "${args}". Use friendly, pragmatic, or none.`,
              "warning",
            );
            return true;
          }
          settings.updateSettings({
            ...settings.$state,
            personality: args as "friendly" | "pragmatic" | "none",
          });
          this.addLocalEvent("Personality updated", args);
          return true;
        }
        case "/approvals":
        case "/permissions": {
          const agentConfig = useAgentsStore().config;
          this.addLocalEvent(
            "Permissions",
            `Approval policy: ${agentConfig?.approvalPolicy || "inherit"}\nSandbox: ${agentConfig?.sandboxMode || "inherit"}`,
          );
          return true;
        }
        case "/setup-default-sandbox":
        case "/sandbox-add-read-dir": {
          this.addLocalEvent(
            "Sandbox command",
            `${command} is not configurable from the web UI yet.`,
          );
          return true;
        }
        case "/experimental": {
          const features = await client.listExperimentalFeatures();
          this.addLocalEvent(
            "Experimental features",
            features.length > 0
              ? features
                  .slice(0, 10)
                  .map(
                    (f) =>
                      `${f.enabled ? "[on]" : "[off]"} ${f.name} (${f.stage})`,
                  )
                  .join("\n")
              : "No experimental features returned by the server.",
          );
          return true;
        }
        case "/skills": {
          const skills = await client.listSkills(
            this.runtimeSettings().cwd || undefined,
          );
          this.addLocalEvent(
            "Skills",
            skills.length > 0
              ? skills
                  .slice(0, 10)
                  .map((s) => s.name)
                  .join("\n")
              : "No skills available.",
          );
          return true;
        }
        case "/fork": {
          if (!this.selectedThreadId) {
            this.addLocalEvent(
              "Fork unavailable",
              "Start or resume a chat before forking it.",
              "warning",
            );
            return true;
          }
          const forkedThread = await client.forkThread(
            this.selectedThreadId,
            this.runtimeSettings(),
          );
          this.selectedThread = forkedThread as Thread;
          this.selectedThreadId = forkedThread.id;
          this.resumedThreadId = forkedThread.id;
          this.selectedModelProvider = forkedThread.modelProvider ?? null;
          this.selectedTokenUsage = null;
          this.activeTurnId = findActiveTurnId(forkedThread as Thread);
          // @ts-ignore Pinia deep type recursion with complex protocol types
          this.liveTranscriptTurn = buildLiveTranscriptTurn(
            forkedThread as Thread,
            this.activeTurnId,
          );
          this.setTranscript(buildTranscript(forkedThread as Thread));
          if (this.selectedAgentId) {
            this.threadByAgentId = {
              ...this.threadByAgentId,
              [this.selectedAgentId]: forkedThread.id,
            };
            this.updateAgentThread(
              this.selectedAgentId,
              forkedThread as Thread,
            );
          }
          this.addLocalEvent(
            "Forked chat",
            forkedThread.name || forkedThread.id,
          );
          return true;
        }
        case "/init": {
          this.addLocalEvent(
            "Init workspace",
            "Run /init in the TUI for the guided flow, or create an `AGENTS.md` file manually.",
          );
          return true;
        }
        case "/compact": {
          if (!this.selectedThreadId) {
            this.addLocalEvent(
              "Compact unavailable",
              "Start or resume a chat before compacting it.",
              "warning",
            );
            return true;
          }
          await client.compactThread(this.selectedThreadId);
          this.addLocalEvent(
            "Compaction started",
            `Requested context compaction for ${this.selectedThreadId}.`,
          );
          return true;
        }
        case "/plan": {
          this.addLocalEvent(
            "Plan mode",
            "Plan mode presets are not exposed in the web UI yet.",
          );
          return true;
        }
        case "/collab": {
          this.addLocalEvent(
            "Collaboration mode",
            "Collaboration mode presets are not exposed in the web UI yet.",
          );
          return true;
        }
        case "/diff": {
          if (!this.selectedThreadId) {
            this.addLocalEvent(
              "Diff unavailable",
              "Start or resume a chat before running /diff.",
              "warning",
            );
            return true;
          }
          await client.runThreadShellCommand(
            this.selectedThreadId,
            "git diff --stat && git diff",
          );
          this.addLocalEvent(
            "Git diff",
            "Requested git diff in the active thread.",
          );
          return true;
        }
        case "/copy": {
          const text = this.latestAssistantText();
          if (!text) {
            this.addLocalEvent(
              "Copy unavailable",
              "There is no assistant output to copy yet.",
              "warning",
            );
            return true;
          }
          if (typeof navigator !== "undefined" && navigator.clipboard) {
            await navigator.clipboard.writeText(text);
            this.addLocalEvent(
              "Copied output",
              "Latest assistant output copied to clipboard.",
            );
          } else {
            this.addLocalEvent(
              "Copy unavailable",
              "Clipboard access is not available in this browser context.",
              "warning",
            );
          }
          return true;
        }
        case "/mention": {
          this.addLocalEvent(
            "Mention file",
            args
              ? `File mentions are not expanded automatically in the web UI yet: ${args}`
              : "Usage: /mention <path>",
            args ? "info" : "warning",
          );
          return true;
        }
        case "/statusline": {
          this.addLocalEvent(
            "Status line",
            "Status line customization is not exposed in the web UI yet.",
          );
          return true;
        }
        case "/theme": {
          const settings = useSettingsStore();
          if (!args) {
            this.addLocalEvent(
              "Theme",
              `Current theme: ${settings.theme}. Options: system, light, dark.`,
            );
            return true;
          }
          if (!["system", "light", "dark"].includes(args)) {
            this.addLocalEvent(
              "Unknown theme",
              `Unsupported theme "${args}". Use system, light, or dark.`,
              "warning",
            );
            return true;
          }
          settings.updateSettings({
            ...settings.$state,
            theme: args as "system" | "light" | "dark",
          });
          this.addLocalEvent("Theme updated", args);
          return true;
        }
        case "/mcp": {
          const servers = await client.listMcpServers();
          this.addLocalEvent(
            "MCP servers",
            servers.length > 0
              ? servers.map((s) => `${s.name}: ${s.authStatus}`).join("\n")
              : "No MCP servers available.",
          );
          return true;
        }
        case "/apps": {
          const apps = await client.listApps(
            this.selectedThreadId || undefined,
          );
          this.addLocalEvent(
            "Apps",
            apps.length > 0
              ? apps
                  .slice(0, 10)
                  .map((a) => `${a.isEnabled ? "[on]" : "[off]"} ${a.name}`)
                  .join("\n")
              : "No apps available.",
          );
          return true;
        }
        case "/plugins": {
          const plugins = await client.listPlugins(
            this.runtimeSettings().cwd || undefined,
          );
          this.addLocalEvent(
            "Plugins",
            plugins.length > 0
              ? plugins
                  .slice(0, 10)
                  .map(
                    (p) =>
                      `${p.installed ? "[installed]" : "[available]"} ${p.name}${p.enabled ? " (enabled)" : ""}`,
                  )
                  .join("\n")
              : "No plugins available.",
          );
          return true;
        }
        case "/logout": {
          await client.logout();
          this.addLocalEvent("Logged out", "Requested account logout.");
          return true;
        }
        case "/quit":
        case "/exit": {
          this.addLocalEvent(
            "Exit unavailable",
            "Browser sessions cannot be terminated with slash commands. Close the tab instead.",
          );
          return true;
        }
        case "/feedback": {
          await client.uploadFeedback(
            args || null,
            this.selectedThreadId || undefined,
          );
          this.addLocalEvent(
            "Feedback sent",
            args || "Uploaded generic feedback without extra logs.",
          );
          return true;
        }
        case "/ps": {
          this.addLocalEvent(
            "Background terminals",
            "Background terminal listing is not exposed in the web UI yet.",
          );
          return true;
        }
        case "/fast": {
          this.addLocalEvent(
            "Fast mode",
            "Service-tier switching is not exposed in the web UI yet.",
          );
          return true;
        }
        case "/realtime": {
          this.addLocalEvent(
            "Realtime mode",
            "Realtime voice mode is not exposed in the web UI yet.",
          );
          return true;
        }
        case "/settings": {
          this.addLocalEvent(
            "Settings",
            "Open the Settings page from the sidebar to adjust runtime and audio options.",
          );
          return true;
        }
        case "/rollout": {
          this.addLocalEvent(
            "Rollout path",
            this.selectedThread?.path ||
              "This thread does not expose a rollout path yet.",
          );
          return true;
        }
        default: {
          const knownCommand = knownSlashCommands.has(command);
          this.addLocalEvent(
            knownCommand
              ? "Slash command not available yet"
              : "Unknown slash command",
            knownCommand
              ? `${command} is handled in the web UI, but this action is not wired up yet.`
              : `${command} is not a recognized Codex command.`,
            knownCommand ? "info" : "warning",
          );
          return true;
        }
      }
    },

    addLocalEvent(
      label: string,
      detail: string,
      tone: "info" | "warning" | "error" = "info",
    ) {
      const turnId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const turn: TranscriptTurn = {
        id: turnId,
        status: "completed",
        error: null,
        items: [{ id: `${turnId}-event`, kind: "event", label, detail, tone }],
      };
      this.setTranscript([...this.transcript, turn]);
    },

    setTranscript(turns: TranscriptTurn[]) {
      this.transcript = turns;
      const view = splitTranscriptView(turns, this.activeTurnId);
      this.committedTranscript = view.committedTurns;
    },

    refreshTranscriptView() {
      const view = splitTranscriptView(this.transcript, this.activeTurnId);
      this.committedTranscript = view.committedTurns;
      if (!this.activeTurnId) {
        this.liveTranscriptTurn = null;
      }
    },

    setStatus(
      message: string | null,
      tone: "info" | "warning" | "error" | null,
    ) {
      this.statusMessage = message;
      this.statusTone = tone;
    },

    selectedAgentName() {
      return (
        this.agents.find((agent) => agent.id === this.selectedAgentId)?.name ||
        this.selectedAgentId ||
        "none"
      );
    },

    findAgents(query: string) {
      const normalized = query.trim().toLowerCase();
      return this.agents.filter((agent) => {
        const haystack =
          `${agent.id} ${agent.name} ${agent.description}`.toLowerCase();
        return haystack.includes(normalized);
      });
    },

    latestAssistantText() {
      for (let ti = this.transcript.length - 1; ti >= 0; ti--) {
        const turn = this.transcript[ti];
        if (!turn) continue;
        for (let ii = turn.items.length - 1; ii >= 0; ii--) {
          const item = turn.items[ii];
          if (!item) continue;
          switch (item.kind) {
            case "assistant":
            case "plan":
              return item.text;
            case "reasoning":
              return [...item.summary, ...item.content].join("\n");
            case "command":
              return [item.command, item.output].filter(Boolean).join("\n\n");
            case "file-change":
              return [item.changes.join("\n"), item.output]
                .filter(Boolean)
                .join("\n\n");
            case "tool":
            case "event":
              return `${item.label}\n${item.detail}`;
            case "user":
              break;
          }
        }
      }
      return "";
    },

    runtimeSettings() {
      const settings = useSettingsStore();
      const agentConfig = useAgentsStore().config;
      return {
        cwd: settings.cwd || "",
        model: agentConfig?.model || null,
        modelProvider: agentConfig?.modelProvider || null,
        personality: settings.personality || "friendly",
        approvalPolicy: normalizeApprovalPolicy(agentConfig?.approvalPolicy),
        sandboxMode: agentConfig?.sandboxMode || "workspace-write",
      };
    },
  },
});

function buildWorkspaceAgentRow(
  agent: AgentInfo,
  threadId: string | null,
  current?: WorkspaceAgentRow,
  latestThread?: Thread | null,
): WorkspaceAgentRow {
  return {
    id: agent.id,
    name: agent.name || agent.id,
    description:
      agent.description || agent.workspace || "Ready for a new thread",
    workspace: agent.workspace,
    hasThread: threadId !== null,
    threadId,
    updatedAt: latestThread?.updatedAt ?? current?.updatedAt ?? 0,
    preview:
      latestThread?.name ||
      latestThread?.preview ||
      current?.preview ||
      "No messages yet",
  };
}

function mapLatestThreadsByAgent(
  agents: AgentInfo[],
  threads: Thread[],
): Record<string, string | null> {
  const mapping: Record<string, string | null> = {};

  for (const agent of agents) {
    const matchingThread = [...threads]
      .filter((thread) => threadMatchesAgent(thread, agent))
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];
    mapping[agent.id] = matchingThread?.id ?? null;
  }

  return mapping;
}

function threadMatchesAgent(thread: Thread, agent: AgentInfo): boolean {
  const candidates = new Set(
    [agent.id, agent.name, ...(agent.nicknameCandidates ?? [])]
      .filter((value): value is string => Boolean(value))
      .map(normalizeAgentIdentity),
  );

  if (candidates.size === 0) {
    return false;
  }

  const searchableThreadText = [thread.name, thread.preview]
    .filter((value): value is string => Boolean(value))
    .map(normalizeAgentIdentity)
    .join(" ");

  for (const value of collectThreadAgentIdentities(thread)) {
    if (candidates.has(normalizeAgentIdentity(value))) {
      return true;
    }
  }

  for (const candidate of candidates) {
    if (candidate.length > 2 && searchableThreadText.includes(candidate)) {
      return true;
    }
  }

  return false;
}

function collectThreadAgentIdentities(thread: Thread): string[] {
  const values: string[] = [];

  if (thread.agentNickname) {
    values.push(thread.agentNickname);
  }
  if (thread.agentRole) {
    values.push(thread.agentRole);
  }

  if (typeof thread.source === "object" && "subAgent" in thread.source) {
    const subAgentSource = thread.source.subAgent;
    if (
      typeof subAgentSource === "object" &&
      subAgentSource !== null &&
      "thread_spawn" in subAgentSource
    ) {
      const spawnSource = subAgentSource.thread_spawn;
      if (spawnSource.agent_nickname) {
        values.push(spawnSource.agent_nickname);
      }
      if (spawnSource.agent_role) {
        values.push(spawnSource.agent_role);
      }
    }
  }

  return values;
}

function normalizeAgentIdentity(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function findActiveTurnId(thread: Thread | null): string | null {
  if (!thread) {
    return null;
  }

  for (let index = thread.turns.length - 1; index >= 0; index -= 1) {
    const turn = thread.turns[index];
    if (turn?.status === "inProgress") {
      return turn.id;
    }
  }

  return null;
}

function describeStartedItem(
  item: Thread["turns"][number]["items"][number],
): string {
  switch (item.type) {
    case "commandExecution":
      return item.command ? `Running ${item.command}` : "Running command";
    case "fileChange":
      return "Updating files";
    case "reasoning":
      return "Thinking";
    case "plan":
      return "Updating plan";
    case "agentMessage":
      return "Drafting response";
    case "mcpToolCall":
      return `Running ${item.server}:${item.tool}`;
    case "dynamicToolCall":
      return `Running ${item.tool}`;
    case "webSearch":
      return `Searching web for ${item.query}`;
    case "imageGeneration":
      return "Generating image";
    case "imageView":
      return `Opening ${item.path}`;
    default:
      return "Working";
  }
}

function buildCommandApprovalRequest(
  params: CommandExecutionRequestApprovalParams,
): WorkspaceApprovalRequest {
  return {
    kind: "command",
    title: "Command approval required",
    threadId: params.threadId,
    turnId: params.turnId,
    itemId: params.itemId,
    reason: params.reason ?? null,
    command: params.command ?? null,
    cwd: params.cwd ?? null,
    choices: [
      { label: "Allow once", value: "accept" },
      { label: "Allow for session", value: "acceptForSession" },
      { label: "Decline", value: "decline" },
      { label: "Cancel", value: "cancel" },
    ],
  };
}

function buildFileChangeApprovalRequest(
  params: FileChangeRequestApprovalParams,
): WorkspaceApprovalRequest {
  return {
    kind: "file-change",
    title: "File change approval required",
    threadId: params.threadId,
    turnId: params.turnId,
    itemId: params.itemId,
    reason: params.reason ?? null,
    grantRoot: params.grantRoot ?? null,
    choices: [
      { label: "Allow once", value: "accept" },
      { label: "Allow for session", value: "acceptForSession" },
      { label: "Decline", value: "decline" },
      { label: "Cancel", value: "cancel" },
    ],
  };
}

function buildPermissionsApprovalRequest(
  params: PermissionsRequestApprovalParams,
): WorkspaceApprovalRequest {
  return {
    kind: "permissions",
    title: "Permissions requested",
    threadId: params.threadId,
    turnId: params.turnId,
    itemId: params.itemId,
    reason: params.reason,
    permissionSummary: summarizePermissions(params),
    choices: [
      {
        label: "Allow for this turn",
        value: { permissions: grantedPermissions(params), scope: "turn" },
      },
      {
        label: "Allow for session",
        value: { permissions: grantedPermissions(params), scope: "session" },
      },
      { label: "Decline", value: { permissions: {}, scope: "turn" } },
    ],
  };
}

function buildPromptRequest(
  params: ToolRequestUserInputParams,
): WorkspacePromptRequest {
  return {
    kind: "prompt",
    title: "Input requested",
    threadId: params.threadId,
    turnId: params.turnId,
    itemId: params.itemId,
    questions: params.questions ?? [],
  };
}

function buildWorkspaceElicitationRequest(
  params: McpServerElicitationRequestParams,
): WorkspaceElicitationRequest {
  if (params.mode === "url") {
    return {
      kind: "mcp-url",
      title: "MCP authentication required",
      threadId: params.threadId,
      turnId: params.turnId,
      serverName: params.serverName,
      message: params.message,
      url: params.url,
      elicitationId: params.elicitationId,
    };
  }
  const fields = Object.entries(params.requestedSchema.properties ?? {}).map(
    ([key, schema]) => ({
      key,
      label: ((schema as Record<string, unknown>).title as string) || key,
      description:
        ((schema as Record<string, unknown>).description as string | null) ??
        null,
      type: elicitationFieldType(
        schema as Record<string, unknown> | null | undefined,
      ),
      required: (params.requestedSchema.required ?? []).includes(key),
      defaultValue: normalizeElicitationDefault(
        (schema as Record<string, unknown>).default ?? null,
      ),
    }),
  );
  return {
    kind: "mcp-form",
    title: `MCP form from ${params.serverName}`,
    threadId: params.threadId,
    turnId: params.turnId,
    serverName: params.serverName,
    message: params.message,
    fields,
  };
}

function buildWorkspaceDynamicToolRequest(
  params: DynamicToolCallParams,
): WorkspaceDynamicToolRequest {
  return {
    kind: "dynamic-tool",
    title: `Dynamic tool call: ${params.tool}`,
    threadId: params.threadId,
    turnId: params.turnId,
    callId: params.callId,
    tool: params.tool,
    argumentsJson: JSON.stringify(params.arguments, null, 2),
  };
}

function elicitationFieldType(
  schema: Record<string, unknown> | null | undefined,
) {
  if (!schema || typeof schema.type !== "string") return "text" as const;
  if (schema.type === "integer" || schema.type === "number")
    return "number" as const;
  if (schema.type === "boolean") return "boolean" as const;
  return "text" as const;
}

function normalizeElicitationDefault(value: unknown) {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  return null;
}

function toNumber(value: bigint | number | null | undefined) {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  return null;
}

function summarizePermissions(params: PermissionsRequestApprovalParams) {
  const lines: string[] = [];
  const perms = params.permissions;
  if (perms.network?.enabled !== null && perms.network?.enabled !== undefined) {
    lines.push(`Network: ${perms.network.enabled ? "enabled" : "disabled"}`);
  }
  if (perms.fileSystem?.read?.length)
    lines.push(`Read: ${perms.fileSystem.read.join(", ")}`);
  if (perms.fileSystem?.write?.length)
    lines.push(`Write: ${perms.fileSystem.write.join(", ")}`);
  return lines.length > 0 ? lines : ["(no specific permissions)"];
}

function grantedPermissions(
  params: PermissionsRequestApprovalParams,
): GrantedPermissionProfile {
  return {
    network: params.permissions.network ?? undefined,
    fileSystem: params.permissions.fileSystem ?? undefined,
  };
}

function normalizeApprovalPolicy(value: unknown): ApprovalPolicy {
  if (
    value === "untrusted" ||
    value === "on-failure" ||
    value === "on-request" ||
    value === "never"
  )
    return value;
  return "on-request";
}

function parseSlashCommand(message: string) {
  const trimmed = message.trim();
  if (!trimmed.startsWith("/")) return null;
  const [command, ...rest] = trimmed.split(/\s+/);
  return { command: command.toLowerCase(), args: rest.join(" ").trim() };
}

function findMatchingThreads(threads: Thread[], query: string) {
  const normalized = query.trim().toLowerCase();
  return threads.filter((thread) => {
    const haystack =
      `${thread.id} ${thread.name || ""} ${thread.preview || ""}`.toLowerCase();
    return haystack.includes(normalized);
  });
}
