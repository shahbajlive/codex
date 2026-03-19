<script setup lang="ts">
import { useForm } from "vee-validate";
import { computed, ref, watch } from "vue";

const props = defineProps<{
  files: { filename: string; content: string }[];
}>();

const emit = defineEmits<{
  save: [files: Record<string, string>];
  discard: [];
}>();

const { isDirty, values, resetForm } = useForm<Record<string, string>>({
  initialValues: {},
});

watch(
  () => props.files,
  (files) => {
    const initial: Record<string, string> = {};
    for (const f of files) {
      initial[f.filename] = f.content;
    }
    resetForm({ values: initial });
  },
  { immediate: true },
);

const activeFile = ref("");

watch(
  () => props.files,
  (files) => {
    if (files.length > 0 && !activeFile.value) {
      activeFile.value = files[0].filename;
    }
  },
  { immediate: true },
);

function selectFile(filename: string) {
  activeFile.value = filename;
}

const onDiscard = () => {
  const initial: Record<string, string> = {};
  for (const f of props.files) {
    initial[f.filename] = f.content;
  }
  resetForm({ values: initial });
  emit("discard");
};

const onSubmit = () => {
  emit("save", { ...values });
  resetForm({ values });
};
</script>

<template>
  <form @submit.prevent="onSubmit">
    <div class="grid" style="grid-template-columns: 220px 1fr; gap: 1rem">
      <div class="flex flex-col gap-2">
        <div class="font-semibold">Core Files</div>
        <div class="text-sm text-muted">
          Bootstrap persona, identity, and tool guidance.
        </div>

        <div v-if="files.length > 0" class="flex flex-col gap-1 mt-2">
          <button
            v-for="file in files"
            :key="file.filename"
            type="button"
            class="text-left px-3 py-2 rounded-md transition-colors"
            :class="
              activeFile === file.filename
                ? 'bg-accent/10 text-accent'
                : 'hover:bg-bg-hover'
            "
            @click="selectFile(file.filename)"
          >
            <div class="font-medium text-sm">{{ file.filename }}</div>
            <div class="text-xs text-muted font-mono">
              {{ (file.content.length / 1024).toFixed(1) }}KB
            </div>
          </button>
        </div>
        <div v-else class="text-sm text-muted mt-2">
          No workspace files found.
        </div>
      </div>

      <div class="flex flex-col gap-3">
        <template v-if="files.length > 0 && activeFile">
          <div class="font-semibold font-mono">{{ activeFile }}</div>
          <textarea
            v-model="values[activeFile]"
            class="input font-mono text-sm"
            style="min-height: 300px; resize: vertical"
          ></textarea>
        </template>

        <div
          v-else
          class="flex flex-col items-center justify-center py-12 text-muted"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1"
            class="mb-4 opacity-50"
          >
            <path
              d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
            />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <div class="font-semibold">No workspace files</div>
        </div>

        <div
          v-if="isDirty"
          class="pt-3 border-t border-border flex justify-end gap-2"
        >
          <button type="button" class="btn" @click="onDiscard">Discard</button>
          <button type="submit" class="btn btn-primary">Save Changes</button>
        </div>
      </div>
    </div>
  </form>
</template>
