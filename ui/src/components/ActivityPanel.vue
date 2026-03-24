<script setup lang="ts">
import {
  renderTranscriptItem,
  transcriptItemTitle,
  type TranscriptItem,
} from "../lib/transcript";

defineProps<{
  activity: TranscriptItem[];
}>();
</script>

<template>
  <section class="card stack stack--md">
    <p class="eyebrow">Activity</p>
    <div v-if="activity.length === 0" class="muted">
      Tool calls and command execution details will appear here.
    </div>
    <div v-else class="stack">
      <div
        v-for="item in activity"
        :key="item.id"
        class="activity__item"
        :style="{
          borderRadius: '24px',
          border: '1px solid var(--border)',
          padding: '16px',
          borderColor:
            'color-mix(in srgb, var(--border-strong) 30%, transparent)',
          background:
            'color-mix(in srgb, var(--panel-strong) 82%, transparent)',
        }"
      >
        <div class="row" style="margin-bottom: 8px; gap: 12px">
          <strong>{{ transcriptItemTitle(item) || item.id }}</strong>
          <span
            v-if="'status' in item"
            class="muted"
            style="
              font-size: 12px;
              text-transform: uppercase;
              letter-spacing: 0.08em;
            "
          >
            {{ item.status }}
          </span>
        </div>
        <pre class="activity__body muted">{{ renderTranscriptItem(item) }}</pre>
      </div>
    </div>
  </section>
</template>
