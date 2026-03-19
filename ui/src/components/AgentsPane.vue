<script setup lang="ts">
import { ref, computed, watch } from "vue";
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
  "overview" | "instructions" | "tools" | "skills" | "channels" | "cron"
>("overview");

const isEditing = ref(false);
const editedName = ref("");
const editedModel = ref("");
const editedInstructions = ref("");
const saving = ref(false);
const selectedInstructionTab = ref("config");

const fileDrafts = ref<Record<string, string>>({});
const fileEditing = ref<string | null>(null);

function selectFileTab(filename: string) {
  selectedInstructionTab.value = filename;
  fileEditing.value = filename;
  if (!fileDrafts.value[filename]) {
    const file = workspaceFiles.value.find((f) => f.filename === filename);
    if (file) {
      fileDrafts.value[filename] = file.content;
    }
  }
}

function resetFileDraft(filename: string) {
  const file = workspaceFiles.value.find((f) => f.filename === filename);
  if (file) {
    fileDrafts.value[filename] = file.content;
  }
}

const currentFileContent = computed(() => {
  if (selectedInstructionTab.value === "config") {
    return isEditing.value
      ? editedInstructions.value
      : props.selectedAgentConfig?.developerInstructions || "";
  }
  const file = workspaceFiles.value.find(
    (f) => f.filename === selectedInstructionTab.value,
  );
  if (fileEditing.value === selectedInstructionTab.value) {
    return (
      fileDrafts.value[selectedInstructionTab.value] ?? file?.content ?? ""
    );
  }
  return file?.content ?? "";
});

const isFileDirty = computed(() => {
  if (selectedInstructionTab.value === "config") {
    return false;
  }
  const file = workspaceFiles.value.find(
    (f) => f.filename === selectedInstructionTab.value,
  );
  const draft = fileDrafts.value[selectedInstructionTab.value];
  return draft !== (file?.content ?? "");
});

const workspaceFiles = computed(() => props.workspaceFiles || []);

const selectedAgent = computed(
  () => props.agents.find((a) => a.id === props.selectedAgentId) || null,
);

function startEdit() {
  editedName.value = selectedAgent.value?.name || "";
  editedModel.value = props.selectedAgentConfig?.model || "";
  editedInstructions.value =
    props.selectedAgentConfig?.developerInstructions || "";
  isEditing.value = true;
}

async function saveEdit() {
  saving.value = true;
  const id = selectedAgent.value?.id || "";
  console.log("Saving agent:", {
    id,
    name: editedName.value,
    model: editedModel.value,
    instructionsLength: editedInstructions.value?.length,
  });
  const result = await codexStore.updateAgent(
    id,
    editedName.value || null,
    editedModel.value || null,
    editedInstructions.value || null,
    null,
  );
  console.log("Save result:", result);
  saving.value = false;
  isEditing.value = false;
}

function cancelEdit() {
  isEditing.value = false;
}

