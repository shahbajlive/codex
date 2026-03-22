<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { storeToRefs } from "pinia";
import PageHeader from "../components/PageHeader.vue";
import { useContactsStore } from "../stores/contacts";
import { useAgentsStore } from "../stores/agents";
import { useCodexStore } from "../stores/codex";

const contactsStore = useContactsStore();
const agentsStore = useAgentsStore();
const codexStore = useCodexStore();
const { contacts, loading, error } = storeToRefs(contactsStore);

const showAddForm = ref(false);
const addMode = ref<"picker" | "manual">("picker");
const manualId = ref("");
const manualThreadId = ref("");
const addingError = ref<string | null>(null);
const selectedAgentId = ref<string | null>(null);

const existingContactIds = computed(
  () => new Set(contacts.value.map((c) => c.id)),
);

const availableAgents = computed(() =>
  agentsStore.agents.filter((a) => !existingContactIds.value.has(a.id)),
);

async function addFromAgent(agentId: string) {
  addingError.value = null;
  try {
    await contactsStore.addContactFromAgent(agentId);
    selectedAgentId.value = null;
    showAddForm.value = false;
  } catch (err) {
    addingError.value = err instanceof Error ? err.message : String(err);
  }
}

async function confirmAddFromAgent() {
  if (!selectedAgentId.value) return;
  await addFromAgent(selectedAgentId.value);
}

async function addManual() {
  if (!manualId.value.trim() || !manualThreadId.value.trim()) return;
  addingError.value = null;
  try {
    await contactsStore.addContact(
      manualId.value.trim(),
      manualThreadId.value.trim(),
    );
    manualId.value = "";
    manualThreadId.value = "";
    showAddForm.value = false;
  } catch (err) {
    addingError.value = err instanceof Error ? err.message : String(err);
  }
}

async function removeContact(id: string) {
  await contactsStore.removeContact(id);
}

async function loadData() {
  if (codexStore.connectionStatus === "connected") {
    await Promise.all([contactsStore.refresh(), agentsStore.refreshAgents()]);
  } else if (
    codexStore.connectionStatus === "disconnected" ||
    codexStore.connectionStatus === "idle"
  ) {
    contactsStore.refresh();
  }
}

onMounted(loadData);

watch(
  () => codexStore.connectionStatus,
  (status) => {
    if (status === "connected" && contacts.value.length === 0) {
      loadData();
    } else if (status === "disconnected") {
      loadData();
    }
  },
);

watch(showAddForm, (open) => {
  if (!open) {
    selectedAgentId.value = null;
    addingError.value = null;
  }
});

watch(addMode, (mode) => {
  if (mode === "manual") {
    selectedAgentId.value = null;
  }
});
</script>

<template>
  <section class="content-panel">
    <PageHeader
      title="Contacts"
      subtitle="Global address book for inter-agent messaging."
    />

    <section class="card">
      <div class="card-header">
        <div>
          <div class="card-title">Contact List</div>
          <div class="card-sub mono">
            {{ contacts.length }} contact{{ contacts.length !== 1 ? "s" : "" }}
            in contacts.json5
          </div>
        </div>
        <button
          class="btn primary"
          :disabled="loading"
          @click="showAddForm = !showAddForm"
        >
          {{ showAddForm ? "Cancel" : "+ Add Contact" }}
        </button>
      </div>

      <div v-if="error" class="field-error">{{ error }}</div>

      <div
        v-if="showAddForm"
        style="
          padding: 12px 0;
          border-bottom: 1px solid var(--border);
          margin-bottom: 12px;
        "
      >
        <div class="agent-tabs" style="margin-bottom: 12px">
          <button
            class="agent-tab"
            :class="{ active: addMode === 'picker' }"
            @click="addMode = 'picker'"
          >
            From Agent
          </button>
          <button
            class="agent-tab"
            :class="{ active: addMode === 'manual' }"
            @click="addMode = 'manual'"
          >
            Manual
          </button>
        </div>

        <div v-if="addMode === 'picker'">
          <div
            v-if="availableAgents.length === 0"
            class="muted"
            style="margin: 12px 0"
          >
            All agents are already contacts.
          </div>
          <div
            v-else
            class="agent-list"
            style="max-height: 300px; overflow-y: auto"
          >
            <button
              v-for="agent in availableAgents"
              :key="agent.id"
              class="agent-row"
              :class="{ active: selectedAgentId === agent.id }"
              @click="selectedAgentId = agent.id"
            >
              <div class="agent-avatar">
                {{ (agent.name || agent.id)[0]!.toUpperCase() }}
              </div>
              <div class="agent-info">
                <div class="agent-title">{{ agent.name || agent.id }}</div>
                <div class="agent-sub mono">{{ agent.id }}</div>
              </div>
            </button>
          </div>
          <div class="row row--spread" style="margin-top: 12px">
            <div class="card-sub muted">
              Select an agent, then confirm to add its public thread as a
              contact.
            </div>
            <button
              class="btn primary"
              :disabled="!selectedAgentId"
              @click="confirmAddFromAgent"
            >
              Add Contact
            </button>
          </div>
        </div>

        <div v-if="addMode === 'manual'" class="stack">
          <div class="field">
            <span>Agent ID</span>
            <input v-model="manualId" placeholder="e.g. planner" />
          </div>
          <div class="field">
            <span>Public Thread ID</span>
            <input
              v-model="manualThreadId"
              class="mono"
              placeholder="e.g. 67e55044-10b1-426f-9247-bb680e5fe0c8"
            />
          </div>
          <div class="row row--spread">
            <button class="btn" @click="showAddForm = false">Cancel</button>
            <button
              class="btn primary"
              :disabled="!manualId.trim() || !manualThreadId.trim()"
              @click="addManual"
            >
              Add Contact
            </button>
          </div>
        </div>

        <div v-if="addingError" class="field-error">{{ addingError }}</div>
      </div>

      <div
        v-if="loading && contacts.length === 0"
        style="margin: 12px 0"
        class="muted"
      >
        Loading contacts...
      </div>

      <div
        v-else-if="contacts.length === 0 && !showAddForm"
        style="margin: 12px 0"
      >
        <div class="card-sub">No contacts yet.</div>
        <div class="card-sub muted">Click "+ Add Contact" to get started.</div>
      </div>

      <div v-else class="tools-list">
        <div
          class="row muted"
          style="padding: 0 12px 8px; font-size: 12px; font-weight: 500"
        >
          <div>Agent ID</div>
          <div style="flex: 1">Public Thread ID</div>
          <div style="width: 72px"></div>
        </div>
        <div v-for="contact in contacts" :key="contact.id" class="tool-item">
          <span class="mono">{{ contact.id }}</span>
          <span class="mono muted">{{ contact.publicThreadId }}</span>
          <button class="btn danger btn--sm" @click="removeContact(contact.id)">
            Remove
          </button>
        </div>
      </div>
    </section>
  </section>
</template>
