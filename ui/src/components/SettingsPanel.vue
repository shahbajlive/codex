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

function update<K extends keyof StoredSettings>(
  key: K,
  value: StoredSettings[K],
) {
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
  <div class="card stack gap-4">
    <div class="stack gap-3">
      <p class="eyebrow">Connection</p>
      <label class="field">
        <span>WebSocket URL</span>
        <input :value="settings.url" @input="onInput('url', $event)" />
      </label>
      <div class="row">
        <button class="btn primary" style="flex: 1" @click="emit('connect')">
          Connect
        </button>
        <button class="btn" style="flex: 1" @click="emit('disconnect')">
          Disconnect
        </button>
      </div>
      <p
        class="muted"
        style="
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        "
      >
        {{ connectionStatus }}
      </p>
      <p class="muted" style="font-size: 12px">{{ platformSummary }}</p>
    </div>

    <div class="stack gap-3">
      <p class="eyebrow">Runtime</p>
      <label class="field">
        <span>Working Directory</span>
        <input :value="settings.cwd" @input="onInput('cwd', $event)" />
      </label>
      <label class="field">
        <span>Model</span>
        <select :value="settings.model" @change="onSelect('model', $event)">
          <option value="">Default</option>
          <option v-for="model in models" :key="model.id" :value="model.id">
            {{ model.displayName }}
          </option>
        </select>
      </label>
      <label class="field">
        <span>Personality</span>
        <select
          :value="settings.personality"
          @change="onSelect('personality', $event)"
        >
          <option value="friendly">friendly</option>
          <option value="pragmatic">pragmatic</option>
          <option value="none">none</option>
        </select>
      </label>
    </div>
  </div>
</template>
