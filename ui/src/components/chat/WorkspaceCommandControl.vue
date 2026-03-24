<script setup lang="ts">
import { nextTick, ref, watch } from "vue";

type CommandPanel = {
  title: string;
  subtitle: string;
};

type CommandOption = {
  id: string;
  title: string;
  detail: string;
  value: string;
  action: "execute" | "fill-query";
  disabledReason?: string | null;
  contextTag?: "picker" | "run" | "disabled";
};

const props = defineProps<{
  open: boolean;
  query: string;
  contextLabel: string;
  panel: CommandPanel | null;
  options: CommandOption[];
  activeIndex: number;
}>();

const emit = defineEmits<{
  close: [];
  updateQuery: [value: string];
  keydown: [event: KeyboardEvent];
  hover: [index: number];
  choose: [option: CommandOption];
}>();

const searchInput = ref<HTMLInputElement | null>(null);

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      return;
    }
    await nextTick();
    searchInput.value?.focus();
    searchInput.value?.select();
  },
);
</script>

<template>
  <div
    v-if="open"
    class="workspace-command-control__backdrop"
    @mousedown.self="emit('close')"
  >
    <section class="workspace-command-control" role="dialog" aria-modal="true">
      <div class="workspace-command-control__header">
        <input
          ref="searchInput"
          :value="query"
          class="workspace-command-control__search"
          type="text"
          placeholder="Type a command or search..."
          @input="
            emit('updateQuery', ($event.target as HTMLInputElement).value)
          "
          @keydown="emit('keydown', $event)"
        />
        <button
          class="workspace-command-control__close"
          type="button"
          @click="emit('close')"
        >
          Esc
        </button>
      </div>

      <div class="workspace-command-control__context">
        <span>{{ contextLabel }}</span>
        <span v-if="panel">{{ panel.title }}</span>
      </div>

      <div v-if="panel" class="workspace-command-control__panel-subtitle">
        {{ panel.subtitle }}
      </div>

      <div class="workspace-command-control__list">
        <button
          v-for="(item, index) in options"
          :key="item.id"
          class="workspace-command-control__item"
          :class="{
            'is-active': index === activeIndex,
            'is-disabled': Boolean(item.disabledReason),
          }"
          type="button"
          :disabled="Boolean(item.disabledReason)"
          @mouseenter="emit('hover', index)"
          @click="emit('choose', item)"
        >
          <span class="workspace-command-control__item-main">
            <span class="workspace-command-control__item-name">{{
              item.title
            }}</span>
            <span class="workspace-command-control__item-copy">{{
              item.detail
            }}</span>
          </span>
          <span
            v-if="item.disabledReason"
            class="workspace-command-control__item-tag workspace-command-control__item-tag--disabled"
          >
            {{ item.disabledReason }}
          </span>
          <span
            v-else-if="item.contextTag"
            class="workspace-command-control__item-tag"
          >
            {{ item.contextTag }}
          </span>
        </button>

        <div
          v-if="options.length === 0"
          class="workspace-command-control__empty"
        >
          No commands found.
        </div>
      </div>
    </section>
  </div>
</template>
