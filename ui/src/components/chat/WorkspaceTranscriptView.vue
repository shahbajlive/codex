<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { storeToRefs } from "pinia";
import { renderMarkdownHtml } from "../../lib/markdown";
import {
  type LiveTranscriptItem,
  type LiveTranscriptTurn,
  type TranscriptItem,
  type TranscriptTurn,
} from "../../lib/transcript";
import { truncate } from "../../lib/format";
import { useChatStore } from "../../stores/chat";

const props = defineProps<{
  selectedAgentId: string | null;
  selectedAgentName: string | null;
  selectedAgentColor: string | null;
  selectedThreadId: string | null;
  committedTranscript: TranscriptTurn[];
  liveTranscriptTurn: LiveTranscriptTurn | null;
  activeTurnId: string | null;
  pendingUserDraft: string | null;
  collapseOverrides: Record<string, boolean | string>;
  statusMessage: string | null;
  statusTone: "info" | "warning" | "error" | null;
}>();

const emit = defineEmits<{
  setCollapseOverride: [key: string, expanded: boolean | string];
  setCollapseOverrides: [updates: Record<string, boolean | string>];
}>();

type TranscriptStatusChip = {
  id: string;
  text: string;
  tone: "info" | "warning" | "error" | "muted";
};

type BubbleStatusState = "running" | "completed" | "failed" | "interrupted";

type BubbleStatus = {
  state: BubbleStatusState;
  label: string;
};

type TurnLike = TranscriptTurn | LiveTranscriptTurn;
type ItemLike = TranscriptItem | LiveTranscriptItem;
type UserItemLike = Extract<ItemLike, { kind: "user" }>;

const transcriptBody = ref<HTMLElement | null>(null);
const settlingLiveTurn = ref<LiveTranscriptTurn | null>(null);
const rowFilter = ref<"all" | "work" | "messages" | "errors">("all");
let settlingLiveTurnTimer: ReturnType<typeof setTimeout> | null = null;
const chatStore = useChatStore();
const { transcriptPinnedToLatest } = storeToRefs(chatStore);

const statusMessage = computed(
  () => props.statusMessage || (props.activeTurnId ? "Working" : null),
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

const displayedCommittedTranscript = computed(() => {
  const hiddenTurnId = activeOrSettlingLiveTurn.value?.id;
  if (!hiddenTurnId) {
    return props.committedTranscript;
  }

  return props.committedTranscript.filter((turn) => turn.id !== hiddenTurnId);
});

const turns = computed(() => {
  const items = displayedCommittedTranscript.value.map((turn) => ({
    turn,
    isLive: false,
  }));
  if (activeOrSettlingLiveTurn.value) {
    items.push({ turn: activeOrSettlingLiveTurn.value, isLive: true });
  }
  return items;
});

const hasTranscriptContent = computed(() => turns.value.length > 0);

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

  const hasVisibleStreamingOutput = turn.items.some((item) => {
    if (item.kind === "user" || item.kind === "event") {
      return false;
    }
    if (item.status !== "streaming") {
      return false;
    }
    if (item.kind === "command" || item.kind === "file-change") {
      return item.output.trim().length > 0;
    }
    if (item.kind === "tool") {
      return Boolean(item.output?.trim() || item.error?.trim());
    }
    return false;
  });

  return hasStreamingTool && !hasVisibleStreamingOutput;
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

  const turn = activeOrSettlingLiveTurn.value;
  if (turn && !props.liveTranscriptTurn) {
    chips.push({
      id: "settling",
      text:
        turn.status === "failed"
          ? "Failed turn"
          : turn.status === "interrupted"
            ? "Interrupted turn"
            : "Settling turn",
      tone:
        turn.status === "failed"
          ? "error"
          : turn.status === "interrupted"
            ? "warning"
            : "muted",
    });
  }

  if (waitingForToolOutput.value) {
    chips.push({
      id: "waiting",
      text: "Waiting for tool output...",
      tone: "muted",
    });
  }

  for (const event of activeOrSettlingLiveTurn.value?.events ?? []) {
    chips.push({
      id: `event-${event.id}`,
      text: `${event.label}: ${truncate(event.detail, 120)}`,
      tone: event.tone,
    });
  }

  return chips;
});

