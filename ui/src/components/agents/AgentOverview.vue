<script setup lang="ts">
import { useAgentsStore } from "../../stores/agents";
import { useCodexStore } from "../../stores/codex";

const agentsStore = useAgentsStore();
const codexStore = useCodexStore();
</script>

<template>
  <form class="card">
    <div class="card-header">
      <div>
        <div class="card-title">Overview</div>
        <div class="card-sub">Agent identity and model configuration.</div>
      </div>
    </div>

    <div class="agent-model-select" style="margin-top: 20px">
      <div class="row" style="gap: 12px; flex-wrap: wrap; margin-top: 12px">
        <label class="field" style="min-width: 260px; flex: 1">
          <span>Primary model</span>
          <select v-model="agentsStore.config!.model">
            <option value="">Default</option>
            <option v-for="m in codexStore.models" :key="m.id" :value="m.id">
              {{ m.displayName }}
            </option>
          </select>
        </label>
      </div>

      <div class="field" style="margin-top: 12px">
        <span>Agent Name</span>
        <input
          v-model="agentsStore.config!.name"
          type="text"
          class="field"
          placeholder="Agent name"
        />
      </div>
    </div>
  </form>
</template>
