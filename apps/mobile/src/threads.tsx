import { useThreads } from "@copilotkit/react-native/headless";
import {
  Archive,
  CalendarDays,
  FileText,
  Keyboard,
  LogOut,
  MessageCircle,
  Monitor,
  Plus,
  RefreshCw,
  Settings2,
  Users,
} from "lucide-react-native";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { BRAND } from "../../../packages/domain/src/brand";
import type { MuseApi } from "./api";
import { hasPhysicalKeyboard } from "./composer-shortcuts";
import { faNumber } from "./locale";
import { useSession } from "./session";
import { Button, colors, ErrorNotice, Field, LinkRow, Sheet, s } from "./ui";
import { useWorkspace } from "./workspace";

function newThreadId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export type Selection = { id: string; existing: boolean };
/** intelligence: CopilotKit Rich Threads; local: OpenMuse database; off: single sample history. */
export type ThreadBackend = "intelligence" | "local" | "off";
type ThreadSummary = { id: string; name: string | null; archived: boolean };
/** The subset of CopilotKit useThreads() that the conversation menu relies on. */
type ThreadList = {
  threads: ThreadSummary[];
  isLoading: boolean;
  error: Error | null;
  isMutating: boolean;
  hasMoreThreads: boolean;
  isFetchingMoreThreads: boolean;
  fetchMoreError: Error | null;
  refetchThreads: () => void;
  fetchMoreThreads: () => void;
  renameThread: (id: string, name: string) => Promise<void>;
  archiveThread: (id: string) => Promise<void>;
  unarchiveThread: (id: string) => Promise<void>;
};
const asError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));
/** Thread menu backed by /api/threads when THREADS_BACKEND=local (no CopilotKit cloud). */
function useLocalThreads(api: MuseApi, enabled: boolean): ThreadList {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isMutating, setMutating] = useState(false);
  const [isFetchingMoreThreads, setFetchingMore] = useState(false);
  const [fetchMoreError, setFetchMoreError] = useState<Error | null>(null);
  const page = useCallback(
    (from?: string | null) =>
      api.request<{ threads: ThreadSummary[]; nextCursor: string | null }>(
        `/api/threads?includeArchived=true&limit=20${from ? `&cursor=${encodeURIComponent(from)}` : ""}`,
      ),
    [api],
  );
  const refetchThreads = useCallback(() => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    void page()
      .then((result) => {
        setThreads(result.threads);
        setCursor(result.nextCursor);
      })
      .catch((e) => setError(asError(e)))
      .finally(() => setLoading(false));
  }, [enabled, page]);
  useEffect(refetchThreads, [refetchThreads]);
  async function patch(id: string, body: { name?: string; archived?: boolean }) {
    setMutating(true);
    try {
      const updated = await api.request<ThreadSummary>(
        `/api/threads/${encodeURIComponent(id)}`,
        body,
        "PATCH",
      );
      setThreads((items) => items.map((item) => (item.id === id ? updated : item)));
    } finally {
      setMutating(false);
    }
  }
  return {
    threads,
    isLoading,
    error,
    isMutating,
    hasMoreThreads: cursor !== null,
    isFetchingMoreThreads,
    fetchMoreError,
    refetchThreads,
    fetchMoreThreads: () => {
      if (!cursor || isFetchingMoreThreads) return;
      setFetchingMore(true);
      setFetchMoreError(null);
      void page(cursor)
        .then((result) => {
          setThreads((items) => [
            ...items,
            ...result.threads.filter((t) => !items.some((i) => i.id === t.id)),
          ]);
          setCursor(result.nextCursor);
        })
        .catch((e) => setFetchMoreError(asError(e)))
        .finally(() => setFetchingMore(false));
    },
    renameThread: (id, name) => patch(id, { name }),
    archiveThread: (id) => patch(id, { archived: true }),
    unarchiveThread: (id) => patch(id, { archived: false }),
  };
}
const ThreadContext = createContext<{
  enabled: boolean;
  backend: ThreadBackend;
  selection: Selection;
  visited: Selection[];
  mainId: string;
  loading: boolean;
  error: string;
  retry: () => void;
  select: (selection: Selection) => void;
  start: () => void;
  claimPrompt: (id: number) => boolean;
} | null>(null);
export function ThreadsProvider({ children }: { children: ReactNode }) {
  const { workspace, navigate, api } = useWorkspace();
  const handledPrompt = useRef(0);
  const backend: ThreadBackend =
    workspace.runtime.richThreads === true
      ? "intelligence"
      : workspace.runtime.localThreads === true
        ? "local"
        : "off";
  const enabled = backend !== "off";
  const [selection, setSelection] = useState<Selection>({ id: "local", existing: false });
  const [visited, setVisited] = useState<Selection[]>([]);
  const [mainId, setMainId] = useState("local");
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setLoading(true);
    setError("");
    void api
      .request<{ threadId: string; existing: boolean }>("/api/main-thread")
      .then((main) => {
        if (!active) return;
        const next = { id: main.threadId, existing: main.existing };
        setMainId(next.id);
        setSelection(next);
        setVisited([next]);
        setLoading(false);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [api, enabled, attempt]);
  function select(next: Selection) {
    setSelection(next);
    setVisited((items) => (items.some((item) => item.id === next.id) ? items : [...items, next]));
    navigate("chat");
  }
  return (
    <ThreadContext.Provider
      value={{
        claimPrompt: (id) => {
          if (handledPrompt.current === id) return false;
          handledPrompt.current = id;
          return true;
        },
        enabled,
        backend,
        mainId,
        visited,
        loading,
        error,
        retry: () => setAttempt((n) => n + 1),
        selection,
        select,
        start: () => select({ id: newThreadId(), existing: false }),
      }}
    >
      {children}
    </ThreadContext.Provider>
  );
}
export function useMuseThread() {
  const context = useContext(ThreadContext);
  if (!context) throw new Error("ThreadsProvider is missing.");
  return context;
}
export function ThreadsSheet({
  onClose,
  onShortcuts,
}: {
  onClose: () => void;
  /** Opens the «میان‌برها» sheet; offered only on desktop web with a physical keyboard. */
  onShortcuts?: () => void;
}) {
  const {
    enabled,
    backend,
    selection,
    visited,
    mainId,
    loading,
    error: mainError,
    retry,
    select,
    start,
  } = useMuseThread();
  const { workspace, open, navigate, refresh, api } = useWorkspace();
  const { me, logout, openAdmin, refreshMe } = useSession();
  // Usage changes with every message; refresh it whenever the menu opens.
  useEffect(() => refreshMe(), [refreshMe]);
  const richThreads = useThreads({
    agentId: "default",
    enabled: backend === "intelligence",
    includeArchived: true,
    limit: 20,
  });
  const localThreads = useLocalThreads(api, backend === "local");
  const threads: ThreadList = backend === "local" ? localThreads : richThreads;
  const [editing, setEditing] = useState<string>();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [archived, setArchived] = useState(false);
  async function mutate(action: () => Promise<void>) {
    setError("");
    try {
      await action();
      setEditing(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  function go(section: "calendar" | "files" | "apps") {
    onClose();
    navigate(section);
  }
  return (
    <Sheet
      title={BRAND.nameFa}
      subtitle={workspace.mode === "sample" ? "فضای کار شما" : workspace.profile.name}
      onClose={onClose}
      drawer
    >
      <View style={{ gap: 14 }}>
        {enabled && loading ? (
          <>
            <ErrorNotice error={mainError} />
            {mainError ? (
              <Button onPress={retry}>تلاش دوباره</Button>
            ) : (
              <ActivityIndicator color={colors.blueDark} />
            )}
          </>
        ) : enabled ? (
          <>
            <LinkRow
              icon={MessageCircle}
              title="گفت‌وگوی اصلی"
              detail="گفت‌وگوی جاری شما"
              onPress={() => {
                select({ id: mainId, existing: true });
                onClose();
              }}
            />
            <Button
              primary
              icon={Plus}
              onPress={() => {
                start();
                onClose();
              }}
            >
              گفت‌وگوی جانبی تازه
            </Button>
            <View style={[s.between, { marginTop: 12 }]}>
              <Text style={s.heading}>گفت‌وگوهای جانبی</Text>
              <Button small onPress={() => setArchived(!archived)}>
                {archived ? "گفت‌وگوهای فعال" : "بایگانی‌شده‌ها"}
              </Button>
            </View>
            {threads.isLoading && <ActivityIndicator color={colors.blueDark} />}
            <ErrorNotice error={error || threads.error?.message} />
            {threads.error && (
              <Button small onPress={threads.refetchThreads}>
                تلاش دوباره
              </Button>
            )}
            {!archived &&
              visited
                .filter(
                  (item) =>
                    item.id !== mainId && !threads.threads.some((saved) => saved.id === item.id),
                )
                .map((item, index) => (
                  <LinkRow
                    key={item.id}
                    icon={MessageCircle}
                    title={`گفت‌وگوی جانبی ${faNumber(index + 1)}`}
                    detail="باز در همین برنامه"
                    onPress={() => {
                      select(item);
                      onClose();
                    }}
                  />
                ))}
            {threads.threads
              .filter((thread) => thread.id !== mainId && thread.archived === archived)
              .map((thread) => (
                <View
                  key={thread.id}
                  style={{
                    paddingVertical: 12,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.line,
                    gap: 10,
                  }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`باز کردن گفت‌وگو: ${thread.name || "گفت‌وگوی بی‌نام"}`}
                    accessibilityState={{ selected: selection.id === thread.id }}
                    onPress={() => {
                      select({ id: thread.id, existing: true });
                      onClose();
                    }}
                    style={[s.row, { gap: 10 }]}
                  >
                    <MessageCircle size={19} color={colors.text} />
                    <Text
                      style={[s.text, { flex: 1, textAlign: "auto", writingDirection: "auto" }]}
                    >
                      {thread.name || "گفت‌وگوی بی‌نام"}
                    </Text>
                  </Pressable>
                  {editing === thread.id && (
                    <Field label="نام گفت‌وگو" value={name} onChangeText={setName} />
                  )}
                  <View style={[s.row, { gap: 8 }]}>
                    <Button
                      small
                      disabled={threads.isMutating || (editing === thread.id && !name.trim())}
                      onPress={() => {
                        if (editing === thread.id)
                          void mutate(() => threads.renameThread(thread.id, name.trim()));
                        else {
                          setEditing(thread.id);
                          setName(thread.name || "");
                        }
                      }}
                    >
                      {editing === thread.id ? "ذخیره" : "تغییر نام"}
                    </Button>
                    <Button
                      small
                      icon={Archive}
                      disabled={threads.isMutating}
                      onPress={() =>
                        void mutate(() =>
                          thread.archived
                            ? threads.unarchiveThread(thread.id)
                            : threads.archiveThread(thread.id),
                        )
                      }
                    >
                      {thread.archived ? "بازگردانی" : "بایگانی"}
                    </Button>
                  </View>
                </View>
              ))}
            {!threads.isLoading &&
              !threads.error &&
              !threads.threads.some(
                (thread) => thread.id !== mainId && thread.archived === archived,
              ) && (
                <Text style={s.muted}>
                  {archived
                    ? "گفت‌وگوی بایگانی‌شده‌ای ندارید. گفت‌وگوهای جانبی را با «بایگانی» به اینجا بیاورید."
                    : "هنوز گفت‌وگوی جانبی ندارید. برای موضوعی جداگانه، «گفت‌وگوی جانبی تازه» را بزنید."}
                </Text>
              )}
            <ErrorNotice error={threads.fetchMoreError?.message} />
            {threads.hasMoreThreads && (
              <Button small busy={threads.isFetchingMoreThreads} onPress={threads.fetchMoreThreads}>
                گفت‌وگوهای بیشتر
              </Button>
            )}
            <Text style={s.small}>
              هر گفت‌وگوی جانبی زمینهٔ گفت‌وگوی خودش را دارد، اما حافظهٔ ذخیره‌شدهٔ دستیار میان همه مشترک
              است.
            </Text>
          </>
        ) : (
          <>
            <LinkRow
              icon={MessageCircle}
              title="گفت‌وگوی اصلی"
              detail="ذخیره‌شده در این فضای کار"
              onPress={() => {
                navigate("chat");
                onClose();
              }}
            />
            <Text style={s.muted}>
              گفت‌وگوی شما در این فضای کار ذخیره می‌شود. اتصال‌ها را می‌توانید در «برنامه‌ها» مدیریت
              کنید.
            </Text>
          </>
        )}
        <View style={s.divider} />
        <LinkRow
          icon={Plus}
          title="سپردن کار"
          detail="یک برنامه، سند یا خلاصهٔ هزینه‌ها"
          onPress={() => {
            onClose();
            open({ type: "delegate" });
          }}
        />
        <LinkRow
          icon={Monitor}
          title="رایانهٔ دستیار"
          detail="مرورگر، نشست‌ها و اسناد"
          onPress={() => {
            onClose();
            open({ type: "computer" });
          }}
        />
        <LinkRow icon={CalendarDays} title="تقویم" onPress={() => go("calendar")} />
        <LinkRow icon={FileText} title="فایل‌ها" onPress={() => go("files")} />
        <LinkRow icon={Settings2} title="برنامه‌ها و تنظیمات" onPress={() => go("apps")} />
        {onShortcuts && hasPhysicalKeyboard() && (
          <LinkRow
            icon={Keyboard}
            title="میان‌برها"
            detail="میان‌برهای صفحه‌کلید؛ با «?» هم باز می‌شود"
            onPress={onShortcuts}
          />
        )}
        {me?.role === "admin" && (
          <LinkRow
            icon={Users}
            title="مدیریت کاربران"
            detail="کلیدهای دسترسی، غیرفعال‌سازی و مصرف"
            onPress={() => {
              onClose();
              openAdmin();
            }}
          />
        )}
        <Button small icon={RefreshCw} onPress={() => void mutate(refresh)}>
          به‌روزرسانی فضای کار
        </Button>
        {me && me.limits.messages !== null && (
          <Text style={s.small}>
            مصرف امروز: {faNumber(me.usage.messages)} از {faNumber(me.limits.messages)} پیام
            {me.limits.tasks !== null
              ? `، ${faNumber(me.usage.tasks)} از ${faNumber(me.limits.tasks)} کار`
              : ""}
          </Text>
        )}
        <Button small danger icon={LogOut} onPress={logout}>
          خروج از حساب
        </Button>
      </View>
    </Sheet>
  );
}