const panels = [
  { id: "overview", label: "Overview" },
  { id: "instructions", label: "Instructions" },
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

async function copyInstructions() {
  const instructions = isEditing.value
    ? editedInstructions.value
    : props.selectedAgentConfig?.developerInstructions;
  if (instructions) {
    await navigator.clipboard.writeText(instructions);
  }
}
</script>

<template>
  <section class="agents-layout">
    <aside class="agents-sidebar">
      <div class="sidebar-header">
        <div>
          <div class="sidebar-title">Agents</div>
          <div class="sidebar-subtitle">{{ agents.length }} configured</div>
        </div>
        <button
          class="refresh-btn"
          @click="emit('refresh')"
          :disabled="loading"
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
            :class="{ spin: loading }"
          >
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
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
            <div class="agent-name">{{ agent.name }}</div>
            <div class="agent-desc">
              {{ agent.description?.slice(0, 50) || "No description" }}
            </div>
          </div>
        </button>
      </div>
    </aside>

    <section class="agents-main">
      <template v-if="selectedAgent">
        <section class="agent-hero">
          <div class="hero-left">
            <div
              class="hero-avatar"
              :style="{ backgroundColor: getAgentColor(selectedAgent.name) }"
            >
              {{ selectedAgent.name.slice(0, 1).toUpperCase() }}
            </div>
            <div class="hero-info">
              <h2 class="hero-name">{{ selectedAgent.name }}</h2>
              <p class="hero-desc">
                {{
                  selectedAgentConfig?.description ||
                  selectedAgent.description ||
                  "No description"
                }}
              </p>
            </div>
          </div>
          <div class="hero-actions">
            <template v-if="isEditing">
              <button class="hero-btn" @click="cancelEdit" :disabled="saving">
                Cancel
              </button>
              <button
                class="hero-btn primary"
                @click="saveEdit"
                :disabled="saving"
              >
                {{ saving ? "Saving..." : "Save" }}
              </button>
            </template>
            <template v-else>
              <button class="hero-btn" @click="startEdit">
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
                    d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
                  />
                  <path
                    d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
                  />
                </svg>
                Edit
              </button>
              <button
                class="hero-btn primary"
                @click="emit('openConversation', selectedAgent.name)"
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
            </template>
          </div>
        </section>

        <div class="agent-tabs">
          <button
            v-for="panel in panels"
            :key="panel.id"
            class="agent-tab"
            :class="{ active: activePanel === panel.id }"
            type="button"
            @click="activePanel = panel.id"
          >
            {{ panel.label }}
          </button>
        </div>

        <section v-if="activePanel === 'overview'" class="panel-content">
          <div class="info-grid">
            <div class="info-card">
              <div class="info-label">Name</div>
              <template v-if="isEditing">
                <input
                  v-model="editedName"
                  class="info-input"
                  placeholder="Agent name"
                />
              </template>
              <template v-else>
                <div class="info-value">
                  {{ selectedAgent.name }}
                </div>
              </template>
            </div>
            <div class="info-card">
              <div class="info-label">Model</div>
              <template v-if="isEditing">
                <select v-model="editedModel" class="info-select">
                  <option value="">Default</option>
                  <option
                    v-for="model in models"
                    :key="model.id"
                    :value="model.id"
                  >
                    {{ model.displayName }}
                  </option>
                </select>
              </template>
              <template v-else>
                <div class="info-value mono">
                  {{ selectedAgentConfig?.model || "default" }}
                </div>
              </template>
            </div>
            <div class="info-card">
              <div class="info-label">Workspace</div>
              <div class="info-value mono">
                {{
                  selectedAgentConfig?.workspace ||
                  selectedAgent.workspace ||
                  "default"
                }}
              </div>
            </div>
            <div class="info-card">
              <div class="info-label">Config File</div>
              <div class="info-value mono">
                {{ selectedAgentConfig?.configFile || "inline" }}
              </div>
            </div>
          </div>
        </section>

        <section
          v-else-if="activePanel === 'instructions'"
          class="panel-content instructions-panel"
        >
          <div class="instructions-sidebar">
            <div class="sidebar-section">
              <div class="section-title">Core Files</div>
              <div class="section-subtitle">
                Bootstrap persona, identity, and tool guidance.
              </div>
              <div class="file-tabs" v-if="workspaceFiles.length > 0">
                <button
                  v-for="file in workspaceFiles"
                  :key="file.filename"
                  class="file-tab"
                  :class="{ active: selectedInstructionTab === file.filename }"
                  @click="selectFileTab(file.filename)"
                >
                  <span class="file-name">{{ file.filename }}</span>
                  <span class="file-meta">
                    {{ (file.content.length / 1024).toFixed(1) }}KB
                  </span>
                </button>
              </div>
              <div v-else class="no-files">No workspace files found.</div>
            </div>
          </div>

          <div class="instructions-editor" v-if="workspaceFiles.length > 0">
            <template v-for="file in workspaceFiles" :key="file.filename">
              <template v-if="selectedInstructionTab === file.filename">
                <div class="editor-header">
                  <div class="editor-title">
                    <div class="file-title mono">{{ file.filename }}</div>
                  </div>
                  <div class="editor-actions">
                    <button
                      class="copy-btn"
                      @click="copyFileContent(file.content)"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <rect
                          x="9"
                          y="9"
                          width="13"
                          height="13"
                          rx="2"
                          ry="2"
                        />
                        <path
                          d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
                        />
                      </svg>
                      Copy
                    </button>
                  </div>
                </div>
                <pre class="instructions-content">{{ file.content }}</pre>
              </template>
            </template>
          </div>

          <div class="instructions-editor empty" v-else>
            <div class="empty-state">
              <div class="empty-icon">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path
                    d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                  />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
              <div class="empty-title">No workspace files</div>
              <div class="empty-desc">This agent has no workspace files.</div>
            </div>
          </div>
        </section>

        <section
          v-else-if="activePanel === 'tools'"
          class="panel-content tools-panel"
        >
          <div v-if="selectedAgentConfig?.tools" class="tools-list">
            <div
              v-if="selectedAgentConfig.tools.allow?.length"
              class="tools-section"
            >
              <div class="section-label">Allowed Tools</div>
              <div
                v-for="tool in selectedAgentConfig.tools.allow"
                :key="tool"
                class="tool-item"
              >
                <span class="tool-name">{{ tool }}</span>
                <span class="tool-status enabled">Allowed</span>
              </div>
            </div>
            <div
              v-if="selectedAgentConfig.tools.deny?.length"
              class="tools-section"
            >
              <div class="section-label">Denied Tools</div>
              <div
                v-for="tool in selectedAgentConfig.tools.deny"
                :key="tool"
                class="tool-item"
              >
                <span class="tool-name">{{ tool }}</span>
                <span class="tool-status disabled">Denied</span>
              </div>
            </div>
            <div
              v-if="
                !selectedAgentConfig.tools.allow?.length &&
                !selectedAgentConfig.tools.deny?.length
              "
              class="placeholder-content"
            >
              <div class="placeholder-text">
                No tool restrictions configured
              </div>
            </div>
          </div>
          <div v-else class="placeholder-content">
            <div class="placeholder-text">No tools configuration</div>
          </div>
        </section>

        <section v-else-if="activePanel === 'skills'" class="panel-content">
          <div v-if="selectedAgentConfig?.skills?.length" class="skills-list">
            <div
              v-for="skill in selectedAgentConfig.skills"
              :key="skill"
              class="tool-item"
            >
              <span class="tool-name">{{ skill }}</span>
              <span class="tool-status enabled">Enabled</span>
            </div>
          </div>
          <div v-else class="placeholder-content">
            <div class="placeholder-icon">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polygon
                  points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
                />
              </svg>
            </div>
            <div class="placeholder-title">Skills</div>
            <div class="placeholder-desc">
              No skills configured for this agent.
            </div>
          </div>
        </section>

        <section v-else-if="activePanel === 'channels'" class="panel-content">
          <div class="placeholder-content">
            <div class="placeholder-icon">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M4 9h16" />
                <path d="M4 15h16" />
                <path d="M10 3L8 21" />
                <path d="M16 3l-2 18" />
              </svg>
            </div>
            <div class="placeholder-title">Channels</div>
            <div class="placeholder-desc">
              Delivery channels are not wired for Codex yet.
            </div>
          </div>
        </section>

        <section v-else class="panel-content">
          <div class="placeholder-content">
            <div class="placeholder-icon">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <div class="placeholder-title">Cron Jobs</div>
            <div class="placeholder-desc">
              Scheduled automation parity is still to come.
            </div>
          </div>
        </section>
      </template>

      <div v-else class="empty-state">
        <div class="empty-icon">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
            />
          </svg>
        </div>
        <div class="empty-title">Select an agent</div>
        <div class="empty-desc">
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
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border);
}

