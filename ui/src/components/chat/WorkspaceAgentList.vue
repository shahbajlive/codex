<script setup lang="ts">
import { computed } from "vue";
import { formatTime, truncate } from "../../lib/format";
import type { WorkspaceAgentRow } from "../../stores/chat/workspace-messages";

const props = defineProps<{
  agents: WorkspaceAgentRow[];
  selectedAgentId: string | null;
  search: string;
}>();

const emit = defineEmits<{
  select: [agentId: string];
  updateSearch: [value: string];
}>();

const AGENT_FALLBACK_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#06b6d4",
  "#3b82f6",
  "#ec4899",
];

function agentAvatarStyle(agent: WorkspaceAgentRow) {
  const color = agent.color || AGENT_FALLBACK_COLORS[0];
  return {
    backgroundColor: `${color}1f`,
    color,
  };
}

const filteredAgents = computed(() => {
  const query = props.search.trim().toLowerCase();
  if (!query) {
    return props.agents;
  }

  return props.agents.filter((agent) => {
    const haystack =
      `${agent.name} ${agent.description} ${agent.id}`.toLowerCase();
    return haystack.includes(query);
  });
});
</script>

<template>
  <aside class="workspace-msg-page__sidebar">
    <section class="workspace-msg-list">
      <div class="workspace-msg-list__header">
        <div class="card-title">Messages</div>
      </div>

      <label class="workspace-msg-search field">
        <div class="input-control workspace-msg-search__control">
          <span class="workspace-msg-search__icon" aria-hidden="true">
            <svg viewBox="0 0 16 16" fill="none">
              <circle
                cx="7"
                cy="7"
                r="4.5"
                stroke="currentColor"
                stroke-width="1.5"
              />
              <path
                d="M10.5 10.5L13 13"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
          </span>
          <input
            :value="search"
            placeholder="Search agents..."
            @input="
              emit('updateSearch', ($event.target as HTMLInputElement).value)
            "
          />
          <button
            v-if="search.trim()"
            class="workspace-msg-search__clear"
            type="button"
            aria-label="Clear search"
            @click="emit('updateSearch', '')"
          >
            <svg viewBox="0 0 16 16" fill="none">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </div>
      </label>

      <div class="workspace-msg-list__items">
        <button
          v-for="agent in filteredAgents"
          :key="agent.id"
          class="workspace-msg-list__item nav-item"
          :class="{ 'active is-selected': agent.id === selectedAgentId }"
          @click="emit('select', agent.id)"
        >
          <div
            class="workspace-msg-list__avatar"
            :style="agentAvatarStyle(agent)"
          >
            <span>{{ agent.name.slice(0, 1) }}</span>
          </div>
          <div class="workspace-msg-list__meta">
            <div class="workspace-msg-list__row">
              <span class="workspace-msg-list__name nav-item__text">{{
                agent.name
              }}</span>
              <span class="workspace-msg-list__time muted">
                {{
                  agent.hasThread
                    ? formatTime(agent.updatedAt) || "active"
                    : "new"
                }}
              </span>
            </div>
            <div class="workspace-msg-list__preview muted">
              {{ truncate(agent.preview || agent.description || agent.id, 60) }}
            </div>
          </div>
        </button>
      </div>
    </section>
  </aside>
</template>
