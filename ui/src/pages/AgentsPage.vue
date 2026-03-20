<script setup lang="ts">
import { storeToRefs } from "pinia";
import AgentsPane from "../components/AgentsPane.vue";
import PageHeader from "../components/PageHeader.vue";
import { useCodexStore } from "../stores/codex";
import { useAgentsStore } from "../stores/agents";

const codexStore = useCodexStore();
const agentsStore = useAgentsStore();

const { models } = storeToRefs(codexStore);

function refreshAgents() {
  agentsStore.refreshAgents();
}

function selectAgent(agentId: string) {
  agentsStore.selectAgent(agentId);
}
</script>

<template>
  <section class="content-panel">
    <PageHeader
      title="Agents"
      subtitle="Inspect isolated agents created by Codex collaboration flows."
    />

    <AgentsPane
      :models="models"
      @refresh="refreshAgents"
      @select="selectAgent"
    />
  </section>
</template>
