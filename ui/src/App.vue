<script setup lang="ts">
import { onBeforeUnmount } from "vue";
import { storeToRefs } from "pinia";
import AppSidebar from "./components/AppSidebar.vue";
import AppTopbar from "./components/AppTopbar.vue";
import { RouterView } from "vue-router";
import { useCodexStore } from "./stores/codex";

const codexStore = useCodexStore();

const {
  busy,
  connectionStatus,
  errorMessage,
  isConnected,
} = storeToRefs(codexStore);

onBeforeUnmount(() => {
  codexStore.disconnect();
});
</script>

<template>
  <div class="shell">
    <AppTopbar
      :connected="isConnected"
      :busy="busy"
      :connection-status="connectionStatus"
      @connect="codexStore.connect"
      @disconnect="codexStore.disconnect"
    />
    <AppSidebar />

    <main class="content">
      <div
        v-if="errorMessage"
        class="banner mb-4"
      >
        {{ errorMessage }}
      </div>
      <RouterView />
    </main>
  </div>
</template>
