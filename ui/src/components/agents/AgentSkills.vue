<script setup lang="ts">
defineProps<{
  skills?: string[];
}>();
</script>

<template>
  <div class="flex flex-col gap-4">
    <div v-if="skills && skills.length" class="flex flex-col gap-2">
      <div
        v-for="skill in skills"
        :key="skill"
        class="flex justify-between items-center p-3 bg-bg rounded-md border border-border"
      >
        <span class="font-mono text-sm">{{ skill }}</span>
        <span class="badge badge-accent">Enabled</span>
      </div>
    </div>

    <div
      v-else
      class="flex flex-col items-center justify-center py-12 text-muted"
    >
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
        <polygon
          points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
        />
      </svg>
      <div class="font-semibold">Skills</div>
      <div class="text-sm mt-1">No skills configured for this agent.</div>
    </div>
  </div>
</template>
