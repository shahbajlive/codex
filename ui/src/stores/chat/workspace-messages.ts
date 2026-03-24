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
  color: string | null;
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

export const INTERRUPT_RECONCILE_DELAY_MS = 2500;
export const ACTIVE_TURN_RECONCILE_INTERVAL_MS = 1500;
export const INTERRUPT_RETRY_INTERVAL_MS = 2000;
export const INTERRUPT_MAX_RETRIES = 3;

let interruptReconcileTimer: ReturnType<typeof setTimeout> | null = null;
let activeTurnReconcileTimer: ReturnType<typeof setTimeout> | null = null;

function clearInterruptReconcileTimer() {
  if (interruptReconcileTimer !== null) {
    clearTimeout(interruptReconcileTimer);
    interruptReconcileTimer = null;
  }
}

function clearActiveTurnReconcileTimer() {
  if (activeTurnReconcileTimer !== null) {
    clearTimeout(activeTurnReconcileTimer);
    activeTurnReconcileTimer = null;
  }
}

export const useWorkspaceMessagesStore = defineStore("workspaceMessages", {
  state: () => ({
    agents: [] as WorkspaceAgentRow[],
    selectedAgentId: null as string | null,
    selectedThreadId: null as string | null,
    selectedThread: null as Thread | null,
    threads: [] as Thread[],
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
    interruptRequestedTurnId: null as string | null,
    interruptRequestedAt: null as number | null,
    interruptRetryCount: 0,
    initialized: false,
    threadByAgentId: {} as Record<string, string | null>,
    threadIdsByAgentId: {} as Record<string, string[]>,
    modelLabel: "" as string,
    contextWindow: null as number | null,
    autoCompactTokenLimit: null as number | null,
    selectedModelProvider: null as string | null,
    selectedTokenUsage: null as ThreadTokenUsage | null,
    tokenUsageByThreadId: {} as Record<string, ThreadTokenUsage>,
    collapsedItemExpandedByKey: {} as Record<string, boolean>,
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

      const previouslySelectedAgentId = this.selectedAgentId;
      const previouslyMappedSelectedThreadId = previouslySelectedAgentId
        ? (this.threadByAgentId[previouslySelectedAgentId] ?? null)
        : null;

      const settings = useSettingsStore();
      const [isolatedAgents, threads] = await Promise.all([
        client.listAgents(settings.cwd || undefined),
        client.listThreads(),
      ]);
      this.threads = threads;
      const reconstructedThreads = mapLatestThreadsByAgent(
        isolatedAgents,
        threads,
      );
      this.threadByAgentId = mergeThreadByAgentMapping(
        this.threadByAgentId,
        reconstructedThreads,
        isolatedAgents,
        threads,
      );
      if (
        previouslySelectedAgentId &&
        previouslyMappedSelectedThreadId &&
        !this.threadByAgentId[previouslySelectedAgentId]
      ) {
        this.threadByAgentId = {
          ...this.threadByAgentId,
          [previouslySelectedAgentId]: previouslyMappedSelectedThreadId,
        };
      }
      this.threadIdsByAgentId = mapThreadsByAgent(
        isolatedAgents,
        threads,
        this.threadIdsByAgentId,
        this.threadByAgentId,
      );
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
        } else if (!threadId) {
          const ensuredThreadId = await this.ensureSelectedThread();
          if (!ensuredThreadId) {
            this.selectedThreadId = null;
            this.selectedThread = null;
            this.resumedThreadId = null;
            this.selectedModelProvider = null;
            this.selectedTokenUsage = null;
            this.activeTurnId = null;
            this.liveTranscriptTurn = null;
            this.setTranscript(buildTranscript(null));
          }
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
          this.resumedThreadId = this.resumedThreadId ?? threadId;
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

    async selectThreadForSelectedAgent(threadId: string) {
      if (!threadId) {
        return;
      }

      this.selectedThreadId = threadId;
      if (this.selectedAgentId) {
        this.threadByAgentId = {
          ...this.threadByAgentId,
          [this.selectedAgentId]: threadId,
        };
        this.threadIdsByAgentId = prependThreadIdForAgent(
          this.threadIdsByAgentId,
          this.selectedAgentId,
          threadId,
        );
      }

      await this.loadThread(threadId);
      if (this.selectedAgentId && this.selectedThread) {
        this.updateAgentThread(
          this.selectedAgentId,
          this.selectedThread as Thread,
        );
      }
    },

    async ensureSelectedThread(): Promise<string | null> {
      const client = clientRef.client;
      const agentId = this.selectedAgentId;
      if (!client || !agentId) {
        return null;
      }

      const mappedThreadId = this.threadByAgentId[agentId] ?? null;
      if (mappedThreadId) {
        this.selectedThreadId = mappedThreadId;
        if (this.selectedThread?.id === mappedThreadId) {
          this.resumedThreadId = this.resumedThreadId ?? mappedThreadId;
          return mappedThreadId;
        }

        try {
          const thread = (await client.readThread(mappedThreadId)) as Thread;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (this as any).selectedThread = thread;
          this.resumedThreadId = thread.id;
          this.selectedModelProvider = thread.modelProvider ?? null;
          this.selectedTokenUsage =
            this.tokenUsageByThreadId[thread.id] ?? null;
          this.activeTurnId = findActiveTurnId(thread);
          // @ts-ignore Pinia deep type recursion with complex protocol types
          this.liveTranscriptTurn = buildLiveTranscriptTurn(
            thread,
            this.activeTurnId,
          );
          this.setTranscript(buildTranscript(thread));
          return mappedThreadId;
        } catch (error) {
          if (isStaleThreadError(error)) {
            try {
              const thread = (await client.readThread(
                mappedThreadId,
                false,
              )) as Thread;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (this as any).selectedThread = thread;
              this.resumedThreadId = thread.id;
              this.selectedModelProvider = thread.modelProvider ?? null;
              this.selectedTokenUsage =
                this.tokenUsageByThreadId[thread.id] ?? null;
              this.activeTurnId = findActiveTurnId(thread);
              // @ts-ignore Pinia deep type recursion with complex protocol types
              this.liveTranscriptTurn = buildLiveTranscriptTurn(
                thread,
                this.activeTurnId,
              );
              this.setTranscript(buildTranscript(thread));
              return mappedThreadId;
            } catch {
              // Continue with stale-thread fallback below.
            }
          }

          this.threadIdsByAgentId = removeThreadIdForAgent(
            this.threadIdsByAgentId,
            agentId,
            mappedThreadId,
          );
          this.threadByAgentId = {
            ...this.threadByAgentId,
            [agentId]: null,
          };
          this.selectedThreadId = null;
          this.selectedThread = null;
          this.resumedThreadId = null;
        }
      }

      const thread = await client.startThreadForAgent(agentId);
      this.threadByAgentId = {
        ...this.threadByAgentId,
        [agentId]: thread.id,
      };
      this.threadIdsByAgentId = prependThreadIdForAgent(
        this.threadIdsByAgentId,
        agentId,
        thread.id,
      );
      this.selectedThreadId = thread.id;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).selectedThread = thread;
      this.resumedThreadId = thread.id;
      this.selectedModelProvider = thread.modelProvider || null;
      this.selectedTokenUsage = null;
      this.activeTurnId = findActiveTurnId(thread);
      this.updateAgentThread(agentId, thread);
      return thread.id;
    },

    async startFreshThreadForSelectedAgent(): Promise<string | null> {
      const client = clientRef.client;
      const agentId = this.selectedAgentId;
      if (!client || !agentId) {
        return null;
      }

      const thread = await client.startThreadForAgent(agentId);
      this.threadByAgentId = {
        ...this.threadByAgentId,
        [agentId]: thread.id,
      };
      this.threadIdsByAgentId = prependThreadIdForAgent(
        this.threadIdsByAgentId,
        agentId,
        thread.id,
      );
      this.selectedThreadId = thread.id;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).selectedThread = thread;
      this.resumedThreadId = thread.id;
      this.selectedModelProvider = thread.modelProvider || null;
      this.selectedTokenUsage = null;
      this.activeTurnId = findActiveTurnId(thread);
      // @ts-ignore Pinia deep type recursion with complex protocol types
      this.liveTranscriptTurn = buildLiveTranscriptTurn(
        thread,
        this.activeTurnId,
      );
      this.setTranscript(buildTranscript(thread));
      this.updateAgentThread(agentId, thread);
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

        let threadId = await this.ensureSelectedThread();
        if (!threadId) {
          return;
        }

        if (
          this.resumedThreadId !== threadId &&
          this.selectedThread?.id !== threadId
        ) {
          try {
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
          } catch (error) {
            if (isStaleThreadError(error)) {
              if (this.selectedAgentId) {
                this.threadIdsByAgentId = removeThreadIdForAgent(
                  this.threadIdsByAgentId,
                  this.selectedAgentId,
                  threadId,
                );
              }
              const freshThreadId =
                await this.startFreshThreadForSelectedAgent();
              if (!freshThreadId) {
                throw error;
              }
              threadId = freshThreadId;
              this.setStatus(
                "Previous thread is no longer available. Sent your message in a fresh chat.",
                "warning",
              );
            } else {
              throw error;
            }
          }
        }

        let turn;
        try {
          turn = await client.startTurn(
            threadId,
            message,
            this.runtimeSettings(),
          );
        } catch (error) {
          if (isStaleThreadError(error)) {
            if (this.selectedAgentId) {
              this.threadIdsByAgentId = removeThreadIdForAgent(
                this.threadIdsByAgentId,
                this.selectedAgentId,
                threadId,
              );
            }
            const freshThreadId = await this.startFreshThreadForSelectedAgent();
            if (!freshThreadId) {
              throw error;
            }
            threadId = freshThreadId;
            turn = await client.startTurn(
              threadId,
              message,
              this.runtimeSettings(),
            );
            this.setStatus(
              "Previous thread is no longer available. Sent your message in a fresh chat.",
              "warning",
            );
          } else {
            throw error;
          }
        }
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
        this.statusMessage = threadActivityMessage(
          this.selectedThread,
          this.activeTurnId,
        );
        this.statusTone = this.statusMessage ? "info" : null;
        this.refreshActiveTurnReconcileLoop();
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

      clearInterruptReconcileTimer();

      const threadId = this.selectedThreadId;
      const turnId = this.activeTurnId;
      this.interruptRequestedTurnId = turnId;
      this.interruptRequestedAt = Date.now();
      this.interruptRetryCount = 1;
      this.setStatus("Interrupting...", "warning");

      interruptReconcileTimer = setTimeout(async () => {
        interruptReconcileTimer = null;
        if (
          this.interruptRequestedTurnId !== turnId ||
          this.activeTurnId !== turnId ||
          this.selectedThreadId !== threadId
        ) {
          return;
        }

        const connectedClient = clientRef.client;
        if (!connectedClient) {
          return;
        }

        try {
          const thread = (await connectedClient.readThread(threadId)) as Thread;
          if (this.selectedThreadId !== threadId) {
            return;
          }

          const reconciledTurn = thread.turns.find(
            (turn) => turn.id === turnId,
          );
          if (!reconciledTurn || reconciledTurn.status === "inProgress") {
            return;
          }

          if (
            this.pendingUserDraft &&
            reconciledTurn.status === "interrupted"
          ) {
            this.restoredDraft = this.pendingUserDraft;
            this.restoredDraftVersion += 1;
          }

          this.pendingUserDraft = null;
          this.activeTurnId = findActiveTurnId(thread);
          this.interruptRequestedTurnId = null;
          this.interruptRequestedAt = null;
          this.interruptRetryCount = 0;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (this as any).selectedThread = thread;
          this.selectedTokenUsage = this.tokenUsageByThreadId[threadId] ?? null;
          // @ts-ignore Pinia deep type recursion with complex protocol types
          this.liveTranscriptTurn = buildLiveTranscriptTurn(
            this.selectedThread,
            this.activeTurnId,
          );
          this.setTranscript(buildTranscript(this.selectedThread));

          if (reconciledTurn.status === "interrupted") {
            this.setStatus("Interrupted", "warning");
            return;
          }

          if (reconciledTurn.status === "completed") {
            this.setStatus("Interrupt requested; turn completed", "warning");
            return;
          }

          this.setStatus(
            reconciledTurn.error?.message ?? "Turn failed",
            "error",
          );
        } catch {
          // If reconcile fails, keep waiting for stream notifications.
        }
      }, INTERRUPT_RECONCILE_DELAY_MS);

      void client.interruptTurn(threadId, turnId).catch((error) => {
        if (
          this.interruptRequestedTurnId !== turnId ||
          this.activeTurnId !== turnId ||
          this.selectedThreadId !== threadId
        ) {
          return;
        }

        clearInterruptReconcileTimer();
        this.interruptRequestedTurnId = null;
        this.interruptRequestedAt = null;
        this.interruptRetryCount = 0;
        this.setStatus(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      });
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
        this.resumedThreadId = this.selectedThread.id;
        this.selectedModelProvider = this.selectedThread?.modelProvider ?? null;
        this.selectedTokenUsage = this.tokenUsageByThreadId[threadId] ?? null;
        this.activeTurnId = findActiveTurnId(this.selectedThread);
        // @ts-ignore Pinia deep type recursion with complex protocol types
        this.liveTranscriptTurn = buildLiveTranscriptTurn(
          this.selectedThread,
          this.activeTurnId,
        );
        this.setTranscript(buildTranscript(this.selectedThread));
        this.statusMessage = threadActivityMessage(
          this.selectedThread,
          this.activeTurnId,
        );
        this.statusTone = this.statusMessage ? "info" : null;
      } catch (error) {
        if (isStaleThreadError(error)) {
          try {
            this.selectedThread = (await client.readThread(
              threadId,
              false,
            )) as Thread;
            this.resumedThreadId = this.selectedThread.id;
            this.selectedModelProvider =
              this.selectedThread?.modelProvider ?? null;
            this.selectedTokenUsage =
              this.tokenUsageByThreadId[threadId] ?? null;
            this.activeTurnId = findActiveTurnId(this.selectedThread);
            // @ts-ignore Pinia deep type recursion with complex protocol types
            this.liveTranscriptTurn = buildLiveTranscriptTurn(
              this.selectedThread,
              this.activeTurnId,
            );
            this.setTranscript(buildTranscript(this.selectedThread));
            this.statusMessage = threadActivityMessage(
              this.selectedThread,
              this.activeTurnId,
            );
            this.statusTone = this.statusMessage ? "info" : null;
            return;
          } catch {
            // Continue with stale-thread fallback below.
          }
        }

        if (this.selectedAgentId) {
          this.threadIdsByAgentId = removeThreadIdForAgent(
            this.threadIdsByAgentId,
            this.selectedAgentId,
            threadId,
          );
        }
        this.selectedThread = null;
        this.selectedModelProvider = null;
        this.selectedTokenUsage = null;
        this.activeTurnId = null;
        this.liveTranscriptTurn = null;
        this.setTranscript(buildTranscript(null));

        if (
          this.selectedAgentId &&
          this.threadByAgentId[this.selectedAgentId] === threadId &&
          isStaleThreadError(error)
        ) {
          const freshThreadId = await this.startFreshThreadForSelectedAgent();
          if (freshThreadId) {
            this.setStatus(
              "Previous thread is no longer available. Started a fresh chat.",
              "warning",
            );
            return;
          }
        }
        this.setStatus(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      } finally {
        this.refreshActiveTurnReconcileLoop();
        this.busy = false;
      }
    },

    async reconcileActiveTurnSnapshot() {
      const client = clientRef.client;
      const threadId = this.selectedThreadId;
      const trackedTurnId = this.activeTurnId;
      if (!client || !threadId) {
        return;
      }

      try {
        const thread = (await client.readThread(threadId)) as Thread;
        if (this.selectedThreadId !== threadId) {
          return;
        }

        const trackedTurn = trackedTurnId
          ? thread.turns.find((turn) => turn.id === trackedTurnId)
          : null;
        if (trackedTurn && trackedTurn.status !== "inProgress") {
          if (this.pendingUserDraft && trackedTurn.status === "interrupted") {
            this.restoredDraft = this.pendingUserDraft;
            this.restoredDraftVersion += 1;
          }
          this.pendingUserDraft = null;

          const interruptedRequested =
            this.interruptRequestedTurnId === trackedTurn.id;
          this.interruptRequestedTurnId = null;
          this.interruptRequestedAt = null;
          this.interruptRetryCount = 0;
          if (trackedTurn.status === "interrupted") {
            this.setStatus("Interrupted", "warning");
          } else if (
            interruptedRequested &&
            trackedTurn.status === "completed"
          ) {
            this.setStatus("Interrupt requested; turn completed", "warning");
          } else if (trackedTurn.status === "failed") {
            this.setStatus(
              trackedTurn.error?.message ?? "Turn failed",
              "error",
            );
          } else {
            this.statusMessage = null;
            this.statusTone = null;
          }
        }

        const snapshotActiveTurnId = findActiveTurnId(thread);
        this.activeTurnId = snapshotActiveTurnId;
        if (
          this.interruptRequestedTurnId &&
          snapshotActiveTurnId === this.interruptRequestedTurnId &&
          this.interruptRequestedAt !== null &&
          this.interruptRetryCount < INTERRUPT_MAX_RETRIES
        ) {
          const elapsed = Date.now() - this.interruptRequestedAt;
          const retryDueAt =
            this.interruptRetryCount * INTERRUPT_RETRY_INTERVAL_MS;
          if (elapsed >= retryDueAt) {
            this.interruptRetryCount += 1;
            void client.interruptTurn(threadId, this.interruptRequestedTurnId);
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).selectedThread = thread;
        this.selectedTokenUsage = this.tokenUsageByThreadId[threadId] ?? null;
        this.setTranscript(buildTranscript(thread));
        if (
          snapshotActiveTurnId &&
          this.interruptRequestedTurnId !== snapshotActiveTurnId &&
          !this.pendingRequest &&
          !this.pendingUserDraft
        ) {
          this.setStatus(
            threadActivityMessage(thread, snapshotActiveTurnId),
            "info",
          );
        }
      } catch {
        // Keep waiting for streamed notifications; this is best-effort fallback.
      }
    },

    refreshActiveTurnReconcileLoop() {
      clearActiveTurnReconcileTimer();
      const shouldTrack =
        !!this.activeTurnId ||
        !!this.pendingUserDraft ||
        !!this.interruptRequestedTurnId ||
        this.statusMessage === "Working" ||
        this.statusMessage === "Interrupting...";
      if (!this.selectedThreadId || !shouldTrack) {
        return;
      }

      activeTurnReconcileTimer = setTimeout(async () => {
        await this.reconcileActiveTurnSnapshot();
        this.refreshActiveTurnReconcileLoop();
      }, ACTIVE_TURN_RECONCILE_INTERVAL_MS);
    },

    handleNotification(notification: CodexNotification) {
      const selectedThreadId = this.selectedThreadId ?? this.selectedThread?.id;

      if (
        notification.method === "thread/tokenUsage/updated" &&
        notification.params.threadId
      ) {
        this.tokenUsageByThreadId = {
          ...this.tokenUsageByThreadId,
          [notification.params.threadId]: notification.params.tokenUsage,
        };
        if (notification.params.threadId === this.selectedThreadId) {
          this.selectedTokenUsage = notification.params.tokenUsage;
        }
        this.contextWindow = notification.params.tokenUsage.modelContextWindow;
      }

      try {
        if (
          selectedThreadId &&
          notificationTargetsSelectedThread(notification, selectedThreadId)
        ) {
          const turnId = notificationTurnId(notification);
          if (turnId && !transcriptHasTurn(this.transcript, turnId)) {
            this.setTranscript(
              applyNotification(this.transcript, {
                method: "turn/started",
                params: {
                  threadId: selectedThreadId,
                  turn: {
                    id: turnId,
                    status: "inProgress",
                    error: null,
                    items: [],
                  },
                },
              } as unknown as CodexNotification),
            );
          }

          if (
            turnId &&
            !this.activeTurnId &&
            notification.method !== "turn/completed" &&
            notification.method !== "turn/aborted"
          ) {
            this.activeTurnId = turnId;
            this.refreshTranscriptView();
          }
        }

        if (
          selectedThreadId &&
          (!("threadId" in notification.params) ||
            notification.params.threadId === selectedThreadId)
        ) {
          this.liveTranscriptTurn = applyLiveNotification(
            this.liveTranscriptTurn,
            notification,
          );
          this.setTranscript(applyNotification(this.transcript, notification));
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "failed to render update";
        this.setStatus(`Live update error: ${message}`, "warning");
      }

      if (notification.method === "turn/started") {
        clearInterruptReconcileTimer();
        this.activeTurnId = notification.params.turn.id;
        this.interruptRequestedTurnId = null;
        this.interruptRequestedAt = null;
        this.interruptRetryCount = 0;
        this.refreshTranscriptView();
        this.setStatus("Working", "info");
      }

      if (notification.method === "item/started") {
        if (this.interruptRequestedTurnId !== notification.params.turnId) {
          this.setStatus(describeStartedItem(notification.params.item), "info");
        }
      }

      if (notification.method === "error" && notification.params.willRetry) {
        this.setStatus(notification.params.error.message, "warning");
      }

      if (notification.method === "turn/aborted") {
        clearInterruptReconcileTimer();
        const isInterruptAbort = notification.params.reason === "interrupted";
        if (
          this.pendingUserDraft &&
          (isInterruptAbort || notification.params.reason === "reviewEnded")
        ) {
          this.restoredDraft = this.pendingUserDraft;
          this.restoredDraftVersion += 1;
        }
        this.pendingUserDraft = null;
        this.activeTurnId = null;
        this.interruptRequestedTurnId = null;
        this.interruptRequestedAt = null;
        this.interruptRetryCount = 0;
        this.refreshTranscriptView();
        if (isInterruptAbort) {
          this.setStatus("Interrupted", "warning");
        } else {
          this.statusMessage = null;
          this.statusTone = null;
        }
      }

      if (notification.method === "turn/completed") {
        clearInterruptReconcileTimer();
        const interruptedTurnCompleted =
          this.interruptRequestedTurnId === notification.params.turn.id;
        const interruptedStatus =
          notification.params.turn.status === "interrupted";
        this.busy = false;
        this.interruptRequestedTurnId = null;
        this.interruptRequestedAt = null;
        this.interruptRetryCount = 0;
        if (this.pendingUserDraft && interruptedStatus) {
          this.restoredDraft = this.pendingUserDraft;
          this.restoredDraftVersion += 1;
        }
        if (interruptedStatus) {
          this.setStatus("Interrupted", "warning");
        } else if (interruptedTurnCompleted) {
          this.setStatus("Interrupt requested; turn completed", "warning");
        } else {
          this.statusMessage = null;
          this.statusTone = null;
        }
        this.pendingUserDraft = null;
        if (notification.params.turn.id === this.activeTurnId) {
          this.activeTurnId = null;
          this.refreshTranscriptView();
        }
      }

      this.refreshActiveTurnReconcileLoop();
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
          if (this.selectedAgentId) {
            this.threadByAgentId = {
              ...this.threadByAgentId,
              [this.selectedAgentId]: null,
            };
          }
          this.selectedTokenUsage = null;
          this.activeTurnId = null;
          this.liveTranscriptTurn = null;
          this.setTranscript(buildTranscript(null));
          await this.startFreshThreadForSelectedAgent();
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
            this.threadIdsByAgentId = prependThreadIdForAgent(
              this.threadIdsByAgentId,
              this.selectedAgentId,
              thread.id,
            );
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
            const providers = Array.from(
              new Set(
                models
                  .map((entry) => {
                    const separator = entry.id.indexOf("/");
                    return separator > 0 ? entry.id.slice(0, separator) : null;
                  })
                  .filter((entry): entry is string => Boolean(entry)),
              ),
            );
            if (providers.includes(args)) {
              this.addLocalEvent(
                "Choose model",
                `Provider \"${args}\" selected. Continue with /model ${args}/<model>.`,
              );
              return true;
            }
            this.addLocalEvent(
              "Unknown model",
              `No model matches "${args}".`,
              "warning",
            );
            return true;
          }
          if (agentsStore.config) {
            agentsStore.config.model = model.id;
            const separator = model.id.indexOf("/");
            agentsStore.config.modelProvider =
              separator > 0 ? model.id.slice(0, separator) : "";
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
      this.liveTranscriptTurn = transcriptViewLiveTurn(
        view.liveTurn,
        this.liveTranscriptTurn,
      );
    },

    refreshTranscriptView() {
      const view = splitTranscriptView(this.transcript, this.activeTurnId);
      this.committedTranscript = view.committedTurns;
      this.liveTranscriptTurn = transcriptViewLiveTurn(
        view.liveTurn,
        this.liveTranscriptTurn,
      );
    },

    setStatus(
      message: string | null,
      tone: "info" | "warning" | "error" | null,
    ) {
      this.statusMessage = message;
      this.statusTone = tone;
    },

    setCollapsedItemExpanded(key: string, expanded: boolean) {
      this.collapsedItemExpandedByKey = {
        ...this.collapsedItemExpandedByKey,
        [key]: expanded,
      };
    },

    mergeCollapsedItemExpanded(updates: Record<string, boolean>) {
      this.collapsedItemExpandedByKey = {
        ...this.collapsedItemExpandedByKey,
        ...updates,
      };
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
              return [item.label, item.output ?? item.error ?? item.input ?? ""]
                .filter(Boolean)
                .join("\n");
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
      const selectedAgentWorkspace = this.agents.find(
        (agent) => agent.id === this.selectedAgentId,
      )?.workspace;

      return {
        cwd: selectedAgentWorkspace || settings.cwd || "",
        model: agentConfig?.model || null,
        modelProvider: agentConfig?.modelProvider || null,
        personality: settings.personality || "friendly",
        approvalPolicy: normalizeApprovalPolicy(agentConfig?.approvalPolicy),
        sandboxMode: agentConfig?.sandboxMode || "workspace-write",
      };
    },
  },

  persist: {
    pick: [
      "threadByAgentId",
      "threadIdsByAgentId",
      "tokenUsageByThreadId",
      "collapsedItemExpandedByKey",
    ],
  },
});

function mergeThreadByAgentMapping(
  current: Record<string, string | null>,
  reconstructed: Record<string, string | null>,
  agents: AgentInfo[],
  threads: Thread[],
): Record<string, string | null> {
  const knownThreadIds = new Set(threads.map((thread) => thread.id));
  const merged: Record<string, string | null> = {};
  for (const agent of agents) {
    const currentThreadId = current[agent.id] ?? null;
    if (currentThreadId && knownThreadIds.has(currentThreadId)) {
      merged[agent.id] = currentThreadId;
      continue;
    }

    const reconstructedThreadId = reconstructed[agent.id] ?? null;
    if (reconstructedThreadId) {
      merged[agent.id] = reconstructedThreadId;
      continue;
    }

    merged[agent.id] = null;
  }
  return merged;
}

function buildWorkspaceAgentRow(
  agent: AgentInfo,
  threadId: string | null,
  current?: WorkspaceAgentRow,
  latestThread?: Thread | null,
): WorkspaceAgentRow {
  return {
    id: agent.id,
    name: agent.name || agent.id,
    color: agent.color ?? null,
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

function mapThreadsByAgent(
  agents: AgentInfo[],
  threads: Thread[],
  currentThreadLists: Record<string, string[]>,
  currentMapping: Record<string, string | null>,
): Record<string, string[]> {
  const mapping: Record<string, string[]> = {};

  for (const agent of agents) {
    const matched = threads
      .filter((thread) => threadMatchesAgent(thread, agent))
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((thread) => thread.id);

    const existing = currentThreadLists[agent.id] ?? [];

    const mappedThreadId = currentMapping[agent.id] ?? null;
    if (mappedThreadId) {
      mapping[agent.id] = [
        mappedThreadId,
        ...matched.filter((id) => id !== mappedThreadId),
        ...existing.filter(
          (id) => id !== mappedThreadId && !matched.includes(id),
        ),
      ];
      continue;
    }

    mapping[agent.id] = [
      ...matched,
      ...existing.filter((id) => !matched.includes(id)),
    ];
  }

  return mapping;
}

function prependThreadIdForAgent(
  mapping: Record<string, string[]>,
  agentId: string,
  threadId: string,
): Record<string, string[]> {
  const existing = mapping[agentId] ?? [];
  if (existing[0] === threadId) {
    return mapping;
  }

  return {
    ...mapping,
    [agentId]: [threadId, ...existing.filter((id) => id !== threadId)],
  };
}

function removeThreadIdForAgent(
  mapping: Record<string, string[]>,
  agentId: string,
  threadId: string,
): Record<string, string[]> {
  const existing = mapping[agentId] ?? [];
  if (!existing.includes(threadId)) {
    return mapping;
  }

  return {
    ...mapping,
    [agentId]: existing.filter((id) => id !== threadId),
  };
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

function threadActivityMessage(
  thread: Thread | null,
  activeTurnId: string | null,
): string | null {
  if (!thread) {
    return null;
  }

  if (activeTurnId) {
    return "Working";
  }

  return thread.status.type === "active" ? "Working" : null;
}

function transcriptHasTurn(turns: TranscriptTurn[], turnId: string): boolean {
  return turns.some((turn) => turn.id === turnId);
}

function notificationTargetsSelectedThread(
  notification: CodexNotification,
  selectedThreadId: string,
): boolean {
  return (
    !("threadId" in notification.params) ||
    notification.params.threadId === selectedThreadId
  );
}

function notificationTurnId(notification: CodexNotification): string | null {
  switch (notification.method) {
    case "turn/started":
      return notification.params.turn.id;
    case "turn/completed":
      return notification.params.turn.id;
    case "turn/aborted":
      return notification.params.turnId;
    case "item/started":
    case "item/completed":
    case "item/agentMessage/delta":
    case "item/plan/delta":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/summaryPartAdded":
    case "item/reasoning/textDelta":
    case "item/commandExecution/outputDelta":
    case "item/commandExecution/terminalInteraction":
    case "item/fileChange/outputDelta":
    case "turn/plan/updated":
    case "turn/diff/updated":
    case "error":
      return notification.params.turnId;
    case "thread/tokenUsage/updated":
    case "thread/started":
      return null;
  }
}

function transcriptViewLiveTurn(
  liveTurn: TranscriptTurn | null,
  current: LiveTranscriptTurn | null,
): LiveTranscriptTurn | null {
  if (!liveTurn) {
    return null;
  }

  return {
    id: liveTurn.id,
    status: liveTurn.status,
    error: liveTurn.error,
    events: current?.id === liveTurn.id ? current.events : [],
    items: liveTurn.items,
  };
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

function isMissingRolloutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("no rollout found for thread id");
}

function isThreadNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("thread not found:");
}

function isThreadNotMaterializedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .toLowerCase()
    .includes("is not materialized yet; includeturns is unavailable");
}

function isStaleThreadError(error: unknown): boolean {
  return (
    isMissingRolloutError(error) ||
    isThreadNotMaterializedError(error) ||
    isThreadNotFoundError(error)
  );
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
