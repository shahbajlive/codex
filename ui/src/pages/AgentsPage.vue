<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";
import AgentsPane from "../components/AgentsPane.vue";
import PageHeader from "../components/PageHeader.vue";
import { useCodexStore } from "../stores/codex";

const codexStore = useCodexStore();
const router = useRouter();
const { agentThreads, agentTranscript, busy, selectedAgent, selectedAgentId } =
  storeToRefs(codexStore);

async function openConversation(threadId: string) {
  await codexStore.openAgentConversation(threadId);
  await router.push("/chat");
}
</script>

<template>
  <section class="content-panel">
    <PageHeader
      title="Agents"
      subtitle="Inspect isolated agents created by Codex collaboration flows."
    />

    <AgentsPane
      :loading="busy"
      :agents="agentThreads"
      :selected-agent-id="selectedAgentId"
      :selected-agent="selectedAgent"
      :transcript="agentTranscript"
      @refresh="codexStore.refreshAgentThreads"
      @select="codexStore.selectAgent"
      @open-conversation="openConversation"
    />
  </section>
</template>
