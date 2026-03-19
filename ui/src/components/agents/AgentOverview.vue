<script setup lang="ts">
import { useForm, useField, useIsFormDirty } from "vee-validate";
import { watch, computed } from "vue";
import type { AgentInfo, AgentReadResponse, Model } from "../../lib/protocol";

const props = defineProps<{
  agent: AgentInfo | null;
  config: AgentReadResponse | null;
  models: Model[];
}>();

const emit = defineEmits<{
  save: [data: { name: string; model: string }];
  discard: [];
}>();

const { handleSubmit, resetForm, values } = useForm({
  initialValues: {
    name: "",
    model: "",
  },
});

const isDirty = useIsFormDirty();
const dirty = computed(() => isDirty.value);

const { value: name } = useField<string>("name");
const { value: model } = useField<string>("model");

watch(
  () => props.config,
  (config) => {
    if (config) {
      resetForm({
        values: {
          name: config.name || props.agent?.name || "",
          model: config.model || "",
        },
      });
    }
  },
  { immediate: true },
);

const onSubmit = handleSubmit((values) => {
  emit("save", { name: values.name, model: values.model });
  resetForm({ values });
});

const onDiscard = () => {
  emit("discard");
  resetForm();
};

const workspace = computed(
  () => props.config?.workspace || props.agent?.workspace || "default",
);
const configFile = computed(() => props.config?.configFile || "inline");
</script>

<template>
  <form @submit.prevent="onSubmit">
    <div class="card-title">Overview</div>
    <div class="card-sub">Workspace paths and identity metadata.</div>

    <div class="agents-overview-grid" style="margin-top: 16px">
      <div class="agent-kv">
        <div class="label">Workspace</div>
        <div class="mono">{{ workspace }}</div>
      </div>
      <div class="agent-kv">
        <div class="label">Primary Model</div>
        <div class="mono">{{ model || "default" }}</div>
      </div>
      <div class="agent-kv">
        <div class="label">Identity Name</div>
        <div>{{ name || "-" }}</div>
      </div>
      <div class="agent-kv">
        <div class="label">Config File</div>
        <div class="mono">{{ configFile }}</div>
      </div>
    </div>

    <div class="agent-model-select" style="margin-top: 20px">
      <div class="label">Model Selection</div>
      <div class="row" style="gap: 12px; flex-wrap: wrap; margin-top: 12px">
        <label class="field" style="min-width: 260px; flex: 1">
          <span>Primary model</span>
          <select v-model="model" class="field">
            <option value="">Default</option>
            <option v-for="m in models" :key="m.id" :value="m.id">
              {{ m.displayName }}
            </option>
          </select>
        </label>
      </div>

      <div class="field" style="margin-top: 12px">
        <span>Agent Name</span>
        <input
          v-model="name"
          type="text"
          class="field"
          placeholder="Agent name"
        />
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
    </div>
  </form>
</template>
