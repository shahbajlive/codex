<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";
import PageHeader from "../components/PageHeader.vue";
import WorkspaceMessagesPage from "../components/WorkspaceMessagesPage.vue";
import { useCodexStore } from "../stores/codex";

const codexStore = useCodexStore();
const router = useRouter();
const { agentThreads, agentTranscript, busy, selectedAgentId } =
  storeToRefs(codexStore);

async function openConversation(threadId: string) {
  await codexStore.openAgentConversation(threadId);
  await router.push("/chat");
}
</script>

<template>
  <section class="content-panel">
    <PageHeader
      title="Messages"
      subtitle="Chat with isolated Codex agent threads through one workspace inbox."
    />

    <WorkspaceMessagesPage
      :loading="busy"
      :agents="agentThreads"
      :selected-agent-id="selectedAgentId"
      :transcript="agentTranscript"
      @refresh="codexStore.refreshAgentThreads"
      @select="codexStore.selectAgent"
      @open-conversation="openConversation"
    />
  </section>
</template>
