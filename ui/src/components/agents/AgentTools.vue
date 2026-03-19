<script setup lang="ts">
import { useForm } from "vee-validate";
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

const { isDirty, values, resetForm } = useForm<Record<string, boolean>>({
  initialValues: {},
});

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
    <div class="flex justify-between items-start gap-4 flex-wrap">
      <div>
        <div class="font-semibold">Tool Access</div>
        <div class="text-sm text-muted">
          Profile + per-tool overrides for this agent.
          <span class="font-mono"
            >{{ enabledCount }}/{{ tools.length }} enabled.</span
          >
        </div>
      </div>
      <div class="flex gap-2">
        <button
          type="button"
          class="btn btn-sm"
          :disabled="!isDirty"
          @click="enableAll"
        >
          Enable All
        </button>
        <button
          type="button"
          class="btn btn-sm"
          :disabled="!isDirty"
          @click="disableAll"
        >
          Disable All
        </button>
      </div>
    </div>

    <div class="mt-6 flex flex-col gap-6">
      <div v-for="section in toolSections" :key="section.id">
        <div class="font-medium text-sm pb-2 border-b border-border mb-3">
          {{ section.label }}
        </div>
        <div class="flex flex-col gap-2">
          <div
            v-for="tool in section.tools"
            :key="tool.id"
            class="flex justify-between items-center p-3 bg-bg rounded-md border border-border"
          >
            <div>
              <div class="font-medium text-sm font-mono">{{ tool.label }}</div>
              <div class="text-xs text-muted">{{ tool.description }}</div>
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

    <div v-if="tools.length === 0" class="py-8 text-center text-muted">
      No tools available
    </div>

    <div
      v-if="isDirty"
      class="mt-6 pt-4 border-t border-border flex justify-end gap-2"
    >
      <button type="button" class="btn" @click="onDiscard">Discard</button>
      <button type="submit" class="btn btn-primary">Save Changes</button>
    </div>
  </form>
</template>
