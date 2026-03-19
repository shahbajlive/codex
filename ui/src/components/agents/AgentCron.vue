<script setup lang="ts">
defineProps<{
  loading?: boolean;
}>();
</script>

<template>
  <div>
    <div class="card-title">Cron Jobs</div>
    <div class="card-sub">Scheduled automation for this agent.</div>

    <div class="callout info" style="margin-top: 16px">
      Scheduled automation parity is still to come.
    </div>
  </div>
</template>
