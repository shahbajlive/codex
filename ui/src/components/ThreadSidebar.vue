<script setup lang="ts">
import { computed } from "vue";
import type { Thread } from "../lib/protocol";
import { formatThreadStatus, formatTime, truncate } from "../lib/format";
import { findLatestUserPreview } from "../lib/transcript";

const props = defineProps<{
  threads: Thread[];
  selectedThreadId: string | null;
  connected: boolean;
}>();

const emit = defineEmits<{
  select: [threadId: string];
  create: [];
}>();

const visibleThreads = computed(() =>
  props.threads.map((thread) => ({
    ...thread,
    displayPreview: truncate(
      findLatestUserPreview(thread) || thread.preview || "Untitled thread",
    ),
  })),
);
</script>

<template>
  <aside class="card thread-sidebar">
    <div class="row row--spread">
      <div>
        <div class="card-title">Threads</div>
        <div class="card-sub">
          Recent Codex conversations and resumable work.
        </div>
      </div>
      <button
        class="btn primary btn--sm"
        :disabled="!connected"
        @click="emit('create')"
      >
        New Thread
      </button>
    </div>

    <div class="thread-list thread-list--spaced">
      <button
        v-for="thread in visibleThreads"
        :key="thread.id"
        class="thread-row"
        :class="{ active: thread.id === selectedThreadId }"
        @click="emit('select', thread.id)"
      >
        <div class="thread-avatar">
          {{ (thread.name || "Untitled").slice(0, 1) }}
        </div>
        <div class="thread-info">
          <div class="thread-title">{{ thread.name || "Untitled thread" }}</div>
          <div class="thread-sub">{{ thread.displayPreview }}</div>
        </div>
        <div class="thread-meta">
          <div>{{ formatTime(thread.updatedAt) }}</div>
          <div>{{ formatThreadStatus(thread.status) }}</div>
        </div>
      </button>
    </div>
  </aside>
</template>
