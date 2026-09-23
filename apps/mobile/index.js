import "react-native-get-random-values";
import "@copilotkit/react-native/polyfills";
import { registerRootComponent } from "expo";
import App from "./App";
import { applyRtl } from "./src/locale";
import { registerServiceWorker } from "./src/pwa";

applyRtl();
registerServiceWorker();
registerRootComponent(App);
