<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import PageHeader from "../components/PageHeader.vue";
import SettingsPanel from "../components/SettingsPanel.vue";
import { useCodexStore } from "../stores/codex";
import { useSettingsStore } from "../stores/settings";

const codexStore = useCodexStore();
const settingsStore = useSettingsStore();

const { connectionStatus, models, platformSummary } = storeToRefs(codexStore);

const settings = computed(() => ({
  url: settingsStore.url,
  cwd: settingsStore.cwd,
  personality: settingsStore.personality
}));
</script>

<template>
  <section class="content-panel">
    <PageHeader
      title="Connection Settings"
      subtitle="Manage app-server connection details and global runtime defaults."
    />

    <SettingsPanel
      :settings="settings"
      :models="models"
      :platform-summary="platformSummary"
      :connection-status="connectionStatus"
      @update="settingsStore.updateSettings"
      @connect="codexStore.connect"
      @disconnect="codexStore.disconnect"
    />
  </section>
</template>
