import { WifiOff } from "lucide-react-native";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { Platform, Text, View } from "react-native";
import { fetchHealth } from "./api";
import { fw } from "./locale";
import { backoffDelay, connectivity } from "./network";
import { NETWORK_ERROR } from "./session-errors";
import { colors, s } from "./ui";

export function useOnline(): boolean {
  return useSyncExternalStore(connectivity.subscribe, connectivity.getSnapshot);
}

function browserOffline(): boolean {
  return Platform.OS === "web" && typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * Keeps the connectivity flag current: browser online/offline events on web, and while offline a
 * /api/health probe with backoff (2s, 4s … 30s) that notices when the server is reachable again.
 */
function useConnectivityMonitor(online: boolean) {
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    if (browserOffline()) connectivity.set(false);
    const offline = () => connectivity.set(false);
    // The browser saying "online" only means a network exists; confirm with the server.
    const back = () => void fetchHealth();
    window.addEventListener("offline", offline);
    window.addEventListener("online", back);
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", back);
    };
  }, []);
  useEffect(() => {
    if (online) return;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const probe = () => {
      timer = setTimeout(
        async () => {
          if (stopped) return;
          if (!browserOffline()) await fetchHealth();
          attempt += 1;
          if (!stopped && !connectivity.getSnapshot()) probe();
        },
        backoffDelay(attempt, { baseMs: 2000, maxMs: 30_000 }),
      );
    };
    probe();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [online]);
}

/** Persistent banner while the app cannot reach the internet or the server. */
export function OfflineBanner() {
  const online = useOnline();
  useConnectivityMonitor(online);
  if (online) return null;
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        s.row,
        {
          gap: 10,
          marginHorizontal: 17,
          marginBottom: 8,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: 16,
          backgroundColor: colors.orange,
        },
      ]}
    >
      <WifiOff size={17} color={colors.text} />
      <Text style={{ flex: 1, color: colors.text, fontSize: 13, lineHeight: 22, ...fw("500") }}>
        اتصال اینترنت برقرار نیست؛ پس از اتصال دوباره تلاش می‌کنیم.
      </Text>
    </View>
  );
}

/**
 * A chat turn that failed for lack of connection is sent again once the connection returns
 * (at most three times in two minutes, so an unreachable model cannot cause a retry loop).
 */
export function useRetryOnReconnect(error: string, ready: boolean, retry: () => void) {
  const online = useOnline();
  const failed = error === NETWORK_ERROR;
  const attempts = useRef<number[]>([]);
  // Retry only on a real offline → online transition observed after the failure.
  const sawOffline = useRef(false);
  const retryRef = useRef(retry);
  retryRef.current = retry;
  useEffect(() => {
    // A failed turn is often the first sign of a lost connection (e.g. no browser event).
    if (failed) connectivity.set(false);
  }, [failed]);
  useEffect(() => {
    if (!online) {
      sawOffline.current = true;
      return;
    }
    if (!failed) {
      sawOffline.current = false;
      return;
    }
    const now = Date.now();
    attempts.current = attempts.current.filter((time) => now - time < 120_000);
    if (!ready || !sawOffline.current || attempts.current.length >= 3) return;
    sawOffline.current = false;
    attempts.current.push(now);
    retryRef.current();
  }, [online, failed, ready]);
}
