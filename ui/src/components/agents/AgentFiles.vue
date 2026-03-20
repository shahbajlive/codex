<script setup lang="ts">
import { useAgentsStore } from "../../stores/agents";

const agentsStore = useAgentsStore();

function handleInput(event: Event) {
  const target = event.target as HTMLTextAreaElement;
  agentsStore.updateFileContent(agentsStore.activeFile, target.value);
}

function formatFileSize(content: string): string {
  const kb = content.length / 1024;
  if (kb < 1) return `${content.length} B`;
  return `${kb.toFixed(1)} KB`;
}
</script>

<template>
  <form class="card">
    <div class="card-header">
      <div>
        <div class="card-title">Workspace Files</div>
        <div class="card-sub">
          Bootstrap persona, identity, and tool guidance.
        </div>
      </div>
    </div>

    <div class="agent-files-grid" style="margin-top: 16px">
      <div class="agent-files-list">
        <template v-if="agentsStore.config?.files.length">
          <button
            v-for="file in agentsStore.config.files"
            :key="file.filename"
            type="button"
            class="agent-file-row"
            :class="{ active: agentsStore.activeFile === file.filename }"
            @click="agentsStore.setActiveFile(file.filename)"
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
        <template
          v-if="agentsStore.config?.files.length && agentsStore.activeFile"
        >
          <div class="agent-file-header">
            <div>
              <div class="agent-file-title mono">
                {{ agentsStore.activeFile }}
              </div>
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
              :value="
                agentsStore.config.files.find(
                  (f) => f.filename === agentsStore.activeFile,
                )?.content || ''
              "
              @input="handleInput"
              class="field"
              style="flex: 1; min-height: 400px; resize: vertical"
            ></textarea>
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
  min-height: 400px;
}
</style>
