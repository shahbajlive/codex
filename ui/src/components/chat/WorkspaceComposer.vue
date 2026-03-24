<script setup lang="ts">
import { onMounted, ref, watch } from "vue";

const props = defineProps<{
  draft: string;
  connected: boolean;
  loading: boolean;
  selectedAgentId: string | null;
  activeTurnId: string | null;
  composerModelUsageLine: string;
  composerMeta: Array<string | null>;
}>();

const emit = defineEmits<{
  updateDraft: [value: string];
  send: [];
  interrupt: [];
  attachMention: [];
  composerKeydown: [event: KeyboardEvent];
}>();

const textarea = ref<HTMLTextAreaElement | null>(null);

function resizeComposer() {
  if (!textarea.value) {
    return;
  }
  textarea.value.style.height = "auto";
  textarea.value.style.height = `${Math.min(textarea.value.scrollHeight, 132)}px`;
}

watch(
  () => props.draft,
  () => {
    resizeComposer();
  },
  { immediate: true },
);

onMounted(() => {
  resizeComposer();
});
</script>

<template>
  <form class="workspace-chat__composer" @submit.prevent="emit('send')">
    <div class="workspace-chat__composer-row">
      <button
        class="workspace-chat__composer-icon"
        type="button"
        title="Attach file"
        aria-label="Attach file"
        @click="emit('attachMention')"
      >
        <svg viewBox="0 0 16 16" fill="none">
          <path
            d="M6.1 9.9l4.6-4.6a2.1 2.1 0 0 1 3 3l-5.4 5.4a3.5 3.5 0 0 1-5-5l5-5a2.4 2.4 0 1 1 3.4 3.4l-4.6 4.6a1.3 1.3 0 1 1-1.8-1.8l4.1-4.1"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <div class="workspace-chat__composer-field">
        <textarea
          ref="textarea"
          :value="draft"
          rows="1"
          :disabled="!connected || !selectedAgentId"
          placeholder="Message the selected workspace agent..."
          @input="
            emit('updateDraft', ($event.target as HTMLTextAreaElement).value)
          "
          @keydown="emit('composerKeydown', $event)"
        />
      </div>
      <div class="workspace-chat__composer-actions">
        <button
          v-if="activeTurnId"
          class="workspace-chat__composer-icon"
          type="button"
          title="Interrupt turn"
          aria-label="Interrupt turn"
          @click="emit('interrupt')"
        >
          <svg viewBox="0 0 16 16" fill="none">
            <rect
              x="4"
              y="4"
              width="8"
              height="8"
              rx="1.5"
              stroke="currentColor"
              stroke-width="1.5"
            />
          </svg>
        </button>
        <button
          class="workspace-chat__composer-send"
          type="submit"
          title="Send message"
          aria-label="Send message"
          :disabled="loading || !connected || !selectedAgentId"
        >
          <svg viewBox="0 0 16 16" fill="none">
            <path
              d="M2.2 2.2L14 8l-11.8 5.8 2.9-5.1L2.2 2.2z"
              fill="currentColor"
            />
          </svg>
        </button>
      </div>
      <span class="workspace-chat__composer-row-model">{{
        composerModelUsageLine
      }}</span>
    </div>
    <div class="workspace-chat__composer-meta">
      <span
        v-for="entry in composerMeta.filter(Boolean)"
        :key="entry || ''"
        class="workspace-chat__composer-meta-chip"
      >
        {{ entry }}
      </span>
    </div>
  </form>
</template>