.sidebar-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text);
}

.sidebar-subtitle {
  font-size: 0.75rem;
  color: var(--muted);
  margin-top: 0.25rem;
}

.refresh-btn {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 0.5rem;
  cursor: pointer;
  color: var(--muted);
  transition: all var(--duration-fast) ease;
}

.refresh-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.refresh-btn .spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.agent-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.agent-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 0.75rem;
  border-radius: var(--radius-md);
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  width: 100%;
  transition: background var(--duration-fast) ease;
}

.agent-row:hover {
  background: var(--bg-hover);
}

.agent-row.active {
  background: var(--accent-subtle);
}

.agent-avatar {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 0.875rem;
  flex-shrink: 0;
}

.agent-info {
  flex: 1;
  min-width: 0;
}

.agent-name {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agent-desc {
  font-size: 0.75rem;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agents-main {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  overflow-y: auto;
}

.agent-hero {
  background: var(--bg-elevated);
  border-radius: var(--radius-lg);
  padding: 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.hero-left {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.hero-avatar {
  width: 64px;
  height: 64px;
  border-radius: var(--radius-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 1.5rem;
  color: white;
}

.hero-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.hero-name {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text);
  margin: 0;
}

.hero-desc {
  font-size: 0.875rem;
  color: var(--muted);
  margin: 0;
  max-width: 400px;
}

.hero-actions {
  display: flex;
  gap: 0.5rem;
}

.hero-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1rem;
  border-radius: var(--radius-md);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--duration-fast) ease;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
}

.hero-btn:hover {
  background: var(--bg-hover);
}

.hero-btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}

.hero-btn.primary:hover {
  background: var(--accent-hover);
}

.agent-tabs {
  display: flex;
  gap: 0.25rem;
  background: var(--bg-elevated);
  padding: 0.25rem;
  border-radius: var(--radius-lg);
}

.agent-tab {
  padding: 0.5rem 1rem;
  border-radius: var(--radius-md);
  font-size: 0.875rem;
  font-weight: 500;
  background: transparent;
  border: none;
  color: var(--muted);
  cursor: pointer;
  transition: all var(--duration-fast) ease;
}

.agent-tab:hover {
  color: var(--text);
}

.agent-tab.active {
  background: var(--bg);
  color: var(--text);
  box-shadow: var(--shadow-sm);
}

.panel-content {
  background: var(--bg-elevated);
  border-radius: var(--radius-lg);
  padding: 1.5rem;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
}

.info-card {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.info-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.info-value {
  font-size: 0.875rem;
  color: var(--text);
}

.info-value.mono {
  font-family: var(--mono);
  font-size: 0.8125rem;
  word-break: break-all;
}

.info-input,
.info-select {
  width: 100%;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  font-family: inherit;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  outline: none;
  transition: border-color var(--duration-fast) ease;
}

.info-input:focus,
.info-select:focus {
  border-color: var(--accent);
}

.info-select {
  cursor: pointer;
}

.copy-btn {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.75rem;
  border-radius: var(--radius-md);
  font-size: 0.8125rem;
  font-weight: 500;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--muted);
  cursor: pointer;
  transition: all var(--duration-fast) ease;
}

.copy-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.instructions-content {
  background: var(--bg);
  border-radius: var(--radius-md);
  padding: 1rem;
  font-family: var(--mono);
  font-size: 0.8125rem;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 400px;
  overflow-y: auto;
  margin: 0;
  border: 1px solid var(--border);
}

.instructions-textarea {
  width: 100%;
  min-height: 300px;
  padding: 1rem;
  font-family: var(--mono);
  font-size: 0.8125rem;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  outline: none;
  resize: vertical;
  white-space: pre-wrap;
  word-break: break-word;
}

.instructions-textarea:focus {
  border-color: var(--accent);
}

.instructions-panel {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 1rem;
  padding: 1rem;
}

.instructions-sidebar {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.sidebar-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.section-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text);
}

