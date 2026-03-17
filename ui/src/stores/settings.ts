import { defineStore } from "pinia";
import type { StoredSettings } from "../lib/storage";
import { loadSettings, saveSettings } from "../lib/storage";

export const useSettingsStore = defineStore("settings", {
  state: (): StoredSettings => loadSettings(),
  actions: {
    updateSettings(next: StoredSettings) {
      this.$patch(next);
      saveSettings({
        url: this.url,
        cwd: this.cwd,
        model: this.model,
        personality: this.personality,
        approvalPolicy: this.approvalPolicy,
        sandboxMode: this.sandboxMode,
        theme: this.theme,
        navCollapsed: this.navCollapsed,
      });
    },
  },
});
