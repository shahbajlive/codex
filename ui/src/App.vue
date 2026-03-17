<script setup lang="ts">
import { ref, onBeforeUnmount, onMounted } from "vue";
import { storeToRefs } from "pinia";
import AppSidebar from "./components/layout/AppSidebar.vue";
import AppTopbar from "./components/layout/AppTopbar.vue";
import SettingsPanel from "./components/SettingsPanel.vue";
import { RouterView } from "vue-router";
import { useCodexStore } from "./stores/codex";
import { useSettingsStore } from "./stores/settings";
import { watchEffect, computed } from "vue";

const settingsStore = useSettingsStore();
const codexStore = useCodexStore();

const rightSidebarOpen = ref(false);

onMounted(() => {
  codexStore.connect();
});

watchEffect(() => {
  const theme = settingsStore.theme;
  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute(
    "data-theme",
    isDark ? "dark" : "light",
  );
});

const {
  busy,
  connectionStatus,
  errorMessage,
  isConnected,
  models,
  platformSummary,
} = storeToRefs(codexStore);

const settings = computed(() => ({
  url: settingsStore.url,
  cwd: settingsStore.cwd,
  model: settingsStore.model,
  personality: settingsStore.personality,
  approvalPolicy: settingsStore.approvalPolicy,
  sandboxMode: settingsStore.sandboxMode,
}));

onBeforeUnmount(() => {
  codexStore.disconnect();
});
</script>

<template>
  <div
    :class="['shell', { 'shell--nav-collapsed': settingsStore.navCollapsed }]"
  >
    <AppTopbar
      :connected="isConnected"
      :busy="busy"
      :connection-status="connectionStatus"
      @connect="codexStore.connect"
      @disconnect="codexStore.disconnect"
      @open-settings="rightSidebarOpen = true"
    />
    <AppSidebar />

    <main :class="['content', { 'content--hidden': rightSidebarOpen }]">
      <div v-if="errorMessage" class="banner mb-4">
        {{ errorMessage }}
      </div>
      <RouterView />
    </main>

    <aside v-if="rightSidebarOpen" class="right-sidebar">
      <div
        class="right-sidebar__backdrop"
        @click="rightSidebarOpen = false"
      ></div>
      <div class="right-sidebar__panel">
        <div class="right-sidebar__header">
          <span class="right-sidebar__title">Settings</span>
          <button
            class="right-sidebar__close"
            @click="rightSidebarOpen = false"
            aria-label="Close settings"
          >
            <svg viewBox="0 0 16 16" fill="none">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </div>
        <div class="right-sidebar__content">
          <SettingsPanel
            :settings="settings"
            :models="models"
            :platform-summary="platformSummary"
            :connection-status="connectionStatus"
            @update="settingsStore.updateSettings"
            @connect="codexStore.connect"
            @disconnect="codexStore.disconnect"
          />
        </div>
      </div>
    </aside>
  </div>
</template>
