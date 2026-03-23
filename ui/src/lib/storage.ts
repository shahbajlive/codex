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
    return { ...defaults(), ...(JSON.parse(raw) as Partial<StoredSettings>) };
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
    theme: "system",
    navCollapsed: false,
  };
}
