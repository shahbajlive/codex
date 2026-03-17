import { createRouter, createWebHistory } from "vue-router";
import AgentsPage from "./pages/AgentsPage.vue";
import ChatPage from "./pages/ChatPage.vue";
import PlaceholderPage from "./pages/PlaceholderPage.vue";
import SettingsPage from "./pages/SettingsPage.vue";
import WorkspaceMessagesRoutePage from "./pages/WorkspaceMessagesRoutePage.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      redirect: "/chat",
    },
    {
      path: "/chat",
      name: "chat",
      component: ChatPage,
    },
    {
      path: "/workspace/messages",
      name: "workspace-messages",
      component: WorkspaceMessagesRoutePage,
    },
    {
      path: "/workspace/map",
      name: "workspace-map",
      component: PlaceholderPage,
      props: {
        title: "Map",
        subtitle: "Visual workspace structure and routing overview.",
      },
    },
    {
      path: "/workspace/kanban",
      name: "workspace-kanban",
      component: PlaceholderPage,
      props: {
        title: "Kanban",
        subtitle: "Track Codex work across the workspace.",
      },
    },
    {
      path: "/overview",
      name: "overview",
      component: PlaceholderPage,
      props: {
        title: "Overview",
        subtitle: "Monitor the Codex workspace at a glance.",
      },
    },
    {
      path: "/channels",
      name: "channels",
      component: PlaceholderPage,
      props: {
        title: "Channels",
        subtitle: "Inspect connections and delivery destinations.",
      },
    },
    {
      path: "/instances",
      name: "instances",
      component: PlaceholderPage,
      props: {
        title: "Instances",
        subtitle: "Review active runtimes and worker capacity.",
      },
    },
    {
      path: "/sessions",
      name: "sessions",
      component: PlaceholderPage,
      props: {
        title: "Sessions",
        subtitle: "Inspect conversation sessions and resumes.",
      },
    },
    {
      path: "/usage",
      name: "usage",
      component: PlaceholderPage,
      props: {
        title: "Usage",
        subtitle: "Track model usage and activity volume.",
      },
    },
    {
      path: "/cron",
      name: "cron",
      component: PlaceholderPage,
      props: {
        title: "Cron Jobs",
        subtitle: "Review scheduled Codex automations.",
      },
    },
    {
      path: "/agents",
      name: "agents",
      component: AgentsPage,
    },
    {
      path: "/skills",
      name: "skills",
      component: PlaceholderPage,
      props: {
        title: "Skills",
        subtitle: "Review installed skills and execution helpers.",
      },
    },
    {
      path: "/settings",
      name: "settings",
      component: SettingsPage,
    },
  ],
});
