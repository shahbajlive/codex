<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";
import PageHeader from "../components/PageHeader.vue";
import WorkspaceMessagesPage from "../components/WorkspaceMessagesPage.vue";
import { findLatestUserPreview } from "../lib/transcript";
import { useCodexStore } from "../stores/codex";
import { useAgentsStore } from "../stores/agents";
import { useSettingsStore } from "../stores/settings";
import { useChatStore } from "../stores/chat";

const codexStore = useCodexStore();
const agentsStore = useAgentsStore();
const workspaceStore = useChatStore();
const settingsStore = useSettingsStore();
const router = useRouter();
const {
  busy: codexBusy,
  isConnected,
  models,
  providers,
} = storeToRefs(codexStore);
const {
  agentThreads,
  autoCompactTokenLimit,
  busy,
  collapsedItemExpandedByKey,
  committedTranscript,
  contextWindow,
  liveTranscriptTurn,
  modelLabel,
  pendingRequest,
  pendingUserDraft,
  restoredDraft,
  restoredDraftVersion,
  statusMessage,
  statusTone,
  activeTurnId,
  selectedModelProvider,
  selectedThreadId,
  selectedTokenUsage,
} = storeToRefs(workspaceStore);
const { agents, selectedAgentId } = storeToRefs(agentsStore);
const { theme } = storeToRefs(settingsStore);

const workspaceAgents = computed(() => {
  const selectedThread = agentThreads.value.find(
    (thread) => thread.id === selectedThreadId.value,
  );

  return agents.value.map((agent) => {
    const thread = selectedAgentId.value === agent.id ? selectedThread : null;

    return {
      id: agent.id,
      name: agent.name || agent.id,
      color: agent.color ?? null,
      description:
        agent.description || agent.workspace || "Ready for a new thread",
      workspace: agent.workspace,
      hasThread: thread !== null,
      threadId: thread?.id ?? null,
      updatedAt: thread?.updatedAt ?? 0,
      preview:
        (thread && findLatestUserPreview(thread)) ||
        agent.description ||
        "No messages yet",
    };
  });
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

const selectedAgentThreadIds = computed(() =>
  agentThreads.value.map((thread) => thread.id),
);

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
    await agentsStore.refreshAgents();
    await workspaceStore.initialize();
  }
}

async function refreshWorkspace() {
  await agentsStore.refreshAgents();
  await workspaceStore.refreshSelectedAgentThreads();
}

async function selectAgent(agentId: string) {
  await agentsStore.selectAgent(agentId);
}

onMounted(() => {
  void initializeWorkspace();
});

watch(isConnected, async (connected) => {
  if (connected) {
    await workspaceStore.initialize();
  }
});

watch(selectedAgentId, async (agentId, previousAgentId) => {
  if (!isConnected.value || !agentId || agentId === previousAgentId) {
    return;
  }

  await workspaceStore.refreshRuntimeMetadata();
  await workspaceStore.refreshSelectedAgentThreads();
});
</script>

<template>
  <section class="content-panel">
    <WorkspaceMessagesPage
      :loading="busy || codexBusy"
      :auto-compact-token-limit="autoCompactTokenLimit"
      :connected="isConnected"
      :context-window="contextWindow"
      :agents="workspaceAgents"
      :model-label="modelLabel"
      :models="models"
      :model-providers="modelProviders"
      :selected-agent-id="selectedAgentId"
      :selected-model-provider="selectedModelProvider"
      :selected-agent-thread-ids="selectedAgentThreadIds"
      :selected-thread-id="selectedThreadId"
      :selected-token-usage="selectedTokenUsage"
      :collapse-overrides="collapsedItemExpandedByKey"
      :pending-request="pendingRequest"
      :pending-user-draft="pendingUserDraft"
      :restored-draft="restoredDraft"
      :restored-draft-version="restoredDraftVersion"
      :status-message="statusMessage"
      :status-tone="statusTone"
      :active-turn-id="activeTurnId"
      :committed-transcript="committedTranscript"
      :live-transcript-turn="liveTranscriptTurn"
      :theme="theme"
      :threads="agentThreads"
      @refresh="refreshWorkspace"
      @select="selectAgent"
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
