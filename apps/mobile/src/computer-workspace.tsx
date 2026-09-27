import {
  ArrowRight,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  Play,
  Power,
  RefreshCw,
  Save,
  Terminal,
  Upload,
} from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Platform, Text, View } from "react-native";
import type { Artifact } from "../../../packages/domain/src";
import type {
  ComputerCommand,
  ComputerDirectory,
  ComputerSnapshot,
} from "../../../packages/domain/src/computer";
import { useComputerDraft } from "./computer-drafts";
import { faDigits, faNumber, fw } from "./locale";
import { Button, Card, colors, Empty, ErrorNotice, Field, LinkRow, s, timeLabel } from "./ui";
import { useWorkspace } from "./workspace";

const mono = Platform.OS === "ios" ? "Menlo" : "monospace";
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** Shell text, paths and output read left-to-right even inside the RTL app. */
const ltr = { fontFamily: mono, writingDirection: "ltr", textAlign: "left" } as const;
const runStatus: Record<ComputerCommand["status"], string> = {
  running: "در حال اجرا",
  succeeded: "موفق",
  failed: "ناموفق",
  timed_out: "پایان مهلت",
  interrupted: "متوقف‌شده",
};

export function LinuxWorkspace({ tab }: { tab: "Terminal" | "Files" }) {
  const { api } = useWorkspace();
  const [snapshot, setSnapshot] = useState<ComputerSnapshot>();
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [command, setCommand] = useComputerDraft("command");
  const [cwd, setCwd] = useComputerDraft("cwd");
  const [executing, setExecuting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [editingCommand, setEditingCommand] = useState(false);
  const version = useRef(0);
  const polling = useRef(false);
  const mutations = useRef(0);
  const refresh = useCallback(async () => {
    if (polling.current || mutations.current) return;
    polling.current = true;
    const request = ++version.current;
    try {
      const next = await api.request<ComputerSnapshot>("/api/computer");
      if (request === version.current) {
        setSnapshot(next);
        setConnectionError("");
      }
    } catch (e) {
      if (request === version.current) setConnectionError(message(e));
    } finally {
      polling.current = false;
    }
  }, [api]);
  useEffect(() => {
    const poll = () => {
      if (AppState.currentState !== "active") return;
      void refresh();
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      version.current++;
      clearInterval(interval);
    };
  }, [refresh]);

  async function control(action: "start" | "stop") {
    if (busy) return;
    setBusy(true);
    setError("");
    mutations.current++;
    const operation = ++version.current;
    try {
      const next = await api.request<ComputerSnapshot>(`/api/computer/${action}`, {});
      if (operation === version.current) setSnapshot(next);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
      mutations.current--;
      void refresh();
    }
  }
  async function run() {
    if (!command.trim() || executing || busy) return;
    const sent = command;
    setExecuting(true);
    setError("");
    mutations.current++;
    const operation = ++version.current;
    try {
      const result = await api.request<ComputerCommand>("/api/computer/commands", {
        command: sent,
        cwd,
      });
      if (operation === version.current)
        setSnapshot((current) =>
          current
            ? {
                ...current,
                commands: [result, ...current.commands.filter((item) => item.id !== result.id)],
              }
            : current,
        );
      setCommand((current) => (current === sent ? "" : current));
      setEditingCommand(false);
    } catch (e) {
      setError(message(e));
    } finally {
      setExecuting(false);
      mutations.current--;
      void refresh();
    }
  }
  const running = snapshot?.status === "running";
  const commandRunning = executing || snapshot?.commands.some((item) => item.status === "running");
  return (
    <View style={{ gap: 16 }}>
      <Card style={{ backgroundColor: colors.sky, gap: 12 }}>
        <View style={[s.row, { gap: 12 }]}>
          <Terminal size={24} color={colors.blueDark} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={s.heading}>فضای کار Linux شما</Text>
            <Text style={s.muted}>
              {running
                ? "در حال اجرا · فایل‌ها پس از خاموش شدن هم می‌مانند"
                : snapshot?.status === "stopped"
                  ? "خاموش · فایل‌هایتان ذخیره شده‌اند"
                  : snapshot?.status === "unconfigured"
                    ? "برای شروع، رایانه را راه‌اندازی کنید"
                    : snapshot?.status === "error"
                      ? "اتصال نیاز به بررسی دارد"
                      : "در حال اتصال…"}
            </Text>
          </View>
          {!snapshot && !error && <ActivityIndicator color={colors.blueDark} />}
        </View>
        {snapshot?.message && <Text style={s.small}>{snapshot.message}</Text>}
        {snapshot?.enabled && (
          <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
            {running ? (
              <Button icon={Power} busy={busy} onPress={() => void control("stop")}>
                خاموش کردن رایانه
              </Button>
            ) : (
              <Button primary icon={Play} busy={busy} onPress={() => void control("start")}>
                روشن کردن رایانه
              </Button>
            )}
            <Button
              icon={RefreshCw}
              disabled={busy}
              onPress={() =>
                void refresh()
                  .then(() => setError(""))
                  .catch((e) => setError(message(e)))
              }
            >
              تازه‌سازی
            </Button>
          </View>
        )}
      </Card>
      <ErrorNotice error={error || connectionError} />
      {!snapshot && (error || connectionError) && (
        <Button
          onPress={() =>
            void refresh()
              .then(() => setError(""))
              .catch((e) => setError(message(e)))
          }
        >
          تلاش دوباره
        </Button>
      )}
      {snapshot?.enabled && (
        <>
          <View style={{ display: tab === "Terminal" ? "flex" : "none", gap: 16 }}>
            {editingCommand || command.length > 0 || snapshot.commands.length === 0 ? (
              <View
                style={{ borderRadius: 22, backgroundColor: colors.subtle, padding: 18, gap: 8 }}
              >
                <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18, ...fw("600") }}>
                  ترمینال
                </Text>
                <Field
                  label="پوشهٔ کاری"
                  value={cwd}
                  onChangeText={setCwd}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={ltr}
                />
                <Field
                  label="فرمان"
                  value={command}
                  onChangeText={setCommand}
                  placeholder="pwd"
                  multiline
                  maxLength={16000}
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  smartInsertDelete={false}
                  keyboardType="ascii-capable"
                  style={{ ...ltr, minHeight: 80 }}
                />
                {/[‘’“”]/.test(command) && (
                  <Button
                    small
                    onPress={() =>
                      setCommand((text) => text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"'))
                    }
                  >
                    استفاده از نقل‌قول‌های ساده
                  </Button>
                )}
                <Button
                  primary
                  icon={Play}
                  busy={!!commandRunning}
                  disabled={!running || !command.trim() || busy}
                  onPress={() => void run()}
                >
                  اجرای فرمان
                </Button>
                <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 20, ...fw("400") }}>
                  روی رایانهٔ شما اجرا می‌شود. دسترسی به شبکه خاموش است؛ برای وب از مرورگر استفاده
                  کنید.
                </Text>
              </View>
            ) : (
              <Button
                primary
                icon={Terminal}
                disabled={!running || busy || !!commandRunning}
                onPress={() => setEditingCommand(true)}
              >
                فرمان جدید
              </Button>
            )}
            {!!commandRunning && (
              <Text style={s.muted}>
                در حال کار… نتیجه اینجا نمایش داده می‌شود. برای پایان دادن به فرمان‌های در حال اجرا،
                رایانه را خاموش کنید.
              </Text>
            )}
            {snapshot.commands.length === 0 ? (
              <Empty
                icon={Terminal}
                title="آمادهٔ اولین فرمان شما"
                detail="اسکریپت اجرا کنید، با فایل‌ها کار کنید یا از دستیارتان بخواهید اینجا چیزی بسازد."
              />
            ) : (
              [...snapshot.commands]
                .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
                .slice(0, showHistory ? undefined : 5)
                .map((run) => <CommandReceipt key={run.id} run={run} />)
            )}
            {snapshot.commands.length > 5 && (
              <Button small onPress={() => setShowHistory(!showHistory)}>
                {showHistory ? "نمایش فرمان‌های اخیر" : "فرمان‌های قبلی"}
              </Button>
            )}
          </View>
          <View style={{ display: tab === "Files" ? "flex" : "none" }}>
            <ComputerFiles running={!!running} active={tab === "Files"} />
          </View>
        </>
      )}
    </View>
  );
}

