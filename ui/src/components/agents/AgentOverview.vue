<script setup lang="ts">
import { useForm, useField } from "vee-validate";
import { watch } from "vue";
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

const { handleSubmit, resetForm, isDirty, values } = useForm({
  initialValues: {
    name: "",
    model: "",
  },
});

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
</script>

<template>
  <form @submit.prevent="onSubmit">
    <div class="grid grid-cols-2 gap-4">
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium text-muted uppercase tracking-wide"
          >Name</label
        >
        <input v-model="name" class="input" placeholder="Agent name" />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium text-muted uppercase tracking-wide"
          >Model</label
        >
        <select v-model="model" class="input">
          <option value="">Default</option>
          <option v-for="m in models" :key="m.id" :value="m.id">
            {{ m.displayName }}
          </option>
        </select>
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium text-muted uppercase tracking-wide"
          >Workspace</label
        >
        <div class="font-mono text-sm">
          {{ config?.workspace || agent?.workspace || "default" }}
        </div>
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium text-muted uppercase tracking-wide"
          >Config File</label
        >
        <div class="font-mono text-sm">
          {{ config?.configFile || "inline" }}
        </div>
      </div>
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
