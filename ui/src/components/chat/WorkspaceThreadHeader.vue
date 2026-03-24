<script setup lang="ts">
import { computed } from "vue";
import type { WorkspaceAgentRow } from "../../stores/chat/workspace-messages";

type ThreadChoice = {
  id: string;
  label: string;
};

const props = defineProps<{
  selectedAgent: WorkspaceAgentRow | null;
  selectedThreadId: string | null;
  threadChoices: ThreadChoice[];
  connected: boolean;
  selectedAgentId: string | null;
  sidebarCollapsed: boolean;
}>();

const emit = defineEmits<{
  selectThread: [threadId: string];
  toggleSidebar: [];
  openConversation: [];
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

function hashColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AGENT_FALLBACK_COLORS[Math.abs(hash) % AGENT_FALLBACK_COLORS.length];
}

function resolvedAgentColor(agent: WorkspaceAgentRow | null): string {
  if (!agent) {
    return "var(--accent)";
  }
  return agent.color || hashColor(agent.name || agent.id);
}

const selectedAgentAvatarStyle = computed(() => {
  const color = resolvedAgentColor(props.selectedAgent);
  return {
    backgroundColor: `${color}1f`,
    color,
  };
});

function onThreadSelectionChange(event: Event) {
  const threadId = (event.target as HTMLSelectElement).value;
  if (!threadId || threadId === props.selectedThreadId) {
    return;
  }
  emit("selectThread", threadId);
}
</script>

<template>
  <header class="workspace-msg-thread__header">
    <button class="workspace-msg-thread__agent" type="button">
      <div
        class="workspace-msg-thread__avatar"
        :style="selectedAgentAvatarStyle"
      >
        {{ selectedAgent ? selectedAgent.name.slice(0, 1) : "?" }}
      </div>
      <div>
        <div class="workspace-msg-thread__name">
          {{ selectedAgent ? selectedAgent.name : "Select an agent" }}
        </div>
        <div class="workspace-msg-thread__title"></div>
      </div>
    </button>

    <button>
      <select
        v-if="selectedAgent && threadChoices.length > 0"
        class="workspace-msg-thread__select"
        :value="selectedThreadId || ''"
        aria-label="Select thread"
        @change="onThreadSelectionChange"
      >
        <option value="" disabled>Select thread</option>
        <option
          v-for="thread in threadChoices"
          :key="thread.id"
          :value="thread.id"
        >
          {{ thread.label }}
        </option>
      </select>
      <span v-else>{{ selectedThreadId || "No thread selected" }}</span>
    </button>

    <div class="workspace-msg-thread__actions">
      <button
        class="workspace-msg-thread__icon-btn"
        type="button"
        :title="
          sidebarCollapsed ? 'Expand conversations' : 'Collapse conversations'
        "
        :aria-label="sidebarCollapsed ? 'Expand' : 'Collapse'"
        @click="emit('toggleSidebar')"
      >
        <svg viewBox="0 0 16 16" fill="none">
          <path
            v-if="sidebarCollapsed"
            d="M6 4l4 4-4 4"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            v-else
            d="M10 4L6 8l4 4"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <span
        class="statusDot"
        :class="{ ok: connected }"
        :title="connected ? 'Connected' : 'Disconnected'"
        aria-hidden="true"
      />
      <button
        v-if="selectedAgentId && selectedThreadId"
        class="workspace-msg-thread__icon-btn"
        type="button"
        title="Open in chat"
        aria-label="Open in chat"
        @click="emit('openConversation')"
      >
        <svg viewBox="0 0 16 16" fill="none">
          <path
            d="M3 3h7v7M10 3l3 3-3 3"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </div>
  </header>
</template>
