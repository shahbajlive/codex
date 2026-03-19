<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { useForm, useIsFormDirty } from "vee-validate";

interface Tool {
  id: string;
  label: string;
  description: string;
  category: string;
}

const props = defineProps<{
  tools: Tool[];
  configTools: { allow?: string[]; deny?: string[] } | null;
  saving?: boolean;
}>();

const emit = defineEmits<{
  save: [tools: { allow: string[]; deny?: string[] }];
  discard: [];
}>();

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

const allowedTools = computed(() => props.configTools?.allow || []);
const deniedTools = computed(() => props.configTools?.deny || []);
const hasExplicitAllow = computed(
  () => (props.configTools?.allow?.length ?? 0) > 0,
);

function isToolEnabled(toolId: string): boolean {
  if (allowedTools.value.includes(toolId)) return true;
  if (deniedTools.value.includes(toolId)) return false;
  return true;
}

const { values, setFieldValue, resetForm } = useForm();
const isDirty = useIsFormDirty();

const registeredTools = ref<string[]>([]);

function registerTools(tools: Tool[]) {
  const newIds = tools.map((t) => t.id);
  const removed = registeredTools.value.filter((id) => !newIds.includes(id));
  for (const id of removed) {
    delete values[id as keyof typeof values];
  }
  for (const tool of tools) {
    if (!(tool.id in values)) {
      values[tool.id as keyof typeof values] = isToolEnabled(tool.id);
    }
  }
  registeredTools.value = newIds;
}

watch(
  () => props.tools,
  (tools) => {
    registerTools(tools);
  },
  { immediate: true },
);

watch(
  () => props.configTools,
  () => {
    registerTools(props.tools);
  },
);

const dirty = computed(() => isDirty.value);

const enabledCount = computed(
  () => Object.values(values).filter(Boolean).length,
);

const onDiscard = () => {
  for (const tool of props.tools) {
    setFieldValue(tool.id, isToolEnabled(tool.id));
  }
  emit("discard");
};

const onSubmit = () => {
  const deny: string[] = [];
  for (const toolId of registeredTools.value) {
    if (!values[toolId as keyof typeof values]) deny.push(toolId);
  }
  emit("save", { allow: [], deny });
  resetForm({ values: { ...values } });
};

function enableAll() {
  for (const toolId of registeredTools.value) {
    setFieldValue(toolId, true);
  }
}

function disableAll() {
  for (const toolId of registeredTools.value) {
    setFieldValue(toolId, false);
  }
}
</script>

<template>
  <form @submit.prevent="onSubmit">
    <div class="row" style="justify-content: space-between">
      <div>
        <div class="card-title">Tool Access</div>
        <div class="card-sub">
          Per-tool overrides for this agent.
          <span class="mono">{{ enabledCount }}/{{ tools.length }}</span>
          enabled.
        </div>
      </div>
      <div class="row" style="gap: 8px">
        <button type="button" class="btn btn--sm" @click="enableAll">
          Enable All
        </button>
        <button type="button" class="btn btn--sm" @click="disableAll">
          Disable All
        </button>
      </div>
    </div>

    <div v-if="hasExplicitAllow" class="callout info" style="margin-top: 12px">
      This agent uses an explicit allowlist. Tool overrides are managed in the
      Config tab.
    </div>

    <div class="agent-tools-meta" style="margin-top: 16px">
      <div class="agent-kv">
        <div class="label">Configured</div>
        <div>{{ configTools ? "yes" : "no" }}</div>
      </div>
      <div class="agent-kv">
        <div class="label">Enabled</div>
        <div class="mono">{{ enabledCount }}/{{ tools.length }}</div>
      </div>
      <div v-if="dirty" class="agent-kv">
        <div class="label">Status</div>
        <div class="mono">unsaved</div>
      </div>
    </div>

    <div class="agent-tools-grid" style="margin-top: 20px">
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
                  <span class="mono" style="margin-left: 8px; opacity: 0.8">
                    core
                  </span>
                </div>
                <div class="agent-tool-sub">{{ tool.description }}</div>
              </div>
              <label class="cfg-toggle">
                <input
                  type="checkbox"
                  :checked="values[tool.id]"
                  @change="
                    setFieldValue(
                      tool.id,
                      ($event.target as HTMLInputElement).checked,
                    )
                  "
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
      v-if="tools.length === 0"
      class="muted"
      style="text-align: center; padding: 40px"
    >
      No tools available.
    </div>

    <div
      v-if="dirty"
      class="row"
      style="justify-content: flex-end; gap: 8px; margin-top: 16px"
    >
      <button type="button" class="btn btn--sm" @click="onDiscard">
        Discard
      </button>
      <button type="submit" class="btn btn--sm primary">
        {{ saving ? "Saving…" : "Save Changes" }}
      </button>
    </div>
  </form>
</template>
