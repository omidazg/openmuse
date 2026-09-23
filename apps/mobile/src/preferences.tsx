import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { LATEST_CHANGELOG_ID, unseenChangelog } from "../../../packages/domain/src/changelog";
import type { MuseApi } from "./api";
import { Onboarding } from "./onboarding";
import { WhatsNewSheet } from "./whats-new";

export interface Preferences {
  onboardingDone: boolean;
  changelogSeen: string | null;
}
type PreferencesValue = {
  preferences?: Preferences;
  /** Entries in «تازه‌ها» the person has not opened yet. */
  unseenCount: number;
  openWhatsNew: () => void;
};
const PreferencesContext = createContext<PreferencesValue | null>(null);

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error("Preferences are unavailable");
  return context;
}

const CACHE_KEY = "dastyar.preferences";
const EMPTY: Preferences = { onboardingDone: false, changelogSeen: null };
let memoryCache: Preferences | undefined;
/** Per-device copy: web keeps it in localStorage, native only in memory for this launch. */
function readCache(): Preferences | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(CACHE_KEY);
    if (raw) return { ...EMPTY, ...JSON.parse(raw) };
  } catch {}
  return memoryCache;
}
function writeCache(value: Preferences) {
  memoryCache = value;
  try {
    globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify(value));
  } catch {}
}

/**
 * Onboarding and «تازه‌ها» state. The server keeps it per person (/api/preferences) so it follows
 * them across devices; when the server is unreachable or older, the device copy is used.
 */
export function PreferencesProvider({ api, children }: { api: MuseApi; children: ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences>();
  const [whatsNew, setWhatsNew] = useState(false);
  useEffect(() => {
    let active = true;
    api
      .request<Preferences>("/api/preferences")
      .then((saved) => {
        writeCache(saved);
        return saved;
      })
      .catch(() => readCache() ?? EMPTY)
      .then((value) => {
        if (active) setPreferences(value);
      });
    return () => {
      active = false;
    };
  }, [api]);
  const update = useCallback(
    (patch: Partial<Preferences>) => {
      setPreferences((current) => {
        const next = { ...(current ?? EMPTY), ...patch };
        writeCache(next);
        return next;
      });
      // Best effort: the device copy already hides the prompt if the server is unreachable.
      void api.request("/api/preferences", patch, "PATCH").catch(() => undefined);
    },
    [api],
  );
  const openWhatsNew = useCallback(() => setWhatsNew(true), []);
  const unseenCount = preferences ? unseenChangelog(preferences.changelogSeen).length : 0;
  const value = useMemo(
    () => ({ preferences, unseenCount, openWhatsNew }),
    [preferences, unseenCount, openWhatsNew],
  );
  return (
    <PreferencesContext.Provider value={value}>
      {children}
      {preferences && !preferences.onboardingDone && (
        // The tour already introduces the product, so current «تازه‌ها» count as seen.
        <Onboarding
          onDone={() => update({ onboardingDone: true, changelogSeen: LATEST_CHANGELOG_ID })}
        />
      )}
      {whatsNew && (
        <WhatsNewSheet
          seenId={preferences?.changelogSeen ?? null}
          onClose={() => {
            setWhatsNew(false);
            update({ changelogSeen: LATEST_CHANGELOG_ID });
          }}
        />
      )}
    </PreferencesContext.Provider>
  );
}
