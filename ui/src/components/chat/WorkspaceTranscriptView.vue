<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import MarkdownRenderer from "../MarkdownRenderer.vue";
import {
  type LiveTranscriptItem,
  type LiveTranscriptTurn,
  type TranscriptItem,
  type TranscriptTurn,
} from "../../lib/transcript";
import { truncate } from "../../lib/format";

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

type TurnLike = TranscriptTurn | LiveTranscriptTurn;
type ItemLike = TranscriptItem | LiveTranscriptItem;
type UserItemLike = Extract<ItemLike, { kind: "user" }>;

const transcriptBody = ref<HTMLElement | null>(null);
const settlingLiveTurn = ref<LiveTranscriptTurn | null>(null);
const rowFilter = ref<"all" | "work" | "messages" | "errors">("all");
let settlingLiveTurnTimer: ReturnType<typeof setTimeout> | null = null;

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
      return item.kind === "user" || item.kind === "assistant";
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
  if (item.kind === "command") {
    return item.exitCode !== null && item.exitCode !== 0;
  }
  if (item.kind === "tool") {
    return Boolean(item.error?.trim());
  }
  return false;
}

function userItem(turn: TurnLike, isLive: boolean): UserItemLike | null {
  const existing = turn.items.find((item) => item.kind === "user");
  if (existing?.kind === "user") {
    return existing;
  }
  if (isLive && props.pendingUserDraft?.trim()) {
    return {
      id: `${turn.id}:pending-user`,
      kind: "user",
      text: props.pendingUserDraft.trim(),
      source: "human",
    };
  }
  return null;
}

function userPrompt(turn: TurnLike, isLive: boolean): string | null {
  return userItem(turn, isLive)?.text ?? null;
}

function responseItem(
  turn: TurnLike,
): Extract<ItemLike, { kind: "assistant" }> | null {
  for (let index = turn.items.length - 1; index >= 0; index -= 1) {
    const item = turn.items[index];
    if (item?.kind === "assistant" && item.text.trim().length > 0) {
      return item;
    }
  }
  return null;
}

function stepItems(turn: TurnLike): ItemLike[] {
  const response = responseItem(turn);
  return turn.items.filter((item) => {
    if (!matchesFilter(item)) {
      return false;
    }
    if (item.kind === "user") {
      return false;
    }
    if (response && item.id === response.id) {
      return false;
    }
    return true;
  });
}

