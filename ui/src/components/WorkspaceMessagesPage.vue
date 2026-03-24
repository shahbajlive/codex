<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import type { Model, Thread, ThreadTokenUsage } from "../lib/protocol";
import { slashCommands } from "../lib/slash-commands";
import {
  liveTranscriptItemStatus,
  liveTranscriptItemTitle,
  liveTurnStatusLabel,
  renderTranscriptItem,
  transcriptTurnStatusLabel,
  transcriptTurnTone,
  transcriptItemTitle,
  type LiveTranscriptItem,
  type LiveTranscriptTurn,
  type TranscriptItem,
  type TranscriptTurn,
} from "../lib/transcript";
import { formatTime, truncate } from "../lib/format";
import type {
  WorkspaceAgentRow,
  WorkspacePendingRequest,
} from "../stores/chat/workspace-messages";

const props = defineProps<{
  autoCompactTokenLimit: number | null;
  loading: boolean;
  connected: boolean;
  contextWindow: number | null;
  agents: WorkspaceAgentRow[];
  modelLabel: string;
  models: Model[];
  modelProviders: string[];
  pendingRequest: WorkspacePendingRequest | null;
  restoredDraft: string | null;
  restoredDraftVersion: number;
  statusMessage: string | null;
  statusTone: "info" | "warning" | "error" | null;
  activeTurnId: string | null;
  committedTranscript: TranscriptTurn[];
  liveTranscriptTurn: LiveTranscriptTurn | null;
  selectedAgentId: string | null;
  selectedModelProvider: string | null;
  selectedAgentThreadIds: string[];
  selectedThreadId: string | null;
  selectedTokenUsage: ThreadTokenUsage | null;
  collapseOverrides: Record<string, boolean>;
  theme: string;
  threads: Thread[];
}>();

const emit = defineEmits<{
  refresh: [];
  rejectRequest: [message?: string];
  resolveRequest: [response: unknown];
  select: [threadId: string];
  selectThread: [threadId: string];
  send: [message: string];
  interrupt: [];
  openConversation: [];
  setCollapseOverride: [key: string, expanded: boolean];
  setCollapseOverrides: [updates: Record<string, boolean>];
}>();

const draft = ref("");
const search = ref("");
const sidebarCollapsed = ref(false);
const promptAnswers = ref<Record<string, string>>({});
const elicitationAnswers = ref<Record<string, string | boolean>>({});
const dynamicToolResult = ref("");
const dynamicToolSuccess = ref(true);
const composerField = ref<HTMLTextAreaElement | null>(null);
const transcriptBody = ref<HTMLElement | null>(null);
const activeCommandIndex = ref(0);
const commandControlOpen = ref(false);
const commandControlQuery = ref("");
const commandControlInput = ref<HTMLInputElement | null>(null);
const settlingLiveTurn = ref<LiveTranscriptTurn | null>(null);
let settlingLiveTurnTimer: ReturnType<typeof setTimeout> | null = null;

async function scrollTranscriptToLatest() {
  await nextTick();
  if (!hasTranscriptContent.value) {
    return;
  }

  const container = transcriptBody.value;
  if (!container) {
    return;
  }

  container.scrollTop = container.scrollHeight;
}

const selectedAgent = computed(
  () =>
    props.agents.find((agent) => agent.id === props.selectedAgentId) ?? null,
);

const AGENT_FALLBACK_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#06b6d4",
  "#3b82f6",
  "#ec4899",
];

function hashColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AGENT_FALLBACK_COLORS[Math.abs(hash) % AGENT_FALLBACK_COLORS.length];
}

function resolvedAgentColor(agent: WorkspaceAgentRow | null): string {
  if (!agent) {
    return "var(--accent)";
  }
  return agent.color || hashColor(agent.name || agent.id);
}

const selectedAgentColor = computed(() =>
  resolvedAgentColor(selectedAgent.value),
);

const workspaceColorVars = computed(() => ({
  "--workspace-agent-color": selectedAgentColor.value,
}));

function agentAvatarStyle(agent: WorkspaceAgentRow) {
  const color = resolvedAgentColor(agent);
  return {
    backgroundColor: `${color}1f`,
    color,
  };
}

const selectedAgentAvatarStyle = computed(() => {
  const color = selectedAgentColor.value;
  return {
    backgroundColor: `${color}1f`,
    color,
  };
});

const filteredAgents = computed(() => {
  const query = search.value.trim().toLowerCase();
  if (!query) {
    return props.agents;
  }

  return props.agents.filter((agent) => {
    const haystack =
      `${agent.name} ${agent.description} ${agent.preview} ${agent.workspace || ""}`.toLowerCase();
    return haystack.includes(query);
  });
});

type ThreadChoice = {
  id: string;
  label: string;
};

const threadChoices = computed<ThreadChoice[]>(() => {
  const threadsById = new Map(
    props.threads.map((thread) => [thread.id, thread]),
  );
  const sortedThreadIds = [...props.selectedAgentThreadIds].sort(
    (left, right) => {
      const leftThread = threadsById.get(left);
      const rightThread = threadsById.get(right);
      if (leftThread && rightThread) {
        return rightThread.updatedAt - leftThread.updatedAt;
      }
      if (rightThread) {
        return 1;
      }
      if (leftThread) {
        return -1;
      }
      return (
        props.selectedAgentThreadIds.indexOf(left) -
        props.selectedAgentThreadIds.indexOf(right)
      );
    },
  );

  const choices = sortedThreadIds.map((threadId) => {
    const thread = threadsById.get(threadId);
    if (thread) {
      const primary = thread.name || thread.preview || thread.id;
      const stamp = formatTime(thread.updatedAt) || "recent";
      return {
        id: thread.id,
        label: `${primary} · ${stamp}`,
      };
    }

    return {
      id: threadId,
      label: `${threadId} · not materialized yet`,
    };
  });

  if (
    props.selectedThreadId &&
    !choices.some((choice) => choice.id === props.selectedThreadId)
  ) {
    choices.unshift({
      id: props.selectedThreadId,
      label: `${props.selectedThreadId} · current`,
    });
  }

  return choices;
});

function onThreadSelectionChange(event: Event) {
  const threadId = (event.target as HTMLSelectElement).value;
  if (!threadId || threadId === props.selectedThreadId) {
    return;
  }
  emit("selectThread", threadId);
}

const composerMeta = computed(() => [
  props.autoCompactTokenLimit
    ? `Auto-compact ${formatTokenCount(props.autoCompactTokenLimit)}`
    : null,
]);

