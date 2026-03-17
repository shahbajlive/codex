<script setup lang="ts">
import type { TranscriptItem } from "../lib/transcript";

defineProps<{
  activity: TranscriptItem[];
}>();
</script>

<template>
  <section class="surface-panel flex flex-col gap-4 p-5">
    <p class="eyebrow">Activity</p>
    <div v-if="activity.length === 0" class="text-sm text-[var(--muted)]">
      Tool calls and command execution details will appear here.
    </div>
    <div v-else class="flex flex-col gap-3">
      <div
        v-for="item in activity"
        :key="item.id"
        class="activity__item rounded-3xl border p-4"
        :style="{
          borderColor: 'color-mix(in srgb, var(--border-strong) 30%, transparent)',
          background: 'color-mix(in srgb, var(--panel-strong) 82%, transparent)',
        }"
      >
        <div class="activity__top mb-2 flex items-center justify-between gap-3">
          <strong>{{ item.kind === "activity" ? item.label : item.id }}</strong>
          <span v-if="'status' in item" class="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
            {{ item.status }}
          </span>
        </div>
        <pre class="activity__body text-sm text-[var(--text)]">
{{ item.kind === "activity" ? item.detail : item.text }}
        </pre>
      </div>
    </div>
  </section>
</template>