function matchesFilter(item: ItemLike): boolean {
  switch (rowFilter.value) {
    case "messages":
      return (
        item.kind === "user" ||
        item.kind === "assistant" ||
        item.kind === "system"
      );
    case "work":
      return item.kind !== "user" && item.kind !== "assistant";
    case "errors":
      return isErrorItem(item);
    case "all":
    default:
      return true;
  }
}

function isErrorItem(item: ItemLike): boolean {
  if (item.kind === "event") {
    return item.tone === "error";
  }
  if (item.kind === "system") {
    return item.tone === "error";
  }
  if (item.kind === "command") {
    return item.exitCode !== null && item.exitCode !== 0;
  }
  if (item.kind === "tool") {
    return Boolean(item.error?.trim());
  }
  return false;
}

function orderedItems(turn: TurnLike, isLive: boolean): ItemLike[] {
  const items = turn.items.filter(matchesFilter);
  const hasUser = items.some((item) => item.kind === "user");
  if (hasUser || !isLive || !props.pendingUserDraft?.trim()) {
    return items;
  }

  return [
    {
      id: `${turn.id}:pending-user`,
      kind: "user",
      text: props.pendingUserDraft.trim(),
      source: "human",
    },
    ...items,
  ];
}

function hasVisibleTurn(turn: TurnLike, isLive: boolean): boolean {
  return orderedItems(turn, isLive).length > 0;
}

function stepsKey(turn: TurnLike): string {
  return `workspace-transcript-steps:${turn.id}`;
}

function isStepsExpanded(turn: TurnLike, isLive: boolean): boolean {
  const override = props.collapseOverrides[stepsKey(turn)];
  if (typeof override === "boolean") {
    return override;
  }
  if (isLive) {
    return true;
  }
  return turn.status === "failed" || turn.status === "interrupted";
}

function toggleSteps(turn: TurnLike, isLive: boolean) {
  emit("setCollapseOverride", stepsKey(turn), !isStepsExpanded(turn, isLive));
}

function turnToneClass(turn: TurnLike, isLive: boolean): string[] {
  return [
    "turn-stack",
    isLive ? "turn-stack--live" : "",
    turn.status === "failed" ? "turn-stack--error" : "",
    turn.status === "interrupted" ? "turn-stack--warning" : "",
  ].filter(Boolean);
}

function stepToggleLabel(turn: TurnLike, isLive: boolean): string {
  if (isLive && props.liveTranscriptTurn) {
    return "Working";
  }
  return isStepsExpanded(turn, isLive) ? "Hide steps" : "Show steps";
}

function stepCount(turn: TurnLike): number {
  return orderedItems(turn, false).filter(
    (item) =>
      item.kind !== "user" &&
      item.kind !== "assistant" &&
      item.kind !== "system",
  ).length;
}

function traceSummary(turn: TurnLike): string {
  const counts = {
    reasoning: 0,
    plan: 0,
    command: 0,
    tool: 0,
    fileChange: 0,
    event: 0,
  };

  for (const item of turn.items) {
    if (
      item.kind === "user" ||
      item.kind === "assistant" ||
      item.kind === "system"
    ) {
      continue;
    }
    switch (item.kind) {
      case "reasoning":
        counts.reasoning += 1;
        break;
      case "plan":
        counts.plan += 1;
        break;
      case "command":
        counts.command += 1;
        break;
      case "tool":
        counts.tool += 1;
        break;
      case "file-change":
        counts.fileChange += 1;
        break;
      case "event":
        counts.event += 1;
        break;
      default:
        break;
    }
  }

  const totalActions =
    counts.reasoning +
    counts.plan +
    counts.command +
    counts.tool +
    counts.fileChange +
    counts.event;

  const segments = [
    totalActions
      ? `${totalActions} action${totalActions === 1 ? "" : "s"}`
      : null,
    counts.command
      ? `${counts.command} command${counts.command === 1 ? "" : "s"}`
      : null,
    counts.tool ? `${counts.tool} tool${counts.tool === 1 ? "" : "s"}` : null,
    counts.fileChange
      ? `${counts.fileChange} file${counts.fileChange === 1 ? "" : "s"}`
      : null,
  ].filter((segment): segment is string => Boolean(segment));

  return segments.join(" · ") || "Trace available";
}

function initials(label: string | null | undefined, fallback: string): string {
  const value = label?.trim();
  if (!value) {
    return fallback;
  }
  return value.slice(0, 1).toUpperCase();
}