const composerModelUsageLine = computed(() => {
  const modelName = props.modelLabel || "default";
  const consumed = formatTokenCount(
    props.selectedTokenUsage?.total.totalTokens ?? 0,
  );
  const capacity = formatTokenCount(
    props.contextWindow ?? props.selectedTokenUsage?.modelContextWindow ?? 0,
  );
  return `${modelName} - ${consumed}/${capacity}`;
});

const statusMessage = computed(
  () => props.statusMessage || (props.activeTurnId ? "Working" : null),
);

const hasTranscriptContent = computed(
  () =>
    displayedCommittedTranscript.value.length > 0 ||
    activeOrSettlingLiveTurn.value !== null,
);

const activeOrSettlingLiveTurn = computed(() => {
  const turn = props.liveTranscriptTurn ?? settlingLiveTurn.value;
  if (!turn) {
    return null;
  }

  return {
    ...turn,
    events: Array.isArray(turn.events) ? turn.events : [],
  };
});

const settlingLiveTone = computed(() => {
  const turn = activeOrSettlingLiveTurn.value;
  if (!turn || props.liveTranscriptTurn) {
    return null;
  }

  switch (turn.status) {
    case "failed":
      return "error";
    case "interrupted":
      return "warning";
    default:
      return "muted";
  }
});

const settlingLiveLabel = computed(() => {
  const turn = activeOrSettlingLiveTurn.value;
  if (!turn || props.liveTranscriptTurn) {
    return null;
  }

  switch (turn.status) {
    case "failed":
      return "Failed turn";
    case "interrupted":
      return "Interrupted turn";
    case "completed":
      return "Completed turn";
    default:
      return "Settling turn";
  }
});

const displayedCommittedTranscript = computed(() => {
  const hiddenTurnId = activeOrSettlingLiveTurn.value?.id;
  if (!hiddenTurnId) {
    return props.committedTranscript;
  }

  return props.committedTranscript.filter((turn) => turn.id !== hiddenTurnId);
});

const collapseOverrides = ref<Record<string, boolean>>({});

watch(
  () => props.collapseOverrides,
  (next) => {
    collapseOverrides.value = { ...next };
  },
  { deep: true, immediate: true },
);

function collapseKey(turnId: string, itemId: string): string {
  return `${props.selectedThreadId ?? "no-thread"}:${turnId}:${itemId}`;
}

function isCollapsibleItem(item: TranscriptItem | LiveTranscriptItem): boolean {
  return (
    item.kind === "command" ||
    item.kind === "file-change" ||
    item.kind === "tool" ||
    item.kind === "reasoning"
  );
}

function shouldAutoCollapse(
  item: TranscriptItem | LiveTranscriptItem,
): boolean {
  if (!isCollapsibleItem(item)) {
    return false;
  }

  if (!("status" in item) || item.status === "streaming") {
    return false;
  }

  const rendered = renderTranscriptItem(item);
  const lineCount = rendered.split("\n").length;
  return lineCount >= 4 || rendered.length >= 220;
}

function isItemExpanded(
  turnId: string,
  item: TranscriptItem | LiveTranscriptItem,
): boolean {
  if (!isCollapsibleItem(item)) {
    return true;
  }

  const override = collapseOverrides.value[collapseKey(turnId, item.id)];
  if (override !== undefined) {
    return override;
  }

  return !shouldAutoCollapse(item);
}

function toggleItemExpanded(
  turnId: string,
  item: TranscriptItem | LiveTranscriptItem,
) {
  const key = collapseKey(turnId, item.id);
  const expanded = !isItemExpanded(turnId, item);
  collapseOverrides.value[key] = expanded;
  emit("setCollapseOverride", key, expanded);
}

function collapsedPreview(item: TranscriptItem | LiveTranscriptItem): string {
  const rendered = renderTranscriptItem(item)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join("\n");
  return rendered.slice(0, 220);
}

function expandAllItems() {
  const next = { ...collapseOverrides.value };
  for (const turn of displayedCommittedTranscript.value) {
    for (const item of turn.items) {
      if (isCollapsibleItem(item)) {
        next[collapseKey(turn.id, item.id)] = true;
      }
    }
  }

  const liveTurn = activeOrSettlingLiveTurn.value;
  if (liveTurn) {
    for (const item of liveTurn.items) {
      if (isCollapsibleItem(item)) {
        next[collapseKey(liveTurn.id, item.id)] = true;
      }
    }
  }

  collapseOverrides.value = next;
  emit("setCollapseOverrides", next);
}

function collapseAllItems() {
  const next = { ...collapseOverrides.value };
  for (const turn of displayedCommittedTranscript.value) {
    for (const item of turn.items) {
      if (isCollapsibleItem(item)) {
        next[collapseKey(turn.id, item.id)] = false;
      }
    }
  }

  const liveTurn = activeOrSettlingLiveTurn.value;
  if (liveTurn) {
    for (const item of liveTurn.items) {
      if (isCollapsibleItem(item)) {
        next[collapseKey(liveTurn.id, item.id)] = false;
      }
    }
  }

  collapseOverrides.value = next;
  emit("setCollapseOverrides", next);
}

type LiveToolOutputPreview = {
  id: string;
  label: string;
  text: string;
};

type TranscriptStatusChip = {
  id: string;
  text: string;
  tone: "info" | "warning" | "error" | "muted";
};

function compactPreviewText(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const tail = lines.slice(-2).join("\n");
  return tail.slice(0, 180);
}

const liveToolOutputPreviews = computed<LiveToolOutputPreview[]>(() => {
  const turn = activeOrSettlingLiveTurn.value;
  if (!turn) {
    return [];
  }

  return turn.items
    .flatMap((item) => {
      if (
        item.kind !== "command" &&
        item.kind !== "file-change" &&
        item.kind !== "tool"
      ) {
        return [];
      }
      if (item.status !== "streaming") {
        return [];
      }

      const text =
        item.kind === "command"
          ? compactPreviewText(item.output)
          : item.kind === "file-change"
            ? compactPreviewText(item.output)
            : compactPreviewText(item.detail);
      if (!text) {
        return [];
      }

      const label =
        item.kind === "command"
          ? item.command
          : item.kind === "file-change"
            ? "File changes"
            : item.label;

      return [{ id: item.id, label, text }];
    })
    .slice(-3);
});

