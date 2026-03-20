<script setup lang="ts">
import { ref, computed } from "vue";
import type { AgentInfo, AgentReadResponse, Model } from "../lib/protocol";
import { useCodexStore } from "../stores/codex";

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

const isEditing = ref(false);
const editedName = ref("");
const editedModel = ref("");
const saving = ref(false);

const selectedAgent = computed(
  () => props.agents.find((a) => a.id === props.selectedAgentId) || null,
);

function startEdit() {
  editedName.value = selectedAgent.value?.name || "";
  editedModel.value = props.selectedAgentConfig?.model || "";
  isEditing.value = true;
}

async function saveEdit() {
  saving.value = true;
  const id = selectedAgent.value?.id || "";
  const nicknames = editedName.value
    ? editedName.value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : null;
  await codexStore.updateAgent(id, editedModel.value || null, null, nicknames);
  saving.value = false;
  isEditing.value = false;
}

function cancelEdit() {
  isEditing.value = false;
}

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

const panels = [
  { id: "overview" as const, label: "Overview" },
  { id: "files" as const, label: "Files" },
  { id: "tools" as const, label: "Tools" },
  { id: "skills" as const, label: "Skills" },
  { id: "channels" as const, label: "Channels" },
  { id: "cron" as const, label: "Cron Jobs" },
];
</script>

<template>
  <div class="agents-layout">
    <section class="card agents-sidebar">
      <div class="row">
        <div>
          <div class="card-title">Agents</div>
          <div class="card-sub">{{ agents.length }} configured.</div>
        </div>
        <button
          class="btn btn--sm"
          :disabled="loading"
          @click="emit('refresh')"
        >
          {{ loading ? "Loading…" : "Refresh" }}
        </button>
      </div>

      <div class="agent-list">
        <button
          v-for="agent in agents"
          :key="agent.id"
          class="agent-row"
          :class="{ active: agent.id === selectedAgentId }"
          @click="emit('select', agent.id)"
        >
          <div
            class="agent-avatar"
            :style="{
              backgroundColor: getAgentColor(agent.name) + '20',
              color: getAgentColor(agent.name),
            }"
          >
            {{ agent.name.slice(0, 1).toUpperCase() }}
          </div>
          <div class="agent-info">
            <div class="agent-title">{{ agent.name }}</div>
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
              :style="{ backgroundColor: getAgentColor(selectedAgent.name) }"
            >
              {{ selectedAgent.name.slice(0, 1).toUpperCase() }}
            </div>
            <div>
              <div class="card-title">{{ selectedAgent.name }}</div>
              <div class="card-sub">
                {{
                  selectedAgentConfig?.description ||
                  selectedAgent.description ||
                  "Agent workspace and routing."
                }}
              </div>
            </div>
          </div>
          <div class="agent-header-meta">
            <div class="mono">{{ selectedAgent.id }}</div>
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

        <section v-if="activePanel === 'overview'" class="card">
          <div class="card-title">Overview</div>
          <div class="card-sub">Workspace paths and identity metadata.</div>

          <div class="agents-overview-grid">
            <div class="agent-kv">
              <div class="label">Workspace</div>
              <div class="mono">
                {{
                  selectedAgentConfig?.workspace ||
                  selectedAgent.workspace ||
                  "default"
                }}
              </div>
            </div>
            <div class="agent-kv">
              <div class="label">Primary Model</div>
              <div class="mono">
                {{ selectedAgentConfig?.model || "default" }}
              </div>
            </div>
            <div class="agent-kv">
              <div class="label">Identity Name</div>
              <div>{{ selectedAgent.name }}</div>
            </div>
            <div class="agent-kv">
              <div class="label">Config File</div>
              <div class="mono">
                {{ selectedAgentConfig?.configFile || "inline" }}
              </div>
            </div>
          </div>

          <div class="agent-model-select">
            <div class="label">Model Selection</div>
            <div class="row">
              <label class="field">
                <span>Primary model</span>
                <select v-model="editedModel" :disabled="!isEditing">
                  <option value="">Default</option>
                  <option
                    v-for="model in models"
                    :key="model.id"
                    :value="model.id"
                  >
                    {{ model.displayName }}
                  </option>
                </select>
              </label>
            </div>
            <div class="row">
              <button
                class="btn btn--sm"
                :disabled="isEditing"
                @click="startEdit"
              >
                Edit
              </button>
              <button
                class="btn btn--sm primary"
                :disabled="!isEditing || saving"
                @click="saveEdit"
              >
                {{ saving ? "Saving…" : "Save" }}
              </button>
            </div>
          </div>
        </section>

        <section v-else-if="activePanel === 'files'" class="card">
          <div class="card-title">Files</div>
          <div class="card-sub">Workspace files for this agent.</div>

          <div class="agent-files-list">
            <div v-if="workspaceFiles.length > 0">
              <div
                v-for="file in workspaceFiles"
                :key="file.filename"
                class="agent-file-row"
              >
                <div class="mono">{{ file.filename }}</div>
                <div class="label">{{ file.content?.length || 0 }} B</div>
              </div>
            </div>
            <div v-else class="muted">
              No workspace files found for this agent.
            </div>
          </div>
        </section>

        <section v-else-if="activePanel === 'tools'" class="card">
          <div class="card-title">Tools</div>
          <div class="card-sub">Tool access configuration for this agent.</div>

          <div v-if="selectedAgentConfig?.tools">
            <div
              v-if="selectedAgentConfig.tools.allow?.length"
              class="tools-list"
            >
              <div class="label">Allowed Tools</div>
              <div
                v-for="tool in selectedAgentConfig.tools.allow"
                :key="tool"
                class="tool-item"
              >
                <span class="mono">{{ tool }}</span>
                <span class="pill pill--live">Allowed</span>
              </div>
            </div>
            <div
              v-if="selectedAgentConfig.tools.deny?.length"
              class="tools-list"
            >
              <div class="label">Denied Tools</div>
              <div
                v-for="tool in selectedAgentConfig.tools.deny"
                :key="tool"
                class="tool-item"
              >
                <span class="mono">{{ tool }}</span>
                <span class="pill danger">Denied</span>
              </div>
            </div>
            <div
              v-if="
                !selectedAgentConfig.tools.allow?.length &&
                !selectedAgentConfig.tools.deny?.length
              "
              class="muted"
            >
              No tool restrictions configured.
            </div>
          </div>
          <div v-else class="muted">No tools configuration.</div>
        </section>

        <section v-else-if="activePanel === 'skills'" class="card">
          <div class="card-title">Skills</div>
          <div class="card-sub">Skills enabled for this agent.</div>

          <div v-if="selectedAgentConfig?.skills?.length" class="tools-list">
            <div
              v-for="skill in selectedAgentConfig.skills"
              :key="skill"
              class="tool-item"
            >
              <span class="mono">{{ skill }}</span>
              <span class="pill pill--live">Enabled</span>
            </div>
          </div>
          <div v-else class="muted">No skills configured for this agent.</div>
        </section>

        <section v-else-if="activePanel === 'channels'" class="card">
          <div class="card-title">Channels</div>
          <div class="card-sub">Delivery channels configuration.</div>
          <div class="muted">
            Delivery channels are not wired for Codex yet.
          </div>
        </section>

        <section v-else class="card">
          <div class="card-title">Cron Jobs</div>
          <div class="card-sub">Scheduled automation configuration.</div>
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
