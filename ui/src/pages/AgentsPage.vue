<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";
import AgentsPane from "../components/AgentsPane.vue";
import PageHeader from "../components/PageHeader.vue";
import { useCodexStore } from "../stores/codex";

const codexStore = useCodexStore();
const router = useRouter();
const { configuredAgents, agentTranscript, busy, selectedAgentId } =
  storeToRefs(codexStore);

function selectAgent(agentId: string) {
  codexStore.selectConfiguredAgent(agentId);
}

async function openConversation(agentId: string) {
  await codexStore.openAgentConversation(agentId);
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
      :agents="configuredAgents"
      :selected-agent-id="selectedAgentId"
      :transcript="agentTranscript"
      @refresh="codexStore.refreshConfiguredAgents"
      @select="selectAgent"
      @open-conversation="openConversation"
    />
  </section>
</template>