const waitingForToolOutput = computed(() => {
  const turn = activeOrSettlingLiveTurn.value;
  if (!turn) {
    return false;
  }

  const hasStreamingTool = turn.items.some(
    (item) =>
      (item.kind === "command" ||
        item.kind === "file-change" ||
        item.kind === "tool") &&
      item.status === "streaming",
  );

  return hasStreamingTool && liveToolOutputPreviews.value.length === 0;
});

const transcriptStatusChips = computed<TranscriptStatusChip[]>(() => {
  const chips: TranscriptStatusChip[] = [];

  if (statusMessage.value) {
    chips.push({
      id: "status",
      text: statusMessage.value,
      tone: props.statusTone ?? "info",
    });
  }

  if (settlingLiveLabel.value) {
    chips.push({
      id: "settling",
      text: settlingLiveLabel.value,
      tone: settlingLiveTone.value ?? "muted",
    });
  }

  if (waitingForToolOutput.value) {
    chips.push({
      id: "waiting",
      text: "Waiting for tool output...",
      tone: "muted",
    });
  }

  const events = activeOrSettlingLiveTurn.value?.events ?? [];
  for (const event of events) {
    chips.push({
      id: `event-${event.id}`,
      text: `${event.label}: ${truncate(event.detail, 120)}`,
      tone: event.tone,
    });
  }

  return chips;
});

const COMMAND_PANEL_PREFIXES = new Set([
  "/model",
  "/resume",
  "/agent",
  "/subagents",
  "/approvals",
  "/permissions",
  "/settings",
]);

const COMMANDS_REQUIRING_THREAD = new Set([
  "/rename",
  "/compact",
  "/fork",
  "/diff",
  "/copy",
  "/review",
]);

const activeCommandQuery = computed(() => commandControlQuery.value.trim());

const selectedThread = computed(
  () =>
    props.threads.find((thread) => thread.id === props.selectedThreadId) ??
    null,
);

const commandContextLabel = computed(() => {
  const agentLabel = selectedAgent.value?.name ?? "No agent";
  const threadLabel =
    selectedThread.value?.name ||
    selectedThread.value?.preview ||
    props.selectedThreadId ||
    "No active thread";
  return `${agentLabel} · ${threadLabel}`;
});

function commandDisabledReason(command: string): string | null {
  if (!props.connected) {
    return "Reconnect to run commands";
  }
  if (!props.selectedAgentId) {
    return "Select an agent";
  }
  if (COMMANDS_REQUIRING_THREAD.has(command) && !props.selectedThreadId) {
    return "Select a thread";
  }
  return null;
}

const visibleCommands = computed(() => {
  const query = activeCommandQuery.value.toLowerCase();
  if (!query || query === "/") {
    return slashCommands;
  }

  const commandTerm = query.startsWith("/") ? query : `/${query}`;
  const textTerm = query.startsWith("/") ? query.slice(1) : query;

  return slashCommands.filter(
    (item) =>
      item.command.startsWith(commandTerm) ||
      item.command.slice(1).includes(textTerm) ||
      item.description.toLowerCase().includes(textTerm),
  );
});

const activeSlashCommand = computed(() => {
  const trimmed = activeCommandQuery.value;
  if (!trimmed.startsWith("/")) {
    return null;
  }
  return trimmed.split(/\s+/, 1)[0]?.toLowerCase() || null;
});

type CommandOption = {
  id: string;
  title: string;
  detail: string;
  value: string;
  action: "execute" | "fill-query";
  disabledReason?: string | null;
  contextTag?: "picker" | "run" | "disabled";
};

function parseModelCommandArgs(value: string): string[] {
  return value.trim().split(/\s+/).slice(1).filter(Boolean);
}

const modelCommandParts = computed(() =>
  parseModelCommandArgs(activeCommandQuery.value),
);

const selectedModelProviderFromDraft = computed(() => {
  if (activeSlashCommand.value !== "/model") {
    return null;
  }

  const [first] = modelCommandParts.value;
  if (!first) {
    return null;
  }

  if (first.includes("/")) {
    return first.split("/", 1)[0] || null;
  }

  return first;
});

const commandPanel = computed(() => {
  switch (activeSlashCommand.value) {
    case "/model":
      if (modelCommandParts.value[0]?.includes("/")) {
        return null;
      }

      if (!selectedModelProviderFromDraft.value) {
        return {
          title: "Choose provider",
          subtitle: "Pick provider, then model",
          options: props.modelProviders.map((provider) => ({
            id: `provider:${provider}`,
            title: provider,
            detail: "Open model list",
            value: `/model ${provider}`,
            action: "fill-query" as const,
            contextTag: "picker" as const,
          })),
        };
      }

      return {
        title: "Choose model",
        subtitle: `${selectedModelProviderFromDraft.value} · Current ${props.modelLabel || "default"}`,
        options: props.models
          .filter(
            (model) =>
              model.id.startsWith(`${selectedModelProviderFromDraft.value}/`) ||
              !model.id.includes("/"),
          )
          .slice(0, 18)
          .map((model) => ({
            id: `model:${model.id}`,
            title: model.displayName || model.id,
            detail: model.description,
            value: `/model ${model.id}`,
            action: "execute" as const,
            contextTag: "run" as const,
          })),
      };
    case "/resume":
      return {
        title: "Resume chat",
        subtitle: "Recent saved threads",
        options: props.threads.slice(0, 8).map((thread) => ({
          id: `thread:${thread.id}`,
          title: thread.name || thread.preview || thread.id,
          detail: thread.id,
          value: `/resume ${JSON.stringify(thread.name || thread.preview || thread.id).slice(1, -1)}`,
          action: "execute" as const,
          contextTag: "run" as const,
        })),
      };
    case "/agent":
    case "/subagents":
      return {
        title: "Switch agent",
        subtitle: "Available workspace agents",
        options: props.agents.slice(0, 10).map((agent) => ({
          id: `agent:${agent.id}`,
          title: agent.name,
          detail: agent.description,
          value: `${activeSlashCommand.value} ${agent.name}`,
          action: "execute" as const,
          contextTag: "run" as const,
        })),
      };
    case "/approvals":
    case "/permissions":
      return {
        title: "Permissions",
        subtitle: "Review permission and sandbox settings",
        options: [
          {
            id: "approval:show",
            title: "Show current permissions",
            detail: "Insert the command and run it",
            value: "/approvals",
            action: "execute" as const,
            contextTag: "run" as const,
          },
          {
            id: "settings:open",
            title: "Open settings",
            detail: "Adjust approval policy and sandbox defaults",
            value: "/settings",
            action: "fill-query" as const,
            contextTag: "picker" as const,
          },
        ],
      };
    case "/settings":
      return {
        title: "Quick settings",
        subtitle: `Theme ${props.theme} · Personality options`,
        options: [
          ...["system", "light", "dark"].map((theme) => ({
            id: `theme:${theme}`,
            title: `Theme ${theme}`,
            detail: theme === props.theme ? "Current theme" : "Apply theme",
            value: `/theme ${theme}`,
            action: "execute" as const,
            contextTag: "run" as const,
          })),
          ...["friendly", "pragmatic", "none"].map((personality) => ({
            id: `personality:${personality}`,
            title: `Personality ${personality}`,
            detail: "Apply personality",
            value: `/personality ${personality}`,
            action: "execute" as const,
            contextTag: "run" as const,
          })),
        ],
      };
    default:
      return null;
  }
});

