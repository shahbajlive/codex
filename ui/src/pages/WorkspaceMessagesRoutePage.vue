<script setup lang="ts">
import { onMounted, watch } from "vue";
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
  threads,
} = storeToRefs(codexStore);
const {
  agents,
  autoCompactTokenLimit,
  busy,
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
} = storeToRefs(workspaceStore);
const { approvalPolicy, personality, sandboxMode, theme } =
  storeToRefs(settingsStore);

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
      :approval-policy="approvalPolicy"
      :model-label="modelLabel"
      :models="models"
      :selected-agent-id="selectedAgentId"
      :selected-model-provider="selectedModelProvider"
      :selected-thread-id="selectedThreadId"
      :selected-token-usage="selectedTokenUsage"
      :personality="personality"
      :pending-request="pendingRequest"
      :restored-draft="restoredDraft"
      :restored-draft-version="restoredDraftVersion"
      :status-message="statusMessage"
      :status-tone="statusTone"
      :active-turn-id="activeTurnId"
      :committed-transcript="committedTranscript"
      :live-transcript-turn="liveTranscriptTurn"
      :sandbox-mode="sandboxMode"
      :theme="theme"
      :threads="threads"
      @refresh="workspaceStore.refreshWorkspaceAgents"
      @select="workspaceStore.selectAgent"
      @resolve-request="workspaceStore.resolvePendingRequest"
      @reject-request="workspaceStore.rejectPendingRequest"
      @send="workspaceStore.sendMessage"
      @interrupt="workspaceStore.interruptActiveTurn"
      @open-conversation="openSelectedConversation"
    />
  </section>
</template>
