<script setup lang="ts">
import { storeToRefs } from "pinia";
import type { Model } from "../lib/protocol";
import { useAgentsStore } from "../stores/agents";
import AgentOverview from "./agents/AgentOverview.vue";
import AgentFiles from "./agents/AgentFiles.vue";
import AgentTools from "./agents/AgentTools.vue";
import AgentSkills from "./agents/AgentSkills.vue";
import AgentContacts from "./agents/AgentContacts.vue";

const agentsStore = useAgentsStore();
const { agents, selectedAgent, dirty } = storeToRefs(agentsStore);

const emit = defineEmits<{
  refresh: [];
  select: [agentId: string];
}>();

function agentColor(
  color: string | null | undefined,
  name: string | null | undefined,
): string {
  return color || hashColor(name ?? "");
}

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
function hashColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
}

const panels = [
  { id: "overview" as const, label: "Overview" },
  { id: "files" as const, label: "Files" },
  { id: "tools" as const, label: "Tools" },
  { id: "skills" as const, label: "Skills" },
  { id: "contacts" as const, label: "Contacts" },
  { id: "channels" as const, label: "Channels" },
  { id: "cron" as const, label: "Cron Jobs" },
];
</script>

<template>
  <div class="agents-layout">
    <section class="card agents-sidebar">
      <div class="row" style="justify-content: space-between">
        <div>
          <div class="card-title">Agents</div>
          <div class="card-sub">{{ agents.length }} configured.</div>
        </div>
        <button
          class="btn btn--sm"
          :disabled="agentsStore.skillsLoading"
          @click="emit('refresh')"
        >
          {{ agentsStore.skillsLoading ? "Loading…" : "Refresh" }}
        </button>
      </div>

      <div class="agent-list">
        <button
          v-for="agent in agents"
          :key="agent.id"
          class="agent-row"
          :class="{ active: agent.id === selectedAgent?.id }"
          @click="emit('select', agent.id)"
        >
          <div
            class="agent-avatar"
            :style="{
              backgroundColor: agentColor(agent.color, agent.name) + '20',
              color: agentColor(agent.color, agent.name),
            }"
          >
            {{ (agent.name ?? "?").slice(0, 1).toUpperCase() }}
          </div>
          <div class="agent-info">
            <div class="agent-title">{{ agent.name ?? "—" }}</div>
            <div class="agent-sub mono">{{ agent.id }}</div>
          </div>
        </button>
      </div>
    </section>

    <section class="agents-main">
      <template v-if="selectedAgent">
        <section class="card agent-header">
          <div class="agent-header-main">
            <div
              class="agent-avatar agent-avatar--lg"
              :style="{
                backgroundColor: agentColor(
                  selectedAgent.color,
                  selectedAgent.name,
                ),
              }"
            >
              {{ (selectedAgent.name ?? "?").slice(0, 1).toUpperCase() }}
            </div>
            <div>
              <div class="card-title">{{ selectedAgent.name }}</div>
              <div class="card-sub">
                {{
                  selectedAgent.description || "Agent workspace and routing."
                }}
              </div>
            </div>
          </div>
          <div class="row">
            <button
              class="btn btn--sm"
              :disabled="!dirty"
              @click="agentsStore.discard()"
            >
              Discard
            </button>
            <button
              class="btn btn--sm primary"
              :disabled="!dirty"
              @click="agentsStore.save()"
            >
              Save
            </button>
          </div>
        </section>

        <div class="agent-tabs">
          <button
            v-for="panel in panels"
            :key="panel.id"
            class="agent-tab"
            :class="{ active: agentsStore.activeTab === panel.id }"
            @click="agentsStore.setActiveTab(panel.id)"
          >
            {{ panel.label }}
          </button>
        </div>

        <AgentOverview v-if="agentsStore.activeTab === 'overview'" />
        <AgentFiles v-else-if="agentsStore.activeTab === 'files'" />
        <AgentTools v-else-if="agentsStore.activeTab === 'tools'" />
        <AgentSkills v-else-if="agentsStore.activeTab === 'skills'" />
        <AgentContacts v-else-if="agentsStore.activeTab === 'contacts'" />

        <section v-else-if="agentsStore.activeTab === 'channels'" class="card">
          <div class="card-header">
            <div>
              <div class="card-title">Channels</div>
              <div class="card-sub">Delivery channels configuration.</div>
            </div>
          </div>
          <div class="muted">
            Delivery channels are not wired for Codex yet.
          </div>
        </section>

        <section v-else class="card">
          <div class="card-header">
            <div>
              <div class="card-title">Cron Jobs</div>
              <div class="card-sub">Scheduled automation configuration.</div>
            </div>
          </div>
          <div class="muted">Scheduled automation parity is still to come.</div>
        </section>
      </template>

      <template v-else>
        <section class="card">
          <div class="card-title">Select an agent</div>
          <div class="card-sub">
            Pick an agent to inspect its workspace and tools.
          </div>
        </section>
      </template>
    </section>
  </div>
</template>
