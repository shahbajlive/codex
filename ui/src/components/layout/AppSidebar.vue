<script setup lang="ts">
import { useRoute } from "vue-router";
import { NAV_GROUPS } from "../../navigation";

const route = useRoute();

function iconPath(icon: string) {
  switch (icon) {
    case "chat":
      return ["M3 4.5h10v7H6.5L3 13V4.5Z"];
    case "folder":
      return ["M2.5 4.5h3l1.5 1.5h6.5v6.5H2.5V4.5Z"];
    case "kanban":
      return ["M3 4h3v8H3V4Z", "M7 4h2v5H7V4Z", "M10 4h3v6h-3V4Z"];
    case "bar":
      return ["M4 12V7", "M8 12V4", "M12 12V9"];
    case "link":
      return [
        "M6.5 9.5 9.5 6.5",
        "M5 11H4a2 2 0 0 1 0-4h2",
        "M11 5h1a2 2 0 1 1 0 4h-2",
      ];
    case "radio":
      return [
        "M8 8m-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0",
        "M8 8m-2.25 0a2.25 2.25 0 1 0 4.5 0a2.25 2.25 0 1 0 -4.5 0",
      ];
    case "session":
      return ["M4 3.5h6l2 2v7H4v-9Z", "M10 3.5v2h2"];
    case "usage":
      return ["M4 12V9", "M7 12V6", "M10 12V3", "M3 12.5h10"];
    case "cron":
      return ["M8 3.5v2", "M8 8l2 1.5", "M12 6.5a4.5 4.5 0 1 1-1.3-3.2"];
    case "agent":
      return [
        "M8 3.5 4.5 5.25v3.5c0 2 1.5 3.25 3.5 4.75 2-1.5 3.5-2.75 3.5-4.75v-3.5L8 3.5Z",
      ];
    case "skill":
      return ["M3.5 8h9", "M8 3.5 5.5 8 8 12.5 10.5 8 8 3.5Z"];
    case "settings":
      return [
        "M8 5.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5Z",
        "M8 2.75v1.25",
        "M8 12v1.25",
        "M12.25 8h1.25",
        "M2.5 8h1.25",
      ];
    case "config":
      return [
        "M4 4h4v4H4V4Z",
        "M10 4h4v2h-2v4h2v2h-4v-2h2V6h-2V4Z",
        "M4 10h2v4H4v-4Z",
        "M10 14h4v4h-4v-4Z",
        "M16 10h2v2h-2v-2Z",
        "M16 14h2v2h-2v-2Z",
        "M4 16h2v2H4v-2Z",
        "M10 20h4v2h-4v-2Z",
      ];
    default:
      return ["M3 8h10"];
  }
}
</script>

<template>
  <aside class="nav">
    <section v-for="group in NAV_GROUPS" :key="group.label" class="nav-group">
      <div class="nav-label nav-label--static">
        <span class="nav-label__text">{{ group.label }}</span>
      </div>
      <div class="nav-group__items">
        <router-link
          v-for="item in group.items"
          :key="item.name"
          :to="item.path"
          class="nav-item"
          :class="{ active: route.name === item.name }"
        >
          <span class="nav-item__icon" aria-hidden="true">
            <svg viewBox="0 0 16 16" fill="none">
              <path v-for="path in iconPath(item.icon)" :key="path" :d="path" />
            </svg>
          </span>
          <span class="nav-item__text">{{ item.title }}</span>
        </router-link>
      </div>
    </section>
  </aside>
</template>
