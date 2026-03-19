<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useForm, useField } from "vee-validate";

const props = defineProps<{
  files: { filename: string; content: string }[];
}>();

const emit = defineEmits<{
  save: [files: Record<string, string>];
  discard: [];
}>();

const { setFieldValue, resetForm } = useForm();

const activeFile = ref("");

const fileContents = ref<Record<string, string>>({});

watch(
  () => props.files,
  (files) => {
    for (const f of files) {
      if (!(f.filename in fileContents.value)) {
        fileContents.value[f.filename] = f.content;
      }
    }
    if (files.length > 0 && !activeFile.value) {
      activeFile.value = files[0].filename;
    }
  },
  { immediate: true },
);

function selectFile(filename: string) {
  activeFile.value = filename;
}

const activeContent = computed(() => {
  if (!activeFile.value) return "";
  return fileContents.value[activeFile.value] ?? "";
});

function handleInput(event: Event) {
  const target = event.target as HTMLTextAreaElement;
  fileContents.value[activeFile.value] = target.value;
}

const isDirty = computed(() => {
  if (!activeFile.value) return false;
  const file = props.files.find((f) => f.filename === activeFile.value);
  return activeContent.value !== (file?.content ?? "");
});

function formatFileSize(content: string): string {
  const kb = content.length / 1024;
  if (kb < 1) return `${content.length} B`;
  return `${kb.toFixed(1)} KB`;
}

const onDiscard = () => {
  const file = props.files.find((f) => f.filename === activeFile.value);
  if (activeFile.value && file) {
    fileContents.value[activeFile.value] = file.content;
  }
  emit("discard");
};

const onSubmit = () => {
  const toSave: Record<string, string> = {};
  for (const f of props.files) {
    const current = fileContents.value[f.filename];
    if (current !== f.content) {
      toSave[f.filename] = current ?? "";
    }
  }
  if (Object.keys(toSave).length > 0) {
    emit("save", toSave);
    for (const [filename, content] of Object.entries(toSave)) {
      fileContents.value[filename] = content;
    }
  }
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
              :value="activeContent"
              @input="handleInput"
              class="field"
              style="flex: 1; min-height: 400px; resize: vertical"
            ></textarea>
          </div>

          <div
            v-if="isDirty"
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
