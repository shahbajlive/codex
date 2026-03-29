import { defineStore } from "pinia";
import type {
  ApprovalPolicy,
  CodexNotification,
  Model,
  Thread,
  ThreadPendingInputItem,
  ThreadTokenUsage,
  ThreadTurnQueueItem,
} from "../lib/protocol";
import {
  applyLiveHistoryNotification,
  applyHistoryNotification,
  attachTurn,
  buildHistory,
  buildLiveHistoryTurn,
  splitHistoryView,
  type HistoryTurn,
  type LiveHistoryTurn,
} from "../lib/history";
import {
  type LiveTranscriptTurn,
  type TranscriptTurn,
} from "../lib/transcript";
import { formatTokenCount } from "../lib/format";
import { type WorkspacePendingRequest, useCommandsStore } from "./commands";
import { useCodexStore } from "./codex";
import { useSettingsStore } from "./settings";
import { useAgentsStore, clientRef, setAgentsClient } from "./agents";

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

export type WorkspaceQueuedMessage = {
  id: string;
  text: string;
};

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

function resolveModelContextWindow(
  models: Model[],
  modelId: string,
): number | null {
  if (!modelId) {
    return null;
  }

  const model = models.find((candidate) => candidate.id === modelId);
  if (!model || model.contextWindow === null) {
    return null;
  }

  return Math.floor(
    (model.contextWindow * model.effectiveContextWindowPercent) / 100,
  );
}

