<script setup lang="ts">
import { computed, ref, watch } from "vue";
import MarkdownRenderer from "./MarkdownRenderer.vue";
import {
  renderTranscriptItemMarkdown,
  transcriptItemTitle,
  type TranscriptTurn,
} from "../lib/transcript";

const props = defineProps<{
  threadName: string;
  transcript: TranscriptTurn[];
  busy: boolean;
  connected: boolean;
}>();

const emit = defineEmits<{
  send: [message: string];
}>();

const draft = ref("");

const hasTranscript = computed(() => props.transcript.length > 0);

function submit() {
  const trimmed = draft.value.trim();
  if (!trimmed || props.busy || !props.connected) {
    return;
  }
  emit("send", trimmed);
  draft.value = "";
}

function isUserItem(kind: string) {
  return kind === "user";
}

function isActivityItem(kind: string) {
  return (
    kind === "reasoning" ||
    kind === "plan" ||
    kind === "command" ||
    kind === "file-change" ||
    kind === "tool" ||
    kind === "event"
  );
}

watch(
  () => props.threadName,
  () => {
    draft.value = "";
  },
);
</script>

<template>
  <section
    class="card"
    style="
      display: flex;
      flex-direction: column;
      min-height: calc(100vh - 2rem);
      overflow: hidden;
    "
  >
    <header
      class="card-header"
      style="border-bottom: 1px solid; padding: 20px 24px"
      :style="{
        borderColor:
          'color-mix(in srgb, var(--border-strong) 34%, transparent)',
      }"
    >
      <div>
        <p class="eyebrow">Thread</p>
        <h2
          style="
            font-family: var(--font-display);
            font-size: 24px;
            font-weight: 600;
            letter-spacing: -0.04em;
            color: var(--text-strong);
          "
        >
          {{ threadName }}
        </h2>
      </div>
      <div class="row">
        <span
          class="ui-pill"
          :style="
            connected
              ? {
                  color: 'var(--ok)',
                  borderColor: 'color-mix(in srgb, var(--ok) 44%, transparent)',
                }
              : undefined
          "
        >
          {{ connected ? "Connected" : "Disconnected" }}
        </span>
        <span
          v-if="busy"
          class="ui-pill"
          :style="{
            color: 'var(--accent)',
            borderColor: 'color-mix(in srgb, var(--accent) 44%, transparent)',
          }"
        >
          Streaming
        </span>
      </div>
    </header>

    <div
      v-if="hasTranscript"
      class="stack stack--lg transcript-pane__body"
      style="flex: 1; overflow: auto; padding: 20px 24px"
    >
      <div v-for="turn in transcript" :key="turn.id" class="stack stack--xs">
        <div
          class="row"
          style="
            gap: 12px;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            color: var(--muted);
          "
        >
          <span>Turn {{ turn.id.slice(0, 8) }}</span>
          <span>{{ turn.status }}</span>
          <span v-if="turn.error" style="color: var(--danger)">{{
            turn.error
          }}</span>
        </div>
        <div
          v-for="item in turn.items"
          :key="item.id"
          class="bubble"
          :class="[
            isUserItem(item.kind)
              ? 'transcript-pane__bubble--user'
              : 'transcript-pane__bubble--assistant',
          ]"
          :style="[
            { maxWidth: '56rem', borderRadius: '24px', padding: '14px 16px' },
            isUserItem(item.kind)
              ? {
                  border: '1px solid',
                  borderColor:
                    'color-mix(in srgb, var(--accent) 46%, transparent)',
                  background:
                    'linear-gradient(180deg, color-mix(in srgb, var(--accent) 86%, #ffffff), color-mix(in srgb, var(--accent) 78%, #000000))',
                  color: 'var(--accent-foreground)',
                }
              : item.kind === 'assistant'
                ? {
                    border: '1px solid',
                    borderColor:
                      'color-mix(in srgb, var(--border-strong) 28%, transparent)',
                    background:
                      'color-mix(in srgb, var(--bg-elevated) 86%, transparent)',
                    color: 'var(--chat-text)',
                  }
                : isActivityItem(item.kind)
                  ? {
                      border: '1px solid',
                      borderColor:
                        'color-mix(in srgb, var(--accent-2) 26%, transparent)',
                      background:
                        'color-mix(in srgb, var(--accent-2-subtle) 85%, var(--bg-elevated))',
                      color: 'var(--text)',
                    }
                  : {
                      border: '1px solid',
                      borderColor:
                        'color-mix(in srgb, var(--border-strong) 24%, transparent)',
                      background:
                        'color-mix(in srgb, var(--panel-strong) 82%, transparent)',
                      color: 'var(--text)',
                    },
          ]"
        >
          <template v-if="transcriptItemTitle(item)">
            <div
              style="
                margin-bottom: 8px;
                font-size: 14px;
                font-weight: 600;
                color: var(--accent-2);
              "
            >
              {{ transcriptItemTitle(item) }}
            </div>
            <MarkdownRenderer
              :content="renderTranscriptItemMarkdown(item)"
              compact
            />
          </template>
          <template v-else>
            <MarkdownRenderer
              :content="renderTranscriptItemMarkdown(item)"
              compact
            />
          </template>
        </div>
      </div>
    </div>
    <div
      v-else
      class="stack transcript-pane__empty"
      style="
        flex: 1;
        align-items: center;
        justify-content: center;
        padding: 48px 32px;
        text-align: center;
        color: var(--muted);
      "
    >
      <p>
        Start a thread or select one from the sidebar to see conversation
        history here.
      </p>
    </div>

    <form
      class="stack transcript-pane__form"
      style="border-top: 1px solid; padding: 20px 24px"
      :style="{
        borderColor:
          'color-mix(in srgb, var(--border-strong) 34%, transparent)',
        background: 'color-mix(in srgb, var(--chrome) 72%, transparent)',
      }"
      @submit.prevent="submit"
    >
      <textarea
        v-model="draft"
        class="field"
        style="min-height: 112px; resize: vertical"
        :disabled="!connected"
        rows="4"
        placeholder="Ask Codex to inspect, explain, or change your codebase."
      />
      <div class="row row--end">
        <button
          class="btn primary"
          type="submit"
          :disabled="busy || !connected"
        >
          Send
        </button>
      </div>
    </form>
  </section>
</template>