function hasVisibleTurn(turn: TurnLike, isLive: boolean): boolean {
  const response = responseItem(turn);
  if (response && matchesFilter(response)) {
    return true;
  }
  if (
    userPrompt(turn, isLive) &&
    rowFilter.value !== "work" &&
    rowFilter.value !== "errors"
  ) {
    return true;
  }
  return stepItems(turn).length > 0;
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
  return stepItems(turn).length;
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

  for (const item of stepItems(turn)) {
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

function isContactUserItem(item: UserItemLike | null): boolean {
  return item?.source === "contact";
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

function userSenderLabel(item: UserItemLike | null): string {
  if (isContactUserItem(item)) {
    return item?.contact?.senderAgentId || "Contact";
  }
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

function bubbleStatus(
  turn: TurnLike,
  isLive: boolean,
): {
  icon: string;
  label: string;
} {
  if (isLive || turn.status === "inProgress") {
    return { icon: "✓✓", label: "Working" };
  }
  if (turn.status === "failed") {
    return { icon: "!", label: "Failed" };
  }
  if (turn.status === "interrupted") {
    return { icon: "!", label: "Interrupted" };
  }
  return { icon: "✓", label: "Sent" };
}

function showBubbleStatus(item: UserItemLike | null): boolean {
  return !isContactUserItem(item);
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

function stripSystemReminder(content: string): string {
  return stripSystemBlocks(content) ?? "";
}

function normalizedCommand(
  item: Extract<ItemLike, { kind: "command" }>,
): string {
  const cleaned = stripSystemReminder(item.command);
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

async function scrollTranscriptToLatest() {
  await nextTick();
  const container = transcriptBody.value;
  if (!container || !hasTranscriptContent.value) {
    return;
  }
  container.scrollTop = container.scrollHeight;
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
</script>

<template>
  <div
    v-if="hasTranscriptContent"
    ref="transcriptBody"
    class="workspace-chat__body"
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
          v-if="userPrompt(entry.turn, entry.isLive)"
          class="workspace-chat__message-row workspace-chat__message-row--right"
        >
          <div class="workspace-chat__message-stack">
            <div
              class="workspace-chat__bubble"
              :class="[
                isContactUserItem(userItem(entry.turn, entry.isLive))
                  ? 'workspace-chat__bubble--contact'
                  : 'workspace-chat__bubble--user',
              ]"
              :title="
                isContactUserItem(userItem(entry.turn, entry.isLive))
                  ? userSenderLabel(userItem(entry.turn, entry.isLive))
                  : undefined
              "
            >
              <span class="workspace-chat__bubble-copy">
                {{ userPrompt(entry.turn, entry.isLive) }}
              </span>
              <span
                v-if="showBubbleStatus(userItem(entry.turn, entry.isLive))"
                class="workspace-chat__bubble-status"
                :title="bubbleStatus(entry.turn, entry.isLive).label"
              >
                {{ bubbleStatus(entry.turn, entry.isLive).icon }}
              </span>
            </div>
          </div>
        </article>

        <div
          class="workspace-chat__message-row workspace-chat__message-row--left"
          v-if="responseItem(entry.turn) || stepItems(entry.turn).length > 0"
        >
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
              v-if="
                responseItem(entry.turn) &&
                matchesFilter(responseItem(entry.turn)!)
              "
              class="workspace-chat__bubble workspace-chat__bubble--assistant"
            >
              <MarkdownRenderer
                :content="renderMessageMarkdown(responseItem(entry.turn)!.text)"
                compact
              />
            </article>

            <button
              v-if="stepItems(entry.turn).length > 0"
              type="button"
              class="chip workspace-chat__steps-toggle"
              :class="{
                'workspace-chat__steps-toggle--summary': !isStepsExpanded(
                  entry.turn,
                  entry.isLive,
                ),
              }"
              :aria-expanded="isStepsExpanded(entry.turn, entry.isLive)"
              @click="toggleSteps(entry.turn, entry.isLive)"
            >
              <span
                class="workspace-chat__steps-toggle-icon"
                aria-hidden="true"
              >
                {{ isStepsExpanded(entry.turn, entry.isLive) ? "▾" : "▸" }}
              </span>
              <span class="workspace-chat__steps-toggle-text">
                {{
                  isStepsExpanded(entry.turn, entry.isLive)
                    ? stepToggleLabel(entry.turn, entry.isLive)
                    : traceSummary(entry.turn)
                }}
              </span>
              <span class="workspace-chat__steps-toggle-count">
                {{ stepCount(entry.turn) }} steps
              </span>
            </button>

            <section
              v-if="
                stepItems(entry.turn).length > 0 &&
                isStepsExpanded(entry.turn, entry.isLive)
              "
              class="workspace-chat__steps"
            >
              <article
                v-for="item in stepItems(entry.turn)"
                :key="item.id"
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
                  <div class="workspace-msg-item__title eyebrow">Thinking</div>
                  <div
                    class="workspace-chat__step-body workspace-chat__step-body--subtle"
                  >
                    <MarkdownRenderer
                      :content="renderReasoningMarkdown(item)"
                      compact
                    />
                  </div>
                </template>

                <template v-else-if="item.kind === 'plan'">
                  <div class="workspace-msg-item__title eyebrow">Plan</div>
                  <div
                    class="workspace-chat__step-body workspace-chat__step-body--subtle"
                  >
                    <MarkdownRenderer
                      :content="renderMessageMarkdown(item.text)"
                      compact
                    />
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
                        class="btn workspace-chat__tool-internal-toggle"
                        :aria-expanded="isToolInternalContextExpanded(item)"
                        @click="toggleToolInternalContext(item)"
                      >
                        <span>{{
                          isToolInternalContextExpanded(item)
                            ? "Hide internal context"
                            : "Show internal context"
                        }}</span>
                        <span class="workspace-chat__tool-internal-count muted"
                          >{{
                            toolHiddenSystemBlocks(item).length
                          }}
                          hidden</span
                        >
                      </button>
                      <pre
                        v-if="isToolInternalContextExpanded(item)"
                        class="code-block workspace-chat__code-block workspace-chat__code-block--internal"
                      ><code>{{ toolHiddenSystemBlocks(item).join('\n\n') }}</code></pre>
                    </div>
                  </div>
                </template>

                <template v-else-if="item.kind === 'file-change'">
                  <div class="workspace-msg-item__title eyebrow">
                    File changes
                  </div>
                  <div class="workspace-chat__step-body">
                    <MarkdownRenderer
                      :content="fileChangeMarkdown(item)"
                      compact
                    />
                  </div>
                </template>

                <template v-else-if="item.kind === 'event'">
                  <div class="workspace-msg-item__title eyebrow">
                    {{ item.label }}
                  </div>
                  <div
                    class="workspace-chat__step-body workspace-chat__step-body--subtle"
                  >
                    <MarkdownRenderer
                      :content="renderMessageMarkdown(item.detail)"
                      compact
                    />
                  </div>
                </template>

                <template v-else-if="item.kind === 'assistant'">
                  <div
                    class="workspace-chat__step-body workspace-chat__step-body--subtle"
                  >
                    <MarkdownRenderer
                      :content="renderMessageMarkdown(item.text)"
                      compact
                    />
                  </div>
                </template>
              </article>
            </section>
          </div>
        </div>
      </section>
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
