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

const defaultAgentId = computed(() => props.agents[0]?.id || null);

const panels = [
  { id: "overview", label: "Overview" },
  { id: "files", label: "Files" },
  { id: "tools", label: "Tools" },
  { id: "skills", label: "Skills" },
  { id: "channels", label: "Channels" },
  { id: "cron", label: "Cron Jobs" },
] as const;

function getAgentInitial(name: string | null | undefined): string {
  if (!name) return "?";
  return name.slice(0, 1).toUpperCase();
}

function isDefaultAgent(agentId: string): boolean {
  return agentId === defaultAgentId.value;
}

function formatAgentSubtitle(agent: AgentInfo): string {
  return agent.description?.slice(0, 40) || "Agent workspace and routing.";
}

async function handleOverviewSave(data: { name: string; model: string }) {
  await codexStore.updateAgent(
    props.selectedAgentId || "",
    data.name || null,
    data.model || null,
    null,
    null,
    null,
  );
}

function handleOverviewDiscard() {}

async function handleFilesSave(files: Record<string, string>) {
  const agentId = props.selectedAgentId;
  if (!agentId) return;

  let hasError = false;
  for (const [filename, content] of Object.entries(files)) {
    const result = await codexStore.saveWorkspaceFile(
      agentId,
      filename,
      content,
    );
    if (!result.success) {
      console.error("Failed to save file:", filename, result.message);
      hasError = true;
    }
  }
  if (!hasError) {
    console.log("All files saved successfully");
  }
}

function handleFilesDiscard() {}

async function handleToolsSave(tools: { allow: string[]; deny: string[] }) {
  await codexStore.updateAgent(
    props.selectedAgentId || "",
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
    <aside class="card agents-sidebar">
      <div class="row row--spread">
        <div>
          <div class="card-title">Agents</div>
          <div class="card-sub">{{ agents.length }} configured.</div>
        </div>
        <button
          class="btn btn--sm"
          @click="emit('refresh')"
          :disabled="loading"
        >
          {{ loading ? "Loading…" : "Refresh" }}
        </button>
      </div>

      <div class="agent-list" style="margin-top: 12px">
        <template v-if="agents.length === 0">
          <div class="muted">No agents found.</div>
        </template>
        <button
          v-for="agent in agents"
          :key="agent.id"
          class="agent-row"
          :class="{ active: agent.id === selectedAgentId }"
          @click="emit('select', agent.id)"
        >
          <div class="agent-avatar">{{ getAgentInitial(agent.name) }}</div>
          <div class="agent-info">
            <div class="agent-title">{{ agent.name || agent.id }}</div>
            <div class="agent-sub mono">{{ agent.id }}</div>
          </div>
          <span v-if="isDefaultAgent(agent.id)" class="agent-pill"
            >default</span
          >
        </button>
      </div>
    </aside>

    <section class="agents-main">
      <template v-if="selectedAgent">
        <section class="card agent-header">
          <div class="agent-header-main">
            <div class="agent-avatar agent-avatar--lg">
              {{ getAgentInitial(selectedAgent.name) }}
            </div>
            <div>
              <div class="card-title">
                {{ selectedAgent.name || selectedAgent.id }}
              </div>
              <div class="card-sub">
                {{ formatAgentSubtitle(selectedAgent) }}
              </div>
            </div>
          </div>
          <div class="agent-header-meta">
            <div class="mono">{{ selectedAgent.id }}</div>
            <span v-if="isDefaultAgent(selectedAgent.id)" class="agent-pill"
              >default</span
            >
          </div>
        </section>

        <div class="agent-tabs">
          <button
            v-for="panel in panels"
            :key="panel.id"
            class="agent-tab"
            :class="{ active: activePanel === panel.id }"
            @click="activePanel = panel.id"
          >
            {{ panel.label }}
          </button>
        </div>

        <section class="card">
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
            :config-tools="
              selectedAgentConfig?.tools
                ? {
                    allow: selectedAgentConfig.tools.allow || undefined,
                    deny: selectedAgentConfig.tools.deny || undefined,
                  }
                : null
            "
            @save="handleToolsSave"
            @discard="handleToolsDiscard"
          />
          <AgentSkills
            v-else-if="activePanel === 'skills'"
            :skills="selectedAgentConfig?.skills ?? undefined"
          />
          <AgentChannels v-else-if="activePanel === 'channels'" />
          <AgentCron v-else-if="activePanel === 'cron'" />
        </section>
      </template>

      <div v-else class="card">
        <div class="card-title">Select an agent</div>
        <div class="card-sub">
          Pick an agent to inspect its workspace and tools.
        </div>
      </div>
    </section>
  </section>
</template>
