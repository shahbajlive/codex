<script setup lang="ts">
import { useAgentsStore } from "../../stores/agents";

const agentsStore = useAgentsStore();
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
      <div class="row">
        <button
          type="button"
          class="btn btn--sm"
          @click="agentsStore.refreshContacts()"
        >
          {{ agentsStore.contactsLoading ? "Loading…" : "Refresh" }}
        </button>
      </div>
    </div>

    <div
      v-if="agentsStore.contactsError"
      class="callout danger"
      style="margin-top: 12px"
    >
      {{ agentsStore.contactsError }}
    </div>

    <div
      v-if="
        !agentsStore.contactsLoading && agentsStore.contactsList.length === 0
      "
      class="stack"
    >
      <div class="card-sub muted">No contacts configured globally.</div>
      <div class="card-sub muted">
        Add contacts in the
        <a href="/contacts" class="link">Contacts page</a>.
      </div>
    </div>

    <div v-else class="tools-list">
      <div class="tool-item label muted" aria-hidden="true">
        <span>Contact</span>
        <span>Thread ID</span>
        <span>Enabled</span>
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

    <div class="card-sub muted">
      Toggle controls whether this agent can communicate with each contact. When
      no contacts are explicitly allowed/denied, all contacts are accessible.
    </div>
  </form>
</template>
