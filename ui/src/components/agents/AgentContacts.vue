<script setup lang="ts">
import { onMounted, watch } from "vue";
import { useAgentsStore } from "../../stores/agents";
import { useCodexStore } from "../../stores/codex";

const agentsStore = useAgentsStore();
const codexStore = useCodexStore();

async function loadContacts() {
  if (
    codexStore.connectionStatus === "connected" &&
    agentsStore.contactsList.length === 0
  ) {
    await agentsStore.refreshContacts();
  }
}

onMounted(loadContacts);
watch(
  () => codexStore.connectionStatus,
  (status) => {
    if (status === "connected") {
      loadContacts();
    }
  },
);
</script>

<template>
  <form class="card">
    <div class="card-header">
      <div>
        <div class="card-title">Contacts</div>
        <div class="card-sub">
          Control which contacts this agent can communicate with.
        </div>
      </div>
    </div>

    <div v-if="agentsStore.contactsList.length === 0" style="margin: 12px 0">
      <div class="card-sub muted">No contacts configured globally.</div>
      <div class="card-sub muted">
        Add contacts in the
        <a href="/contacts" class="link">Contacts page</a>.
      </div>
    </div>

    <div v-else class="tools-list">
      <div class="contacts-header">
        <div>Contact</div>
        <div>Thread ID</div>
        <div>Enabled</div>
      </div>
      <div
        v-for="contact in agentsStore.contactsList"
        :key="contact.id"
        class="tool-item"
      >
        <span class="mono">{{ contact.id }}</span>
        <span class="mono muted">{{ contact.publicThreadId }}</span>
        <label class="cfg-toggle">
          <input
            :checked="agentsStore.isContactEnabled(contact.id)"
            @change="agentsStore.toggleContact(contact.id)"
            type="checkbox"
          />
          <span class="cfg-toggle__track"></span>
        </label>
      </div>
    </div>

    <div style="margin-top: 16px">
      <div class="card-sub muted">
        Toggle controls whether this agent can communicate with each contact.
        When no contacts are explicitly allowed/denied, all contacts are
        accessible.
      </div>
    </div>
  </form>
</template>

<style scoped>
.contacts-header {
  display: grid;
  grid-template-columns: 1fr 2fr auto;
  gap: 12px;
  align-items: center;
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
  padding: 0 12px 8px;
}
</style>
