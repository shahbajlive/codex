<script setup lang="ts">
defineProps<{
  title: string;
  subtitle: string;
}>();
</script>

<template>
  <section class="content-header">
    <div>
      <div class="page-title">{{ title }}</div>
      <div class="page-sub">{{ subtitle }}</div>
    </div>
  </section>
</template>
