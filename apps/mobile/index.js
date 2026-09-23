import "react-native-get-random-values";
import "@copilotkit/react-native/polyfills";
import { registerRootComponent } from "expo";
import App from "./App";
import { applyRtl } from "./src/locale";

applyRtl();
registerRootComponent(App);
