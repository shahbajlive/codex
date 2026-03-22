export type AppRouteName =
  | "chat"
  | "workspace-map"
  | "workspace-messages"
  | "workspace-kanban"
  | "overview"
  | "channels"
  | "instances"
  | "sessions"
  | "usage"
  | "cron"
  | "agents"
  | "contacts"
  | "skills"
  | "settings"
  | "config";

export type NavGroup = {
  label: string;
  items: Array<{
    name: AppRouteName;
    title: string;
    subtitle: string;
    path: string;
    icon:
      | "chat"
      | "folder"
      | "kanban"
      | "bar"
      | "link"
      | "radio"
      | "session"
      | "usage"
      | "cron"
      | "agent"
      | "skill"
      | "settings"
      | "config";
  }>;
};

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Chat",
    items: [
      {
        name: "chat",
        title: "Chat",
        subtitle: "Threads and live Codex output.",
        path: "/chat",
        icon: "chat",
      },
    ],
  },
  {
    label: "Workspace",
    items: [
      {
        name: "workspace-map",
        title: "Map",
        subtitle: "Workspace topology and thread relationships.",
        path: "/workspace/map",
        icon: "folder",
      },
      {
        name: "workspace-messages",
        title: "Messages",
        subtitle: "Talk to isolated agent threads from one shared hub.",
        path: "/workspace/messages",
        icon: "chat",
      },
      {
        name: "workspace-kanban",
        title: "Kanban",
        subtitle: "Track Codex work across lanes.",
        path: "/workspace/kanban",
        icon: "kanban",
      },
    ],
  },
  {
    label: "Control",
    items: [
      {
        name: "overview",
        title: "Overview",
        subtitle: "Workspace health and activity.",
        path: "/overview",
        icon: "bar",
      },
      {
        name: "channels",
        title: "Channels",
        subtitle: "Linked destinations and delivery paths.",
        path: "/channels",
        icon: "link",
      },
      {
        name: "instances",
        title: "Instances",
        subtitle: "Active Codex runtimes and nodes.",
        path: "/instances",
        icon: "radio",
      },
      {
        name: "sessions",
        title: "Sessions",
        subtitle: "Conversation sessions and history.",
        path: "/sessions",
        icon: "session",
      },
      {
        name: "usage",
        title: "Usage",
        subtitle: "Model consumption and throughput.",
        path: "/usage",
        icon: "usage",
      },
      {
        name: "cron",
        title: "Cron Jobs",
        subtitle: "Scheduled Codex automation flows.",
        path: "/cron",
        icon: "cron",
      },
    ],
  },
  {
    label: "Agent",
    items: [
      {
        name: "agents",
        title: "Agents",
        subtitle: "Inspect spawned agents, roles, and transcripts.",
        path: "/agents",
        icon: "agent",
      },
      {
        name: "contacts",
        title: "Contacts",
        subtitle: "Global address book for inter-agent messaging.",
        path: "/contacts",
        icon: "agent",
      },
      {
        name: "skills",
        title: "Skills",
        subtitle: "Installed skills and execution helpers.",
        path: "/skills",
        icon: "skill",
      },
    ],
  },
  {
    label: "Settings",
    items: [
      {
        name: "settings",
        title: "Connection",
        subtitle: "Backend URL and runtime defaults.",
        path: "/settings",
        icon: "settings",
      },
      {
        name: "config",
        title: "Config",
        subtitle: "Edit config.toml and advanced settings.",
        path: "/config",
        icon: "config",
      },
    ],
  },
];

export const ROUTE_TITLES: Record<
  AppRouteName,
  { title: string; subtitle: string }
> = {
  "chat": {
    title: "Chat",
    subtitle:
      "Direct Codex conversations with thread history and streaming turns.",
  },
  "workspace-map": {
    title: "Map",
    subtitle: "Visual workspace structure and routing overview.",
  },
  "workspace-messages": {
    title: "Workspace Messages",
    subtitle: "Browse agent threads in one workspace-style inbox.",
  },
  "workspace-kanban": {
    title: "Kanban",
    subtitle: "Track Codex work across the workspace.",
  },
  "overview": {
    title: "Overview",
    subtitle: "Monitor the Codex workspace at a glance.",
  },
  "channels": {
    title: "Channels",
    subtitle: "Inspect connections and delivery destinations.",
  },
  "instances": {
    title: "Instances",
    subtitle: "Review active runtimes and worker capacity.",
  },
  "sessions": {
    title: "Sessions",
    subtitle: "Inspect conversation sessions and resumes.",
  },
  "usage": {
    title: "Usage",
    subtitle: "Track model usage and activity volume.",
  },
  "cron": {
    title: "Cron Jobs",
    subtitle: "Review scheduled Codex automations.",
  },
  "agents": {
    title: "Agents",
    subtitle: "Inspect isolated agents created by Codex collaboration flows.",
  },
  "contacts": {
    title: "Contacts",
    subtitle: "Global address book for inter-agent messaging.",
  },
  "skills": {
    title: "Skills",
    subtitle: "Review installed skills and execution helpers.",
  },
  "settings": {
    title: "Connection Settings",
    subtitle: "Manage app-server connection details and runtime defaults.",
  },
  "config": {
    title: "Config",
    subtitle: "Edit config.toml and advanced settings.",
  },
};
