<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
  liveTranscriptItemStatus,
  liveTranscriptItemTitle,
  liveTurnStatusLabel,
  renderTranscriptItem,
  transcriptItemTitle,
  transcriptTurnStatusLabel,
  transcriptTurnTone,
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
  collapseOverrides: Record<string, boolean>;
  statusMessage: string | null;
  statusTone: "info" | "warning" | "error" | null;
}>();

const emit = defineEmits<{
  setCollapseOverride: [key: string, expanded: boolean];
  setCollapseOverrides: [updates: Record<string, boolean>];
}>();

const transcriptBody = ref<HTMLElement | null>(null);
const settlingLiveTurn = ref<LiveTranscriptTurn | null>(null);
const collapseOverrides = ref<Record<string, boolean>>({});
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

const hasTranscriptContent = computed(
  () =>
    displayedCommittedTranscript.value.length > 0 ||
    activeOrSettlingLiveTurn.value !== null,
);

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

watch(
  () => props.collapseOverrides,
  (next) => {
    collapseOverrides.value = { ...next };
  },
  { deep: true, immediate: true },
);

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
    <div class="workspace-chat__view-actions">
      <button class="btn btn--sm" type="button" @click="collapseAllItems">
        Collapse all tools/reasoning
      </button>
      <button class="btn btn--sm" type="button" @click="expandAllItems">
        Expand all
      </button>
    </div>

    <div v-if="transcriptStatusChips.length > 0" class="workspace-chat__chips">
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
        <span v-if="turn.error" class="turn-meta__error">{{ turn.error }}</span>
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
            <span v-if="'status' in item" class="workspace-msg-item__status">{{
              item.status
            }}</span>
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
        <div class="workspace-chat__tool-chip-title">{{ preview.label }}</div>
        <pre class="workspace-chat__tool-chip-body">{{ preview.text }}</pre>
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
        <span v-if="activeOrSettlingLiveTurn.error" class="turn-meta__error">{{
          activeOrSettlingLiveTurn.error
        }}</span>
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
</template>