export const useChatStore = defineStore("chat", {
  state: () => ({
    selectedThreadId: null as string | null,
    agentThreads: [] as Thread[],
    history: buildHistory(null),
    liveHistoryTurn: null as LiveHistoryTurn | null,
    pendingRequest: null as WorkspacePendingRequest | null,
    busy: false,
    statusMessage: null as string | null,
    statusTone: null as "info" | "warning" | "error" | null,
    activeTurnId: null as string | null,
    pendingUserDraft: null as string | null,
    pendingInputByThreadId: {} as Record<string, ThreadPendingInputItem[]>,
    turnQueueByThreadId: {} as Record<string, ThreadTurnQueueItem[]>,
    restoredDraft: null as string | null,
    restoredDraftVersion: 0,
    attachedThreadId: null as string | null,
    interruptRequestedTurnId: null as string | null,
    interruptRequestedAt: null as number | null,
    interruptRetryCount: 0,
    initialized: false,
    modelLabel: "" as string,
    contextWindow: null as number | null,
    autoCompactTokenLimit: null as number | null,
    selectedModelProvider: null as string | null,
    tokenUsageByThreadId: {} as Record<string, ThreadTokenUsage>,
    collapsedItemExpandedByKey: {} as Record<string, boolean | string>,
    transcriptPinnedToLatest: true,
  }),

  getters: {
    transcript(state): TranscriptTurn[] {
      return state.history;
    },

    committedTranscript(state): TranscriptTurn[] {
      return splitHistoryView(state.history, state.activeTurnId).committedTurns;
    },

    liveTranscriptTurn(state): LiveTranscriptTurn | null {
      return historyViewLiveTurn(
        splitHistoryView(state.history, state.activeTurnId).liveTurn,
        state.liveHistoryTurn,
      );
    },

    selectedTokenUsage(state): ThreadTokenUsage | null {
      if (!state.selectedThreadId) {
        return null;
      }

      return state.tokenUsageByThreadId[state.selectedThreadId] ?? null;
    },

    composerModelUsageLine(): string {
      const modelName = this.modelLabel || "default";
      const capacity =
        this.selectedTokenUsage?.modelContextWindow ?? this.contextWindow;
      if (capacity === null) {
        return modelName;
      }

      const consumed = formatTokenCount(
        this.selectedTokenUsage?.total.totalTokens ?? 0,
      );
      return `${modelName} · ${consumed}/${formatTokenCount(capacity)}`;
    },

    queuedMessages(state): WorkspaceQueuedMessage[] {
      if (!state.selectedThreadId) {
        return [];
      }

      const pendingInput =
        state.pendingInputByThreadId[state.selectedThreadId] ?? [];
      const turnQueue = state.turnQueueByThreadId[state.selectedThreadId] ?? [];

      const messages: WorkspaceQueuedMessage[] = [];

      // Add pending input messages (steer)
      messages.push(
        ...pendingInput.map((item) => ({
          id: `pending-${item.index}`,
          text: item.text,
        })),
      );

      // Add turn queue messages (queued user inputs)
      messages.push(
        ...turnQueue.map((item) => ({
          id: `queue-${item.index}`,
          text: item.text,
        })),
      );

      return messages;
    },

    turnQueue(state): ThreadTurnQueueItem[] {
      if (!state.selectedThreadId) {
        return [];
      }
      return state.turnQueueByThreadId[state.selectedThreadId] ?? [];
    },
  },

  actions: {
    getSelectedThread(state: {
      agentThreads: Thread[];
      selectedThreadId: string | null;
    }): Thread | null {
      if (!state.selectedThreadId) {
        return null;
      }

      return (
        state.agentThreads.find(
          (thread) => thread.id === state.selectedThreadId,
        ) ?? null
      );
    },

    getSelectedAgentId(): string | null {
      return useAgentsStore().selectedAgentId;
    },

    getSelectedAgentName(): string {
      const agentsStore = useAgentsStore();
      const selectedId = agentsStore.selectedAgentId;
      return (
        agentsStore.agents.find((agent) => agent.id === selectedId)?.name ||
        selectedId ||
        "none"
      );
    },

    replaceThread(thread: Thread) {
      const nextThreads: Thread[] = [thread];
      for (const candidate of this.agentThreads as Thread[]) {
        if (candidate.id !== thread.id) {
          nextThreads.push(candidate);
        }
      }
      nextThreads.sort((left, right) => right.updatedAt - left.updatedAt);
      // @ts-ignore Pinia deep type recursion with complex protocol types
      this.agentThreads = nextThreads;
    },

    removeThread(threadId: string) {
      const remainingThreads: Thread[] = [];
      for (const thread of this.agentThreads as Thread[]) {
        if (thread.id !== threadId) {
          remainingThreads.push(thread);
        }
      }
      this.agentThreads = remainingThreads;
      if (this.pendingInputByThreadId[threadId]) {
        const next = { ...this.pendingInputByThreadId };
        delete next[threadId];
        this.pendingInputByThreadId = next;
      }
    },

    setPendingInputSnapshot(
      threadId: string,
      pendingInput: ThreadPendingInputItem[],
    ) {
      this.pendingInputByThreadId = {
        ...this.pendingInputByThreadId,
        [threadId]: pendingInput,
      };
    },

    setTurnQueueSnapshot(threadId: string, queue: ThreadTurnQueueItem[]) {
      this.turnQueueByThreadId = {
        ...this.turnQueueByThreadId,
        [threadId]: queue,
      };
    },

    applyThreadSnapshot(thread: Thread, attach = true) {
      this.replaceThread(thread);
      if (attach) {
        this.attachedThreadId = thread.id;
      }
      this.selectedModelProvider = thread.modelProvider ?? null;
      this.activeTurnId = this.findActiveTurnId(thread);
      // @ts-ignore Pinia deep type recursion with complex protocol types
      this.liveHistoryTurn = buildLiveHistoryTurn(thread, this.activeTurnId);
      this.setHistory(buildHistory(thread));
    },

    applyThreadTokenUsage(
      threadId: string,
      tokenUsage: ThreadTokenUsage | null,
    ) {
      if (!tokenUsage) {
        return;
      }

      this.tokenUsageByThreadId = {
        ...this.tokenUsageByThreadId,
        [threadId]: tokenUsage,
      };
    },

    findAgents(query: string) {
      const agentsStore = useAgentsStore();
      const normalized = query.trim().toLowerCase();
      return agentsStore.agents.filter((agent) => {
        const haystack =
          `${agent.id} ${agent.name} ${agent.description}`.toLowerCase();
        return haystack.includes(normalized);
      });
    },

    latestAssistantText(transcript?: TranscriptTurn[]) {
      const source = transcript ?? this.transcript;
      for (let ti = source.length - 1; ti >= 0; ti -= 1) {
        const turn = source[ti];
        if (!turn) continue;
        for (let ii = turn.items.length - 1; ii >= 0; ii -= 1) {
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
      const agentsStore = useAgentsStore();
      const agentConfig = agentsStore.config;
      const selectedAgentWorkspace = agentsStore.agents.find(
        (agent) => agent.id === agentsStore.selectedAgentId,
      )?.workspace;

      return {
        cwd: selectedAgentWorkspace || settings.cwd || "",
        model: agentConfig?.model || null,
        modelProvider: agentConfig?.modelProvider || null,
        personality: settings.personality || "friendly",
        approvalPolicy: this.normalizeApprovalPolicy(
          agentConfig?.approvalPolicy,
        ),
        sandboxMode: agentConfig?.sandboxMode || "workspace-write",
      };
    },

    sortThreadsByUpdatedAt(threads: Thread[]): Thread[] {
      return [...threads].sort(
        (left, right) => right.updatedAt - left.updatedAt,
      );
    },

    getSelectedAgentPublicThreadId(agentId: string | null): string | null {
      if (!agentId) {
        return null;
      }

      return (
        useAgentsStore().contactsList.find((contact) => contact.id === agentId)
          ?.publicThreadId ?? null
      );
    },

    findActiveTurnId(thread: Thread | null): string | null {
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
    },

    threadActivityMessage(
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
    },

    transcriptHasTurn(turns: TranscriptTurn[], turnId: string): boolean {
      return turns.some((turn) => turn.id === turnId);
    },

    notificationTargetsSelectedThread(
      notification: CodexNotification,
      selectedThreadId: string,
    ): boolean {
      return (
        !("threadId" in notification.params) ||
        notification.params.threadId === selectedThreadId
      );
    },

    notificationTurnId(notification: CodexNotification): string | null {
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
        case "thread/pendingInput/updated":
          return null;
      }
    },

    normalizeApprovalPolicy(value: unknown): ApprovalPolicy {
      if (
        value === "untrusted" ||
        value === "on-failure" ||
        value === "on-request" ||
        value === "never"
      ) {
        return value;
      }
      return "on-request";
    },

    isStaleThreadError(error: unknown): boolean {
      const message = error instanceof Error ? error.message : String(error);
      const normalized = message.toLowerCase();
      return (
        normalized.includes("no rollout found for thread id") ||
        normalized.includes(
          "is not materialized yet; includeturns is unavailable",
        ) ||
        normalized.includes("thread not found:")
      );
    },

    clearSelectedThreadState() {
      this.selectedThreadId = null;
      this.attachedThreadId = null;
      this.selectedModelProvider = null;
      this.activeTurnId = null;
      this.liveHistoryTurn = null;
      this.transcriptPinnedToLatest = true;
      this.setHistory(buildHistory(null));
    },

    async initialize() {
      const client = clientRef.client;
      if (!client || this.initialized) {
        return;
      }

      this.initialized = true;
      this.registerRequestHandlers();
      client.onNotification((notification) =>
        this.handleNotification(notification),
      );
      await this.refreshRuntimeMetadata();
      await this.refreshSelectedAgentThreads();
    },

    async refreshRuntimeMetadata() {
      const client = clientRef.client;
      const settings = useSettingsStore();
      const codexStore = useCodexStore();
      const agentsStore = useAgentsStore();
      const agentModel = agentsStore.config?.model || settings.model || "";
      this.modelLabel = agentModel || "default";
      this.contextWindow = resolveModelContextWindow(
        codexStore.models,
        agentModel,
      );
      if (!client) {
        return;
      }

      try {
        const response = await client.readConfig(settings.cwd || undefined);
        const resolvedModel =
          agentsStore.config?.model ||
          settings.model ||
          response.config.model ||
          "";
        const agentProvider = agentsStore.config?.modelProvider || "";
        this.modelLabel = resolvedModel || "default";
        this.contextWindow =
          resolveModelContextWindow(codexStore.models, resolvedModel) ??
          toNumber(response.config.model_context_window);
        this.selectedModelProvider =
          agentProvider ||
          (resolvedModel.includes("/")
            ? resolvedModel.slice(0, resolvedModel.indexOf("/"))
            : null) ||
          response.config.model_provider ||
          null;
        this.autoCompactTokenLimit = toNumber(
          response.config.model_auto_compact_token_limit,
        );
      } catch {
        this.contextWindow = null;
        this.autoCompactTokenLimit = null;
      }
    },

    async refreshSelectedAgentThreads() {
      const client = clientRef.client;
      const agentsStore = useAgentsStore();
      const agentId = agentsStore.selectedAgentId;
      if (!client || !agentId) {
        return;
      }

      const publicThreadId = this.getSelectedAgentPublicThreadId(agentId);
      const threadList = await client.listAgentThreads(agentId);
      const threads = this.sortThreadsByUpdatedAt(threadList);
      this.agentThreads = threads;

      const existingThreadId = this.selectedThreadId;
      const resolvedThreadId =
        (existingThreadId &&
        threads.some((thread) => thread.id === existingThreadId)
          ? existingThreadId
          : null) ??
        (publicThreadId &&
        threads.some((thread) => thread.id === publicThreadId)
          ? publicThreadId
          : null) ??
        threads[0]?.id ??
        null;

      const hasLoadedResolvedThread =
        this.attachedThreadId === resolvedThreadId;

      this.selectedThreadId = resolvedThreadId;
      if (!resolvedThreadId) {
        this.clearSelectedThreadState();
        return;
      }

      if (hasLoadedResolvedThread) {
        return;
      }

      await this.loadThread(resolvedThreadId);
    },

    async selectThreadForSelectedAgent(threadId: string) {
      if (!threadId) {
        return;
      }

      this.selectedThreadId = threadId;
      await this.loadThread(threadId);
      if (this.selectedThreadId !== threadId) {
        return;
      }
      await this.attachThread(threadId);
    },

    async ensureSelectedThread(): Promise<string | null> {
      const client = clientRef.client;
      const agentId = this.getSelectedAgentId();
      if (!client || !agentId) {
        return null;
      }

      const publicThreadId = this.getSelectedAgentPublicThreadId(agentId);
      const existingThreadId =
        (this.selectedThreadId &&
        this.agentThreads.some((thread) => thread.id === this.selectedThreadId)
          ? this.selectedThreadId
          : null) ??
        (publicThreadId &&
        this.agentThreads.some((thread) => thread.id === publicThreadId)
          ? publicThreadId
          : null) ??
        this.agentThreads[0]?.id ??
        null;

      if (existingThreadId) {
        this.selectedThreadId = existingThreadId;
        if (this.attachedThreadId === existingThreadId) {
          return existingThreadId;
        }

        await this.loadThread(existingThreadId);
        if (this.selectedThreadId !== existingThreadId) {
          return this.selectedThreadId;
        }
        await this.attachThread(existingThreadId);
        return this.selectedThreadId;
      }

      const thread = await client.startThreadForAgent(agentId);
      this.selectedThreadId = thread.id;
      this.applyThreadSnapshot(thread);
      return thread.id;
    },

    async startFreshThreadForSelectedAgent(): Promise<string | null> {
      const client = clientRef.client;
      const agentId = this.getSelectedAgentId();
      if (!client || !agentId) {
        return null;
      }

      const thread = await client.startThreadForAgent(agentId);
      this.selectedThreadId = thread.id;
      this.applyThreadSnapshot(thread);
      return thread.id;
    },

    async attachThread(threadId: string): Promise<string> {
      const client = clientRef.client;
      if (!client) {
        throw new Error("Client not connected");
      }

      if (this.attachedThreadId === threadId) {
        return threadId;
      }

      try {
        const response = await client.resumeThreadSnapshot(
          threadId,
          this.runtimeSettings(),
        );
        this.applyThreadTokenUsage(threadId, response.tokenUsage);
        this.applyThreadSnapshot(response.thread);
        return threadId;
      } catch (error) {
        if (!this.isStaleThreadError(error)) {
          throw error;
        }

        this.removeThread(threadId);
        this.clearSelectedThreadState();
        throw error;
      }
    },

    async startTurnWithRecovery(
      threadId: string,
      message: string,
    ): Promise<{
      threadId: string;
      turn: Awaited<
        ReturnType<NonNullable<typeof clientRef.client>["startTurn"]>
      >;
    }> {
      const client = clientRef.client;
      if (!client) {
        throw new Error("Client not connected");
      }

      try {
        const turn = await client.startTurn(
          threadId,
          message,
          this.runtimeSettings(),
        );
        return { threadId, turn };
      } catch (error) {
        if (!this.isStaleThreadError(error)) {
          throw error;
        }

        this.removeThread(threadId);
        this.clearSelectedThreadState();
        throw error;
      }
    },

    async sendMessage(message: string): Promise<boolean> {
      const client = clientRef.client;
      if (!client || !this.getSelectedAgentId()) {
        return false;
      }

      const trimmed = message.trim();
      if (!trimmed) {
        return false;
      }

      try {
        const hadActiveTurn = this.activeTurnId !== null;
        this.busy = true;
        this.statusMessage = null;
        this.statusTone = null;
        if (await this.handleSlashCommand(trimmed)) {
          return true;
        }

        let threadId = await this.ensureSelectedThread();
        if (!threadId) {
          return false;
        }

        threadId = await this.attachThread(threadId);

        const started = await this.startTurnWithRecovery(threadId, message);
        threadId = started.threadId;
        const { turn } = started;

        this.activeTurnId = turn.id;
        this.pendingUserDraft = hadActiveTurn ? null : trimmed;
        this.replaceThread(
          attachTurn(this.getSelectedThread(this) as Thread, turn) as Thread,
        );
        // @ts-ignore Pinia deep type recursion with complex protocol types
        this.liveHistoryTurn = buildLiveHistoryTurn(
          this.getSelectedThread(this),
          this.activeTurnId,
        );
        this.setHistory(buildHistory(this.getSelectedThread(this)));
        this.statusMessage = this.threadActivityMessage(
          this.getSelectedThread(this),
          this.activeTurnId,
        );
        this.statusTone = this.statusMessage ? "info" : null;
        await this.refreshPendingInput(threadId);
        this.refreshActiveTurnReconcileLoop();
        return true;
      } catch (error) {
        this.setStatus(
          error instanceof Error ? error.message : String(error),
          "error",
        );
        return false;
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
          const response = await connectedClient.readThreadSnapshot(threadId);
          const thread = response.thread;
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
          this.activeTurnId = this.findActiveTurnId(thread);
          this.interruptRequestedTurnId = null;
          this.interruptRequestedAt = null;
          this.interruptRetryCount = 0;
          this.applyThreadTokenUsage(threadId, response.tokenUsage);
          this.replaceThread(thread);
          // @ts-ignore Pinia deep type recursion with complex protocol types
          this.liveHistoryTurn = buildLiveHistoryTurn(
            this.getSelectedThread(this),
            this.activeTurnId,
          );
          this.setHistory(buildHistory(this.getSelectedThread(this)));

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
        const response = await client.readThreadSnapshot(threadId);
        const thread = response.thread;
        this.applyThreadTokenUsage(threadId, response.tokenUsage);
        this.applyThreadSnapshot(thread, false);
        this.statusMessage = this.threadActivityMessage(
          thread,
          this.activeTurnId,
        );
        this.statusTone = this.statusMessage ? "info" : null;
        await this.refreshPendingInput(threadId);
      } catch (error) {
        if (this.isStaleThreadError(error)) {
          try {
            const response = await client.readThreadSnapshot(threadId, false);
            const thread = response.thread;
            this.applyThreadTokenUsage(threadId, response.tokenUsage);
            this.applyThreadSnapshot(thread, false);
            this.statusMessage = this.threadActivityMessage(
              thread,
              this.activeTurnId,
            );
            this.statusTone = this.statusMessage ? "info" : null;
            await this.refreshPendingInput(threadId);
            return;
          } catch {
            // Continue with stale-thread fallback below.
          }
        }

        this.removeThread(threadId);
        this.clearSelectedThreadState();
        this.setStatus(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      } finally {
        this.refreshActiveTurnReconcileLoop();
        this.busy = false;
      }
    },

    async refreshPendingInput(threadId: string) {
      const client = clientRef.client;
      if (!client) {
        return;
      }

      try {
        const response = await client.readThreadPendingInput(threadId);
        this.setPendingInputSnapshot(threadId, response.pendingInput);
      } catch {
        this.setPendingInputSnapshot(threadId, []);
      }
    },

    async deleteQueuedMessage(messageId: string) {
      const client = clientRef.client;
      const threadId = this.selectedThreadId;
      if (!client || !threadId) {
        return;
      }

      // Check if this is a pending input or turn queue message
      // messageId format: "pending-{index}" or "queue-{index}"
      const isPendingInput = messageId.startsWith("pending-");
      const isTurnQueue = messageId.startsWith("queue-");

      if (!isPendingInput && !isTurnQueue) {
        console.warn("Unknown messageId format:", messageId);
        return;
      }

      const index = Number.parseInt(messageId.split("-")[1], 10);
      if (!Number.isFinite(index)) {
        return;
      }

      try {
        if (isTurnQueue) {
          // Delete from turn queue
          const response = await client.deleteThreadTurnQueue(threadId, index);
          this.setTurnQueueSnapshot(threadId, response.queue);
        } else {
          // Delete from pending input
          const response = await client.deleteThreadPendingInput(
            threadId,
            index,
          );
          this.setPendingInputSnapshot(threadId, response.pendingInput);
        }
      } catch (error) {
        console.error("Failed to delete queued message:", error);
        if (isTurnQueue) {
          // Refresh turn queue on error
          const response = await client.readThreadTurnQueue(threadId);
          this.setTurnQueueSnapshot(threadId, response.queue);
        } else {
          await this.refreshPendingInput(threadId);
        }
      }
    },

    async steerQueuedMessage(messageId: string) {
      const client = clientRef.client;
      const threadId = this.selectedThreadId;
      if (!client || !threadId) {
        return;
      }

      // Parse messageId to determine source
      const isPendingInput = messageId.startsWith("pending-");
      const isTurnQueue = messageId.startsWith("queue-");

      if (!isPendingInput && !isTurnQueue) {
        console.warn("Unknown messageId format:", messageId);
        return;
      }

      const index = Number.parseInt(messageId.split("-")[1], 10);
      if (!Number.isFinite(index)) {
        return;
      }

      // Get the message text from the queue
      let messageText = "";
      if (isTurnQueue) {
        const queue = this.turnQueueByThreadId[threadId] || [];
        const item = queue.find((_, i) => i === index);
        messageText = item?.text || "";
      } else {
        const pending = this.pendingInputByThreadId[threadId] || [];
        const item = pending.find((_, i) => i === index);
        messageText = item?.text || "";
      }

      if (!messageText) {
        console.warn("No message text found for index:", index);
        return;
      }

      try {
        // Get the latest thread snapshot to get the current active turn ID
        // This handles the case where auto-continue started a new turn
        const snapshot = await client.readThreadSnapshot(threadId);
        const activeTurn = snapshot.thread.turns.find(
          (turn) => turn.status === "inProgress",
        );
        if (!activeTurn) {
          console.warn("No active turn to steer");
          return;
        }

        await client.steerThreadTurn(threadId, activeTurn.id, messageText);

        // Remove the message from queue after steering
        if (isTurnQueue) {
          const response = await client.deleteThreadTurnQueue(threadId, index);
          this.setTurnQueueSnapshot(threadId, response.queue);
        } else {
          const response = await client.deleteThreadPendingInput(
            threadId,
            index,
          );
          this.setPendingInputSnapshot(threadId, response.pendingInput);
        }
      } catch (error) {
        console.error("Failed to steer queued message:", error);
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
        const response = await client.readThreadSnapshot(threadId);
        const thread = response.thread;
        this.applyThreadTokenUsage(threadId, response.tokenUsage);
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

        const snapshotActiveTurnId = this.findActiveTurnId(thread);
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
        this.replaceThread(thread);
        this.setHistory(buildHistory(thread));
        if (
          snapshotActiveTurnId &&
          this.interruptRequestedTurnId !== snapshotActiveTurnId &&
          !this.pendingRequest &&
          !this.pendingUserDraft
        ) {
          this.setStatus(
            this.threadActivityMessage(thread, snapshotActiveTurnId),
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
      const selectedThreadId =
        this.selectedThreadId ?? this.getSelectedThread(this)?.id;

      if (
        notification.method === "thread/tokenUsage/updated" &&
        notification.params.threadId
      ) {
        this.tokenUsageByThreadId = {
          ...this.tokenUsageByThreadId,
          [notification.params.threadId]: notification.params.tokenUsage,
        };
      }

      if (notification.method === "thread/pendingInput/updated") {
        this.setPendingInputSnapshot(
          notification.params.threadId,
          notification.params.pendingInput,
        );
      }

      if (notification.method === "thread/turnQueue/updated") {
        this.setTurnQueueSnapshot(
          notification.params.threadId,
          notification.params.queue,
        );
      }

      try {
        if (
          selectedThreadId &&
          this.notificationTargetsSelectedThread(notification, selectedThreadId)
        ) {
          const turnId = this.notificationTurnId(notification);
          if (turnId && !this.transcriptHasTurn(this.transcript, turnId)) {
            this.setHistory(
              applyHistoryNotification(this.history, {
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
          this.liveHistoryTurn = applyLiveHistoryNotification(
            this.liveHistoryTurn,
            notification,
          );
          this.setHistory(applyHistoryNotification(this.history, notification));
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
        void this.refreshPendingInput(notification.params.threadId);
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
        void this.refreshPendingInput(notification.params.threadId);
      }

      this.refreshActiveTurnReconcileLoop();
    },

    registerRequestHandlers() {
      useCommandsStore().registerWorkspaceRequestHandlers(this);
    },

    async waitForPendingRequest(request: WorkspacePendingRequest) {
      return useCommandsStore().waitForPendingRequest(this, request);
    },

    async selectThreadForRequest(threadId: string) {
      this.selectedThreadId = threadId;
      await this.loadThread(threadId);
      if (this.selectedThreadId !== threadId) {
        return;
      }
      await this.attachThread(threadId);
    },

    resolvePendingRequest(response: unknown) {
      useCommandsStore().resolvePendingRequest(this, response);
    },

    rejectPendingRequest(message = "Request cancelled") {
      useCommandsStore().rejectPendingRequest(this, message);
    },

    async handleSlashCommand(message: string) {
      return useCommandsStore().handleWorkspaceSlashCommand(this, message);
    },

    addLocalEvent(
      label: string,
      detail: string,
      tone: "info" | "warning" | "error" = "info",
    ) {
      const turnId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const turn: HistoryTurn = {
        id: turnId,
        status: "completed",
        error: null,
        items: [{ id: `${turnId}-event`, kind: "event", label, detail, tone }],
      };
      this.setHistory([...this.history, turn]);
    },

    setHistory(turns: HistoryTurn[]) {
      this.history = turns;
      const view = splitHistoryView(turns, this.activeTurnId);
      this.liveHistoryTurn = historyViewLiveTurn(
        view.liveTurn,
        this.liveHistoryTurn,
      );
    },

    refreshTranscriptView() {
      const view = splitHistoryView(this.history, this.activeTurnId);
      this.liveHistoryTurn = historyViewLiveTurn(
        view.liveTurn,
        this.liveHistoryTurn,
      );
    },

    setStatus(
      message: string | null,
      tone: "info" | "warning" | "error" | null,
    ) {
      this.statusMessage = message;
      this.statusTone = tone;
    },

    setTranscriptPinnedToLatest(pinned: boolean) {
      this.transcriptPinnedToLatest = pinned;
    },

    setCollapsedItemExpanded(key: string, expanded: boolean | string) {
      this.collapsedItemExpandedByKey = {
        ...this.collapsedItemExpandedByKey,
        [key]: expanded,
      };
    },

    mergeCollapsedItemExpanded(updates: Record<string, boolean | string>) {
      this.collapsedItemExpandedByKey = {
        ...this.collapsedItemExpandedByKey,
        ...updates,
      };
    },
  },
});

function historyViewLiveTurn(
  liveTurn: HistoryTurn | null,
  current: LiveHistoryTurn | null,
): LiveHistoryTurn | null {
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

function toNumber(value: bigint | number | null | undefined) {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  return null;
}
