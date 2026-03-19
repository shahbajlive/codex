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
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
    <div class="font-semibold">Cron Jobs</div>
    <div class="text-sm mt-1">
      Scheduled automation parity is still to come.
    </div>
  </div>
</template>
