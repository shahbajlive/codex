import { createApp } from "vue";
import { createPinia, type PiniaPlugin } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import "./styles.css";
import piniaPluginPersistedstate from "pinia-plugin-persistedstate";

const app = createApp(App);
const pinia = createPinia();
pinia.use(piniaPluginPersistedstate as PiniaPlugin);

app.use(pinia);
app.use(router);
app.mount("#app");

// Expose stores globally for debugging/testing
declare global {
  interface Window {
    __CODEX_STORES__?: Record<string, unknown>;
  }
}
window.__CODEX_STORES__ = {
  getPinia: () => pinia,
  getStore: (name: string) => pinia.state.value[name],
  getAllStores: () => Object.keys(pinia.state.value),
};