function avatarStyle(color: string | null | undefined) {
  const resolved = color?.trim() || "var(--accent)";
  return {
    backgroundColor: `${resolved}1f`,
    color: resolved,
  };
}

function userSenderLabel(): string {
  return "You";
}

function assistantSenderLabel(): string {
  return props.selectedAgentName?.trim() || "Assistant";
}

function assistantAvatarLabel(): string {
  return initials(assistantSenderLabel(), "A");
}

function assistantAvatarStyle() {
  return avatarStyle(props.selectedAgentColor);
}

function systemAvatarLabel(
  item: Extract<ItemLike, { kind: "system" }>,
): string {
  return initials(item.label, "S");
}

function systemAvatarStyle() {
  return {
    backgroundColor: "color-mix(in srgb, var(--muted) 16%, transparent)",
    color: "var(--muted)",
  };
}

function bubbleStatus(turn: TurnLike, isLive: boolean): BubbleStatus {
  if (turn.status === "failed") {
    return { state: "failed", label: "Failed" };
  }
  if (turn.status === "interrupted") {
    return { state: "interrupted", label: "Interrupted" };
  }
  if (isLive) {
    return { state: "running", label: "Working" };
  }
  if (turn.status === "completed") {
    return { state: "completed", label: "Completed" };
  }
  return { state: "running", label: "Working" };
}

function bubbleStatusClass(status: BubbleStatus): string {
  return `workspace-chat__bubble-status--${status.state}`;
}

function isDoubleTickStatus(status: BubbleStatus): boolean {
  return status.state === "running" || status.state === "completed";
}

function isErrorStatus(status: BubbleStatus): boolean {
  return status.state === "failed" || status.state === "interrupted";
}

function renderMessageMarkdown(text: string): string {
  return text.trim();
}

function renderReasoningMarkdown(
  item: Extract<ItemLike, { kind: "reasoning" }>,
): string {
  return [item.summary.join("\n"), item.content.join("\n")]
    .filter((part) => part.trim().length > 0)
    .join("\n\n");
}

function renderToolSection(
  title: string,
  content: string | null,
  language = "text",
): string | null {
  const normalized = content?.trim();
  if (!normalized) {
    return null;
  }
  return `### ${title}\n\n\`\`\`${language}\n${normalized}\n\`\`\``;
}

