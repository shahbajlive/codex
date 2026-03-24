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
  selectedThreadId: string | null;
  committedTranscript: TranscriptTurn[];
  liveTranscriptTurn: LiveTranscriptTurn | null;
  activeTurnId: string | null;
  pendingUserDraft: string | null;
  collapseOverrides: Record<string, boolean>;
  statusMessage: string | null;
  statusTone: "info" | "warning" | "error" | null;
}>();

const emit = defineEmits<{
  setCollapseOverride: [key: string, expanded: boolean];
  setCollapseOverrides: [updates: Record<string, boolean>];
}>();

type TranscriptStatusChip = {
  id: string;
  text: string;
  tone: "info" | "warning" | "error" | "muted";
};

type ToolTab = "input" | "output" | "error";

type TurnLike = TranscriptTurn | LiveTranscriptTurn;
type ItemLike = TranscriptItem | LiveTranscriptItem;

const transcriptBody = ref<HTMLElement | null>(null);
const settlingLiveTurn = ref<LiveTranscriptTurn | null>(null);
const rowFilter = ref<"all" | "work" | "messages" | "errors">("all");
const compactMode = ref(false);
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

function userPrompt(turn: TurnLike, isLive: boolean): string | null {
  const userItem = turn.items.find((item) => item.kind === "user");
  if (userItem?.kind === "user") {
    return userItem.text;
  }
  if (isLive && props.pendingUserDraft?.trim()) {
    return props.pendingUserDraft.trim();
  }
  return null;
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
  return true;
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

function turnSuffix(turn: TurnLike, isLive: boolean): string | null {
  if (isLive && props.liveTranscriptTurn) {
    return "live";
  }
  if (turn.status === "failed") {
    return "error";
  }
  if (turn.status === "interrupted") {
    return "interrupted";
  }
  if (turn.status === "completed") {
    return "done";
  }
  return null;
}

function turnSuffixClass(turn: TurnLike, isLive: boolean): string[] {
  return [
    "turn-header__suffix",
    isLive ? "turn-header__suffix--running" : "",
    turn.status === "failed" ? "turn-header__suffix--error" : "",
    turn.status === "interrupted" ? "turn-header__suffix--warning" : "",
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

function prettyPrintContent(content: string | null): string | null {
  const trimmed = content?.trim();
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
  return content?.trim() ?? "";
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

function toolTabKey(item: Extract<ItemLike, { kind: "tool" }>): string {
  return `workspace-transcript-tool-tab:${item.id}`;
}

function availableToolTabs(
  item: Extract<ItemLike, { kind: "tool" }>,
): ToolTab[] {
  const tabs: ToolTab[] = [];
  if (toolHasInput(item)) {
    tabs.push("input");
  }
  if (toolHasOutput(item)) {
    tabs.push("output");
  }
  if (toolHasError(item)) {
    tabs.push("error");
  }
  return tabs;
}

function defaultToolTab(item: Extract<ItemLike, { kind: "tool" }>): ToolTab {
  if (toolHasError(item)) {
    return "error";
  }
  if (toolHasOutput(item)) {
    return "output";
  }
  return "input";
}

function activeToolTab(item: Extract<ItemLike, { kind: "tool" }>): ToolTab {
  const override = props.collapseOverrides[toolTabKey(item)];
  const tabs = availableToolTabs(item);
  if (
    typeof override === "string" &&
    ["input", "output", "error"].includes(override) &&
    tabs.includes(override as ToolTab)
  ) {
    return override as ToolTab;
  }
  return defaultToolTab(item);
}

function setToolTab(item: Extract<ItemLike, { kind: "tool" }>, tab: ToolTab) {
  emit("setCollapseOverride", toolTabKey(item), tab);
}

function toolTabLabel(tab: ToolTab): string {
  switch (tab) {
    case "input":
      return "Input";
    case "output":
      return "Output";
    case "error":
      return "Error";
  }
}

function toolSubtitle(
  item: Extract<ItemLike, { kind: "tool" }>,
): string | null {
  const input = item.input?.trim();
  if (!input) {
    return item.status === "streaming" ? "Running" : null;
  }
  const json = parseJsonLike(input);
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const entries = Object.entries(json as Record<string, unknown>)
      .slice(0, 2)
      .map(([key, value]) => {
        const normalized =
          typeof value === "string"
            ? value
            : typeof value === "number" || typeof value === "boolean"
              ? String(value)
              : Array.isArray(value)
                ? `${value.length} items`
                : value && typeof value === "object"
                  ? "object"
                  : "value";
        return `${key}=${truncate(normalized, 28)}`;
      });
    if (entries.length > 0) {
      return entries.join(" · ");
    }
  }
  return truncate(input.replace(/\s+/g, " "), 64);
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
  return content
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "")
    .replace(/<system-reminder\/?>([\s\S]*?)$/gi, "")
    .trim();
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
          class="turn-header workspace-chat__prompt-card"
        >
          <span class="turn-header__content">
            <span class="turn-header__label-row">
              <span class="turn-header__label">User</span>
              <span
                v-if="turnSuffix(entry.turn, entry.isLive)"
                :class="turnSuffixClass(entry.turn, entry.isLive)"
              >
                {{ turnSuffix(entry.turn, entry.isLive) }}
              </span>
            </span>
            <span class="turn-header__preview">
              {{ userPrompt(entry.turn, entry.isLive) }}
            </span>
          </span>
        </article>

        <button
          v-if="stepItems(entry.turn).length > 0"
          type="button"
          class="workspace-chat__steps-toggle"
          :aria-expanded="isStepsExpanded(entry.turn, entry.isLive)"
          @click="toggleSteps(entry.turn, entry.isLive)"
        >
          <span class="workspace-chat__steps-toggle-icon" aria-hidden="true">
            {{ isStepsExpanded(entry.turn, entry.isLive) ? "▾" : "▸" }}
          </span>
          <span class="workspace-chat__steps-toggle-text">
            {{ stepToggleLabel(entry.turn, entry.isLive) }}
          </span>
          <span class="workspace-chat__steps-toggle-count">
            {{ stepCount(entry.turn) }} steps
          </span>
        </button>

        <div
          class="turn-stack__items"
          :class="{
            'workspace-chat__items--compact': compactMode,
            'workspace-chat__markdown--compact': compactMode,
          }"
        >
          <section
            v-if="
              stepItems(entry.turn).length > 0 &&
              isStepsExpanded(entry.turn, entry.isLive)
            "
            class="workspace-chat__steps workspace-chat__steps-panel"
          >
            <article
              v-for="item in stepItems(entry.turn)"
              :key="item.id"
              class="workspace-msg-item workspace-chat__step-item"
              :class="[
                item.kind === 'command'
                  ? 'workspace-msg-item--command'
                  : 'workspace-msg-item--work',
                item.kind === 'event' ? 'workspace-msg-item--event' : '',
                item.kind === 'command' &&
                item.exitCode !== null &&
                item.exitCode !== 0
                  ? 'workspace-msg-item--terminal-error'
                  : '',
              ]"
            >
              <template v-if="item.kind === 'reasoning'">
                <div class="workspace-msg-item__title">Thinking</div>
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
                <div class="workspace-msg-item__title">Plan</div>
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
                      <span
                        class="workspace-msg-item__title workspace-chat__terminal-label"
                        >Shell</span
                      >
                      <span
                        v-if="commandBodyLabel(item)"
                        class="workspace-chat__terminal-title"
                        >{{ commandBodyLabel(item) }}</span
                      >
                      <span class="workspace-chat__terminal-spacer"></span>
                      <span
                        v-if="commandExitLabel(item)"
                        class="workspace-chat__terminal-chip"
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
                      class="workspace-chat__code-block workspace-chat__code-block--terminal"
                      :class="{
                        'workspace-chat__code-block--terminal-preview':
                          !isCommandExpanded(item),
                      }"
                    ><code>{{ isCommandExpanded(item) ? commandDisplay(item) : commandPreview(item) }}</code></pre>
                  </div>
                </button>
                <div
                  v-if="isCommandExpanded(item)"
                  class="workspace-chat__command-body"
                >
                  <div
                    v-if="item.exitCode !== null && item.exitCode !== 0"
                    class="workspace-chat__meta-line workspace-chat__meta-line--error"
                  >
                    Command exited with {{ item.exitCode }}
                  </div>
                </div>
              </template>

              <template v-else-if="item.kind === 'tool'">
                <div class="workspace-chat__tool-header">
                  <div class="workspace-chat__tool-heading">
                    <span class="workspace-msg-item__title">{{
                      item.label
                    }}</span>
                    <span
                      v-if="item.status === 'streaming'"
                      class="workspace-chat__status-badge workspace-chat__status-badge--running"
                    >
                      running
                    </span>
                  </div>
                  <div
                    v-if="toolSubtitle(item)"
                    class="workspace-chat__tool-subtitle"
                  >
                    {{ toolSubtitle(item) }}
                  </div>
                </div>
                <div class="workspace-chat__tool-body">
                  <div
                    v-if="availableToolTabs(item).length > 0"
                    class="workspace-chat__tool-panel"
                  >
                    <div class="workspace-chat__tool-tabs" role="tablist">
                      <button
                        v-for="tab in availableToolTabs(item)"
                        :key="tab"
                        type="button"
                        class="workspace-chat__tool-tab"
                        :class="{
                          'workspace-chat__tool-tab--active':
                            activeToolTab(item) === tab,
                          'workspace-chat__tool-tab--error': tab === 'error',
                        }"
                        :aria-selected="activeToolTab(item) === tab"
                        @click="setToolTab(item, tab)"
                      >
                        {{ toolTabLabel(tab) }}
                      </button>
                    </div>

                    <div class="workspace-chat__tool-panel-body">
                      <template v-if="activeToolTab(item) === 'input'">
                        <pre
                          class="workspace-chat__code-block"
                        ><code>{{ prettyPrintContent(item.input) }}</code></pre>
                      </template>

                      <template v-else-if="activeToolTab(item) === 'output'">
                        <MarkdownRenderer
                          v-if="looksLikeProse(item.output)"
                          :content="renderToolText(item.output)"
                          compact
                        />
                        <pre
                          v-else
                          class="workspace-chat__code-block workspace-chat__code-block--output"
                        ><code>{{ prettyPrintContent(item.output) }}</code></pre>
                      </template>

                      <template v-else-if="activeToolTab(item) === 'error'">
                        <pre
                          class="workspace-chat__code-block workspace-chat__code-block--error"
                        ><code>{{ renderToolText(item.error) }}</code></pre>
                      </template>
                    </div>
                  </div>
                </div>
              </template>

              <template v-else-if="item.kind === 'file-change'">
                <div class="workspace-msg-item__title">File changes</div>
                <div class="workspace-chat__step-body">
                  <MarkdownRenderer
                    :content="fileChangeMarkdown(item)"
                    compact
                  />
                </div>
              </template>

              <template v-else-if="item.kind === 'event'">
                <div class="workspace-msg-item__title">{{ item.label }}</div>
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

          <article
            v-if="
              responseItem(entry.turn) &&
              matchesFilter(responseItem(entry.turn)!)
            "
            class="workspace-msg-item workspace-msg-item--assistant workspace-chat__response-card"
          >
            <MarkdownRenderer
              :content="renderMessageMarkdown(responseItem(entry.turn)!.text)"
              compact
            />
          </article>
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
