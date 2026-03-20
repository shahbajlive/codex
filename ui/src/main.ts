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
