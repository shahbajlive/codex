import type { ApprovalPolicy, PersonalityMode, SandboxMode } from "./protocol";

export type StoredSettings = {
  url: string;
  cwd: string;
  model: string;
  personality: PersonalityMode;
  approvalPolicy: ApprovalPolicy;
  sandboxMode: SandboxMode;
  theme: "system" | "light" | "dark";
  navCollapsed: boolean;
};

const STORAGE_KEY = "codex-web-ui-settings";

export function loadSettings(): StoredSettings {
  if (typeof window === "undefined") {
    return defaults();
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return defaults();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredSettings>;
    const merged = { ...defaults(), ...parsed };
    return {
      ...merged,
      url: typeof merged.url === "string" ? merged.url : defaults().url,
      cwd: typeof merged.cwd === "string" ? merged.cwd : defaults().cwd,
      model: typeof merged.model === "string" ? merged.model : defaults().model,
      personality: isPersonality(merged.personality)
        ? merged.personality
        : defaults().personality,
      approvalPolicy: isApprovalPolicy(merged.approvalPolicy)
        ? merged.approvalPolicy
        : defaults().approvalPolicy,
      sandboxMode: isSandboxMode(merged.sandboxMode)
        ? merged.sandboxMode
        : defaults().sandboxMode,
      theme: isTheme(merged.theme) ? merged.theme : defaults().theme,
      navCollapsed:
        typeof merged.navCollapsed === "boolean"
          ? merged.navCollapsed
          : defaults().navCollapsed,
    };
  } catch {
    return defaults();
  }
}

export function saveSettings(settings: StoredSettings) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function defaults(): StoredSettings {
  return {
    url: "ws://127.0.0.1:8765",
    cwd: "",
    model: "",
    personality: "friendly",
    approvalPolicy: "on-request",
    sandboxMode: "workspace-write",
    theme: "system",
    navCollapsed: false,
  };
}

function isTheme(value: unknown): value is StoredSettings["theme"] {
  return value === "system" || value === "light" || value === "dark";
}

function isPersonality(value: unknown): value is PersonalityMode {
  return value === "friendly" || value === "pragmatic" || value === "none";
}

function isApprovalPolicy(value: unknown): value is ApprovalPolicy {
  return (
    value === "untrusted" ||
    value === "on-failure" ||
    value === "on-request" ||
    value === "never"
  );
}

function isSandboxMode(value: unknown): value is SandboxMode {
  return (
    value === "read-only" ||
    value === "workspace-write" ||
    value === "danger-full-access"
  );
}