const commandOptions = computed<CommandOption[]>(() => {
  if (commandPanel.value) {
    return commandPanel.value.options.map((option) => ({
      ...option,
      disabledReason: commandDisabledReason(option.value),
    }));
  }
  if (!commandControlOpen.value) {
    return [];
  }

  return visibleCommands.value.map((item) => ({
    id: item.command,
    title: item.command,
    detail: item.description,
    value: item.command,
    action: COMMAND_PANEL_PREFIXES.has(item.command) ? "fill-query" : "execute",
    disabledReason: commandDisabledReason(item.command),
    contextTag: COMMAND_PANEL_PREFIXES.has(item.command) ? "picker" : "run",
  }));
});

const highlightedCommand = computed(
  () => commandOptions.value[activeCommandIndex.value] ?? null,
);

const pendingApproval = computed(() => {
  const request = props.pendingRequest;
  if (
    request?.kind === "command" ||
    request?.kind === "file-change" ||
    request?.kind === "permissions"
  ) {
    return request;
  }
  return null;
});

const pendingPrompt = computed(() =>
  props.pendingRequest?.kind === "prompt" ? props.pendingRequest : null,
);

const pendingElicitation = computed(() => {
  const request = props.pendingRequest;
  if (request?.kind === "mcp-url" || request?.kind === "mcp-form") {
    return request;
  }
  return null;
});

const pendingDynamicTool = computed(() =>
  props.pendingRequest?.kind === "dynamic-tool" ? props.pendingRequest : null,
);

function submit() {
  const message = draft.value.trim();
  if (!message || props.loading || !props.connected) {
    return;
  }
  emit("send", message);
  draft.value = "";
}

function applySlashCommand(command: string) {
  draft.value = command;
  resizeComposer();
  composerField.value?.focus();
}

async function focusCommandControlInput() {
  await nextTick();
  commandControlInput.value?.focus();
  commandControlInput.value?.select();
}

function openCommandControl(query = "") {
  commandControlOpen.value = true;
  commandControlQuery.value = query;
  activeCommandIndex.value = 0;
  void focusCommandControlInput();
}

function closeCommandControl() {
  commandControlOpen.value = false;
  commandControlQuery.value = "";
  activeCommandIndex.value = 0;
}

function chooseCommandOption(option: CommandOption) {
  if (option.disabledReason) {
    return;
  }

  if (option.action === "fill-query") {
    commandControlQuery.value = option.value;
    return;
  }

  emit("send", option.value);
  closeCommandControl();
  draft.value = "";
  void nextTick(() => composerField.value?.focus());
}

function handleCommandControlKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown") {
    if (commandOptions.value.length > 0) {
      event.preventDefault();
      activeCommandIndex.value =
        (activeCommandIndex.value + 1) % commandOptions.value.length;
    }
    return;
  }

  if (event.key === "ArrowUp") {
    if (commandOptions.value.length > 0) {
      event.preventDefault();
      activeCommandIndex.value =
        (activeCommandIndex.value - 1 + commandOptions.value.length) %
        commandOptions.value.length;
    }
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    closeCommandControl();
    void nextTick(() => composerField.value?.focus());
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    if (highlightedCommand.value) {
      chooseCommandOption(highlightedCommand.value);
    }
  }
}

function handleGlobalKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openCommandControl("");
    return;
  }

  if (commandControlOpen.value && event.key === "Escape") {
    event.preventDefault();
    closeCommandControl();
    void nextTick(() => composerField.value?.focus());
  }
}

function handleComposerKeydown(event: KeyboardEvent) {
  if (event.isComposing) {
    return;
  }

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openCommandControl("");
    return;
  }

  if (
    event.key === "/" &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    draft.value.trim().length === 0
  ) {
    event.preventDefault();
    openCommandControl("/");
    return;
  }

  if (event.key === "Escape") {
    if (commandControlOpen.value) {
      event.preventDefault();
      closeCommandControl();
    }
    return;
  }

  if (event.key === "Enter") {
    if (!event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }
}

function transcriptItemClass(item: TranscriptItem | LiveTranscriptItem) {
  if (item.kind === "user") {
    return "card workspace-msg-item workspace-msg-item--user";
  }
  if (item.kind === "assistant") {
    return "card workspace-msg-item workspace-msg-item--assistant";
  }
  if (item.kind === "event") {
    return `card workspace-msg-item workspace-msg-item--event workspace-msg-item--event-${item.tone}`;
  }
  return "card workspace-msg-item workspace-msg-item--work";
}

function liveTranscriptItemClass(item: LiveTranscriptItem) {
  return `${transcriptItemClass(item)} workspace-msg-item--live`;
}

function committedTurnClass(turn: TranscriptTurn) {
  const tone = transcriptTurnTone(turn);
  return {
    "turn-stack--warning": tone === "warning",
    "turn-stack--error": tone === "error",
  };
}

function resolveApproval(response: unknown) {
  emit("resolveRequest", response);
}

function submitPromptAnswers() {
  const request = pendingPrompt.value;
  if (!request) {
    return;
  }

  const answers = Object.fromEntries(
    request.questions.map((question) => [
      question.id,
      {
        answers: [promptAnswers.value[question.id] || ""].filter(Boolean),
      },
    ]),
  );
  emit("resolveRequest", { answers });
}

function fillPromptAnswer(questionId: string, value: string) {
  promptAnswers.value = {
    ...promptAnswers.value,
    [questionId]: value,
  };
}

