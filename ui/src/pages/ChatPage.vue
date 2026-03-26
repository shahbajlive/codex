<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import PageHeader from "../components/PageHeader.vue";
import ThreadSidebar from "../components/ThreadSidebar.vue";
import TranscriptPane from "../components/TranscriptPane.vue";
import { useCodexStore } from "../stores/codex";
import { useSettingsStore } from "../stores/settings";

const codexStore = useCodexStore();
const settingsStore = useSettingsStore();

const {
  busy,
  connectionStatus,
  currentActivity,
  isConnected,
  models,
  platformSummary,
  selectedThreadId,
  selectedThreadName,
  threads,
  transcript,
} = storeToRefs(codexStore);

const settings = computed(() => ({
  url: settingsStore.url,
  cwd: settingsStore.cwd,
  model: settingsStore.model,
  personality: settingsStore.personality,
  approvalPolicy: settingsStore.approvalPolicy,
  sandboxMode: settingsStore.sandboxMode,
}));
</script>

<template>
  <section class="content-panel content-panel--chat">
    <PageHeader
      title="Chat"
      subtitle="Direct Codex conversations with thread history and streaming turns."
    />

    <div class="chat-page__layout">
      <ThreadSidebar
        :threads="threads"
        :selected-thread-id="selectedThreadId"
        :connected="isConnected"
        @select="codexStore.selectThread"
        @create="codexStore.createThread"
      />

      <TranscriptPane
        :thread-name="selectedThreadName"
        :transcript="transcript"
        :busy="busy"
        :connected="isConnected"
        @send="codexStore.sendMessage"
      />
    </div>
  </section>
</template>
