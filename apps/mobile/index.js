import "react-native-get-random-values";
import "@copilotkit/react-native/polyfills";
// Before anything reads localStorage: phones get a file-backed copy (see device-storage.native.ts).
import "./src/device-storage";
import { registerRootComponent, reloadAppAsync } from "expo";
import { createElement, useEffect, useState } from "react";
import { Platform, View } from "react-native";
import App from "./App";
import { applyDisplay, DisplayProvider } from "./src/display";
import { applyRtl } from "./src/locale";
import { registerServiceWorker } from "./src/pwa";

const rtlReload = applyRtl();
// Saved theme, contrast and text size before first paint, so there is no flash.
applyDisplay();
registerServiceWorker();
// react-native-web resolves start/end from its own locale context, not <html dir>; without this
// every logical style (start, marginStart, borderTopEndRadius…) lands on the LTR side.
const Root = () => {
  // First launch on a phone: RTL was just switched on natively and applies after one reload.
  // Render nothing meanwhile; if the reload does not happen, show the app anyway.
  const [ready, setReady] = useState(!rtlReload);
  useEffect(() => {
    if (ready) return;
    reloadAppAsync("RTL").catch(() => setReady(true));
    const timer = setTimeout(() => setReady(true), 2500);
    return () => clearTimeout(timer);
  }, [ready]);
  return ready ? createElement(DisplayProvider, null, createElement(App)) : null;
};
registerRootComponent(
  Platform.OS === "web"
    ? () => createElement(View, { dir: "rtl", style: { flex: 1 } }, createElement(Root))
    : Root,
);