function fillElicitationAnswer(key: string, value: string | boolean) {
  elicitationAnswers.value = {
    ...elicitationAnswers.value,
    [key]: value,
  };
}

function submitElicitation(action: "accept" | "decline" | "cancel") {
  const request = pendingElicitation.value;
  if (!request) {
    return;
  }

  if (request.kind === "mcp-url" || action !== "accept") {
    emit("resolveRequest", { action, content: null, _meta: null });
    return;
  }

  const content = Object.fromEntries(
    request.fields.map((field) => [
      field.key,
      normalizeElicitationValue(
        field.type,
        elicitationAnswers.value[field.key] ?? null,
      ),
    ]),
  );
  emit("resolveRequest", { action, content, _meta: null });
}

function submitDynamicToolResponse() {
  emit("resolveRequest", {
    contentItems: dynamicToolResult.value
      ? [{ type: "inputText", text: dynamicToolResult.value }]
      : [],
    success: dynamicToolSuccess.value,
  });
}

function normalizeElicitationValue(
  type: "text" | "number" | "boolean",
  value: string | boolean | null,
) {
  if (type === "boolean") {
    return Boolean(value);
  }
  if (type === "number") {
    if (typeof value === "string" && value.trim() !== "") {
      return Number(value);
    }
    return null;
  }
  return typeof value === "string" ? value : "";
}

function resizeComposer() {
  if (!composerField.value) {
    return;
  }
  composerField.value.style.height = "auto";
  composerField.value.style.height = `${Math.min(composerField.value.scrollHeight, 132)}px`;
}

