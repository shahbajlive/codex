<script lang="ts" setup>
import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import { useRoute } from "vue-router";
import { formatTime, truncate } from "../lib/format";
import { findLatestUserPreview } from "../lib/history";
import { useAgentsStore } from "../stores/agents";
import { useChatStore } from "../stores/chat";

const agentsStore = useAgentsStore();
const chatStore = useChatStore();
const route = useRoute();
const search = ref("");

const { agents, selectedAgentId, skillsLoading } = storeToRefs(agentsStore);
const { agentThreads, selectedThreadId, busy } = storeToRefs(chatStore);

const isWorkspaceMessages = computed(
  () => route.path === "/workspace/messages",
);

const FALLBACK_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#06b6d4",
  "#3b82f6",
  "#ec4899",
];

function avatarStyle(item: { color?: string | null }) {
  const color = item.color || FALLBACK_COLORS[0];
  return {
    backgroundColor: `${color}1f`,
    color,
  };
}

function selectItem(id: string) {
  void agentsStore.selectAgent(id);
}

const filteredAgents = computed(() => {
  const query = search.value.trim().toLowerCase();
  if (!query) {
    return agents.value;
  }

  return agents.value.filter((agent) => {
    const haystack =
      `${agent.name || ""} ${agent.description || ""} ${agent.id}`.toLowerCase();
    return haystack.includes(query);
  });
});

const sidebarItems = computed(() => {
  if (!isWorkspaceMessages.value) {
    return filteredAgents.value.map((agent) => ({
      id: agent.id,
      name: agent.name ?? "-",
      subtitle: agent.id,
      monoSubtitle: true,
      color: agent.color,
    }));
  }

  const selectedThread = agentThreads.value.find(
    (thread) => thread.id === selectedThreadId.value,
  );

  return filteredAgents.value.map((agent) => {
    const thread = selectedAgentId.value === agent.id ? selectedThread : null;
    return {
      id: agent.id,
      name: agent.name || agent.id,
      subtitle: truncate(
        (thread && findLatestUserPreview(thread)) ||
          agent.description ||
          agent.id,
        60,
      ),
      color: agent.color,
      badge: thread ? formatTime(thread.updatedAt) || "active" : "new",
    };
  });
});

const title = computed(() =>
  isWorkspaceMessages.value ? "Messages" : "Agents",
);

const refreshLabel = computed(() => {
  if (isWorkspaceMessages.value) {
    return busy.value ? "Refreshing..." : "Refresh";
  }

  return skillsLoading.value ? "Loading..." : "Refresh";
});

const refreshDisabled = computed(() =>
  isWorkspaceMessages.value ? busy.value : skillsLoading.value,
);

async function refreshSidebar() {
  await agentsStore.refreshAgents();
  if (isWorkspaceMessages.value) {
    await chatStore.refreshSelectedAgentThreads();
  }
}
</script>

<template>
  <section class="card agents-sidebar">
    <div class="card-header">
      <div class="card-title">{{ title }}</div>
      <button
        :disabled="refreshDisabled"
        class="btn btn--sm"
        @click="refreshSidebar"
      >
        {{ refreshLabel }}
      </button>
    </div>

    <label class="field">
      <input
        :value="search"
        placeholder="Search agents..."
        @input="search = ($event.target as HTMLInputElement).value"
      />
    </label>

    <div class="agent-list">
      <button
        v-for="item in sidebarItems"
        :key="item.id"
        :class="{ active: item.id === selectedAgentId }"
        class="agent-row"
        @click="selectItem(item.id)"
      >
        <div :style="avatarStyle(item)" class="agent-avatar">
          {{ item.name.slice(0, 1).toUpperCase() }}
        </div>
        <div class="agent-info">
          <span class="agent-title-row">
            <span class="agent-title">{{ item.name }}</span>
            <span v-if="item.badge" class="agent-pill">{{ item.badge }}</span>
          </span>
          <span :class="{ mono: item.monoSubtitle }" class="agent-sub">
            {{ item.subtitle }}
          </span>
        </div>
      </button>
    </div>
  </section>
</template>
