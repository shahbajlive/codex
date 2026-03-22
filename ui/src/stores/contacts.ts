import { defineStore } from "pinia";
import type { CodexAppServerClient } from "../lib/app-server-client";
import type { ContactListResponse, Thread } from "../lib/protocol";

let clientRef: { client: CodexAppServerClient | null } = { client: null };

export function setContactsClient(client: CodexAppServerClient | null) {
  clientRef.client = client;
}

export interface ContactRecord {
  id: string;
  publicThreadId: string;
}

export const useContactsStore = defineStore("contacts", {
  state: () => ({
    contacts: [] as ContactRecord[],
    loading: false,
    error: null as string | null,
  }),

  actions: {
    async refresh() {
      if (!clientRef.client) {
        this.error =
          "Not connected to app-server. Check the WebSocket URL in settings.";
        return;
      }
      this.loading = true;
      this.error = null;
      try {
        this.contacts = await clientRef.client.listContacts();
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
      } finally {
        this.loading = false;
      }
    },

    async addContact(id: string, publicThreadId: string) {
      if (!clientRef.client) return;
      this.error = null;
      try {
        await clientRef.client.createContact(id, publicThreadId);
        await this.refresh();
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
        throw err;
      }
    },

    async removeContact(id: string) {
      if (!clientRef.client) return;
      this.error = null;
      try {
        await clientRef.client.deleteContact(id);
        this.contacts = this.contacts.filter((c) => c.id !== id);
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
        throw err;
      }
    },

    async addContactFromAgent(agentId: string): Promise<ContactRecord> {
      if (!clientRef.client) throw new Error("Not connected");
      this.error = null;
      try {
        const thread: Thread =
          await clientRef.client.startThreadForAgent(agentId);
        await this.addContact(agentId, thread.id);
        return { id: agentId, publicThreadId: thread.id };
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
        throw err;
      }
    },
  },
});