function formatTokenCount(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(0)}k`;
  }
  return String(value);
}

watch(
  () => props.selectedAgentId,
  () => {
    draft.value = "";
    resizeComposer();
  },
);

watch(draft, () => {
  resizeComposer();
});

watch(commandControlQuery, () => {
  activeCommandIndex.value = 0;
});

watch(
  () => props.pendingRequest,
  (request) => {
    if (request?.kind === "prompt") {
      promptAnswers.value = Object.fromEntries(
        request.questions.map((question) => [question.id, ""]),
      );
      return;
    }
    if (request?.kind === "mcp-form") {
      elicitationAnswers.value = Object.fromEntries(
        request.fields.map((field) => [field.key, field.defaultValue ?? ""]),
      ) as Record<string, string | boolean>;
      return;
    }
    if (request?.kind === "dynamic-tool") {
      dynamicToolResult.value = "";
      dynamicToolSuccess.value = true;
      return;
    }
    promptAnswers.value = {};
    elicitationAnswers.value = {};
  },
  { immediate: true },
);

watch(
  () => props.restoredDraftVersion,
  () => {
    if (props.restoredDraft === null) {
      return;
    }
    draft.value = props.restoredDraft;
    resizeComposer();
    composerField.value?.focus();
  },
);

watch(
  () => props.liveTranscriptTurn,
  (next, previous) => {
    if (settlingLiveTurnTimer) {
      clearTimeout(settlingLiveTurnTimer);
      settlingLiveTurnTimer = null;
    }

    if (next) {
      settlingLiveTurn.value = null;
      return;
    }

    if (!previous) {
      settlingLiveTurn.value = null;
      return;
    }

    settlingLiveTurn.value = previous;
    settlingLiveTurnTimer = setTimeout(() => {
      settlingLiveTurn.value = null;
      settlingLiveTurnTimer = null;
    }, 450);
  },
);

watch(
  [
    () => props.selectedThreadId,
    () => props.committedTranscript,
    () => props.liveTranscriptTurn,
    () => settlingLiveTurn.value,
  ],
  () => {
    void scrollTranscriptToLatest();
  },
  { deep: true, flush: "post" },
);

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleGlobalKeydown);
  if (settlingLiveTurnTimer) {
    clearTimeout(settlingLiveTurnTimer);
    settlingLiveTurnTimer = null;
  }
});

onMounted(() => {
  window.addEventListener("keydown", handleGlobalKeydown);
});
</script>

<template>
  <section
    class="workspace-msg-page"
    :class="{ 'is-sidebar-collapsed': sidebarCollapsed }"
    :style="workspaceColorVars"
  >
    <aside class="workspace-msg-page__sidebar">
      <section class="workspace-msg-list">
        <div class="workspace-msg-list__header">
          <div class="card-title">Messages</div>
          <!--          <div class="card-sub">Workspace agent inbox</div>-->
        </div>

        <label class="workspace-msg-search field">
          <div class="workspace-msg-search__control">
            <span class="workspace-msg-search__icon" aria-hidden="true">
              <svg viewBox="0 0 16 16" fill="none">
                <circle
                  cx="7"
                  cy="7"
                  r="4.5"
                  stroke="currentColor"
                  stroke-width="1.5"
                />
                <path
                  d="M10.5 10.5L13 13"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                />
              </svg>
            </span>
            <input v-model="search" placeholder="Search agents..." />
            <button
              v-if="search.trim()"
              class="workspace-msg-search__clear"
              type="button"
              aria-label="Clear search"
              @click="search = ''"
            >
              <svg viewBox="0 0 16 16" fill="none">
                <path
                  d="M4 4l8 8M12 4l-8 8"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                />
              </svg>
            </button>
          </div>
        </label>

        <div class="workspace-msg-list__items">
          <button
            v-for="agent in filteredAgents"
            :key="agent.id"
            class="workspace-msg-list__item nav-item"
            :class="{ 'active is-selected': agent.id === selectedAgentId }"
            @click="$emit('select', agent.id)"
          >
            <div
              class="workspace-msg-list__avatar"
              :style="agentAvatarStyle(agent)"
            >
              <span>{{ agent.name.slice(0, 1) }}</span>
            </div>
            <div class="workspace-msg-list__meta">
              <div class="workspace-msg-list__row">
                <span class="workspace-msg-list__name nav-item__text">{{
                  agent.name
                }}</span>
                <span class="workspace-msg-list__time muted">
                  {{
                    agent.hasThread
                      ? formatTime(agent.updatedAt) || "active"
                      : "new"
                  }}
                </span>
              </div>
              <div class="workspace-msg-list__preview muted">
                {{
                  truncate(agent.preview || agent.description || agent.id, 60)
                }}
              </div>
            </div>
          </button>
        </div>
      </section>
    </aside>

    <section class="workspace-msg-thread">
      <header class="workspace-msg-thread__header">
        <button class="workspace-msg-thread__agent" type="button">
          <div
            class="workspace-msg-thread__avatar"
            :style="selectedAgentAvatarStyle"
          >
            {{ selectedAgent ? selectedAgent.name.slice(0, 1) : "?" }}
          </div>
          <div>
            <div class="workspace-msg-thread__name">
              {{ selectedAgent ? selectedAgent.name : "Select an agent" }}
            </div>
            <div class="workspace-msg-thread__title"></div>
          </div>
        </button>

        <button>
          <select
            v-if="selectedAgent && threadChoices.length > 0"
            class="workspace-msg-thread__select"
            :value="selectedThreadId || ''"
            aria-label="Select thread"
            @change="onThreadSelectionChange"
          >
            <option value="" disabled>Select thread</option>
            <option
              v-for="thread in threadChoices"
              :key="thread.id"
              :value="thread.id"
            >
              {{ thread.label }}
            </option>
          </select>
          <span v-else>{{ selectedThreadId || "No thread selected" }}</span>
        </button>

        <div class="workspace-msg-thread__actions">
          <button
            class="workspace-msg-thread__icon-btn"
            type="button"
            :title="
              sidebarCollapsed
                ? 'Expand conversations'
                : 'Collapse conversations'
            "
            :aria-label="sidebarCollapsed ? 'Expand' : 'Collapse'"
            @click="sidebarCollapsed = !sidebarCollapsed"
          >
            <svg viewBox="0 0 16 16" fill="none">
              <path
                v-if="sidebarCollapsed"
                d="M6 4l4 4-4 4"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                v-else
                d="M10 4L6 8l4 4"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <span
            class="statusDot"
            :class="{ ok: connected }"
            :title="connected ? 'Connected' : 'Disconnected'"
            aria-hidden="true"
          />
          <button
            v-if="selectedAgentId && selectedThreadId"
            class="workspace-msg-thread__icon-btn"
            type="button"
            title="Open in chat"
            aria-label="Open in chat"
            @click="$emit('openConversation')"
          >
            <svg viewBox="0 0 16 16" fill="none">
              <path
                d="M3 3h7v7M10 3l3 3-3 3"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </div>
      </header>

      <div class="workspace-msg-thread__chat">
        <div v-if="pendingApproval" class="workspace-request callout warn">
          <div class="workspace-request__header">
            <div>
              <div class="note-title">{{ pendingApproval.title }}</div>
              <div v-if="pendingApproval.reason" class="card-sub">
                {{ pendingApproval.reason }}
              </div>
            </div>
            <span class="agent-pill warn">Action needed</span>
          </div>

          <pre
            v-if="pendingApproval.kind === 'command' && pendingApproval.command"
            class="workspace-request__body code-block"
            >{{ pendingApproval.command }}</pre
          >
          <div
            v-if="pendingApproval.kind === 'command' && pendingApproval.cwd"
            class="workspace-request__meta muted"
          >
            Working directory:
            <span class="mono">{{ pendingApproval.cwd }}</span>
          </div>
          <div
            v-if="
              pendingApproval.kind === 'file-change' &&
              pendingApproval.grantRoot
            "
            class="workspace-request__meta muted"
          >
            Requested root:
            <span class="mono">{{ pendingApproval.grantRoot }}</span>
          </div>
          <div
            v-if="pendingApproval.kind === 'permissions'"
            class="workspace-request__list"
          >
            <div
              v-for="entry in pendingApproval.permissionSummary"
              :key="entry"
              class="workspace-request__list-item"
            >
              {{ entry }}
            </div>
          </div>

          <div class="workspace-request__actions">
            <button
              v-for="choice in pendingApproval.choices"
              :key="choice.label"
              class="btn"
              :class="choice.label.startsWith('Allow') ? 'primary' : ''"
              @click="resolveApproval(choice.value)"
            >
              {{ choice.label }}
            </button>
          </div>
        </div>

        <form
          v-if="pendingPrompt"
          class="workspace-request workspace-request--prompt callout info"
          @submit.prevent="submitPromptAnswers"
        >
          <div class="workspace-request__header">
            <div>
              <div class="note-title">{{ pendingPrompt.title }}</div>
              <div class="card-sub">The agent is waiting for your answer.</div>
            </div>
            <span class="agent-pill">Input needed</span>
          </div>

          <div class="workspace-request__questions">
            <div
              v-for="question in pendingPrompt.questions"
              :key="question.id"
              class="workspace-request__question"
            >
              <label class="label workspace-request__question-title">{{
                question.header
              }}</label>
              <div class="card-sub workspace-request__question-copy">
                {{ question.question }}
              </div>
              <div
                v-if="question.options?.length"
                class="workspace-request__choices"
              >
                <button
                  v-for="option in question.options"
                  :key="`${question.id}:${option.label}`"
                  class="btn btn--sm"
                  type="button"
                  @click="fillPromptAnswer(question.id, option.label)"
                >
                  {{ option.label }}
                </button>
              </div>
              <input
                v-if="question.isSecret"
                :value="promptAnswers[question.id] || ''"
                class="field workspace-request__input"
                type="password"
                @input="
                  fillPromptAnswer(
                    question.id,
                    ($event.target as HTMLInputElement).value,
                  )
                "
              />
              <textarea
                v-else
                :value="promptAnswers[question.id] || ''"
                class="field workspace-request__input"
                rows="3"
                @input="
                  fillPromptAnswer(
                    question.id,
                    ($event.target as HTMLTextAreaElement).value,
                  )
                "
              />
            </div>
          </div>

          <div class="workspace-request__actions">
            <button class="btn primary" type="submit">Submit answers</button>
            <button
              class="btn"
              type="button"
              @click="$emit('rejectRequest', 'Prompt dismissed')"
            >
              Cancel
            </button>
          </div>
        </form>

        <form
          v-if="pendingElicitation"
          class="workspace-request workspace-request--prompt callout info"
          @submit.prevent="submitElicitation('accept')"
        >
          <div class="workspace-request__header">
            <div>
              <div class="note-title">{{ pendingElicitation.title }}</div>
              <div class="card-sub">{{ pendingElicitation.message }}</div>
            </div>
            <span class="agent-pill">MCP</span>
          </div>

          <div
            v-if="pendingElicitation.kind === 'mcp-url'"
            class="workspace-request__question"
          >
            <div class="workspace-request__meta muted">
              Open this URL to continue:
              <a
                :href="pendingElicitation.url"
                target="_blank"
                rel="noreferrer"
              >
                {{ pendingElicitation.url }}
              </a>
            </div>
          </div>

          <div v-else class="workspace-request__questions">
            <div
              v-for="field in pendingElicitation.fields"
              :key="field.key"
              class="workspace-request__question"
            >
              <label class="label workspace-request__question-title">
                {{ field.label }}
                <span v-if="field.required">*</span>
              </label>
              <div
                v-if="field.description"
                class="card-sub workspace-request__question-copy"
              >
                {{ field.description }}
              </div>
              <label
                v-if="field.type === 'boolean'"
                class="row workspace-request__toggle-row"
              >
                <input
                  :checked="Boolean(elicitationAnswers[field.key])"
                  type="checkbox"
                  @change="
                    fillElicitationAnswer(
                      field.key,
                      ($event.target as HTMLInputElement).checked,
                    )
                  "
                />
                <span>Enabled</span>
              </label>
              <input
                v-else-if="field.type === 'number'"
                :value="String(elicitationAnswers[field.key] ?? '')"
                class="workspace-request__input"
                type="number"
                @input="
                  fillElicitationAnswer(
                    field.key,
                    ($event.target as HTMLInputElement).value,
                  )
                "
              />
              <textarea
                v-else
                :value="String(elicitationAnswers[field.key] ?? '')"
                class="workspace-request__input"
                rows="3"
                @input="
                  fillElicitationAnswer(
                    field.key,
                    ($event.target as HTMLTextAreaElement).value,
                  )
                "
              />
            </div>
          </div>

          <div class="workspace-request__actions">
            <button class="btn primary" type="submit">Accept</button>
            <button
              class="btn"
              type="button"
              @click="submitElicitation('decline')"
            >
              Decline
            </button>
            <button
              class="btn"
              type="button"
              @click="submitElicitation('cancel')"
            >
              Cancel
            </button>
          </div>
        </form>

        <form
          v-if="pendingDynamicTool"
          class="workspace-request workspace-request--prompt callout warn"
          @submit.prevent="submitDynamicToolResponse"
        >
          <div class="workspace-request__header">
            <div>
              <div class="note-title">{{ pendingDynamicTool.title }}</div>
              <div class="card-sub">
                Return a manual result for this client-side tool call.
              </div>
            </div>
            <span class="agent-pill warn">Tool call</span>
          </div>

          <pre class="workspace-request__body code-block">{{
            pendingDynamicTool.argumentsJson
          }}</pre>

          <label class="row workspace-request__toggle-row">
            <input v-model="dynamicToolSuccess" type="checkbox" />
            <span>Mark tool call as successful</span>
          </label>

          <textarea
            v-model="dynamicToolResult"
            class="workspace-request__input"
            rows="4"
            placeholder="Enter text content returned by the tool."
          />

          <div class="workspace-request__actions">
            <button class="btn primary" type="submit">Send tool result</button>
            <button
              class="btn"
              type="button"
              @click="$emit('rejectRequest', 'Tool call cancelled')"
            >
              Cancel
            </button>
          </div>
        </form>

        <div
          v-if="hasTranscriptContent"
          ref="transcriptBody"
          class="workspace-chat__body"
        >
          <div class="workspace-chat__view-actions">
            <button class="btn btn--sm" type="button" @click="collapseAllItems">
              Collapse all tools/reasoning
            </button>
            <button class="btn btn--sm" type="button" @click="expandAllItems">
              Expand all
            </button>
          </div>
          <div
            v-if="transcriptStatusChips.length > 0"
            class="workspace-chat__chips"
          >
            <span
              v-for="chip in transcriptStatusChips"
              :key="chip.id"
              class="workspace-chat__chip"
              :class="`workspace-chat__chip--${chip.tone}`"
            >
              {{ chip.text }}
            </span>
          </div>
          <div
            v-for="turn in displayedCommittedTranscript"
            :key="turn.id"
            class="turn-stack"
            :class="committedTurnClass(turn)"
          >
            <div class="turn-meta">
              <span>Turn {{ turn.id.slice(0, 8) }}</span>
              <span class="turn-meta__status">{{
                transcriptTurnStatusLabel(turn)
              }}</span>
              <span v-if="turn.error" class="turn-meta__error">{{
                turn.error
              }}</span>
            </div>
            <div
              v-for="item in turn.items"
              :key="item.id"
              :class="transcriptItemClass(item)"
            >
              <div class="workspace-msg-item__head">
                <div
                  v-if="transcriptItemTitle(item)"
                  class="card-title workspace-msg-item__title"
                >
                  {{ transcriptItemTitle(item) }}
                  <span
                    v-if="'status' in item"
                    class="workspace-msg-item__status"
                    >{{ item.status }}</span
                  >
                </div>
                <button
                  v-if="isCollapsibleItem(item)"
                  class="workspace-msg-item__toggle"
                  type="button"
                  @click="toggleItemExpanded(turn.id, item)"
                >
                  {{ isItemExpanded(turn.id, item) ? "Collapse" : "Expand" }}
                </button>
              </div>
              <pre
                v-if="isItemExpanded(turn.id, item)"
                class="workspace-msg-item__body"
                >{{ renderTranscriptItem(item) }}</pre
              >
              <pre v-else class="workspace-msg-item__preview">{{
                collapsedPreview(item)
              }}</pre>
            </div>
          </div>

          <div
            v-if="liveToolOutputPreviews.length > 0"
            class="workspace-chat__tool-strip"
          >
            <div
              v-for="preview in liveToolOutputPreviews"
              :key="preview.id"
              class="workspace-chat__tool-chip"
            >
              <div class="workspace-chat__tool-chip-title">
                {{ preview.label }}
              </div>
              <pre class="workspace-chat__tool-chip-body">{{
                preview.text
              }}</pre>
            </div>
          </div>

          <div
            v-if="activeOrSettlingLiveTurn"
            class="turn-stack turn-stack--live"
            :class="{
              'turn-stack--warning': settlingLiveTone === 'warning',
              'turn-stack--error': settlingLiveTone === 'error',
            }"
          >
            <div class="turn-meta">
              <span>Turn {{ activeOrSettlingLiveTurn.id.slice(0, 8) }}</span>
              <span class="turn-meta__status">{{
                liveTurnStatusLabel(activeOrSettlingLiveTurn)
              }}</span>
              <span
                v-if="activeOrSettlingLiveTurn.error"
                class="turn-meta__error"
              >
                {{ activeOrSettlingLiveTurn.error }}
              </span>
            </div>
            <div
              v-for="item in activeOrSettlingLiveTurn.items"
              :key="item.id"
              :class="liveTranscriptItemClass(item)"
            >
              <div class="workspace-msg-item__head">
                <div
                  v-if="liveTranscriptItemTitle(item)"
                  class="card-title workspace-msg-item__title"
                >
                  {{ liveTranscriptItemTitle(item) }}
                  <span
                    v-if="liveTranscriptItemStatus(item)"
                    class="workspace-msg-item__status"
                    >{{ liveTranscriptItemStatus(item) }}</span
                  >
                </div>
                <button
                  v-if="isCollapsibleItem(item)"
                  class="workspace-msg-item__toggle"
                  type="button"
                  @click="toggleItemExpanded(activeOrSettlingLiveTurn.id, item)"
                >
                  {{
                    isItemExpanded(activeOrSettlingLiveTurn.id, item)
                      ? "Collapse"
                      : "Expand"
                  }}
                </button>
              </div>
              <pre
                v-if="isItemExpanded(activeOrSettlingLiveTurn.id, item)"
                class="workspace-msg-item__body"
                >{{ renderTranscriptItem(item) }}</pre
              >
              <pre v-else class="workspace-msg-item__preview">{{
                collapsedPreview(item)
              }}</pre>
            </div>
          </div>
        </div>
        <div v-else class="workspace-chat__empty">
          {{
            selectedAgentId
              ? selectedThreadId
                ? "No messages in this thread yet."
                : "No thread selected for this agent yet."
              : "Select an agent on the left to view its transcript."
          }}
        </div>

        <div
          v-if="!hasTranscriptContent && transcriptStatusChips.length > 0"
          class="workspace-chat__chips workspace-chat__chips--standalone"
        >
          <span
            v-for="chip in transcriptStatusChips"
            :key="chip.id"
            class="workspace-chat__chip"
            :class="`workspace-chat__chip--${chip.tone}`"
          >
            {{ chip.text }}
          </span>
        </div>

        <form class="workspace-chat__composer" @submit.prevent="submit">
          <div class="workspace-chat__composer-row">
            <button
              class="workspace-chat__composer-icon"
              type="button"
              title="Attach file"
              aria-label="Attach file"
              @click="applySlashCommand('/mention ')"
            >
              <svg viewBox="0 0 16 16" fill="none">
                <path
                  d="M6.1 9.9l4.6-4.6a2.1 2.1 0 0 1 3 3l-5.4 5.4a3.5 3.5 0 0 1-5-5l5-5a2.4 2.4 0 1 1 3.4 3.4l-4.6 4.6a1.3 1.3 0 1 1-1.8-1.8l4.1-4.1"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
            <div class="workspace-chat__composer-field">
              <textarea
                ref="composerField"
                v-model="draft"
                rows="1"
                :disabled="!connected || !selectedAgentId"
                placeholder="Message the selected workspace agent..."
                @keydown="handleComposerKeydown"
              />
            </div>
            <div class="workspace-chat__composer-actions">
              <button
                v-if="activeTurnId"
                class="workspace-chat__composer-icon"
                type="button"
                title="Interrupt turn"
                aria-label="Interrupt turn"
                @click="$emit('interrupt')"
              >
                <svg viewBox="0 0 16 16" fill="none">
                  <rect
                    x="4"
                    y="4"
                    width="8"
                    height="8"
                    rx="1.5"
                    stroke="currentColor"
                    stroke-width="1.5"
                  />
                </svg>
              </button>
              <button
                class="workspace-chat__composer-send"
                type="submit"
                title="Send message"
                aria-label="Send message"
                :disabled="loading || !connected || !selectedAgentId"
              >
                <svg viewBox="0 0 16 16" fill="none">
                  <path
                    d="M2.2 2.2L14 8l-11.8 5.8 2.9-5.1L2.2 2.2z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            </div>
            <span class="workspace-chat__composer-row-model">{{
              composerModelUsageLine
            }}</span>
          </div>
          <div class="workspace-chat__composer-meta">
            <span
              v-for="entry in composerMeta.filter(Boolean)"
              :key="entry || ''"
              class="workspace-chat__composer-meta-chip"
            >
              {{ entry }}
            </span>
          </div>
        </form>

        <div
          v-if="commandControlOpen"
          class="workspace-command-control__backdrop"
          @mousedown.self="closeCommandControl"
        >
          <section
            class="workspace-command-control"
            role="dialog"
            aria-modal="true"
          >
            <div class="workspace-command-control__header">
              <input
                ref="commandControlInput"
                v-model="commandControlQuery"
                class="workspace-command-control__search"
                type="text"
                placeholder="Type a command or search..."
                @keydown="handleCommandControlKeydown"
              />
              <button
                class="workspace-command-control__close"
                type="button"
                @click="closeCommandControl"
              >
                Esc
              </button>
            </div>

            <div class="workspace-command-control__context">
              <span>{{ commandContextLabel }}</span>
              <span v-if="commandPanel">{{ commandPanel.title }}</span>
            </div>

            <div
              v-if="commandPanel"
              class="workspace-command-control__panel-subtitle"
            >
              {{ commandPanel.subtitle }}
            </div>

            <div class="workspace-command-control__list">
              <button
                v-for="(item, index) in commandOptions"
                :key="item.id"
                class="workspace-command-control__item"
                :class="{
                  'is-active': index === activeCommandIndex,
                  'is-disabled': Boolean(item.disabledReason),
                }"
                type="button"
                :disabled="Boolean(item.disabledReason)"
                @mouseenter="activeCommandIndex = index"
                @click="chooseCommandOption(item)"
              >
                <span class="workspace-command-control__item-main">
                  <span class="workspace-command-control__item-name">{{
                    item.title
                  }}</span>
                  <span class="workspace-command-control__item-copy">{{
                    item.detail
                  }}</span>
                </span>
                <span
                  v-if="item.disabledReason"
                  class="workspace-command-control__item-tag workspace-command-control__item-tag--disabled"
                >
                  {{ item.disabledReason }}
                </span>
                <span
                  v-else-if="item.contextTag"
                  class="workspace-command-control__item-tag"
                >
                  {{ item.contextTag }}
                </span>
              </button>

              <div
                v-if="commandOptions.length === 0"
                class="workspace-command-control__empty"
              >
                No commands found.
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  </section>
</template>
