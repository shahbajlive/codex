<script setup lang="ts">
defineProps<{
  skills?: string[];
}>();
</script>

<template>
  <div>
    <div class="card-title">Skills</div>
    <div class="card-sub">Skills filter for this agent.</div>

    <div
      v-if="skills && skills.length"
      class="chip-row"
      style="margin-top: 16px"
    >
      <div v-for="skill in skills" :key="skill" class="chip">
        {{ skill }}
      </div>
    </div>

    <div v-else class="muted" style="text-align: center; padding: 40px">
      No skills configured for this agent.
    </div>
  </div>
</template>
