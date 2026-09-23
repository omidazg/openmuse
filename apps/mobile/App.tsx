import { CopilotKitProvider } from "@copilotkit/react-native/headless";
import { StatusBar } from "expo-status-bar";
import {
  ArrowRight,
  Bell,
  Check,
  Lightbulb,
  type LucideIcon,
  Menu,
  MessageCircle,
  PanelsTopLeft,
  Shapes,
  SquareCheck,
  X,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import type { Section, Workspace } from "../../packages/domain/src";
import { BRAND } from "../../packages/domain/src/brand";
import {
  AgentActivityScreen,
  AgentStatus,
  AppsScreen,
  GoalsScreen,
  IdeasScreen,
} from "./src/agent-ui";
import { AgentWorkspaceProvider, useAgentWorkspace } from "./src/agent-workspace";
import {
  API_URL,
  createSession,
  endSession,
  fetchHealth,
  MuseApi,
  onUnauthorized,
} from "./src/api";
import { ChatScreen, WorkspaceTools } from "./src/chat";
import { requestComposerFocus } from "./src/composer-keys";
import { ShortcutsSheet, useWebShortcuts } from "./src/composer-shortcuts";
import { ComputerEntry } from "./src/computer";
import { ComputerDraftProvider } from "./src/computer-drafts";
import { Details } from "./src/details";
import { Landing } from "./src/landing";
import { faNumber, fw, useAppFonts } from "./src/locale";
import { PhoneLogin } from "./src/login";
import { BrowserScreen, CalendarScreen, FilesScreen, MailScreen } from "./src/screens";
import { SessionProvider } from "./src/session";
import { ThreadsProvider, ThreadsSheet, useMuseThread } from "./src/threads";
import { Button, Card, colors, ErrorNotice, Field, IconButton, Mascot, s } from "./src/ui";
import { type Detail, useWorkspace, WorkspaceContext } from "./src/workspace";

const nav: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: "chat", label: "گفت‌وگو", icon: MessageCircle },
  { id: "activity", label: "فعالیت", icon: PanelsTopLeft },
  { id: "ideas", label: "ایده‌ها", icon: Lightbulb },
  { id: "goals", label: "اهداف", icon: SquareCheck },
  { id: "apps", label: "برنامه‌ها", icon: Shapes },
];
const titles: Partial<Record<Section, { title: string; subtitle: string }>> = {
  activity: { title: "فعالیت", subtitle: "برنامه‌ها، پیشرفت، تصمیم‌ها و نتیجه‌ها." },
  ideas: { title: "ایده‌ها", subtitle: "قدم‌های بعدی کاربردی، متناسب با دنیای شما." },
  goals: {
    title: "اهداف",
    subtitle: "هدف‌های بلندمدت و چیزهایی که باید حواسمان به آن‌ها باشد.",
  },
  apps: {
    title: "برنامه‌ها",
    subtitle: "اتصال‌ها، توانایی‌ها و آنچه دستیارتان به خاطر دارد.",
  },
  connections: { title: "برنامه‌ها", subtitle: "اتصال‌ها و توانایی‌ها." },
  mail: { title: "ایمیل", subtitle: "گفت‌وگوهایی که پشت کارهای شماست." },
  calendar: { title: "تقویم", subtitle: "زمان برای چیزهایی که مهم‌اند." },
  browser: { title: "مرورگر", subtitle: "نشست‌های مرور متصل شما." },
  files: { title: "فایل‌ها", subtitle: "اسناد، فرم‌ها و نسخه‌های تکمیل‌شده." },
};
const TOKEN_KEY = "dastyar.session";
/** Web keeps the 24-hour session token so a refresh does not ask for the key again. */
function loadToken(): string {
  try {
    return globalThis.localStorage?.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}
function saveToken(value: string) {
  try {
    if (value) globalThis.localStorage?.setItem(TOKEN_KEY, value);
    else globalThis.localStorage?.removeItem(TOKEN_KEY);
  } catch {}
}

export default function App() {
  const fontsReady = useAppFonts();
  const [token, setToken] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [otpEnabled, setOtpEnabled] = useState(false);
  const [method, setMethod] = useState<"key" | "phone">("key");
  /** Back to the login screen, e.g. after logout or when the server ends the session. */
  const signOut = useCallback((message = "") => {
    saveToken("");
    setToken("");
    setError(message);
    setBusy(false);
  }, []);
  const logout = useCallback(() => {
    void endSession(token);
    signOut();
  }, [token, signOut]);
  useEffect(() => {
    if (!token) return;
    onUnauthorized((message) => signOut(message));
    return () => onUnauthorized(undefined);
  }, [token, signOut]);
  useEffect(() => {
    void fetchHealth().then((health) => {
      setOtpEnabled(Boolean(health?.otpEnabled));
      if (health?.otpEnabled) setMethod("phone");
    });
  }, []);
  const connect = useCallback(async (key?: string, silent = false) => {
    setBusy(true);
    setError("");
    try {
      const session = await createSession(key);
      saveToken(session.token);
      setToken(session.token);
    } catch (e) {
      // The first automatic attempt has no key; its failure is expected, not an error.
      if (!silent) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void (async () => {
      const saved = loadToken();
      if (saved) {
        const ok = await fetch(`${API_URL}/api/workspace`, {
          headers: { Authorization: `Bearer ${saved}` },
        })
          .then((r) => r.ok)
          .catch(() => false);
        if (ok) {
          setToken(saved);
          setBusy(false);
          return;
        }
        saveToken("");
      }
      await connect(undefined, true);
    })();
  }, [connect]);
  if (!fontsReady) return null;
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      {token ? (
        <CopilotKitProvider
          runtimeUrl={`${API_URL}/api/copilotkit`}
          headers={{ Authorization: `Bearer ${token}` }}
        >
          <WorkspaceApp token={token} logout={logout} />
        </CopilotKitProvider>
      ) : (
        <Landing>
          <View style={{ width: "100%", maxWidth: 420, gap: 22, alignItems: "center" }}>
            <Text style={[s.heading, { fontSize: 20, lineHeight: 32 }]}>ورود به فضای کار</Text>
            {busy ? (
              <ActivityIndicator color={colors.blueDark} />
            ) : (
              <Card style={{ width: "100%" }}>
                {otpEnabled && (
                  <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
                    <Button small primary={method === "phone"} onPress={() => setMethod("phone")}>
                      شمارهٔ موبایل
                    </Button>
                    <Button small primary={method === "key"} onPress={() => setMethod("key")}>
                      کلید دسترسی
                    </Button>
                  </View>
                )}
                <ErrorNotice error={error} />
                {otpEnabled && method === "phone" ? (
                  <PhoneLogin
                    onSession={(value) => {
                      saveToken(value);
                      setError("");
                      setToken(value);
                    }}
                  />
                ) : (
                  <>
                    <Field
                      label="کلید دسترسی فضای کار"
                      value={accessKey}
                      onChangeText={setAccessKey}
                      secureTextEntry
                      placeholder="کلید دسترسی خود را وارد کنید"
                    />
                    <Button primary onPress={() => void connect(accessKey || undefined)}>
                      باز کردن فضای کار
                    </Button>
                  </>
                )}
                {__DEV__ ? (
                  <Text style={[s.small, { marginTop: 15 }]}>
                    فضاهای کار محلی بدون کلید باز می‌شوند. مطمئن شوید سرور {BRAND.nameFa} در این
                    نشانی در حال اجراست: <Text style={{ writingDirection: "ltr" }}>{API_URL}</Text>
                  </Text>
                ) : (
                  <Text style={[s.small, { marginTop: 15 }]}>
                    کلید دسترسی را از مدیر سرویس دریافت کنید. پس از ورود، این دستگاه تا ۲۴ ساعت شما
                    را به خاطر می‌سپارد.
                  </Text>
                )}
              </Card>
            )}
          </View>
        </Landing>
      )}
    </SafeAreaProvider>
  );
}
function WorkspaceApp({ token, logout }: { token: string; logout: () => void }) {
  const api = useMemo(() => new MuseApi(token), [token]);
  const [workspace, setWorkspace] = useState<Workspace>();
  const [section, setSection] = useState<Section>("chat");
  const [detail, setDetail] = useState<Detail>();
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState<{ id: number; text: string }>();
  const fail = useCallback(
    (e: unknown) =>
      setError(`فضای کار بارگذاری نشد. ${e instanceof Error ? e.message : String(e)}`),
    [],
  );
  const refresh = useCallback(async () => {
    const snapshot = await api.request<Workspace>("/api/workspace");
    setWorkspace(snapshot);
    setError("");
  }, [api]);
  useEffect(() => {
    void refresh().catch(fail);
  }, [refresh, fail]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh().catch(fail);
    });
    return () => listener.remove();
  }, [refresh, fail]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  const navigate = useCallback(
    (next: Section) =>
      setSection(next === "today" ? "chat" : next === "connections" ? "apps" : next),
    [],
  );
  const open = useCallback((next: Detail) => setDetail(next), []);
  const close = useCallback(() => setDetail(undefined), []);
  const ask = useCallback((text: string) => {
    setPrompt({ id: Date.now(), text });
    setSection("chat");
  }, []);
  if (!workspace)
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: colors.canvas,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          gap: 18,
        }}
      >
        <Mascot size={56} />
        {error ? (
          <>
            <ErrorNotice error={error} />
            <Button onPress={() => void refresh().catch(fail)}>تلاش دوباره</Button>
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.blueDark} />
            <Text style={s.muted}>در حال باز کردن فضای کار…</Text>
          </>
        )}
      </SafeAreaView>
    );
  return (
    <WorkspaceContext.Provider
      value={{ workspace, api, section, navigate, refresh, open, close, notify: setToast, ask }}
    >
      <SessionProvider api={api} logout={logout}>
        <AgentWorkspaceProvider>
          <ComputerDraftProvider key={token}>
            <ThreadsProvider>
              <WorkspaceShell
                detail={detail}
                toast={toast}
                clearToast={() => setToast("")}
                error={error}
                prompt={prompt}
              />
            </ThreadsProvider>
          </ComputerDraftProvider>
        </AgentWorkspaceProvider>
      </SessionProvider>
    </WorkspaceContext.Provider>
  );
}
function WorkspaceShell({
  detail,
  toast,
  clearToast,
  error,
  prompt,
}: {
  detail?: Detail;
  toast: string;
  clearToast: () => void;
  error: string;
  prompt?: { id: number; text: string };
}) {
  const { workspace, section, navigate, open } = useWorkspace();
  const { data } = useAgentWorkspace();
  const {
    selection,
    visited,
    mainId,
    loading: threadsLoading,
    error: threadsError,
    retry: retryThreads,
    enabled: richThreads,
    start: startThread,
  } = useMuseThread();
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Desktop web: Ctrl/Cmd+K conversations, Ctrl/Cmd+Shift+O new conversation, «?» help.
  useWebShortcuts(true, (action) => {
    if (action === "threads") {
      setShortcutsOpen(false);
      setThreadsOpen(true);
      return true;
    }
    if (action === "newChat") {
      setThreadsOpen(false);
      setShortcutsOpen(false);
      if (richThreads) startThread();
      else navigate("chat");
      setTimeout(requestComposerFocus, 50);
      return true;
    }
    if (action === "escape" && (threadsOpen || shortcutsOpen) && !detail) {
      // Also closed by the web Modal on keyup; closing here keeps Esc working before it activates.
      setThreadsOpen(false);
      setShortcutsOpen(false);
      return true;
    }
    if (action === "help" && !threadsOpen && !detail) {
      setShortcutsOpen(true);
      return true;
    }
    if (action === "focusInput" && section !== "chat" && !threadsOpen && !detail) {
      navigate("chat");
      setTimeout(requestComposerFocus, 50);
      return true;
    }
    return false;
  });
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const pending =
    (data?.notifications.filter((n) => !n.read).length || 0) +
    workspace.actions.filter((a) => a.status === "awaiting_review").length;
  const activeTask =
    data?.tasks.find(
      (task) => task.status === "waiting_approval" || task.status === "waiting_input",
    ) || data?.tasks.find((task) => task.status === "running");
  const agentName = data?.identity.name || BRAND.nameFa;
  const status = activeTask
    ? activeTask.status === "waiting_approval"
      ? `آمادهٔ بررسی · ${activeTask.title}`
      : activeTask.status === "waiting_input"
        ? `منتظر پاسخ شما · ${activeTask.title}`
        : activeTask.plan.find((step) => step.status === "running")?.title || activeTask.title
    : data?.tasks.some((task) => task.status === "queued")
      ? "در حال شروع کار بعدی…"
      : "هر وقت لازم باشد، همین‌جا هستم";
  const title = titles[section] || titles.apps;
  const Screen =
    section === "mail"
      ? MailScreen
      : section === "calendar"
        ? CalendarScreen
        : section === "browser"
          ? BrowserScreen
          : section === "files"
            ? FilesScreen
            : section === "activity"
              ? AgentActivityScreen
              : section === "ideas"
                ? IdeasScreen
                : section === "goals"
                  ? GoalsScreen
                  : AppsScreen;
  const utility = ["mail", "calendar", "browser", "files"].includes(section);
  return (
    <>
      <WorkspaceTools />
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={["top", "bottom"]}>
        <View style={{ flex: 1, width: "100%", maxWidth: 760, alignSelf: "center" }}>
          <View
            style={{
              height: desktop ? 146 : 122,
              paddingTop: desktop ? 14 : 2,
              marginHorizontal: 20,
            }}
          >
            <View style={{ position: "absolute", start: 0, top: 16, zIndex: 1 }}>
              <IconButton
                icon={Menu}
                label="باز کردن گفت‌وگوها و منو"
                onPress={() => setThreadsOpen(true)}
              />
            </View>
            <View style={{ alignItems: "center", gap: 1 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`باز کردن فعالیت‌ها و تأییدهای ${agentName}`}
                onPress={() => navigate("activity")}
                style={({ pressed }) => ({
                  alignItems: "center",
                  maxWidth: "70%",
                  opacity: pressed ? 0.65 : 1,
                })}
              >
                <Mascot size={desktop ? 58 : 49} variant={data?.identity.avatar} />
                <Text
                  style={{
                    fontSize: 16,
                    lineHeight: 24,
                    ...fw("600"),
                    color: colors.text,
                  }}
                >
                  {agentName}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{
                    fontSize: 12,
                    lineHeight: 18,
                    color: colors.muted,
                    marginBottom: 6,
                    ...fw("400"),
                  }}
                >
                  {status}
                </Text>
              </Pressable>
              {section === "chat" && <ComputerEntry />}
            </View>
            <View style={{ position: "absolute", end: 0, top: 16 }}>
              <IconButton
                icon={Bell}
                label={`اعلان‌ها، ${faNumber(pending)} مورد خوانده‌نشده یا در انتظار`}
                onPress={() => open({ type: "notifications" })}
              />
              {pending > 0 && (
                <View
                  pointerEvents="none"
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 4,
                    position: "absolute",
                    top: 7,
                    end: 9,
                    backgroundColor: colors.blueDark,
                  }}
                />
              )}
            </View>
          </View>
          <View style={{ flex: 1, minHeight: 0 }}>
            {section !== "chat" && (
              <ScrollView
                key={section}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: desktop ? 42 : 22, paddingBottom: 28 }}
                keyboardShouldPersistTaps="handled"
              >
                {utility && (
                  <Button
                    small
                    icon={ArrowRight}
                    style={{ alignSelf: "flex-start", marginBottom: 18 }}
                    onPress={() => navigate("apps")}
                  >
                    بازگشت به برنامه‌ها
                  </Button>
                )}
                <Text style={[s.title, { fontSize: 25, marginBottom: 22 }]}>{title?.title}</Text>
                <ErrorNotice error={error} />
                <Screen />
              </ScrollView>
            )}
            <View
              style={{
                display: section === "chat" ? "flex" : "none",
                flex: 1,
                paddingHorizontal: desktop ? 42 : 17,
              }}
            >
              <AgentStatus />
              {richThreads ? (
                <>
                  <ErrorNotice error={threadsError} />
                  {threadsError ? (
                    <Button onPress={retryThreads}>تلاش دوباره</Button>
                  ) : threadsLoading ? (
                    <ActivityIndicator color={colors.blueDark} />
                  ) : null}
                  {!threadsLoading && selection.id !== mainId && (
                    <Text style={[s.small, { textAlign: "center", marginBottom: 8 }]}>
                      گفت‌وگوی جانبی
                    </Text>
                  )}
                  {visited.map((thread) => (
                    <View
                      key={thread.id}
                      style={{ display: selection.id === thread.id ? "flex" : "none", flex: 1 }}
                    >
                      <ChatScreen
                        thread={thread}
                        active={section === "chat" && selection.id === thread.id}
                        prompt={selection.id === thread.id ? prompt : undefined}
                      />
                    </View>
                  ))}
                </>
              ) : (
                <ChatScreen prompt={prompt} active={section === "chat"} />
              )}
            </View>
          </View>
          <View
            style={{
              paddingHorizontal: 22,
              paddingTop: 10,
              paddingBottom: desktop ? 22 : 7,
              alignItems: "center",
            }}
          >
            <View
              style={{
                flexDirection: "row",
                width: "100%",
                maxWidth: 370,
                padding: 5,
                backgroundColor: colors.card,
                borderRadius: 40,
                shadowColor: "#132631",
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.07,
                shadowRadius: 18,
                elevation: 3,
                borderWidth: 1,
                borderColor: colors.line,
              }}
            >
              {nav.map((item) => {
                const active = section === item.id || (item.id === "apps" && utility);
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="tab"
                    accessibilityLabel={item.label}
                    accessibilityState={{ selected: active }}
                    onPress={() => navigate(item.id)}
                    style={{
                      flex: 1,
                      height: 47,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: active ? colors.subtle : "transparent",
                      borderRadius: 28,
                    }}
                  >
                    <item.icon size={23} strokeWidth={1.8} color={colors.text} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
        {!!toast && (
          <View
            pointerEvents="box-none"
            style={{ position: "absolute", bottom: 94, start: 20, end: 20, alignItems: "center" }}
          >
            <View
              style={[
                s.row,
                {
                  gap: 10,
                  padding: 14,
                  backgroundColor: colors.text,
                  borderRadius: 20,
                  maxWidth: 560,
                },
              ]}
            >
              <Check size={16} color={colors.blue} />
              <Text
                style={{
                  color: colors.canvas,
                  fontSize: 14,
                  lineHeight: 22,
                  flexShrink: 1,
                  ...fw("400"),
                }}
              >
                {toast}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="بستن اعلان"
                onPress={clearToast}
              >
                <X size={16} color={colors.canvas} />
              </Pressable>
            </View>
          </View>
        )}
        {threadsOpen && (
          <ThreadsSheet
            onClose={() => setThreadsOpen(false)}
            onShortcuts={() => {
              setThreadsOpen(false);
              setShortcutsOpen(true);
            }}
          />
        )}
        {shortcutsOpen && <ShortcutsSheet onClose={() => setShortcutsOpen(false)} />}
        {detail && (
          <Details
            key={
              detail.type === "task"
                ? detail.taskId
                : detail.type === "file"
                  ? detail.file.id
                  : detail.type === "browser"
                    ? detail.browser.id
                    : detail.type === "mail"
                      ? detail.mail.id
                      : detail.type === "review"
                        ? detail.action.id
                        : detail.type === "email"
                          ? JSON.stringify(detail.draft)
                          : detail.type === "event"
                            ? detail.event?.id || "event-new"
                            : detail.type
            }
            detail={detail}
          />
        )}
      </SafeAreaView>
    </>
  );
}