function CommandReceipt({ run }: { run: ComputerCommand }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <Card style={{ gap: 10 }}>
      <View style={[s.between, { gap: 10 }]}>
        <Text
          style={[
            s.small,
            {
              color:
                run.status === "succeeded"
                  ? colors.success
                  : run.status === "running"
                    ? colors.blueDark
                    : colors.danger,
            },
          ]}
        >
          {runStatus[run.status] ?? run.status}
          {run.exitCode !== undefined ? ` · کد خروج ${faDigits(run.exitCode)}` : ""}
        </Text>
        <Text style={s.small}>{timeLabel(run.startedAt)}</Text>
      </View>
      <Text selectable style={[s.text, { ...ltr, fontSize: 13 }]}>{`$ ${run.command}`}</Text>
      <Text style={[s.small, ltr]}>{run.cwd}</Text>
      {expanded && (
        <>
          {!!run.stdout && (
            <Text selectable style={[s.text, { ...ltr, fontSize: 12, lineHeight: 19 }]}>
              {run.stdout}
            </Text>
          )}
          {!!run.stderr && (
            <Text
              selectable
              style={[s.text, { ...ltr, fontSize: 12, lineHeight: 19, color: colors.danger }]}
            >
              {run.stderr}
            </Text>
          )}
          {!run.stdout && !run.stderr && run.status !== "running" && (
            <Text style={s.small}>بدون خروجی</Text>
          )}
          {run.truncated && (
            <Text style={s.small}>
              خروجی به سقف نمایش رسید. نتیجه‌های بزرگ را در یک فایل بنویسید.
            </Text>
          )}
        </>
      )}
      {!!(run.stdout || run.stderr) && (
        <Button small onPress={() => setExpanded(!expanded)}>
          {expanded ? "پنهان کردن خروجی" : "نمایش خروجی"}
        </Button>
      )}
    </Card>
  );
}

