import { useThreads } from "@copilotkit/react-native/headless";
import {
  Archive,
  Brain,
  CalendarDays,
  FileText,
  Keyboard,
  LogOut,
  MessageCircle,
  Monitor,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Settings2,
  Share2,
  Tag,
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
import { DisplayMenuRows } from "./display-settings";
import { faNumber } from "./locale";
import { PersonaList } from "./personal";
import { usePreferences } from "./preferences";
import { useSession } from "./session";
import { ShareSheet, useShareThreadId } from "./share-sheet";
import {
  LabelBar,
  LabelPicker,
  SearchBox,
  SearchResults,
  type ThreadLabel,
  useThreadLabels,
  useThreadSearch,
} from "./thread-organizer";
import { Button, Chip, colors, ErrorNotice, Field, LinkRow, Sheet, s } from "./ui";
import { WhatsNewRow } from "./whats-new";
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
type ThreadSummary = {
  id: string;
  name: string | null;
  archived: boolean;
  /** Local backend only. */
  pinned?: boolean;
  labels?: string[];
};
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
  /** Pins and labels are stored by the local backend only. */
  pinThread?: (id: string, pinned: boolean) => Promise<void>;
  setThreadLabels?: (id: string, labels: string[]) => Promise<void>;
};
const asError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));
/** Pinned threads first; otherwise keep the server's most-recent-first order. */
const pinnedFirst = (items: ThreadSummary[]) =>
  items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => Number(!!b.item.pinned) - Number(!!a.item.pinned) || a.index - b.index)
    .map(({ item }) => item);
