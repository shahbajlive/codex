<script setup lang="ts">
import { truncate } from "../../lib/format";
import type { WorkspaceQueuedMessage } from "../../stores/chat";

const props = defineProps<{
  queuedMessages: WorkspaceQueuedMessage[];
  expanded: boolean;
  stacked?: boolean;
}>();

const emit = defineEmits<{
  toggleExpanded: [];
  editQueuedMessage: [messageId: string];
  deleteQueuedMessage: [messageId: string];
}>();
</script>

<template>
  <section
    v-if="queuedMessages.length"
    class="workspace-chat__queue-drawer"
    :class="{ 'workspace-chat__queue-drawer--stacked': stacked }"
  >
    <button
      class="workspace-chat__queue-drawer-header"
      :class="{ 'workspace-chat__queue-drawer-header--stacked': stacked }"
      type="button"
      :aria-expanded="expanded"
      @click="emit('toggleExpanded')"
    >
      <div class="workspace-chat__queue-drawer-copy">
        <div class="workspace-chat__queue-drawer-title">Queued messages</div>
      </div>

      <div class="workspace-chat__queue-drawer-meta">
        <span class="workspace-chat__queue-drawer-count">{{
          queuedMessages.length
        }}</span>
        <svg
          class="workspace-chat__queue-drawer-chevron"
          :class="{ 'is-open': expanded }"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path d="M4 6l4 4 4-4"></path>
        </svg>
      </div>
    </button>

    <div
      v-show="expanded"
      class="workspace-chat__queue-drawer-body"
      :class="{ 'workspace-chat__queue-drawer-body--stacked': stacked }"
    >
      <article
        v-for="message in queuedMessages"
        :key="message.id"
        class="workspace-chat__queue-item"
      >
        <span class="workspace-chat__queue-item-status" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="none">
            <path d="M4 8.5L7 11.5L12.5 4.5"></path>
          </svg>
        </span>

        <div class="workspace-chat__queue-item-body">
          <div class="workspace-chat__queue-item-text">
            {{ truncate(message.text, 160) }}
          </div>
          <div class="workspace-chat__queue-item-subtitle">
            Waiting in queue
          </div>
        </div>

        <div class="workspace-chat__queue-item-actions">
          <button
            class="workspace-chat__queue-item-action"
            type="button"
            @click="emit('editQueuedMessage', message.id)"
          >
            Edit
          </button>
          <button
            class="workspace-chat__queue-item-action workspace-chat__queue-item-action--danger"
            type="button"
            @click="emit('deleteQueuedMessage', message.id)"
          >
            Delete
          </button>
        </div>
      </article>
    </div>
  </section>
</template>
