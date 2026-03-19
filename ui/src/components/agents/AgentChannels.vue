<script setup lang="ts">
defineProps<{
  loading?: boolean;
}>();
</script>

<template>
  <div>
    <div class="card-title">Channels</div>
    <div class="card-sub">Delivery channels configuration.</div>

    <div class="callout info" style="margin-top: 16px">
      Delivery channels are not wired for Codex yet.
    </div>
  </div>
</template>