.section-subtitle {
  font-size: 0.75rem;
  color: var(--muted);
  margin-bottom: 0.5rem;
}

.file-tabs {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.file-tab {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.625rem 0.75rem;
  border-radius: var(--radius-md);
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  width: 100%;
  transition: background var(--duration-fast) ease;
}

.file-tab:hover {
  background: var(--bg-hover);
}

.file-tab.active {
  background: var(--accent-subtle);
}

.file-name {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text);
}

.file-tab.active .file-name {
  color: var(--accent);
}

.file-meta {
  font-size: 0.6875rem;
  color: var(--muted);
  font-family: var(--mono);
}

.instructions-editor {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

.editor-title {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.file-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text);
}

.editor-actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.field span {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.field .instructions-textarea {
  min-height: 400px;
}

.placeholder-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem 1rem;
  text-align: center;
}

.placeholder-icon {
  color: var(--muted);
  opacity: 0.5;
  margin-bottom: 1rem;
}

.placeholder-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 0.375rem;
}

.placeholder-desc {
  font-size: 0.875rem;
  color: var(--muted);
}

.tools-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.tool-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  background: var(--bg);
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
}

.tool-name {
  font-family: var(--mono);
  font-size: 0.875rem;
  color: var(--text);
}

.tool-status {
  font-size: 0.75rem;
  font-weight: 500;
  padding: 0.25rem 0.5rem;
  border-radius: var(--radius-sm);
}

.tool-status.enabled {
  background: var(--accent-subtle);
  color: var(--accent);
}

.tool-status.disabled {
  background: var(--bg-hover);
  color: var(--muted);
}

.panel-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 0.25rem;
}

.panel-desc {
  font-size: 0.875rem;
  color: var(--muted);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  padding: 3rem;
}

.empty-icon {
  color: var(--muted);
  opacity: 0.3;
  margin-bottom: 1.5rem;
}

.empty-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 0.5rem;
}

.empty-desc {
  font-size: 0.875rem;
  color: var(--muted);
}
</style>
