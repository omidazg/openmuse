import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AccessibilityInfo, Platform } from "react-native";
import {
  DEFAULT_PREFS,
  type DisplayPrefs,
  documentAttributes,
  loadPrefs,
  motionReduced,
  savePrefs,
  textScale,
} from "./display-prefs";
import { canvasColor } from "./theme";

/**
 * Display preferences, stored per device. Web keeps them in localStorage and applies theme,
 * contrast and text scale through <html> attributes and CSS zoom, so every screen follows
 * without a reload. Native has no persistent store yet; there the choices last for the
 * session, and theme and text size follow the device settings.
 */
function storage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

let current: DisplayPrefs = loadPrefs(storage());
let osReduceMotion = false;

/** Motion preference outside React (e.g. imperative scroll calls). */
export function isMotionReduced(): boolean {
  return motionReduced(current, osReduceMotion);
}

/** Push preferences to the web document: theme and contrast attributes, zoom, theme-color. */
export function applyDisplay(prefs: DisplayPrefs = current): void {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  const root = document.documentElement;
  for (const [name, value] of Object.entries(documentAttributes(prefs))) {
    if (value === null) root.removeAttribute(name);
    else root.setAttribute(name, value);
  }
  const scale = textScale(prefs);
  // CSS zoom scales every font size, line height and touch target together, including
  // modals portalled to <body>, without touching the fixed sizes in each screen.
  root.style.setProperty("zoom", scale === 1 ? "" : String(scale));
  for (const meta of Array.from(document.querySelectorAll('meta[name="theme-color"]'))) {
    const media = meta.getAttribute("media") || "";
    const isDark = prefs.theme === "dark" || (prefs.theme === "auto" && media.includes("dark"));
    meta.setAttribute("content", canvasColor(isDark, prefs.simple));
  }
}

type Display = {
  prefs: DisplayPrefs;
  update: (patch: Partial<DisplayPrefs>) => void;
  /** Text scale in effect (web applies it with CSS zoom). */
  scale: number;
  /** True when the OS or the manual toggle asks for less motion. */
  reduceMotion: boolean;
  /** True when the OS itself asks for less motion. */
  osReduceMotion: boolean;
};

const DisplayContext = createContext<Display>({
  prefs: DEFAULT_PREFS,
  update: () => {},
  scale: 1,
  reduceMotion: false,
  osReduceMotion: false,
});

export function DisplayProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState(current);
  const [os, setOs] = useState(osReduceMotion);
  useEffect(() => {
    let live = true;
    const set = (value: boolean) => {
      osReduceMotion = value;
      if (live) setOs(value);
    };
    AccessibilityInfo.isReduceMotionEnabled()
      .then(set)
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", set);
    return () => {
      live = false;
      sub?.remove();
    };
  }, []);
  useEffect(() => {
    current = prefs;
    savePrefs(storage(), prefs);
    applyDisplay(prefs);
  }, [prefs]);
  const update = useCallback(
    (patch: Partial<DisplayPrefs>) => setPrefs((prev) => ({ ...prev, ...patch })),
    [],
  );
  const value = useMemo(
    () => ({
      prefs,
      update,
      scale: textScale(prefs),
      reduceMotion: motionReduced(prefs, os),
      osReduceMotion: os,
    }),
    [prefs, update, os],
  );
  return <DisplayContext.Provider value={value}>{children}</DisplayContext.Provider>;
}

export function useDisplay(): Display {
  return useContext(DisplayContext);
}
