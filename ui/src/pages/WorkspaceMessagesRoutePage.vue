<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";
import PageHeader from "../components/PageHeader.vue";
import WorkspaceMessagesPage from "../components/WorkspaceMessagesPage.vue";
import { useCodexStore } from "../stores/codex";
import { useSettingsStore } from "../stores/settings";
import { useWorkspaceMessagesStore } from "../stores/chat/workspace-messages";

const codexStore = useCodexStore();
const workspaceStore = useWorkspaceMessagesStore();
const settingsStore = useSettingsStore();
const router = useRouter();
const {
  busy: codexBusy,
  isConnected,
  models,
  providers,
} = storeToRefs(codexStore);
const {
  agents,
  autoCompactTokenLimit,
  busy,
  collapsedItemExpandedByKey,
  committedTranscript,
  contextWindow,
  liveTranscriptTurn,
  modelLabel,
  pendingRequest,
  restoredDraft,
  restoredDraftVersion,
  statusMessage,
  statusTone,
  activeTurnId,
  selectedModelProvider,
  selectedAgentId,
  selectedThreadId,
  selectedTokenUsage,
  threadIdsByAgentId,
  threads,
} = storeToRefs(workspaceStore);
const { theme } = storeToRefs(settingsStore);

const selectedAgentThreadIds = computed(() => {
  const agentId = selectedAgentId.value;
  if (!agentId) {
    return [] as string[];
  }
  return threadIdsByAgentId.value[agentId] ?? [];
});

const modelProviders = computed(() => {
  const ids = new Set<string>(Object.keys(providers.value));
  for (const model of models.value) {
    const separatorIndex = model.id.indexOf("/");
    if (separatorIndex > 0) {
      ids.add(model.id.slice(0, separatorIndex));
    }
  }
  return Array.from(ids).sort();
});

async function openConversation(threadId: string) {
  await codexStore.selectThread(threadId);
  await router.push("/chat");
}

async function openSelectedConversation() {
  const threadId = await workspaceStore.openConversationInMainChat();
  if (threadId) {
    await openConversation(threadId);
  }
}

async function initializeWorkspace() {
  if (isConnected.value) {
    await workspaceStore.initialize();
  }
}

onMounted(() => {
  void initializeWorkspace();
});

watch(isConnected, async (connected) => {
  if (connected) {
    await workspaceStore.initialize();
  }
});
</script>

<template>
  <section class="content-panel">
    <WorkspaceMessagesPage
      :loading="busy || codexBusy"
      :auto-compact-token-limit="autoCompactTokenLimit"
      :connected="isConnected"
      :context-window="contextWindow"
      :agents="agents"
      :model-label="modelLabel"
      :models="models"
      :model-providers="modelProviders"
      :selected-agent-id="selectedAgentId"
      :selected-model-provider="selectedModelProvider"
      :selected-thread-id="selectedThreadId"
      :selected-token-usage="selectedTokenUsage"
      :collapse-overrides="collapsedItemExpandedByKey"
      :selected-agent-thread-ids="selectedAgentThreadIds"
      :pending-request="pendingRequest"
      :restored-draft="restoredDraft"
      :restored-draft-version="restoredDraftVersion"
      :status-message="statusMessage"
      :status-tone="statusTone"
      :active-turn-id="activeTurnId"
      :committed-transcript="committedTranscript"
      :live-transcript-turn="liveTranscriptTurn"
      :theme="theme"
      :threads="threads"
      @refresh="workspaceStore.refreshWorkspaceAgents"
      @select="workspaceStore.selectAgent"
      @select-thread="workspaceStore.selectThreadForSelectedAgent"
      @resolve-request="workspaceStore.resolvePendingRequest"
      @reject-request="workspaceStore.rejectPendingRequest"
      @send="workspaceStore.sendMessage"
      @interrupt="workspaceStore.interruptActiveTurn"
      @set-collapse-override="workspaceStore.setCollapsedItemExpanded"
      @set-collapse-overrides="workspaceStore.mergeCollapsedItemExpanded"
      @open-conversation="openSelectedConversation"
    />
  </section>
</template>
