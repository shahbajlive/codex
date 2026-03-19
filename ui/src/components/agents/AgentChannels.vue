<script setup lang="ts">
defineProps<{
  loading?: boolean;
}>();
</script>

<template>
  <div class="flex flex-col items-center justify-center py-12 text-muted">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="48"
      height="48"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1"
      class="mb-4 opacity-50"
    >
      <path d="M4 9h16" />
      <path d="M4 15h16" />
      <path d="M10 3L8 21" />
      <path d="M16 3l-2 18" />
    </svg>
    <div class="font-semibold">Channels</div>
    <div class="text-sm mt-1">
      Delivery channels are not wired for Codex yet.
    </div>
  </div>
</template>
