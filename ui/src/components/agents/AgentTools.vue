<script setup lang="ts">
import { useForm, useIsFormDirty } from "vee-validate";
import { computed, watch } from "vue";

interface Tool {
  id: string;
  label: string;
  description: string;
}

const props = defineProps<{
  tools: Tool[];
  configTools: { allow?: string[]; deny?: string[] } | null;
}>();

const emit = defineEmits<{
  save: [tools: { allow: string[]; deny: string[] }];
  discard: [];
}>();

const TOOL_SECTIONS = [
  {
    id: "filesystem",
    label: "Filesystem",
    tools: ["Read", "Write", "Edit", "Glob", "Grep", "Move", "Remove", "Mkdir"],
  },
  {
    id: "terminal",
    label: "Terminal",
    tools: ["Bash", "Node", "Python", "Go", "Rust"],
  },
  {
    id: "code",
    label: "Code Intelligence",
    tools: ["CodebaseIndex", "CodeSearch", "FindFunctions", "ListClasses"],
  },
  { id: "web", label: "Web", tools: ["Fetch", "WebSearch", "Curl"] },
  {
    id: "git",
    label: "Git",
    tools: ["Git", "GitCommit", "GitBranch", "GitPR"],
  },
  {
    id: "misc",
    label: "Miscellaneous",
    tools: [
      "TodoRead",
      "TodoWrite",
      "NotesRead",
      "NotesWrite",
      "RegistryRead",
      "RegistryWrite",
    ],
  },
];

const toolSections = computed(() => {
  const sections = [];
  for (const section of TOOL_SECTIONS) {
    const available = props.tools.filter((t) => section.tools.includes(t.id));
    if (available.length > 0) {
      sections.push({ ...section, tools: available });
    }
  }
  const other = props.tools.filter(
    (t) => !TOOL_SECTIONS.some((s) => s.tools.includes(t.id)),
  );
  if (other.length > 0) {
    sections.push({ id: "other", label: "Other", tools: other });
  }
  return sections;
});

const { values, resetForm } = useForm<Record<string, boolean>>({
  initialValues: {},
});

const isDirty = useIsFormDirty();
const dirty = computed(() => isDirty.value);

const allowedTools = computed(() => props.configTools?.allow || []);
const deniedTools = computed(() => props.configTools?.deny || []);

function isToolEnabled(toolId: string): boolean {
  if (allowedTools.value.includes(toolId)) return true;
  if (deniedTools.value.includes(toolId)) return false;
  return true;
}

watch(
  [() => props.tools, () => props.configTools],
  ([tools, configTools]) => {
    const initial: Record<string, boolean> = {};
    for (const tool of tools) {
      initial[tool.id] = isToolEnabled(tool.id);
    }
    resetForm({ values: initial });
  },
  { immediate: true },
);

const enabledCount = computed(
  () => Object.values(values).filter(Boolean).length,
);

const onDiscard = () => {
  const initial: Record<string, boolean> = {};
  for (const tool of props.tools) {
    initial[tool.id] = isToolEnabled(tool.id);
  }
  resetForm({ values: initial });
  emit("discard");
};

const onSubmit = () => {
  const deny: string[] = [];
  for (const [toolId, enabled] of Object.entries(values)) {
    if (!enabled) {
      deny.push(toolId);
    }
  }
  emit("save", { allow: [], deny });
  resetForm({ values: { ...values } });
};

function enableAll() {
  for (const key of Object.keys(values)) {
    values[key] = true;
  }
}

function disableAll() {
  for (const key of Object.keys(values)) {
    values[key] = false;
  }
}
</script>

<template>
  <form @submit.prevent="onSubmit">
    <div class="card-title">Tool Access</div>
    <div class="card-sub">
      Profile + per-tool overrides for this agent.
      <span class="mono">{{ enabledCount }}/{{ tools.length }} enabled.</span>
    </div>

    <div class="agent-tools-buttons" style="margin-top: 12px">
      <button
        type="button"
        class="btn btn--sm"
        :disabled="!dirty"
        @click="enableAll"
      >
        Enable All
      </button>
      <button
        type="button"
        class="btn btn--sm"
        :disabled="!dirty"
        @click="disableAll"
      >
        Disable All
      </button>
    </div>

    <div class="agent-tools-grid" style="margin-top: 16px">
      <div v-for="section in toolSections" :key="section.id">
        <div class="agent-tools-header">{{ section.label }}</div>
        <div class="agent-tools-list">
          <div
            v-for="tool in section.tools"
            :key="tool.id"
            class="agent-tool-row"
          >
            <div>
              <div class="agent-tool-title mono">{{ tool.label }}</div>
              <div class="agent-tool-sub">{{ tool.description }}</div>
            </div>
            <label class="toggle">
              <input
                type="checkbox"
                :value="tool.id"
                v-model="values[tool.id]"
              />
              <span class="toggle-track"></span>
            </label>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="tools.length === 0"
      class="muted"
      style="text-align: center; padding: 40px"
    >
      No tools available
    </div>

    <div
      v-if="dirty"
      class="row"
      style="justify-content: flex-end; gap: 8px; margin-top: 16px"
    >
      <button type="button" class="btn btn--sm" @click="onDiscard">
        Discard
      </button>
      <button type="submit" class="btn btn--sm primary">Save Changes</button>
    </div>
  </form>
</template>
