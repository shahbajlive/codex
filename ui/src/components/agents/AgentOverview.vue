<script setup lang="ts">
import { computed } from "vue";
import { useAgentsStore } from "../../stores/agents";
import { useCodexStore } from "../../stores/codex";

const agentsStore = useAgentsStore();
const codexStore = useCodexStore();

const availableProviders = computed(() => {
  const providers = new Set(Object.keys(codexStore.providers));
  for (const model of codexStore.models) {
    const separatorIndex = model.id.indexOf("/");
    if (separatorIndex > 0) {
      providers.add(model.id.slice(0, separatorIndex));
    }
  }
  if (agentsStore.config?.modelProvider) {
    providers.add(agentsStore.config.modelProvider);
  }
  return Array.from(providers).sort();
});

const filteredModels = computed(() => {
  const p = agentsStore.config?.modelProvider;
  if (!p) return codexStore.models;
  return codexStore.models.filter((m) => m.id.startsWith(`${p}/`));
});

const currentModelId = computed(() => agentsStore.config?.model ?? "");
const currentProviderId = computed(
  () => agentsStore.config?.modelProvider ?? "",
);
const currentProviderInList = computed(() =>
  availableProviders.value.includes(currentProviderId.value),
);
const showCurrentProvider = computed(
  () => !!currentProviderId.value && !currentProviderInList.value,
);
const currentModelInList = computed(() =>
  filteredModels.value.some((m) => m.id === currentModelId.value),
);
const showCurrentModel = computed(
  () =>
    currentModelId.value &&
    !currentModelInList.value &&
    filteredModels.value.length > 0,
);
</script>

<template>
  <form class="card">
    <div class="card-header">
      <div>
        <div class="card-title">Overview</div>
        <div class="card-sub">Agent identity and runtime overrides.</div>
      </div>
    </div>

    <div
      v-if="agentsStore.config"
      class="agent-model-select"
      style="margin-top: 20px"
    >
      <div class="row" style="gap: 12px; flex-wrap: wrap; margin-top: 12px">
        <label class="field" style="min-width: 180px; flex: 1">
          <span>Provider</span>
          <select v-model="agentsStore.config!.modelProvider">
            <option value="">Default</option>
            <option v-if="showCurrentProvider" :value="currentProviderId">
              {{ currentProviderId }} (not in config)
            </option>
            <option v-for="p in availableProviders" :key="p" :value="p">
              {{ p }}
            </option>
          </select>
        </label>
        <label class="field" style="min-width: 240px; flex: 2">
          <span>Primary model</span>
          <select v-model="agentsStore.config!.model">
            <option value="">Default</option>
            <option
              v-if="showCurrentModel"
              :value="currentModelId"
              style="font-style: italic"
            >
              {{ currentModelId }} (not in catalog)
            </option>
            <option v-for="m in filteredModels" :key="m.id" :value="m.id">
              {{ m.displayName }}
            </option>
          </select>
        </label>
        <label class="field" style="min-width: 180px; flex: 1">
          <span>Approval</span>
          <select v-model="agentsStore.config!.approvalPolicy">
            <option value="">Global default</option>
            <option value="on-request">on-request</option>
            <option value="on-failure">on-failure</option>
            <option value="untrusted">untrusted</option>
            <option value="never">never</option>
          </select>
        </label>
        <label class="field" style="min-width: 180px; flex: 1">
          <span>Sandbox</span>
          <select v-model="agentsStore.config!.sandboxMode">
            <option value="">Global default</option>
            <option value="workspace-write">workspace-write</option>
            <option value="read-only">read-only</option>
            <option value="danger-full-access">danger-full-access</option>
          </select>
        </label>
      </div>

      <div class="row" style="gap: 12px; flex-wrap: wrap; margin-top: 12px">
        <label class="field" style="min-width: 200px; flex: 1">
          <span>Agent Name</span>
          <input
            v-model="agentsStore.config!.name"
            type="text"
            class="field"
            placeholder="Agent name"
          />
        </label>
        <label class="field" style="min-width: 120px; flex: 0">
          <span>Color</span>
          <div style="display: flex; align-items: center; gap: 8px">
            <input
              v-model="agentsStore.config!.color"
              type="color"
              style="width: 40px; height: 32px; padding: 2px; cursor: pointer"
            />
            <span style="font-size: 11px; opacity: 0.6">
              {{ agentsStore.config!.color || "none" }}
            </span>
          </div>
        </label>
      </div>
    </div>
    <div v-else class="muted" style="margin-top: 20px; padding: 16px">
      Loading agent configuration…
    </div>
  </form>
</template>