function fileChangeMarkdown(
  item: Extract<ItemLike, { kind: "file-change" }>,
): string {
  return [
    item.changes.length > 0
      ? `### Changes\n\n\`\`\`diff\n${item.changes.join("\n")}\n\`\`\``
      : null,
    renderToolSection("Output", item.output, "text"),
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
}

function parseJsonLike(content: string | null): unknown | null {
  const trimmed = content?.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

const SYSTEM_REMINDER_PATTERN =
  /<system-reminder>([\s\S]*?)<\/system-reminder>/gi;

function hiddenSystemBlocks(content: string | null): string[] {
  if (!content?.trim()) {
    return [];
  }
  return Array.from(content.matchAll(SYSTEM_REMINDER_PATTERN))
    .map((match) => match[1]?.trim() ?? "")
    .filter((value) => value.length > 0);
}

function stripSystemBlocks(content: string | null): string | null {
  const trimmed = content?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed
    .replace(SYSTEM_REMINDER_PATTERN, "")
    .replace(/<system-reminder\/?>([\s\S]*?)$/gi, "")
    .trim();
}

function prettyPrintContent(content: string | null): string | null {
  const trimmed = stripSystemBlocks(content);
  if (!trimmed) {
    return null;
  }
  const parsed = parseJsonLike(trimmed);
  if (parsed === null) {
    return trimmed;
  }
  return JSON.stringify(parsed, null, 2);
}

function looksLikeProse(content: string | null): boolean {
  const trimmed = content?.trim();
  if (!trimmed) {
    return false;
  }
  if (parseJsonLike(trimmed) !== null) {
    return false;
  }
  if (trimmed.includes("\n") && /(^|\n)[\[{>$#]/.test(trimmed)) {
    return false;
  }
  if (/```|diff --git|\$\s|\bERROR\b|\bWARN\b|\bException\b/i.test(trimmed)) {
    return false;
  }
  return /[.!?]/.test(trimmed) && trimmed.length < 900;
}

function renderToolText(content: string | null): string {
  return stripSystemBlocks(content) ?? "";
}

function toolHasInput(item: Extract<ItemLike, { kind: "tool" }>): boolean {
  return Boolean(item.input?.trim());
}

function toolHasOutput(item: Extract<ItemLike, { kind: "tool" }>): boolean {
  return Boolean(item.output?.trim());
}

function toolHasError(item: Extract<ItemLike, { kind: "tool" }>): boolean {
  return Boolean(item.error?.trim());
}

function toolOpenKey(item: Extract<ItemLike, { kind: "tool" }>): string {
  return `workspace-transcript-tool:${item.id}`;
}

function toolInternalContextKey(
  item: Extract<ItemLike, { kind: "tool" }>,
): string {
  return `workspace-transcript-tool-internal:${item.id}`;
}

function isToolExpanded(item: Extract<ItemLike, { kind: "tool" }>): boolean {
  const override = props.collapseOverrides[toolOpenKey(item)];
  if (typeof override === "boolean") {
    return override;
  }
  return (
    item.status === "streaming" || toolHasError(item) || toolHasOutput(item)
  );
}

function toggleTool(item: Extract<ItemLike, { kind: "tool" }>) {
  emit("setCollapseOverride", toolOpenKey(item), !isToolExpanded(item));
}

function toolHiddenSystemBlocks(
  item: Extract<ItemLike, { kind: "tool" }>,
): string[] {
  return hiddenSystemBlocks(item.input);
}

function hasToolInternalContext(
  item: Extract<ItemLike, { kind: "tool" }>,
): boolean {
  return toolHiddenSystemBlocks(item).length > 0;
}

function isToolInternalContextExpanded(
  item: Extract<ItemLike, { kind: "tool" }>,
): boolean {
  return props.collapseOverrides[toolInternalContextKey(item)] === true;
}

function toggleToolInternalContext(item: Extract<ItemLike, { kind: "tool" }>) {
  emit(
    "setCollapseOverride",
    toolInternalContextKey(item),
    !isToolInternalContextExpanded(item),
  );
}

function toolPreview(item: Extract<ItemLike, { kind: "tool" }>): string {
  const input = stripSystemBlocks(item.input);
  const json = parseJsonLike(input);

  if (json && typeof json === "object" && !Array.isArray(json)) {
    const parts = Object.entries(json as Record<string, unknown>)
      .slice(0, 3)
      .map(([key, value]) => {
        if (typeof value === "string") {
          const compact = value.replace(/\s+/g, " ").trim();
          if (!compact) {
            return null;
          }
          if (compact.length > 28) {
            return `${key}=…`;
          }
          return `${key}=${JSON.stringify(compact)}`;
        }
        if (typeof value === "number" || typeof value === "boolean") {
          return `${key}=${value}`;
        }
        if (Array.isArray(value)) {
          return `${key}=[${value.length}]`;
        }
        if (value && typeof value === "object") {
          return `${key}={…}`;
        }
        return null;
      })
      .filter((part): part is string => Boolean(part));

    if (parts.length > 0) {
      return `$ ${item.label} ${parts.join(" ")}`;
    }
  }

  if (input) {
    return `$ ${item.label} ${truncate(input.replace(/\s+/g, " "), 72)}`;
  }

  return `$ ${item.label}`;
}

function toolTerminalContent(
  item: Extract<ItemLike, { kind: "tool" }>,
): string {
  const lines = [toolPreview(item)];

  const input = prettyPrintContent(item.input);
  if (input) {
    lines.push("", "# Input", input);
  }

  if (hasToolInternalContext(item)) {
    lines.push(
      "",
      "# Internal",
      `[hidden ${toolHiddenSystemBlocks(item).length} block${toolHiddenSystemBlocks(item).length === 1 ? "" : "s"}]`,
    );
  }

  const output = looksLikeProse(item.output)
    ? renderToolText(item.output)
    : prettyPrintContent(item.output);
  if (output) {
    lines.push("", "# Output", output);
  }

  const error = renderToolText(item.error);
  if (error) {
    lines.push("", "# Error", error);
  }

  return lines.join("\n");
}

function commandExitTone(
  item: Extract<ItemLike, { kind: "command" }>,
): string | null {
  if (item.exitCode === null) {
    return item.status === "streaming" ? "running" : null;
  }
  return item.exitCode === 0 ? "ok" : "error";
}

function commandExitLabel(
  item: Extract<ItemLike, { kind: "command" }>,
): string | null {
  if (item.exitCode === null) {
    return item.status === "streaming" ? "running" : null;
  }
  return item.exitCode === 0 ? "exit 0" : `exit ${item.exitCode}`;
}

function commandBodyLabel(
  item: Extract<ItemLike, { kind: "command" }>,
): string | null {
  const cwd = item.cwd?.trim();
  return cwd && cwd.length > 0 ? cwd : null;
}

function normalizedCommand(
  item: Extract<ItemLike, { kind: "command" }>,
): string {
  const cleaned = item.command.trim();
  return cleaned || item.command.trim();
}

function commandPreview(item: Extract<ItemLike, { kind: "command" }>): string {
  return `$ ${commandSummary(item)}`;
}

function commandTerminalTranscript(
  item: Extract<ItemLike, { kind: "command" }>,
): string {
  const lines = [normalizedCommand(item)].filter(Boolean);
  if (item.output.trim()) {
    lines.push(item.output.trimEnd());
  }
  if (item.terminalInputs.length > 0) {
    lines.push(item.terminalInputs.join("\n"));
  }
  return lines.join("\n\n");
}

function commandSummary(item: Extract<ItemLike, { kind: "command" }>): string {
  return truncate(normalizedCommand(item).replace(/\s+/g, " "), 100);
}

function commandDisplay(item: Extract<ItemLike, { kind: "command" }>): string {
  const chunks = [`$ ${normalizedCommand(item)}`];
  if (item.output.trim()) {
    chunks.push(item.output.trimEnd());
  }
  if (item.terminalInputs.length > 0) {
    chunks.push(item.terminalInputs.join("\n"));
  }
  return chunks.join("\n");
}

function commandOutputLines(
  item: Extract<ItemLike, { kind: "command" }>,
): string[] {
  return commandTerminalTranscript(item)
    .trim()
    .split("\n")
    .filter((line) => line.length > 0);
}

function commandOpenKey(item: Extract<ItemLike, { kind: "command" }>): string {
  return `workspace-transcript-command:${item.id}`;
}

function isCommandExpanded(
  item: Extract<ItemLike, { kind: "command" }>,
): boolean {
  const override = props.collapseOverrides[commandOpenKey(item)];
  if (typeof override === "boolean") {
    return override;
  }
  return (
    commandOutputLines(item).length <= 12 ||
    item.status === "streaming" ||
    (item.exitCode !== null && item.exitCode !== 0)
  );
}

function toggleCommand(item: Extract<ItemLike, { kind: "command" }>) {
  emit("setCollapseOverride", commandOpenKey(item), !isCommandExpanded(item));
}

function statusChipClass(tone: TranscriptStatusChip["tone"]): string[] {
  switch (tone) {
    case "warning":
      return ["workspace-chat__chip--warning", "chip-warn"];
    case "error":
      return ["workspace-chat__chip--error", "chip-danger"];
    case "info":
      return ["workspace-chat__chip--info"];
    case "muted":
    default:
      return ["workspace-chat__chip--muted"];
  }
}

function updatePinnedToLatest() {
  const container = transcriptBody.value;
  if (!container) {
    return;
  }

  chatStore.setTranscriptPinnedToLatest(
    container.scrollHeight - container.scrollTop - container.clientHeight <= 24,
  );
}

async function scrollTranscriptToLatest() {
  await nextTick();
  const container = transcriptBody.value;
  if (!container || !hasTranscriptContent.value) {
    return;
  }
  container.scrollTo({
    top: container.scrollHeight,
    behavior: "auto",
  });
  updatePinnedToLatest();
}

function handleTranscriptScroll() {
  updatePinnedToLatest();
}

function jumpToLatest() {
  chatStore.setTranscriptPinnedToLatest(true);
  void scrollTranscriptToLatest();
}

watch(
  () => props.liveTranscriptTurn,
  (turn, previousTurn) => {
    if (settlingLiveTurnTimer) {
      clearTimeout(settlingLiveTurnTimer);
      settlingLiveTurnTimer = null;
    }
    if (!turn && previousTurn) {
      settlingLiveTurn.value = previousTurn;
      settlingLiveTurnTimer = setTimeout(() => {
        settlingLiveTurn.value = null;
        settlingLiveTurnTimer = null;
      }, 450);
      return;
    }
    settlingLiveTurn.value = turn;
  },
  { immediate: true },
);

watch(
  () => props.selectedThreadId,
  () => {
    chatStore.setTranscriptPinnedToLatest(true);
    void scrollTranscriptToLatest();
  },
  { immediate: true, flush: "post" },
);

watch(
  [
    () => props.committedTranscript,
    () => props.liveTranscriptTurn,
    () => settlingLiveTurn.value,
  ],
  () => {
    if (transcriptPinnedToLatest.value) {
      void scrollTranscriptToLatest();
    }
  },
  { deep: true, flush: "post" },
);

onMounted(() => {
  updatePinnedToLatest();
});

onBeforeUnmount(() => {
  if (settlingLiveTurnTimer) {
    clearTimeout(settlingLiveTurnTimer);
    settlingLiveTurnTimer = null;
  }
});
</script>

<template>
  <div v-if="hasTranscriptContent" class="workspace-chat__body-shell">
    <div
      ref="transcriptBody"
      class="workspace-chat__body"
      @scroll="handleTranscriptScroll"
    >
      <div class="workspace-chat__timeline">
        <div
          v-if="transcriptStatusChips.length > 0"
          class="chip-row workspace-chat__chips"
        >
          <span
            v-for="chip in transcriptStatusChips"
            :key="chip.id"
            class="chip workspace-chat__chip"
            :class="statusChipClass(chip.tone)"
          >
            {{ chip.text }}
          </span>
        </div>

        <section
          v-for="entry in turns"
          v-show="hasVisibleTurn(entry.turn, entry.isLive)"
          :key="entry.turn.id"
          :class="turnToneClass(entry.turn, entry.isLive)"
        >
          <article
            v-for="item in orderedItems(entry.turn, entry.isLive)"
            :key="item.id"
            class="workspace-chat__message-row"
            :class="[
              item.kind === 'user'
                ? 'workspace-chat__message-row--right'
                : 'workspace-chat__message-row--left',
            ]"
          >
            <template v-if="item.kind === 'user'">
              <div class="workspace-chat__message-stack">
                <div
                  class="workspace-chat__bubble workspace-chat__bubble--user"
                >
                  <span class="workspace-chat__bubble-copy">
                    {{ item.text }}
                  </span>
                  <span
                    class="workspace-chat__bubble-status"
                    :class="
                      bubbleStatusClass(bubbleStatus(entry.turn, entry.isLive))
                    "
                    :title="bubbleStatus(entry.turn, entry.isLive).label"
                  >
                    <svg
                      class="workspace-chat__bubble-status-icon workspace-chat__bubble-status-icon--double"
                      :class="{
                        'is-active': isDoubleTickStatus(
                          bubbleStatus(entry.turn, entry.isLive),
                        ),
                      }"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path d="M2.5 8.5L5.5 11.5L10.5 4.5"></path>
                      <path d="M6.5 8.5L9.5 11.5L14 5.5"></path>
                    </svg>
                    <svg
                      v-if="
                        isErrorStatus(bubbleStatus(entry.turn, entry.isLive))
                      "
                      class="workspace-chat__bubble-status-icon workspace-chat__bubble-status-icon--error is-active"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path d="M8 3.5v6"></path>
                      <path d="M8 11.5h.01"></path>
                    </svg>
                  </span>
                </div>
              </div>
            </template>

            <template v-else-if="item.kind === 'system'">
              <div
                class="workspace-msg-list__avatar workspace-msg-list__avatar--system"
                :style="systemAvatarStyle()"
                :title="item.label"
              >
                {{ systemAvatarLabel(item) }}
              </div>
              <div
                class="workspace-chat__message-stack workspace-chat__message-stack--agent"
              >
                <div
                  class="workspace-chat__bubble workspace-chat__bubble--system"
                >
                  <div class="workspace-chat__bubble-label">
                    {{ item.label }}
                  </div>
                  <div
                    class="codex-markdown codex-markdown--compact workspace-chat__bubble-text"
                    v-html="
                      renderMarkdownHtml(renderMessageMarkdown(item.detail))
                    "
                  ></div>
                </div>
              </div>
            </template>

            <template v-else-if="item.kind === 'assistant'">
              <div
                class="workspace-msg-list__avatar"
                :style="assistantAvatarStyle()"
                :title="assistantSenderLabel()"
              >
                {{ assistantAvatarLabel() }}
              </div>
              <div
                class="workspace-chat__message-stack workspace-chat__message-stack--agent"
              >
                <div
                  class="workspace-chat__bubble workspace-chat__bubble--assistant"
                >
                  <div
                    class="codex-markdown codex-markdown--compact"
                    v-html="
                      renderMarkdownHtml(renderMessageMarkdown(item.text))
                    "
                  ></div>
                </div>
              </div>
            </template>

            <template v-else>
              <div
                class="workspace-msg-list__avatar"
                :style="assistantAvatarStyle()"
                :title="assistantSenderLabel()"
              >
                {{ assistantAvatarLabel() }}
              </div>
              <div
                class="turn-stack__items workspace-chat__message-stack workspace-chat__message-stack--agent"
              >
                <article
                  class="workspace-chat__step-item"
                  :class="[
                    item.kind === 'command'
                      ? 'workspace-msg-item--command'
                      : 'workspace-msg-item--work',
                    item.kind === 'command' &&
                    item.exitCode !== null &&
                    item.exitCode !== 0
                      ? 'workspace-msg-item--terminal-error'
                      : '',
                  ]"
                >
                  <template v-if="item.kind === 'reasoning'">
                    <div class="workspace-msg-item__title eyebrow">
                      Thinking
                    </div>
                    <div
                      class="workspace-chat__step-body workspace-chat__step-body--subtle"
                    >
                      <div
                        class="codex-markdown codex-markdown--compact"
                        v-html="
                          renderMarkdownHtml(renderReasoningMarkdown(item))
                        "
                      ></div>
                    </div>
                  </template>

                  <template v-else-if="item.kind === 'plan'">
                    <div class="workspace-msg-item__title eyebrow">Plan</div>
                    <div
                      class="workspace-chat__step-body workspace-chat__step-body--subtle"
                    >
                      <div
                        class="codex-markdown codex-markdown--compact"
                        v-html="
                          renderMarkdownHtml(renderMessageMarkdown(item.text))
                        "
                      ></div>
                    </div>
                  </template>

                  <template v-else-if="item.kind === 'command'">
                    <button
                      type="button"
                      class="workspace-chat__command-toggle"
                      :aria-expanded="isCommandExpanded(item)"
                      @click="toggleCommand(item)"
                    >
                      <div class="workspace-chat__terminal-frame">
                        <div class="workspace-chat__terminal-bar">
                          <span class="workspace-chat__terminal-dot"></span>
                          <span class="workspace-chat__terminal-dot"></span>
                          <span class="workspace-chat__terminal-dot"></span>
                          <span class="workspace-msg-item__title eyebrow"
                            >Shell</span
                          >
                          <span
                            v-if="commandBodyLabel(item)"
                            class="mono muted"
                            >{{ commandBodyLabel(item) }}</span
                          >
                          <span style="flex: 1"></span>
                          <span
                            v-if="commandExitLabel(item)"
                            class="chip workspace-chat__terminal-chip"
                            :class="[
                              commandExitTone(item)
                                ? `workspace-chat__terminal-chip--${commandExitTone(item)}`
                                : '',
                            ]"
                          >
                            {{ commandExitLabel(item) }}
                          </span>
                        </div>
                        <pre
                          class="code-block workspace-chat__code-block workspace-chat__code-block--terminal"
                          :class="{
                            'workspace-chat__code-block--terminal-preview':
                              !isCommandExpanded(item),
                          }"
                        ><code class="mono">{{ isCommandExpanded(item) ? commandDisplay(item) : commandPreview(item) }}</code></pre>
                      </div>
                    </button>
                    <div
                      v-if="isCommandExpanded(item)"
                      class="workspace-chat__command-body"
                    >
                      <div
                        v-if="item.exitCode !== null && item.exitCode !== 0"
                        class="workspace-chat__meta-line eyebrow workspace-chat__meta-line--error"
                      >
                        Command exited with {{ item.exitCode }}
                      </div>
                    </div>
                  </template>

                  <template v-else-if="item.kind === 'tool'">
                    <button
                      type="button"
                      class="workspace-chat__command-toggle"
                      :aria-expanded="isToolExpanded(item)"
                      @click="toggleTool(item)"
                    >
                      <div class="workspace-chat__terminal-frame">
                        <div class="workspace-chat__terminal-bar">
                          <span class="workspace-chat__terminal-dot"></span>
                          <span class="workspace-chat__terminal-dot"></span>
                          <span class="workspace-chat__terminal-dot"></span>
                          <span class="workspace-msg-item__title eyebrow">{{
                            item.label
                          }}</span>
                          <span style="flex: 1"></span>
                          <span
                            v-if="item.status === 'streaming'"
                            class="chip workspace-chat__terminal-chip workspace-chat__terminal-chip--running"
                          >
                            running
                          </span>
                        </div>
                        <pre
                          class="code-block workspace-chat__code-block workspace-chat__code-block--terminal"
                          :class="{
                            'workspace-chat__code-block--terminal-preview':
                              !isToolExpanded(item),
                          }"
                        ><code class="mono">{{ isToolExpanded(item) ? toolTerminalContent(item) : toolPreview(item) }}</code></pre>
                      </div>
                    </button>
                    <div
                      v-if="isToolExpanded(item)"
                      class="workspace-chat__tool-body"
                    >
                      <div
                        v-if="hasToolInternalContext(item)"
                        class="workspace-chat__tool-internal"
                      >
                        <button
                          type="button"
                          class="chip workspace-chat__steps-toggle"
                          :aria-expanded="isToolInternalContextExpanded(item)"
                          @click="toggleToolInternalContext(item)"
                        >
                          <span
                            class="workspace-chat__steps-toggle-icon"
                            aria-hidden="true"
                          >
                            {{
                              isToolInternalContextExpanded(item) ? "▾" : "▸"
                            }}
                          </span>
                          <span class="workspace-chat__steps-toggle-text">
                            Internal context
                          </span>
                        </button>
                        <section
                          v-if="isToolInternalContextExpanded(item)"
                          class="workspace-chat__steps"
                        >
                          <div
                            v-for="block in toolHiddenSystemBlocks(item)"
                            :key="block"
                            class="workspace-chat__step-item workspace-msg-item--work"
                          >
                            <div class="workspace-msg-item__title eyebrow">
                              Hidden context
                            </div>
                            <div
                              class="workspace-chat__step-body workspace-chat__step-body--subtle"
                            >
                              <div
                                class="codex-markdown codex-markdown--compact"
                                v-html="
                                  renderMarkdownHtml(
                                    renderMessageMarkdown(block),
                                  )
                                "
                              ></div>
                            </div>
                          </div>
                        </section>
                      </div>
                    </div>
                  </template>

                  <template v-else-if="item.kind === 'file-change'">
                    <div class="workspace-msg-item__title eyebrow">
                      File changes
                    </div>
                    <div
                      class="workspace-chat__step-body workspace-chat__step-body--subtle"
                    >
                      <div
                        class="codex-markdown codex-markdown--compact"
                        v-html="renderMarkdownHtml(fileChangeMarkdown(item))"
                      ></div>
                    </div>
                  </template>

                  <template v-else-if="item.kind === 'event'">
                    <div class="workspace-msg-item__title eyebrow">
                      {{ item.label }}
                    </div>
                    <div
                      class="workspace-chat__step-body workspace-chat__step-body--subtle"
                    >
                      <div
                        class="codex-markdown codex-markdown--compact"
                        v-html="
                          renderMarkdownHtml(renderMessageMarkdown(item.detail))
                        "
                      ></div>
                    </div>
                  </template>
                </article>
              </div>
            </template>
          </article>
        </section>
      </div>
    </div>

    <button
      v-if="!transcriptPinnedToLatest"
      type="button"
      class="workspace-chat__jump-latest"
      aria-label="Jump to latest message"
      @click="jumpToLatest"
    >
      <span aria-hidden="true">↓</span>
    </button>
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
    class="chip-row workspace-chat__chips workspace-chat__chips--standalone"
  >
    <span
      v-for="chip in transcriptStatusChips"
      :key="chip.id"
      class="chip workspace-chat__chip"
      :class="statusChipClass(chip.tone)"
    >
      {{ chip.text }}
    </span>
  </div>
</template>
