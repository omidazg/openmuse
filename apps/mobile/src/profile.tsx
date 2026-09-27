import {
  BookOpen,
  BookOpenCheck,
  Bug,
  Calculator,
  CalendarClock,
  Camera,
  ChartPie,
  ClipboardList,
  Code,
  FileText,
  GraduationCap,
  Handshake,
  Landmark,
  Languages,
  type LucideIcon,
  Megaphone,
  MessageSquareReply,
  PencilLine,
  Receipt,
  Scale,
  Store,
  Terminal,
  Timer,
  Users,
  Wallet,
} from "lucide-react-native";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  EMPTY_PROFILE,
  type PathIcon,
  sanitizeProfile,
  type UserProfile,
} from "../../../packages/domain/src/paths";
import type { MuseApi } from "./api";

const pathIcons: Record<PathIcon, LucideIcon> = {
  calculator: Calculator,
  store: Store,
  "file-text": FileText,
  scale: Scale,
  "graduation-cap": GraduationCap,
  "pencil-line": PencilLine,
  code: Code,
  "chart-pie": ChartPie,
  camera: Camera,
  receipt: Receipt,
  "message-square-reply": MessageSquareReply,
  "clipboard-list": ClipboardList,
  landmark: Landmark,
  handshake: Handshake,
  "book-open": BookOpen,
  languages: Languages,
  "book-open-check": BookOpenCheck,
  timer: Timer,
  bug: Bug,
  terminal: Terminal,
  wallet: Wallet,
  users: Users,
  "calendar-clock": CalendarClock,
  megaphone: Megaphone,
};

/** lucide component for a path, starter or shortcut icon name. */
export function pathIcon(name: PathIcon): LucideIcon {
  return pathIcons[name] ?? FileText;
}

/** Fields the app may change; the server sets `chosenAt` whenever `paths` is sent. */
export type ProfilePatch = Partial<
  Pick<UserProfile, "paths" | "details" | "reminders" | "inviteDismissed">
>;

type ProfileValue = {
  /** Undefined while loading. */
  profile?: UserProfile;
  /**
   * Optimistic save to PUT /api/agent/profile; resolves with the server's copy. On failure the
   * previous profile is restored and the error rethrown.
   */
  save: (patch: ProfilePatch) => Promise<UserProfile>;
};
const ProfileContext = createContext<ProfileValue | null>(null);

export function useProfile() {
  const context = useContext(ProfileContext);
  if (!context) throw new Error("Profile is unavailable");
  return context;
}

const CACHE_KEY = "dastyar.profile";
function readCache(): UserProfile | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(CACHE_KEY);
    if (raw) return sanitizeProfile(JSON.parse(raw));
  } catch {}
  return undefined;
}
function writeCache(value: UserProfile) {
  try {
    globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify(value));
  } catch {}
}

/**
 * «مسیرهای من» for the signed-in person. The server keeps it (/api/agent/profile) so it follows
 * them across devices; the device copy is used when the server is unreachable.
 */
export function ProfileProvider({ api, children }: { api: MuseApi; children: ReactNode }) {
  const [profile, setProfile] = useState<UserProfile>();
  useEffect(() => {
    let active = true;
    api
      .request<UserProfile>("/api/agent/profile")
      .then((saved) => {
        const value = sanitizeProfile(saved);
        writeCache(value);
        return value;
      })
      .catch(() => readCache() ?? EMPTY_PROFILE)
      .then((value) => {
        if (active) setProfile(value);
      });
    return () => {
      active = false;
    };
  }, [api]);
  const save = useCallback(
    async (patch: ProfilePatch) => {
      let previous: UserProfile | undefined;
      setProfile((current) => {
        previous = current;
        const next = sanitizeProfile({
          ...(current ?? EMPTY_PROFILE),
          ...patch,
          ...(patch.paths ? { chosenAt: new Date().toISOString() } : {}),
        });
        writeCache(next);
        return next;
      });
      let saved: UserProfile;
      try {
        saved = sanitizeProfile(await api.request<UserProfile>("/api/agent/profile", patch, "PUT"));
      } catch (error) {
        // Undo the optimistic change so the screen matches what the server kept.
        if (previous) {
          writeCache(previous);
          setProfile(previous);
        }
        throw error;
      }
      writeCache(saved);
      setProfile(saved);
      return saved;
    },
    [api],
  );
  const value = useMemo(() => ({ profile, save }), [profile, save]);
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}
