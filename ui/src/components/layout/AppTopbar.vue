<script setup lang="ts">
import { ref } from "vue";
import { useSettingsStore } from "../../stores/settings";

const settingsStore = useSettingsStore();

const props = defineProps<{
  connected: boolean;
  busy: boolean;
  connectionStatus: string;
}>();

const emit = defineEmits<{
  connect: [];
  disconnect: [];
  openSettings: [];
}>();

const toggleNav = () => {
  settingsStore.updateSettings({ ...settingsStore.$state, navCollapsed: !settingsStore.navCollapsed });
};

const setTheme = (theme: "light" | "system" | "dark") => {
  settingsStore.updateSettings({ ...settingsStore.$state, theme });
};
</script>

<template>
  <header class="topbar">
    <div class="topbar-left">
      <button class="nav-collapse-toggle" type="button" :title="settingsStore.navCollapsed ? 'Expand navigation' : 'Collapse navigation'" aria-label="Navigation" @click="toggleNav">
        <span class="nav-collapse-toggle__icon">
          <svg viewBox="0 0 16 16" fill="none">
            <path d="M3 4.5h10" />
            <path d="M3 8h10" />
            <path d="M3 11.5h10" />
          </svg>
        </span>
      </button>
      <div class="brand">
        <div class="brand-logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M9 4.75 7.75 3.5" />
            <path d="M15 4.75 16.25 3.5" />
            <path d="M7 9.5c0-3.04 2.24-5.5 5-5.5s5 2.46 5 5.5v.75h1.25A1.75 1.75 0 0 1 20 12v4.25c0 .97-.78 1.75-1.75 1.75H5.75A1.75 1.75 0 0 1 4 16.25V12c0-.97.78-1.75 1.75-1.75H7V9.5Z" />
            <circle cx="9.25" cy="10.75" r=".75" fill="currentColor" stroke="none" />
            <circle cx="14.75" cy="10.75" r=".75" fill="currentColor" stroke="none" />
          </svg>
        </div>
        <div class="brand-text">
          <div class="brand-title">CODEX</div>
          <div class="brand-sub">Gateway Dashboard</div>
        </div>
      </div>
    </div>

    <div class="topbar-status">
      <span v-if="props.busy" class="pill pill--busy">
        streaming
      </span>

      <div style="position: relative;">
        <button class="pill" style="background: transparent; cursor: pointer;" @click="emit('openSettings')">
          <span class="statusDot" :class="{ 'ok': props.connected }"></span>
          <span>Health</span>
          <span class="mono">{{ props.connected ? 'OK' : 'Offline' }}</span>
        </button>
      </div>

      <div class="theme-toggle">
        <div class="theme-toggle__track" :style="{ '--theme-index': settingsStore.theme === 'light' ? 0 : settingsStore.theme === 'system' ? 1 : 2 }">
          <div class="theme-toggle__indicator"></div>
          <button class="theme-toggle__button" :class="{ active: settingsStore.theme === 'light' }" @click="setTheme('light')" title="Light theme" aria-label="Light theme">
            <svg class="theme-icon" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
            </svg>
          </button>
          <button class="theme-toggle__button" :class="{ active: settingsStore.theme === 'system' }" @click="setTheme('system')" title="System theme" aria-label="System theme">
            <svg class="theme-icon" viewBox="0 0 24 24">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <path d="M8 21h8M12 17v4" />
            </svg>
          </button>
          <button class="theme-toggle__button" :class="{ active: settingsStore.theme === 'dark' }" @click="setTheme('dark')" title="Dark theme" aria-label="Dark theme">
            <svg class="theme-icon" viewBox="0 0 24 24">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </header>
</template>
