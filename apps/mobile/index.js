import "react-native-get-random-values";
import "@copilotkit/react-native/polyfills";
import { registerRootComponent } from "expo";
import { createElement } from "react";
import { Platform, View } from "react-native";
import App from "./App";
import { applyDisplay, DisplayProvider } from "./src/display";
import { applyRtl } from "./src/locale";
import { registerServiceWorker } from "./src/pwa";

applyRtl();
// Saved theme, contrast and text size before first paint, so there is no flash.
applyDisplay();
registerServiceWorker();
// react-native-web resolves start/end from its own locale context, not <html dir>; without this
// every logical style (start, marginStart, borderTopEndRadius…) lands on the LTR side.
const Root = () => createElement(DisplayProvider, null, createElement(App));
registerRootComponent(
  Platform.OS === "web"
    ? () => createElement(View, { dir: "rtl", style: { flex: 1 } }, createElement(Root))
    : Root,
);
