<script setup lang="ts">
import { ref, computed, watch } from "vue";
import type { AgentInfo, AgentReadResponse, Model } from "../lib/protocol";
import { useCodexStore } from "../stores/codex";
import AgentOverview from "./agents/AgentOverview.vue";
import AgentFiles from "./agents/AgentFiles.vue";
import AgentTools from "./agents/AgentTools.vue";
import AgentSkills from "./agents/AgentSkills.vue";
import AgentChannels from "./agents/AgentChannels.vue";
import AgentCron from "./agents/AgentCron.vue";

const codexStore = useCodexStore();

const props = defineProps<{
  loading: boolean;
  agents: AgentInfo[];
  selectedAgentId: string | null;
  selectedAgentConfig: AgentReadResponse | null;
  workspaceFiles: { filename: string; content: string }[];
  models: Model[];
}>();

const emit = defineEmits<{
  refresh: [];
  select: [agentId: string];
  openConversation: [agentId: string];
}>();

const activePanel = ref<
  "overview" | "files" | "tools" | "skills" | "channels" | "cron"
>("overview");

const tools = computed(() => codexStore.toolsCatalog?.tools || []);

watch(activePanel, async (newPanel) => {
  if (newPanel === "tools") {
    await codexStore.loadToolsCatalog();
  }
});

const selectedAgent = computed(
  () => props.agents.find((a) => a.id === props.selectedAgentId) || null,
);

const panels = [
  { id: "overview", label: "Overview" },
  { id: "files", label: "Files" },
  { id: "tools", label: "Tools" },
  { id: "skills", label: "Skills" },
  { id: "channels", label: "Channels" },
  { id: "cron", label: "Cron Jobs" },
] as const;

function getAgentColor(name: string): string {
  const colors = [
    "#EF4444",
    "#F97316",
    "#F59E0B",
    "#84CC16",
    "#22C55E",
    "#14B8A6",
    "#06B6D4",
    "#0EA5E9",
    "#3B82F6",
    "#6366F1",
    "#8B5CF6",
    "#A855F7",
    "#D946EF",
    "#EC4899",
    "#F43F5E",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

async function handleOverviewSave(data: { name: string; model: string }) {
  await codexStore.updateAgent(
    props.selectedAgentId || "",
    data.name || null,
    data.model || null,
    null,
    null,
    null,
    null,
    null,
  );
}

function handleOverviewDiscard() {}

async function handleFilesSave(files: Record<string, string>) {
  console.log("Saving files:", files);
  // TODO: Implement file saving via backend API
}

function handleFilesDiscard() {}

async function handleToolsSave(tools: { allow: string[]; deny: string[] }) {
  await codexStore.updateAgent(
    props.selectedAgentId || "",
    null,
    null,
    null,
    null,
    null,
    null,
    tools.allow.length > 0 || tools.deny.length > 0 ? tools : null,
  );
}

function handleToolsDiscard() {}
</script>

<template>
  <section class="agents-layout">
    <aside class="agents-sidebar">
      <div
        class="flex justify-between items-start mb-4 pb-4 border-b border-border"
      >
        <div>
          <div class="font-semibold">Agents</div>
          <div class="text-sm text-muted">{{ agents.length }} configured</div>
        </div>
        <button class="btn btn-sm" @click="emit('refresh')" :disabled="loading">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            :class="{ 'animate-spin': loading }"
          >
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
        </button>
      </div>

      <div class="flex flex-col gap-1">
        <button
          v-for="agent in agents"
          :key="agent.id"
          class="flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors"
          :class="
            agent.id === selectedAgentId ? 'bg-accent/10' : 'hover:bg-bg-hover'
          "
          @click="emit('select', agent.id)"
        >
          <div
            class="w-9 h-9 rounded-md flex items-center justify-center font-semibold text-sm"
            :style="{
              backgroundColor: getAgentColor(agent.name || '') + '20',
              color: getAgentColor(agent.name || ''),
            }"
          >
            {{ (agent.name || "?").slice(0, 1).toUpperCase() }}
          </div>
          <div class="flex-1 min-w-0">
            <div class="font-medium text-sm truncate">{{ agent.name }}</div>
            <div class="text-xs text-muted truncate">
              {{ agent.description?.slice(0, 50) || "No description" }}
            </div>
          </div>
        </button>
      </div>
    </aside>

    <section class="agents-main">
      <template v-if="selectedAgent">
        <section
          class="bg-bg-elevated rounded-lg p-6 flex justify-between items-center"
        >
          <div class="flex items-center gap-4">
            <div
              class="w-16 h-16 rounded-lg flex items-center justify-center font-bold text-xl text-white"
              :style="{ backgroundColor: getAgentColor(selectedAgent.name) }"
            >
              {{ selectedAgent.name.slice(0, 1).toUpperCase() }}
            </div>
            <div>
              <h2 class="text-xl font-semibold">{{ selectedAgent.name }}</h2>
              <p class="text-sm text-muted">
                {{
                  selectedAgentConfig?.description ||
                  selectedAgent.description ||
                  "No description"
                }}
              </p>
            </div>
          </div>
          <button
            class="btn btn-primary"
            @click="emit('openConversation', selectedAgent?.name || '')"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
              />
            </svg>
            Chat
          </button>
        </section>

        <div class="bg-bg-elevated rounded-lg p-1 flex gap-1">
          <button
            v-for="panel in panels"
            :key="panel.id"
            class="px-4 py-2 rounded-md text-sm font-medium transition-colors"
            :class="
              activePanel === panel.id
                ? 'bg-bg shadow-sm'
                : 'text-muted hover:text-text'
            "
            @click="activePanel = panel.id"
          >
            {{ panel.label }}
          </button>
        </div>

        <section class="bg-bg-elevated rounded-lg p-6">
          <AgentOverview
            v-if="activePanel === 'overview'"
            :agent="selectedAgent"
            :config="selectedAgentConfig"
            :models="models"
            @save="handleOverviewSave"
            @discard="handleOverviewDiscard"
          />
          <AgentFiles
            v-else-if="activePanel === 'files'"
            :files="workspaceFiles"
            @save="handleFilesSave"
            @discard="handleFilesDiscard"
          />
          <AgentTools
            v-else-if="activePanel === 'tools'"
            :tools="tools"
            :config-tools="selectedAgentConfig?.tools || null"
            @save="handleToolsSave"
            @discard="handleToolsDiscard"
          />
          <AgentSkills
            v-else-if="activePanel === 'skills'"
            :skills="selectedAgentConfig?.skills"
          />
          <AgentChannels v-else-if="activePanel === 'channels'" />
          <AgentCron v-else-if="activePanel === 'cron'" />
        </section>
      </template>

      <div
        v-else
        class="bg-bg-elevated rounded-lg p-12 flex flex-col items-center justify-center text-muted"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="64"
          height="64"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1"
          class="opacity-30 mb-6"
        >
          <path
            d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
          />
        </svg>
        <div class="text-xl font-semibold">Select an agent</div>
        <div class="text-sm mt-1">
          Pick an agent to inspect its workspace and tools.
        </div>
      </div>
    </section>
  </section>
</template>

<style scoped>
.agents-layout {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 1rem;
  height: calc(100vh - 140px);
}

.agents-sidebar {
  background: var(--bg-elevated);
  border-radius: var(--radius-lg);
  padding: 1rem;
  overflow-y: auto;
}

.agents-main {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  overflow-y: auto;
}
</style>
