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
import {
  AgentActivityScreen,
  AgentStatus,
  AppsScreen,
  GoalsScreen,
  IdeasScreen,
} from "./src/agent-ui";
import { AgentWorkspaceProvider, useAgentWorkspace } from "./src/agent-workspace";
import { API_URL, createSession, MuseApi } from "./src/api";
import { ChatScreen, WorkspaceTools } from "./src/chat";
import { ComputerEntry } from "./src/computer";
import { ComputerDraftProvider } from "./src/computer-drafts";
import { Details } from "./src/details";
import { faNumber, fw, useAppFonts } from "./src/locale";
import { BrowserScreen, CalendarScreen, FilesScreen, MailScreen } from "./src/screens";
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
export default function App() {
  const fontsReady = useAppFonts();
  const [token, setToken] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const connect = useCallback(async (key?: string) => {
    setBusy(true);
    setError("");
    try {
      const session = await createSession(key);
      setToken(session.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void connect();
  }, [connect]);
  if (!fontsReady) return null;
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {token ? (
        <CopilotKitProvider
          runtimeUrl={`${API_URL}/api/copilotkit`}
          headers={{ Authorization: `Bearer ${token}` }}
        >
          <WorkspaceApp token={token} />
        </CopilotKitProvider>
      ) : (
        <SafeAreaView
          style={{
            flex: 1,
            backgroundColor: colors.canvas,
            justifyContent: "center",
            alignItems: "center",
            padding: 24,
          }}
        >
          <View style={{ width: "100%", maxWidth: 420, gap: 22, alignItems: "center" }}>
            <Mascot size={72} />
            <Text
              style={{
                fontSize: 32,
                lineHeight: 44,
                textAlign: "center",
                color: colors.text,
                ...fw("500"),
              }}
            >
              به OpenMuse خوش آمدید.
            </Text>
            <Text style={[s.muted, { textAlign: "center" }]}>فضایی کوچک برای روزتان.</Text>
            {busy ? (
              <ActivityIndicator color={colors.blueDark} />
            ) : (
              <Card style={{ width: "100%" }}>
                <ErrorNotice error={error} />
                <Field
                  label="کلید دسترسی فضای کار"
                  value={accessKey}
                  onChangeText={setAccessKey}
                  secureTextEntry
                  placeholder="برای فضای کار آنلاین لازم است"
                />
                <Button primary onPress={() => void connect(accessKey || undefined)}>
                  باز کردن فضای کار
                </Button>
                <Text style={[s.small, { marginTop: 15 }]}>
                  فضاهای کار محلی بدون کلید باز می‌شوند. مطمئن شوید سرور OpenMuse در این نشانی در حال
                  اجراست: <Text style={{ writingDirection: "ltr" }}>{API_URL}</Text>
                </Text>
              </Card>
            )}
          </View>
        </SafeAreaView>
      )}
    </SafeAreaProvider>
  );
}
function WorkspaceApp({ token }: { token: string }) {
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
  } = useMuseThread();
  const [threadsOpen, setThreadsOpen] = useState(false);
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const pending =
    (data?.notifications.filter((n) => !n.read).length || 0) +
    workspace.actions.filter((a) => a.status === "awaiting_review").length;
  const activeTask =
    data?.tasks.find(
      (task) => task.status === "waiting_approval" || task.status === "waiting_input",
    ) || data?.tasks.find((task) => task.status === "running");
  const agentName = data?.identity.name || "OpenMuse";
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
            <View style={{ position: "absolute", start: 0, top: 16 }}>
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
                backgroundColor: "#FFF",
                borderRadius: 40,
                shadowColor: "#132631",
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.07,
                shadowRadius: 18,
                elevation: 3,
                borderWidth: 1,
                borderColor: "#F8F8F8",
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
                      backgroundColor: active ? "#F0F1F2" : "transparent",
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
                style={{ color: "#FFF", fontSize: 14, lineHeight: 22, flexShrink: 1, ...fw("400") }}
              >
                {toast}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="بستن اعلان"
                onPress={clearToast}
              >
                <X size={16} color="#FFF" />
              </Pressable>
            </View>
          </View>
        )}
        {threadsOpen && <ThreadsSheet onClose={() => setThreadsOpen(false)} />}
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
