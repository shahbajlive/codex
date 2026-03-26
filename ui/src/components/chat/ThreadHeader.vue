<script setup lang="ts">
import { computed } from "vue";
import { WorkspaceAgentRow } from "../../stores/chat";

type ThreadChoice = {
  id: string;
  label: string;
};

const props = defineProps<{
  selectedAgent: WorkspaceAgentRow | null;
  selectedThreadId: string | null;
  threadChoices: ThreadChoice[];
  sidebarCollapsed: boolean;
}>();

const emit = defineEmits<{
  selectThread: [threadId: string];
  toggleSidebar: [];
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
  <header class="card agent-header">
    <div class="agent-header-main">
      <div class="agent-avatar" :style="selectedAgentAvatarStyle">
        {{ selectedAgent ? selectedAgent.name?.slice(0, 1) : "?" }}
      </div>
      <div>
        <div class="card-title">
          {{ selectedAgent ? selectedAgent.name : "Select an agent" }}
        </div>
        <div class="card-sub">
          {{ selectedAgent?.description || "Agent workspace and routing." }}
        </div>
      </div>
    </div>

    <div class="agent-header-center">
      <select
        v-if="selectedAgent && threadChoices.length > 0"
        class="input-control workspace-msg-thread__select"
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
    </div>

    <div class="agent-header-meta">
      <button class="btn btn--sm" type="button" @click="emit('toggleSidebar')">
        {{ sidebarCollapsed ? "Show List" : "Hide List" }}
      </button>
    </div>
  </header>
</template>
