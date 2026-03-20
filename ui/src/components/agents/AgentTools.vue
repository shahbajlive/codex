<script setup lang="ts">
import { computed } from "vue";
import { useAgentsStore } from "../../stores/agents";

const agentsStore = useAgentsStore();

interface Tool {
  id: string;
  label: string;
  description: string;
}

const CORE_TOOLS: Tool[] = [
  { id: "read", label: "Read", description: "Read file contents" },
  { id: "write", label: "Write", description: "Write to files" },
  { id: "edit", label: "Edit", description: "Edit files with precision" },
  { id: "glob", label: "Glob", description: "Find files by pattern" },
  { id: "grep", label: "Grep", description: "Search file contents" },
  {
    id: "index-files",
    label: "Index Files",
    description: "Index project files",
  },
  {
    id: "search-files",
    label: "Search Files",
    description: "Search project files",
  },
  { id: "shell", label: "Shell", description: "Execute shell commands" },
  { id: "bash", label: "Bash", description: "Run bash commands" },
  { id: "nodejs", label: "Node.js", description: "Execute Node.js code" },
  { id: "strace", label: "Strace", description: "Trace system calls" },
  { id: "ltrace", label: "Ltrace", description: "Trace library calls" },
  { id: "top", label: "Top", description: "Monitor processes" },
  { id: "kill", label: "Kill", description: "Terminate processes" },
  { id: "pkill", label: "Pkill", description: "Kill by name" },
  { id: "git", label: "Git", description: "Git version control" },
  { id: "web-fetch", label: "Web Fetch", description: "Fetch web content" },
  { id: "memory", label: "Memory", description: "Persistent memory" },
  { id: "skills", label: "Skills", description: "Execute skills" },
  { id: "ddp", label: "DDP", description: "Distributed data" },
];

const TOOL_SECTIONS = [
  {
    id: "filesystem",
    label: "Filesystem",
    tools: [
      "read",
      "write",
      "edit",
      "glob",
      "grep",
      "index-files",
      "search-files",
    ],
  },
  {
    id: "execution",
    label: "Execution",
    tools: [
      "shell",
      "bash",
      "nodejs",
      "strace",
      "ltrace",
      "top",
      "kill",
      "pkill",
    ],
  },
  { id: "vcs", label: "VCS", tools: ["git"] },
  { id: "web", label: "Web", tools: ["web-fetch"] },
  {
    id: "miscellaneous",
    label: "Miscellaneous",
    tools: ["memory", "skills", "ddp"],
  },
];

const hasExplicitAllow = computed(
  () => (agentsStore.config?.tools.allowed.length ?? 0) > 0,
);

const enabledCount = computed(() => {
  if (hasExplicitAllow.value) {
    return agentsStore.config?.tools.allowed.length ?? 0;
  }
  return CORE_TOOLS.length - (agentsStore.config?.tools.denied.length ?? 0);
});

const toolSections = computed(() => {
  return TOOL_SECTIONS.map((section) => ({
    ...section,
    tools: CORE_TOOLS.filter((t) => section.tools.includes(t.id)),
  }));
});
</script>

<template>
  <form class="card">
    <div class="card-header">
      <div>
        <div class="card-title">Tools</div>
        <div class="card-sub">
          Tool access configuration for this agent.
          <span class="mono">{{ enabledCount }}/{{ CORE_TOOLS.length }}</span>
          enabled.
        </div>
      </div>
    </div>

    <div v-if="hasExplicitAllow" class="callout info" style="margin-top: 12px">
      This agent uses an explicit allowlist.
    </div>

    <div class="agent-tools-grid" style="margin-top: 16px">
      <div v-for="section in toolSections" :key="section.id">
        <div class="agent-tools-section">
          <div class="agent-tools-header">{{ section.label }}</div>
          <div class="agent-tools-list">
            <div
              v-for="tool in section.tools"
              :key="tool.id"
              class="agent-tool-row"
            >
              <div>
                <div class="agent-tool-title mono">
                  {{ tool.label }}
                  <span class="mono" style="margin-left: 8px; opacity: 0.8"
                    >core</span
                  >
                </div>
                <div class="agent-tool-sub">{{ tool.description }}</div>
              </div>
              <label class="cfg-toggle">
                <input
                  :checked="agentsStore.isToolEnabled(tool.id)"
                  @change="agentsStore.toggleTool(tool.id)"
                  type="checkbox"
                  :disabled="hasExplicitAllow"
                />
                <span class="cfg-toggle__track"></span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="
        (agentsStore.config?.tools.allowed.length ?? 0) > 0 ||
        (agentsStore.config?.tools.denied.length ?? 0) > 0
      "
      style="margin-top: 20px"
    >
      <div class="label">Configured Allow/Deny</div>
      <div class="tools-list">
        <div v-if="(agentsStore.config?.tools.allowed.length ?? 0) > 0">
          <div class="label" style="margin-top: 12px">Allowed Tools</div>
          <div
            v-for="tool in agentsStore.config!.tools.allowed"
            :key="tool"
            class="tool-item"
          >
            <span class="mono">{{ tool }}</span>
            <span class="pill pill--live">Allowed</span>
          </div>
        </div>
        <div v-if="(agentsStore.config?.tools.denied.length ?? 0) > 0">
          <div class="label" style="margin-top: 12px">Denied Tools</div>
          <div
            v-for="tool in agentsStore.config!.tools.denied"
            :key="tool"
            class="tool-item"
          >
            <span class="mono">{{ tool }}</span>
            <span class="pill danger">Denied</span>
          </div>
        </div>
      </div>
    </div>
  </form>
</template>