/** Thread menu backed by /api/threads when THREADS_BACKEND=local (no CopilotKit cloud). */
function useLocalThreads(api: MuseApi, enabled: boolean, label: string | null): ThreadList {
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
        `/api/threads?includeArchived=true&limit=20${label ? `&label=${encodeURIComponent(label)}` : ""}${from ? `&cursor=${encodeURIComponent(from)}` : ""}`,
      ),
    [api, label],
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
  async function patch(
    id: string,
    body: { name?: string; archived?: boolean; pinned?: boolean; labels?: string[] },
  ) {
    setMutating(true);
    try {
      const updated = await api.request<ThreadSummary>(
        `/api/threads/${encodeURIComponent(id)}`,
        body,
        "PATCH",
      );
      setThreads((items) => pinnedFirst(items.map((item) => (item.id === id ? updated : item))));
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
    pinThread: (id, pinned) => patch(id, { pinned }),
    setThreadLabels: (id, labels) => patch(id, { labels }),
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
  /** New side conversation, optionally pinned to a ready-made assistant first. */
  start: (personaId?: string) => Promise<void>;
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
        start: async (personaId) => {
          const id = newThreadId();
          if (personaId)
            await api.request(`/api/agent/threads/${encodeURIComponent(id)}/persona`, {
              personaId,
            });
          select({ id, existing: false });
        },
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
  const { unseenCount, openWhatsNew } = usePreferences();
  // Usage changes with every message; refresh it whenever the menu opens.
  useEffect(() => refreshMe(), [refreshMe]);
  const richThreads = useThreads({
    agentId: "default",
    enabled: backend === "intelligence",
    includeArchived: true,
    limit: 20,
  });
  const local = backend === "local";
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const localThreads = useLocalThreads(api, local, labelFilter);
  const threads: ThreadList = local ? localThreads : richThreads;
  const labels = useThreadLabels(api, local);
  const [query, setQuery] = useState("");
  const search = useThreadSearch(api, query, local, threads.threads);
  const [editing, setEditing] = useState<string>();
  const [labeling, setLabeling] = useState<string>();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [archived, setArchived] = useState(false);
  // undefined: closed; {} lists every share link; threadId opens export and sharing for it.
  const [sharing, setSharing] = useState<{ threadId?: string }>();
  const currentShareId = useShareThreadId(selection.id);
  const canShare = backend !== "intelligence";
  const visible = threads.threads.filter(
    (thread) =>
      thread.id !== mainId &&
      thread.archived === archived &&
      (!labelFilter || (thread.labels ?? []).includes(labelFilter)),
  );
  const pinned = visible.filter((thread) => thread.pinned);
  const rest = visible.filter((thread) => !thread.pinned);
  const renderThread = (thread: ThreadSummary) => (
    <ThreadRow
      key={thread.id}
      thread={thread}
      threads={threads}
      labels={labels.labels}
      selected={selection.id === thread.id}
      editing={editing === thread.id}
      labeling={labeling === thread.id}
      name={name}
      setName={setName}
      onOpen={() => {
        select({ id: thread.id, existing: true });
        onClose();
      }}
      onRename={() => {
        if (editing === thread.id) void mutate(() => threads.renameThread(thread.id, name.trim()));
        else {
          setEditing(thread.id);
          setName(thread.name || "");
        }
      }}
      onToggleLabels={() => setLabeling(labeling === thread.id ? undefined : thread.id)}
      onShare={canShare ? () => setSharing({ threadId: thread.id }) : undefined}
      mutate={mutate}
    />
  );
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
        {enabled && !loading && <SearchBox value={query} onChange={setQuery} />}
        {enabled && loading ? (
          <>
            <ErrorNotice error={mainError} />
            {mainError ? (
              <Button onPress={retry}>تلاش دوباره</Button>
            ) : (
              <ActivityIndicator color={colors.blueDark} />
            )}
          </>
        ) : enabled && search.active ? (
          <SearchResults
            query={query}
            search={search}
            server={local}
            mainId={mainId}
            onOpen={(id) => {
              select({ id, existing: true });
              onClose();
            }}
          />
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
                void start();
                onClose();
              }}
            >
              گفت‌وگوی جانبی تازه
            </Button>
            {currentShareId && (
              <LinkRow
                icon={Share2}
                title="خروجی و اشتراک‌گذاری"
                detail="گفت‌وگوی باز: دانلود PDF و Word یا پیوند فقط‌خواندنی"
                onPress={() => setSharing({ threadId: currentShareId })}
              />
            )}
            <Text style={[s.heading, { marginTop: 12 }]}>دستیارهای آماده</Text>
            <Text style={s.small}>هر دستیار یک گفت‌وگوی تازه با تخصص خودش شروع می‌کند.</Text>
            <PersonaList
              onPick={(persona) =>
                void mutate(async () => {
                  await start(persona.id);
                  onClose();
                })
              }
            />
            <View style={[s.between, { marginTop: 12 }]}>
              <Text style={s.heading}>گفت‌وگوهای جانبی</Text>
              <Button small onPress={() => setArchived(!archived)}>
                {archived ? "گفت‌وگوهای فعال" : "بایگانی‌شده‌ها"}
              </Button>
            </View>
            {local && <LabelBar labels={labels} filter={labelFilter} onFilter={setLabelFilter} />}
            {threads.isLoading && <ActivityIndicator color={colors.blueDark} />}
            <ErrorNotice error={error || threads.error?.message} />
            {threads.error && (
              <Button small onPress={threads.refetchThreads}>
                تلاش دوباره
              </Button>
            )}
            {!archived &&
              !labelFilter &&
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
            {pinned.length > 0 && (
              <View style={[s.row, { gap: 6 }]}>
                <Pin size={14} color={colors.muted} />
                <Text style={s.label}>سنجاق‌شده</Text>
              </View>
            )}
            {pinned.map(renderThread)}
            {pinned.length > 0 && rest.length > 0 && <Text style={s.label}>سایر گفت‌وگوها</Text>}
            {rest.map(renderThread)}
            {!threads.isLoading && !threads.error && visible.length === 0 && (
              <Text style={s.muted}>
                {labelFilter
                  ? "گفت‌وگویی با این برچسب اینجا نیست. با دکمهٔ «برچسب‌ها» زیر هر گفت‌وگو برچسب بزنید یا «همه» را انتخاب کنید."
                  : archived
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
            <LinkRow
              icon={Share2}
              title="خروجی و اشتراک‌گذاری"
              detail="دانلود PDF و Word یا پیوند فقط‌خواندنی"
              onPress={() => setSharing({ threadId: "default" })}
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
        <LinkRow
          icon={Brain}
          title="حافظه"
          detail="دستورهای سفارشی و نکته‌های ذخیره‌شده"
          onPress={() => {
            onClose();
            open({ type: "memory" });
          }}
        />
        <LinkRow icon={Settings2} title="برنامه‌ها و تنظیمات" onPress={() => go("apps")} />
        {canShare && (
          <LinkRow
            icon={Share2}
            title="پیوندهای اشتراکی"
            detail="دیدن و لغو پیوندهای فقط‌خواندنی"
            onPress={() => setSharing({})}
          />
        )}
        <WhatsNewRow
          unseen={unseenCount}
          onPress={() => {
            onClose();
            openWhatsNew();
          }}
        />
        <DisplayMenuRows onClose={onClose} />
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
      {sharing && <ShareSheet threadId={sharing.threadId} onClose={() => setSharing(undefined)} />}
    </Sheet>
  );
}
function ThreadRow({
  thread,
  threads,
  labels,
  selected,
  editing,
  labeling,
  name,
  setName,
  onOpen,
  onRename,
  onToggleLabels,
  onShare,
  mutate,
}: {
  thread: ThreadSummary;
  threads: ThreadList;
  labels: ThreadLabel[];
  selected: boolean;
  editing: boolean;
  labeling: boolean;
  name: string;
  setName: (name: string) => void;
  onOpen: () => void;
  onRename: () => void;
  onToggleLabels: () => void;
  onShare?: () => void;
  mutate: (action: () => Promise<void>) => Promise<void>;
}) {
  const title = thread.name || "گفت‌وگوی بی‌نام";
  const own = labels.filter((label) => thread.labels?.includes(label.id));
  const { pinThread, setThreadLabels } = threads;
  return (
    <View
      style={{
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.line,
        gap: 10,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`باز کردن گفت‌وگو: ${title}`}
        accessibilityState={{ selected }}
        onPress={onOpen}
        style={[s.row, { gap: 10 }]}
      >
        {thread.pinned ? (
          <Pin size={19} color={colors.blueDark} />
        ) : (
          <MessageCircle size={19} color={colors.text} />
        )}
        <Text style={[s.text, { flex: 1, textAlign: "auto", writingDirection: "auto" }]}>
          {title}
        </Text>
      </Pressable>
      {own.length > 0 && (
        <View style={[s.row, { gap: 6, flexWrap: "wrap" }]}>
          {own.map((label) => (
            <Chip key={label.id} tint={colors.lavender}>
              {label.name}
            </Chip>
          ))}
        </View>
      )}
      {editing && <Field label="نام گفت‌وگو" value={name} onChangeText={setName} />}
      {labeling && setThreadLabels && (
        <LabelPicker
          labels={labels}
          selected={thread.labels ?? []}
          disabled={threads.isMutating}
          onChange={(next) => void mutate(() => setThreadLabels(thread.id, next))}
        />
      )}
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button small disabled={threads.isMutating || (editing && !name.trim())} onPress={onRename}>
          {editing ? "ذخیره" : "تغییر نام"}
        </Button>
        {pinThread && (
          <Button
            small
            icon={thread.pinned ? PinOff : Pin}
            disabled={threads.isMutating}
            onPress={() => void mutate(() => pinThread(thread.id, !thread.pinned))}
          >
            {thread.pinned ? "برداشتن سنجاق" : "سنجاق"}
          </Button>
        )}
        {setThreadLabels && (
          <Button small icon={Tag} onPress={onToggleLabels}>
            {labeling ? "بستن برچسب‌ها" : "برچسب‌ها"}
          </Button>
        )}
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
        {onShare && (
          <Button small icon={Share2} onPress={onShare}>
            اشتراک‌گذاری
          </Button>
        )}
      </View>
    </View>
  );
}
