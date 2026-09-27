import { Platform } from "react-native";

/** Registers public/sw.js (app-shell cache) in production web builds only. */
export function registerServiceWorker(): void {
  if (Platform.OS !== "web" || __DEV__) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (!globalThis.isSecureContext) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline caching is optional; the app works the same without it.
    });
  });
}
