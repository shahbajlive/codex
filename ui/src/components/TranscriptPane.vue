<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { TranscriptTurn } from "../lib/transcript";

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

watch(
  () => props.threadName,
  () => {
    draft.value = "";
  },
);
</script>

<template>
  <section class="surface-panel flex min-h-[calc(100vh-2rem)] flex-col overflow-hidden">
    <header class="flex items-center justify-between gap-4 border-b px-6 py-5" :style="{ borderColor: 'color-mix(in srgb, var(--border-strong) 34%, transparent)' }">
      <div>
        <p class="eyebrow">Thread</p>
        <h2 class="font-[var(--font-display)] text-2xl font-semibold tracking-[-0.04em] text-[var(--text-strong)]">
          {{ threadName }}
        </h2>
      </div>
      <div class="flex gap-2">
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
          :style="{ color: 'var(--accent)', borderColor: 'color-mix(in srgb, var(--accent) 44%, transparent)' }"
        >
          Streaming
        </span>
      </div>
    </header>

    <div v-if="hasTranscript" class="flex flex-1 flex-col gap-5 overflow-auto px-6 py-5">
      <div v-for="turn in transcript" :key="turn.id" class="flex flex-col gap-2.5">
        <div class="flex items-center justify-between gap-3 text-xs uppercase tracking-[0.1em] text-[var(--muted)]">
          <span>Turn {{ turn.id.slice(0, 8) }}</span>
          <span>{{ turn.status }}</span>
          <span v-if="turn.error" class="turn__error text-[var(--danger)]">{{ turn.error }}</span>
        </div>
        <div
          v-for="item in turn.items"
          :key="item.id"
          class="bubble max-w-[min(100%,56rem)] rounded-3xl border px-4 py-3.5"
          :class="item.kind === 'user' ? 'self-end' : 'self-start'"
          :style="
            item.kind === 'user'
              ? {
                  borderColor: 'color-mix(in srgb, var(--accent) 46%, transparent)',
                  background:
                    'linear-gradient(180deg, color-mix(in srgb, var(--accent) 86%, #ffffff), color-mix(in srgb, var(--accent) 78%, #000000))',
                  color: 'var(--accent-foreground)',
                }
              : item.kind === 'assistant'
                ? {
                    borderColor: 'color-mix(in srgb, var(--border-strong) 28%, transparent)',
                    background: 'color-mix(in srgb, var(--bg-elevated) 86%, transparent)',
                    color: 'var(--chat-text)',
                  }
                : {
                    borderColor: 'color-mix(in srgb, var(--accent-2) 26%, transparent)',
                    background: 'color-mix(in srgb, var(--accent-2-subtle) 85%, var(--bg-elevated))',
                    color: 'var(--text)',
                  }
          "
        >
          <template v-if="item.kind === 'activity'">
            <div class="bubble__label mb-2 text-sm font-semibold text-[var(--accent-2)]">
              {{ item.label }}
            </div>
            <pre class="bubble__body">{{ item.detail }}</pre>
          </template>
          <template v-else>
            <pre class="bubble__body">{{ item.text }}</pre>
          </template>
        </div>
      </div>
    </div>
    <div v-else class="flex flex-1 items-center justify-center px-8 py-12 text-center text-sm text-[var(--muted)]">
      <p>Start a thread or select one from the sidebar to see conversation history here.</p>
    </div>

    <form
      class="flex flex-col gap-3 border-t px-6 py-5"
      :style="{
        borderColor: 'color-mix(in srgb, var(--border-strong) 34%, transparent)',
        background: 'color-mix(in srgb, var(--chrome) 72%, transparent)',
      }"
      @submit.prevent="submit"
    >
      <textarea
        v-model="draft"
        class="ui-input min-h-28 resize-y"
        :disabled="!connected"
        rows="4"
        placeholder="Ask Codex to inspect, explain, or change your codebase."
      />
      <div class="flex justify-end">
        <button class="ui-button ui-button-primary" type="submit" :disabled="busy || !connected">
          Send
        </button>
      </div>
    </form>
  </section>
</template>
