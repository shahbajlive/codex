<script setup lang="ts">
const props = defineProps<{
  connected: boolean;
  busy: boolean;
  connectionStatus: string;
}>();

defineEmits<{
  connect: [];
  disconnect: [];
}>();
</script>

<template>
  <header class="topbar">
    <div class="topbar-left">
      <button class="nav-collapse-toggle" type="button" aria-label="Navigation">
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
      <span class="pill" :class="{ 'pill--live': props.connected }">
        <span class="statusDot" :class="{ 'statusDot--live': props.connected }"></span>
        <span class="mono">{{ props.connectionStatus }}</span>
      </span>
      <span v-if="props.busy" class="pill pill--busy">
        streaming
      </span>
      <button class="button button--primary button--compact" @click="$emit('connect')">Connect</button>
      <button class="button button--compact" @click="$emit('disconnect')">Disconnect</button>
    </div>
  </header>
</template>