function ComputerFiles({ running, active }: { running: boolean; active: boolean }) {
  const { api, workspace, open, refresh } = useWorkspace();
  const [path, setPath] = useComputerDraft("path");
  const [directory, setDirectory] = useState<ComputerDirectory>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [retry, setRetry] = useState(0);
  const [editor, setEditor] = useComputerDraft("editor");
  const [folder, setFolder] = useState<string>();
  const [importing, setImporting] = useState(false);
  const dirty = !!editor && (editor.text !== editor.saved || editor.path !== editor.savedPath);
  useEffect(() => {
    if (!active || !running) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError("");
    void api
      .request<ComputerDirectory>(`/api/computer/files?path=${encodeURIComponent(path)}`)
      .then((value) => {
        if (alive) setDirectory(value);
      })
      .catch((e) => {
        if (alive) setError(message(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [api, active, running, path, retry]);

  async function read(file: string) {
    if (busy || loading || !running) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const content = await api.request<{ path: string; text: string }>(
        "/api/computer/files/read",
        { path: file },
      );
      if (mounted.current) setEditor({ ...content, saved: content.text, savedPath: content.path });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function importDocument(file: Artifact) {
    if (busy || !running) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.request("/api/computer/files/import", {
        fileId: file.id,
        path: `${path}/${file.name.replace(/[\\/]/g, "_")}`,
      });
      setImporting(false);
      setNotice("سند در رایانه‌تان کپی شد.");
      setRetry((value) => value + 1);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function openPdf(path: string) {
    if (busy || !running) return;
    setBusy(true);
    setError("");
    try {
      const file = await api.request<Artifact>("/api/computer/files/export", { path });
      await refresh();
      if (mounted.current) open({ type: "file", file });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!editor || busy) return;
    const sent = editor;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.request("/api/computer/files/write", { path: sent.path, text: sent.text });
      if (mounted.current)
        setEditor((current) =>
          current?.path === sent.path
            ? { ...current, saved: sent.text, savedPath: sent.path }
            : current,
        );
      setNotice("فایل در رایانه‌تان ذخیره شد.");
      setRetry((value) => value + 1);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function mkdir() {
    if (!folder?.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.request("/api/computer/files/mkdir", { path: `${path}/${folder.trim()}` });
      setFolder(undefined);
      setRetry((value) => value + 1);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 12 }}>
      <View style={s.between}>
        <Text style={s.heading}>فایل‌های فضای کار</Text>
        {(busy || loading) && <ActivityIndicator color={colors.blueDark} />}
      </View>
      <Text selectable style={[s.small, ltr]}>
        {editor?.path || path}
      </Text>
      <ErrorNotice error={error} />
      {!!notice && <Text style={[s.small, { color: colors.success }]}>{notice}</Text>}
      {!running && (
        <Text style={s.muted}>برای مرور یا ویرایش فایل‌های ذخیره‌شده، رایانه را روشن کنید.</Text>
      )}
      {editor ? (
        <>
          <Field
            label="مسیر فایل"
            value={editor.path}
            onChangeText={(value) => setEditor({ ...editor, path: value })}
            autoCorrect={false}
            autoCapitalize="none"
            style={ltr}
          />
          <Field
            label="محتوای فایل"
            value={editor.text}
            onChangeText={(value) => setEditor({ ...editor, text: value })}
            multiline
            autoCorrect={false}
            spellCheck={false}
            smartInsertDelete={false}
            keyboardType="ascii-capable"
            autoCapitalize="none"
            style={{ ...ltr, minHeight: 240, fontSize: 13 }}
          />
          <View style={[s.row, { flexWrap: "wrap", gap: 8 }]}>
            <Button
              primary
              icon={Save}
              busy={busy}
              disabled={!running || !editor.path.trim()}
              onPress={() => void save()}
            >
              ذخیرهٔ فایل
            </Button>
            <Button
              disabled={busy}
              icon={ArrowRight}
              onPress={() => {
                setEditor(undefined);
                setNotice("");
              }}
            >
              {dirty ? "نادیده گرفتن تغییرات" : "بازگشت به فایل‌ها"}
            </Button>
          </View>
        </>
      ) : (
        <>
          <View style={[s.row, { flexWrap: "wrap", gap: 8 }]}>
            {path !== "/workspace" && (
              <Button
                small
                disabled={busy}
                icon={ArrowRight}
                onPress={() => setPath(path.slice(0, path.lastIndexOf("/")) || "/workspace")}
              >
                پوشهٔ بالاتر
              </Button>
            )}
            <Button
              small
              disabled={!running || busy}
              icon={FilePlus2}
              onPress={() => {
                setNotice("");
                setEditor({
                  path: `${path}/note-${Date.now()}.txt`,
                  text: "",
                  saved: "",
                  savedPath: "",
                });
              }}
            >
              فایل جدید
            </Button>
            <Button
              small
              disabled={!running || busy}
              icon={FolderPlus}
              onPress={() => setFolder("")}
            >
              پوشهٔ جدید
            </Button>
            <Button
              small
              disabled={!running || busy}
              icon={RefreshCw}
              onPress={() => setRetry(retry + 1)}
            >
              تازه‌سازی فایل‌ها
            </Button>
            <Button
              small
              disabled={!running || busy}
              icon={Upload}
              onPress={() => setImporting(!importing)}
            >
              {importing ? "پنهان کردن اسناد" : "کپی سند به اینجا"}
            </Button>
          </View>
          {importing && (
            <Card>
              <Text style={s.heading}>یک PDF ذخیره‌شده انتخاب کنید</Text>
              <Text style={[s.small, { marginTop: 6 }]}>
                در همین پوشه کپی می‌شود. فایلی با همین نام جایگزین خواهد شد.
              </Text>
              {workspace.files.map((file) => (
                <LinkRow
                  key={file.id}
                  icon={FileText}
                  title={file.name}
                  onPress={() => void importDocument(file)}
                />
              ))}
              {!workspace.files.length && (
                <Text style={s.muted}>
                  هنوز سندی ندارید. ابتدا سندی از ایمیل یا بخش «فایل‌ها» اضافه کنید.
                </Text>
              )}
            </Card>
          )}
          {folder !== undefined && (
            <Card style={{ gap: 8 }}>
              <Field
                label="نام پوشه"
                value={folder}
                onChangeText={setFolder}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <View style={[s.row, { gap: 8 }]}>
                <Button
                  primary
                  disabled={!running || !folder.trim()}
                  busy={busy}
                  onPress={() => void mkdir()}
                >
                  ساختن پوشه
                </Button>
                <Button disabled={busy} onPress={() => setFolder(undefined)}>
                  انصراف
                </Button>
              </View>
            </Card>
          )}
          {running &&
            directory?.path === path &&
            directory.entries.map((entry) => (
              <LinkRow
                key={entry.path}
                icon={entry.type === "directory" ? Folder : FileText}
                title={entry.name}
                detail={
                  entry.type === "directory"
                    ? "پوشه"
                    : entry.type === "symlink"
                      ? "پیوند نمادین"
                      : `${faNumber(Math.max(1, Math.ceil(entry.size / 1024)))} کیلوبایت`
                }
                onPress={() => {
                  if (busy || loading || !running) return;
                  if (entry.type === "directory") {
                    setNotice("");
                    setPath(entry.path);
                  } else if (/\.pdf$/i.test(entry.name)) void openPdf(entry.path);
                  else void read(entry.path);
                }}
              />
            ))}
          {running &&
            !busy &&
            !loading &&
            !error &&
            directory?.path === path &&
            directory.entries.length === 0 && (
              <Empty
                icon={Folder}
                title="فضایی کوچک برای ساختن"
                detail="فایلی اینجا اضافه کنید یا از دستیارتان بخواهید در فضای کارش یکی بسازد."
              />
            )}
        </>
      )}
    </View>
  );
}
