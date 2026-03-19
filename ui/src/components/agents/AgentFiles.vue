<script setup lang="ts">
import { useForm, useIsFormDirty } from "vee-validate";
import { computed, ref, watch } from "vue";

const props = defineProps<{
  files: { filename: string; content: string }[];
}>();

const emit = defineEmits<{
  save: [files: Record<string, string>];
  discard: [];
}>();

const { values, resetForm } = useForm<Record<string, string>>({
  initialValues: {},
});

const isDirty = useIsFormDirty();
const dirty = computed(() => isDirty.value);

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

function formatFileSize(content: string): string {
  const kb = content.length / 1024;
  if (kb < 1) return `${content.length} B`;
  return `${kb.toFixed(1)} KB`;
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
    <div class="card-title">Workspace Files</div>
    <div class="card-sub">Bootstrap persona, identity, and tool guidance.</div>

    <div class="agent-files-grid" style="margin-top: 16px">
      <div class="agent-files-list">
        <template v-if="files.length > 0">
          <button
            v-for="file in files"
            :key="file.filename"
            type="button"
            class="agent-file-row"
            :class="{ active: activeFile === file.filename }"
            @click="selectFile(file.filename)"
          >
            <div>
              <div class="agent-file-name">{{ file.filename }}</div>
              <div class="agent-file-meta mono">
                {{ formatFileSize(file.content) }}
              </div>
            </div>
          </button>
        </template>
        <div v-else class="muted">No workspace files found.</div>
      </div>

      <div class="agent-files-editor">
        <template v-if="files.length > 0 && activeFile">
          <div class="agent-file-header">
            <div>
              <div class="agent-file-title mono">{{ activeFile }}</div>
              <div class="agent-file-sub">Edit workspace file content</div>
            </div>
          </div>

          <div
            class="field"
            style="
              margin-top: 12px;
              flex: 1;
              display: flex;
              flex-direction: column;
            "
          >
            <textarea
              v-model="values[activeFile]"
              class="field"
              style="flex: 1; min-height: 400px; resize: vertical"
            ></textarea>
          </div>

          <div
            v-if="dirty"
            class="row"
            style="justify-content: flex-end; gap: 8px; margin-top: 12px"
          >
            <button type="button" class="btn btn--sm" @click="onDiscard">
              Discard
            </button>
            <button type="submit" class="btn btn--sm primary">
              Save Changes
            </button>
          </div>
        </template>

        <div v-else class="muted" style="text-align: center; padding: 40px">
          Select a file to edit its contents.
        </div>
      </div>
    </div>
  </form>
</template>

<style scoped>
.agent-files-editor {
  display: flex;
  flex-direction: column;
  min-height: 1000px;
}
</style>
