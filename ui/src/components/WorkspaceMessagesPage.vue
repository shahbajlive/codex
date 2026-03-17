<script setup lang="ts">
import type { Thread } from "../lib/protocol";
import type { TranscriptTurn } from "../lib/transcript";
import { agentDisplayName } from "../lib/agents";
import { formatTime, truncate } from "../lib/format";

defineProps<{
  loading: boolean;
  agents: Thread[];
  selectedAgentId: string | null;
  transcript: TranscriptTurn[];
}>();

defineEmits<{
  refresh: [];
  select: [threadId: string];
  openConversation: [threadId: string];
}>();
</script>

<template>
  <section class="grid min-h-[calc(100vh-10rem)] grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
    <aside class="card">
      <div class="row row--spread">
        <div>
          <div class="card-title">Workspace Messages</div>
          <div class="card-sub">Agent inbox from Codex subagent threads.</div>
        </div>
        <button class="btn btn--sm" @click="$emit('refresh')">
          {{ loading ? "Loading..." : "Refresh" }}
        </button>
      </div>

      <div class="agent-list mt-3">
        <button
          v-for="agent in agents"
          :key="agent.id"
          class="agent-row"
          :class="{ active: agent.id === selectedAgentId }"
          @click="$emit('select', agent.id)"
        >
          <div class="agent-avatar">
            {{ agent.agentNickname?.slice(0, 1) || agentDisplayName(agent).slice(0, 1) }}
          </div>
          <div class="agent-info">
            <div class="agent-title">{{ agentDisplayName(agent) }}</div>
            <div class="agent-sub mono">
              {{ truncate(agent.preview || agent.id, 40) }}
            </div>
          </div>
          <span class="agent-pill">{{ formatTime(agent.updatedAt) }}</span>
        </button>
      </div>
    </aside>

    <section class="card flex min-h-[calc(100vh-10rem)] flex-col overflow-hidden">
      <div class="row row--spread border-b pb-5" :style="{ borderColor: 'var(--border)' }">
        <div>
          <div class="card-title">Selected Agent Messages</div>
          <div class="card-sub">Inspect recent thread output before opening chat.</div>
        </div>
        <button v-if="selectedAgentId" class="btn primary" @click="$emit('openConversation', selectedAgentId)">
          Open in Chat
        </button>
      </div>

      <div v-if="transcript.length > 0" class="mt-5 flex flex-1 flex-col gap-5 overflow-auto">
        <div v-for="turn in transcript" :key="turn.id" class="flex flex-col gap-2.5">
          <div class="flex items-center justify-between gap-3 text-xs uppercase tracking-[0.1em] text-[var(--muted)]">
            <span>Turn {{ turn.id.slice(0, 8) }}</span>
            <span>{{ turn.status }}</span>
          </div>
          <div
            v-for="item in turn.items"
            :key="item.id"
            class="rounded-3xl border px-4 py-3.5"
            :style="
              item.kind === 'assistant'
                ? {
                    borderColor: 'color-mix(in srgb, var(--border-strong) 28%, transparent)',
                    background: 'color-mix(in srgb, var(--bg-elevated) 86%, transparent)',
                    color: 'var(--chat-text)',
                  }
                : item.kind === 'activity'
                  ? {
                      borderColor: 'color-mix(in srgb, var(--accent-2) 26%, transparent)',
                      background: 'color-mix(in srgb, var(--accent-2-subtle) 85%, var(--bg-elevated))',
                      color: 'var(--text)',
                    }
                  : {
                      borderColor: 'color-mix(in srgb, var(--accent) 46%, transparent)',
                      background:
                        'linear-gradient(180deg, color-mix(in srgb, var(--accent) 86%, #ffffff), color-mix(in srgb, var(--accent) 78%, #000000))',
                      color: 'var(--accent-foreground)',
                    }
            "
          >
            <div v-if="item.kind === 'activity'" class="mb-2 text-sm font-semibold text-[var(--accent-2)]">
              {{ item.label }}
            </div>
            <pre>{{ item.kind === "activity" ? item.detail : item.text }}</pre>
          </div>
        </div>
      </div>
      <div v-else class="flex flex-1 items-center justify-center px-8 py-12 text-center text-sm text-[var(--muted)]">
        Select an agent on the left to view its message history.
      </div>
    </section>
  </section>
</template>
