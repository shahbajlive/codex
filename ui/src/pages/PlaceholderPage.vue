<script setup lang="ts">
import PageHeader from "../components/PageHeader.vue";

defineProps<{
  title: string;
  subtitle: string;
}>();
</script>

<template>
  <section class="content-panel">
    <PageHeader :title="title" :subtitle="subtitle" />
    <section class="card card--padded-lg">
      <div class="card-title">{{ title }}</div>
      <div class="card-sub">
        This page is part of the OpenClaw-style shell and is ready for the
        Codex-specific implementation next.
      </div>
    </section>
  </section>
</template>
