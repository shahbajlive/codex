<script setup lang="ts">
import type { Model } from "../lib/protocol";
import type { StoredSettings } from "../lib/storage";

const props = defineProps<{
  settings: StoredSettings;
  models: Model[];
  platformSummary: string;
  connectionStatus: string;
}>();

const emit = defineEmits<{
  update: [settings: StoredSettings];
  connect: [];
  disconnect: [];
}>();

function update<K extends keyof StoredSettings>(key: K, value: StoredSettings[K]) {
  emit("update", { ...props.settings, [key]: value });
}

function onInput<K extends keyof StoredSettings>(key: K, event: Event) {
  const target = event.target as HTMLInputElement;
  update(key, target.value as StoredSettings[K]);
}

function onSelect<K extends keyof StoredSettings>(key: K, event: Event) {
  const target = event.target as HTMLSelectElement;
  update(key, target.value as StoredSettings[K]);
}
</script>

<template>
  <aside class="surface-panel flex flex-col gap-4 p-5">
    <div class="flex flex-col gap-3">
      <p class="eyebrow">Connection</p>
      <label class="ui-field">
        <span class="text-sm text-[var(--muted)]">WebSocket URL</span>
        <input class="ui-input" :value="settings.url" @input="onInput('url', $event)" />
      </label>
      <div class="flex items-center justify-between gap-3">
        <button class="ui-button ui-button-primary flex-1" @click="emit('connect')">Connect</button>
        <button class="ui-button flex-1" @click="emit('disconnect')">Disconnect</button>
      </div>
      <p class="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">{{ connectionStatus }}</p>
      <p class="text-xs text-[var(--muted)]">{{ platformSummary }}</p>
    </div>

    <div class="flex flex-col gap-3">
      <p class="eyebrow">Runtime</p>
      <label class="ui-field">
        <span class="text-sm text-[var(--muted)]">Working Directory</span>
        <input class="ui-input" :value="settings.cwd" @input="onInput('cwd', $event)" />
      </label>
      <label class="ui-field">
        <span class="text-sm text-[var(--muted)]">Model</span>
        <select class="ui-input" :value="settings.model" @change="onSelect('model', $event)">
          <option value="">Default</option>
          <option v-for="model in models" :key="model.id" :value="model.id">
            {{ model.displayName }}
          </option>
        </select>
      </label>
      <label class="ui-field">
        <span class="text-sm text-[var(--muted)]">Personality</span>
        <select class="ui-input" :value="settings.personality" @change="onSelect('personality', $event)">
          <option value="friendly">friendly</option>
          <option value="pragmatic">pragmatic</option>
          <option value="none">none</option>
        </select>
      </label>
      <label class="ui-field">
        <span class="text-sm text-[var(--muted)]">Approval</span>
        <select class="ui-input" :value="settings.approvalPolicy" @change="onSelect('approvalPolicy', $event)">
          <option value="on-request">on-request</option>
          <option value="on-failure">on-failure</option>
          <option value="untrusted">untrusted</option>
          <option value="never">never</option>
        </select>
      </label>
      <label class="ui-field">
        <span class="text-sm text-[var(--muted)]">Sandbox</span>
        <select class="ui-input" :value="settings.sandboxMode" @change="onSelect('sandboxMode', $event)">
          <option value="workspace-write">workspace-write</option>
          <option value="read-only">read-only</option>
          <option value="danger-full-access">danger-full-access</option>
        </select>
      </label>
    </div>
  </aside>
</template>
