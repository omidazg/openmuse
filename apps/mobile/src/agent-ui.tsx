import {
  ArrowLeft,
  Bell,
  Brain,
  CalendarDays,
  ChevronLeft,
  CircleDollarSign,
  FileText,
  Globe2,
  Heart,
  Lightbulb,
  ListChecks,
  Mail,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Square,
  Target,
  Users,
  X,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Linking, Pressable, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import type { Artifact, BrowserSession } from "../../../packages/domain/src";
import type {
  AgentArtifact,
  AgentTask,
  Evidence,
  Goal,
  Idea,
  Monitor,
  RunEvent,
} from "../../../packages/domain/src/agent";
import { BRAND } from "../../../packages/domain/src/brand";
import { useAgentWorkspace } from "./agent-workspace";
import { FONT, faDate, faDateTime, faDigits, faNumber, fw, LOCALE, toLatinDigits } from "./locale";
import { ActivityScreen, ConnectionsScreen } from "./screens";
import {
  Button,
  Card,
  CheckRow,
  Chip,
  colors,
  Empty,
  ErrorNotice,
  Field,
  LinkRow,
  Mascot,
  resultSummary,
  SectionHeading,
  Sheet,
  s,
} from "./ui";
import { useWorkspace } from "./workspace";

const STATUS_LABELS: Record<string, string> = {
  queued: "در صف",
  running: "در حال انجام",
  waiting_approval: "در انتظار تأیید",
  waiting_input: "در انتظار پاسخ شما",
  scheduled: "زمان‌بندی‌شده",
  paused: "متوقف‌شده",
  succeeded: "انجام شد",
  failed: "ناموفق",
  cancelled: "لغوشده",
  pending: "در انتظار",
  waiting: "در انتظار",
  active: "فعال",
  completed: "تکمیل‌شده",
  stopped: "پایان‌یافته",
  new: "تازه",
  dismissed: "کنارگذاشته",
  accepted: "پذیرفته‌شده",
  agent: "کار عمومی",
  document: "سند",
  monitor: "پیگیری",
  finance: "مالی",
  plan: "برنامه",
  comparison: "مقایسه",
  report: "گزارش",
  step: "گام",
  observation: "مشاهده",
  approval: "تأیید",
  result: "نتیجه",
  error: "خطا",
  status: "وضعیت",
  warm: "گرم",
  concise: "موجز",
  thoughtful: "سنجیده",
  sky: "آسمانی",
  sand: "شنی",
  lilac: "یاسی",
};
/** Persian display label for a status/kind enum; the underlying value is never changed. */
export function statusLabel(value: string) {
  return STATUS_LABELS[value] ?? value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
/** Short Jalali date with 24-hour time, e.g. «۲۹ شهریور، ۱۴:۳۰». */
function stamp(value?: string, fallback = "هنوز بررسی نشده") {
  if (!value) return fallback;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return faDigits(value);
  return new Intl.DateTimeFormat(`${LOCALE}-u-ca-persian`, {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}
/** Jalali display for a date value from data (ISO date-only strings are read as calendar days). */
function day(value: unknown) {
  const text = String(value ?? "");
  if (!text) return "";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) return faDigits(text);
  return faDate(date, { dateStyle: "medium", ...(dateOnly ? { timeZone: "UTC" } : {}) });
}
/** User-typed number: Persian/Arabic digits, «٫» decimal and thousands separators normalized. */
function typedNumber(text: string) {
  return Number(
    toLatinDigits(text)
      .replace(/٫/g, ".")
      .replace(/[,٬\s]/g, ""),
  );
}
function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
function activeTask(task: AgentTask) {
  return !["succeeded", "failed", "cancelled"].includes(task.status);
}
export function AgentStatus() {
  const { data, error, refresh } = useAgentWorkspace();
  if (data?.worker.running && !error) return null;
  return (
    <View style={{ gap: 8 }}>
      <ErrorNotice
        error={error ? `به‌روزرسانی‌های دستیار دریافت نشد. دوباره وصل شوید. (${error})` : ""}
      />
      {error && (
        <Button small onPress={() => void refresh().catch(() => {})}>
          اتصال دوباره به دستیار
        </Button>
      )}
      {!data && !error && <ActivityIndicator color={colors.blueDark} />}
      {data && !data.worker.running && (
        <Text style={s.small}>
          پردازشگر آفلاین است. کارهای ذخیره‌شده پس از اتصال دوباره ادامه می‌یابند.
        </Text>
      )}
    </View>
  );
}
export function TaskCard({
  task,
  compact = false,
  onOpen,
}: {
  task: AgentTask;
  compact?: boolean;
  onOpen?: () => void;
}) {
  const { open } = useWorkspace();
  const done = task.plan.filter((step) => step.status === "succeeded").length;
  const next = task.plan.find((step) => ["running", "waiting"].includes(step.status));
  const waiting = ["waiting_input", "waiting_approval"].includes(task.status);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`باز کردن کار: ${task.title}`}
      onPress={() => {
        onOpen?.();
        open({ type: "task", taskId: task.id });
      }}
    >
      <Card
        style={{
          padding: compact ? 15 : 20,
          gap: 11,
          borderRadius: 22,
          backgroundColor: colors.subtle,
        }}
      >
        <View style={[s.row, { gap: 10 }]}>
          <View
            style={[
              s.iconBox,
              { width: 34, height: 34, backgroundColor: waiting ? colors.orange : colors.sky },
            ]}
          >
            <ListChecks size={18} color={colors.blueDark} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={s.heading}>{task.title}</Text>
            <Text style={s.small}>
              {statusLabel(task.status)}
              {task.plan.length ? ` · ${faNumber(done)} از ${faNumber(task.plan.length)} گام` : ""}
            </Text>
          </View>
          <ChevronLeft size={17} color={colors.muted} />
        </View>
        {!!task.plan.length && (
          <View style={{ height: 4, backgroundColor: colors.line, borderRadius: 4 }}>
            <View
              style={{
                height: 4,
                width: `${Math.round((done / task.plan.length) * 100)}%`,
                backgroundColor: "#6AAEE0",
                borderRadius: 4,
              }}
            />
          </View>
        )}
        {(task.question || task.result || task.error || next?.title) && (
          <Text numberOfLines={compact ? 2 : 4} style={s.muted}>
            {task.question || task.error || resultSummary(task.result || next?.title || "")}
          </Text>
        )}
        {waiting && (
          <Text style={[s.small, { color: colors.blueDark, ...fw("600") }]}>
            {task.status === "waiting_approval" ? "بازبینی درخواست شده" : "به پاسخ شما نیاز است"}
          </Text>
        )}
      </Card>
    </Pressable>
  );
}
export function ChatWork() {
  const { data } = useAgentWorkspace();
  const tasks = [...(data?.tasks || [])]
    .filter(activeTask)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 2);
  if (!tasks.length) return null;
  return (
    <View style={{ gap: 10 }}>
      {tasks.map((task) => (
        <TaskCard task={task} key={task.id} compact />
      ))}
    </View>
  );
}
export function AgentActivityScreen() {
  const { data } = useAgentWorkspace();
  const [filter, setFilter] = useState<"all" | "active" | "finished">("all");
  const tasks = [...(data?.tasks || [])]
    .filter(
      (task) => filter === "all" || (filter === "active" ? activeTask(task) : !activeTask(task)),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <View style={{ gap: 20 }}>
      <AgentStatus />
      <View style={[s.row, { gap: 8 }]}>
        {(
          [
            ["all", "همه"],
            ["active", "در حال انجام"],
            ["finished", "پایان‌یافته"],
          ] as const
        ).map(([item, label]) => (
          <Button key={item} small primary={filter === item} onPress={() => setFilter(item)}>
            {label}
          </Button>
        ))}
      </View>
      {tasks.map((task) => (
        <TaskCard key={task.id} task={task} />
      ))}
      {!tasks.length && (
        <Empty
          icon={ListChecks}
          title="هنوز کاری نسپرده‌اید"
          detail="کارهایی که می‌سپارید با برنامه، پیشرفت و نتیجه اینجا نمایش داده می‌شوند. در گفت‌وگو اولین کار را بسپارید."
        />
      )}
      <SectionHeading title="بازبینی‌ها و رسیدها" />
      <ActivityScreen />
    </View>
  );
}
export function EvidenceList({ items }: { items: Evidence[] }) {
  const { workspace, open } = useWorkspace();
  const [error, setError] = useState("");
  return (
    <View style={{ gap: 10 }}>
      {items.map((item) => (
        <View
          key={item.id}
          style={{ borderStartWidth: 2, borderStartColor: colors.blue, paddingStart: 12, gap: 4 }}
        >
          <Text style={[s.small, { color: colors.text, ...fw("600") }]}>{item.title}</Text>
          <Text selectable style={s.small}>
            {item.excerpt}
          </Text>
          {item.url && /^https?:\/\//i.test(item.url) && (
            <Button
              small
              onPress={() =>
                void Linking.openURL(item.url || "").catch(() =>
                  setError("منبع باز نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید."),
                )
              }
            >
              باز کردن منبع
            </Button>
          )}
          {item.kind === "mail" && workspace.mail.some((mail) => mail.id === item.id) && (
            <Button
              small
              onPress={() => {
                const mail = workspace.mail.find((m) => m.id === item.id);
                if (mail) open({ type: "mail", mail });
              }}
            >
              مشاهده ایمیل
            </Button>
          )}
          {item.kind === "file" && workspace.files.some((file) => file.id === item.id) && (
            <Button
              small
              onPress={() => {
                const file = workspace.files.find((f) => f.id === item.id);
                if (file) open({ type: "file", file });
              }}
            >
              مشاهده فایل
            </Button>
          )}
        </View>
      ))}
      <ErrorNotice error={error} />
    </View>
  );
}
export function TaskDetail({ taskId }: { taskId: string }) {
  const { api, workspace, close, open, refresh: refreshWorkspace } = useWorkspace();
  const { data, mutate } = useAgentWorkspace();
  const [detail, setDetail] = useState<{
    task: AgentTask;
    events: RunEvent[];
    artifacts: AgentArtifact[];
    files: Artifact[];
    browsers: BrowserSession[];
  }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState("");
  const [fieldJson, setFieldJson] = useState("");
  const [showFieldJson, setShowFieldJson] = useState(false);
  const [fields, setFields] = useState<Record<string, string | boolean>>({});
  const task = data?.tasks.find((item) => item.id === taskId) || detail?.task;
  useEffect(() => {
    let active = true;
    void api
      .request<{
        task: AgentTask;
        events: RunEvent[];
        artifacts: AgentArtifact[];
        files: Artifact[];
        browsers: BrowserSession[];
      }>(`/api/agent/tasks/${taskId}`)
      .then((result) => {
        if (active) {
          setDetail(result);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [api, taskId, task?.updatedAt]);
  async function act(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      await mutate(`/tasks/${taskId}/${path}`, body);
      if (path === "input") {
        setAnswer("");
        setFields({});
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function submitInput() {
    try {
      let parsed: Record<string, string | boolean> = fields;
      if (fieldJson.trim()) {
        let raw: unknown;
        try {
          raw = JSON.parse(fieldJson);
        } catch {
          throw new Error("فیلدهای فرم خوانده نشد. قالب JSON را بررسی کنید و دوباره ثبت کنید.");
        }
        if (
          !raw ||
          typeof raw !== "object" ||
          Array.isArray(raw) ||
          Object.values(raw).some(
            (value) => typeof value !== "string" && typeof value !== "boolean",
          )
        )
          throw new Error(
            "فیلدهای فرم پذیرفته نشد. یک شیء JSON با مقادیر متنی یا true/false وارد کنید.",
          );
        parsed = raw as Record<string, string | boolean>;
      }
      await act("input", {
        answer: answer.trim() || "فیلدهای درخواستی تکمیل شد.",
        fields: parsed,
      });
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function review() {
    setBusy(true);
    setError("");
    try {
      await refreshWorkspace();
      const snapshot = await api.request<typeof workspace>("/api/workspace");
      const action = snapshot.actions.find((item) => item.id === task?.actionId);
      if (!action)
        throw new Error("این بازبینی هنوز در دسترس نیست. صفحه را تازه کنید و دوباره تلاش کنید.");
      open({ type: "review", action });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const missing = Array.isArray(task?.state.missingFields) ? task.state.missingFields : [];
  const fieldNames = missing
    .map((field) =>
      typeof field === "string"
        ? field
        : typeof field === "object" && field && "name" in field
          ? String(field.name)
          : "",
    )
    .filter(Boolean);
  return (
    <Sheet
      title={task?.title || "کار"}
      subtitle={
        task
          ? `${statusLabel(task.status)} · ${stamp(task.updatedAt)}`
          : "در حال بارگذاری پیشرفت ذخیره‌شده…"
      }
      onClose={close}
    >
      <ErrorNotice error={error} />
      {!task ? (
        <ActivityIndicator color={colors.blueDark} />
      ) : (
        <View style={{ gap: 20 }}>
          <Text selectable style={s.text}>
            {task.prompt}
          </Text>
          <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
            {["queued", "running", "scheduled", "waiting_input", "waiting_approval"].includes(
              task.status,
            ) && (
              <Button
                small
                icon={Pause}
                busy={busy}
                onPress={() => void act("control", { action: "pause" })}
              >
                توقف
              </Button>
            )}
            {task.status === "paused" && (
              <Button
                small
                icon={Play}
                busy={busy}
                onPress={() => void act("control", { action: "resume" })}
              >
                ادامه
              </Button>
            )}
            {task.status === "failed" && (
              <Button
                small
                icon={RefreshCw}
                busy={busy}
                onPress={() => void act("control", { action: "retry" })}
              >
                تلاش دوباره
              </Button>
            )}
            {activeTask(task) && (
              <Button
                small
                danger
                icon={X}
                busy={busy}
                onPress={() => void act("control", { action: "cancel" })}
              >
                لغو کار
              </Button>
            )}
          </View>
          {task.status === "waiting_approval" && (
            <Card style={{ backgroundColor: colors.lavender, gap: 12 }}>
              <Text style={s.heading}>آماده بازبینی شما</Text>
              <Text style={s.muted}>پیش از ادامه، اقدام و حساب دقیق را بازبینی کنید.</Text>
              <Button primary busy={busy} onPress={() => void review()}>
                بازبینی اقدام
              </Button>
            </Card>
          )}
          {task.status === "waiting_input" && (
            <Card style={{ backgroundColor: colors.sky, gap: 10 }}>
              <Text style={s.heading}>{task.question || "یک توضیح از طرف شما کمک می‌کند"}</Text>
              {fieldNames.map((name) =>
                missing.some(
                  (f) => typeof f === "object" && f && f.name === name && f.type === "checkbox",
                ) ? (
                  <CheckRow
                    key={name}
                    label={name.replace(/_/g, " ")}
                    checked={Boolean(fields[name])}
                    onPress={() => setFields((current) => ({ ...current, [name]: !current[name] }))}
                  />
                ) : (
                  <Field
                    key={name}
                    label={name.replace(/_/g, " ")}
                    value={String(fields[name] ?? "")}
                    onChangeText={(value) =>
                      setFields((current) => ({ ...current, [name]: value }))
                    }
                  />
                ),
              )}
              {!fieldNames.length && (
                <Field
                  label="پاسخ شما"
                  value={answer}
                  onChangeText={setAnswer}
                  multiline
                  placeholder="جزئیات جاافتاده را اضافه کنید…"
                />
              )}
              {task.kind === "document" && !fieldNames.length && (
                <>
                  <Button small onPress={() => setShowFieldJson(!showFieldJson)}>
                    {showFieldJson ? "پنهان کردن فیلدهای فرم" : "وارد کردن فیلدهای فرم"}
                  </Button>
                  {showFieldJson && (
                    <Field
                      label="فیلدها (JSON: نام فیلد به مقدار)"
                      value={fieldJson}
                      onChangeText={setFieldJson}
                      multiline
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={{ writingDirection: "ltr" }}
                      placeholder={'{"full_name":"نام شما","consent":true}'}
                    />
                  )}
                </>
              )}
              <Button
                primary
                busy={busy}
                disabled={!answer.trim() && !Object.keys(fields).length && !fieldJson.trim()}
                onPress={() => void submitInput()}
              >
                ادامه کار
              </Button>
            </Card>
          )}
          {!!task.plan.length && (
            <Card style={{ gap: 15 }}>
              <Text style={s.heading}>برنامه</Text>
              {task.plan.map((step, index) => (
                <View key={step.id} style={[s.row, { gap: 10, alignItems: "flex-start" }]}>
                  <Text
                    style={[
                      s.text,
                      { color: step.status === "succeeded" ? colors.blueDark : colors.muted },
                    ]}
                  >
                    {step.status === "succeeded" ? "✓" : `${faNumber(index + 1)}.`}
                  </Text>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={s.text}>{step.title}</Text>
                    <Text style={s.small}>
                      {statusLabel(step.status)}
                      {step.detail ? ` · ${step.detail}` : ""}
                    </Text>
                  </View>
                </View>
              ))}
            </Card>
          )}
          {task.result && (
            <Card style={{ backgroundColor: colors.green }}>
              <Text selectable style={s.text}>
                {resultSummary(task.result)}
              </Text>
            </Card>
          )}
          <ErrorNotice error={task.error ?? undefined} />
          {detail?.browsers?.map((browser) => (
            <Card key={browser.id} style={{ gap: 10 }}>
              <Text style={s.heading}>{browser.title || "مرورگر دستیار"}</Text>
              <Text selectable style={[s.small, { writingDirection: "ltr" }]}>
                {browser.url}
              </Text>
              {browser.status === "active" && browser.previewUrl && (
                <Image
                  accessibilityLabel="پیش‌نمایش مرورگر دستیار"
                  source={{ uri: api.url(browser.previewUrl) }}
                  style={{ width: "100%", aspectRatio: 1.6, borderRadius: 12 }}
                />
              )}
              <Button
                small
                busy={busy}
                onPress={() => {
                  setBusy(true);
                  void (async () => {
                    try {
                      if (["running", "scheduled", "queued"].includes(task.status))
                        await mutate(`/tasks/${taskId}/control`, { action: "pause" });
                      open({ type: "browser", browser });
                    } catch (error) {
                      setError(errorText(error));
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                {["running", "scheduled", "queued"].includes(task.status)
                  ? "توقف و باز کردن مرورگر"
                  : "باز کردن مرورگر"}
              </Button>
            </Card>
          ))}
          {detail?.files?.map((file) => (
            <LinkRow
              key={file.id}
              title={file.name}
              detail={`${faNumber(file.pageCount)} صفحه · PDF`}
              icon={FileText}
              onPress={() => open({ type: "file", file })}
            />
          ))}
          {(
            data?.artifacts.filter((artifact) => artifact.taskId === taskId) ||
            detail?.artifacts ||
            []
          ).map((artifact) => (
            <ArtifactCard key={artifact.id} artifact={artifact} />
          ))}
          {!!task.evidence.length && (
            <View style={{ gap: 14 }}>
              <Text style={s.heading}>منابع</Text>
              <EvidenceList items={task.evidence} />
            </View>
          )}
          <Text style={s.heading}>روند زمانی</Text>
          {detail?.events.map((event) => (
            <View
              key={event.id}
              style={{
                gap: 4,
                paddingStart: 14,
                borderStartWidth: 2,
                borderStartColor: colors.line,
              }}
            >
              <Text style={s.small}>
                {stamp(event.date)} · {statusLabel(event.kind)}
              </Text>
              <Text style={s.text}>{event.title}</Text>
              <Text selectable style={s.muted}>
                {event.detail}
              </Text>
            </View>
          ))}
          {!detail?.events.length && (
            <Text style={s.muted}>
              هنوز گامی ثبت نشده است. پردازشگر هر گام را هنگام انجام اینجا ثبت می‌کند.
            </Text>
          )}
        </View>
      )}
    </Sheet>
  );
}
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function display(value: unknown): string {
  return typeof value === "string"
    ? value
    : typeof value === "number"
      ? faNumber(value)
      : typeof value === "boolean"
        ? value
          ? "بله"
          : "خیر"
        : value === null
          ? "بدون مقدار"
          : JSON.stringify(value, null, 2) || "";
}
export function ArtifactCard({ artifact }: { artifact: AgentArtifact }) {
  const [expanded, setExpanded] = useState(false);
  const { api, refresh, open } = useWorkspace();
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState("");
  if (artifact.kind === "finance") return <FinanceArtifact artifact={artifact} />;
  async function exportPdf() {
    setPdfBusy(true);
    setPdfError("");
    try {
      const file = await api.request<Artifact>(`/api/agent/artifacts/${artifact.id}/pdf`, {});
      await refresh();
      open({ type: "file", file });
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : String(e));
    } finally {
      setPdfBusy(false);
    }
  }
  const rows = Object.entries(artifact.data);
  return (
    <Card style={{ gap: 13, backgroundColor: colors.card }}>
      <View style={s.between}>
        <Text style={s.heading}>{artifact.title}</Text>
        <Chip>{statusLabel(artifact.kind)}</Chip>
      </View>
      <Text selectable style={s.muted}>
        {artifact.summary}
      </Text>
      {(expanded ? rows : rows.slice(0, 4)).map(([key, value]) => (
        <View key={key} style={{ gap: 6 }}>
          <Text style={s.label}>{key.replace(/_/g, " ")}</Text>
          {Array.isArray(value) ? (
            value.slice(0, expanded ? 100 : 5).map((item) => {
              const row = record(item);
              return (
                <View
                  key={`${key}-${display(row?.id ?? item)}`}
                  style={{
                    paddingVertical: 8,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.line,
                  }}
                >
                  <Text selectable style={s.text}>
                    {row
                      ? Object.entries(row)
                          .map(([name, val]) => `${name}: ${display(val)}`)
                          .join(" · ")
                      : display(item)}
                  </Text>
                </View>
              );
            })
          ) : record(value) ? (
            Object.entries(record(value) || {}).map(([name, val]) => (
              <View key={name} style={s.between}>
                <Text style={s.muted}>{name}</Text>
                <Text selectable style={s.text}>
                  {display(val)}
                </Text>
              </View>
            ))
          ) : (
            <Text
              selectable
              style={[
                s.text,
                typeof value === "number"
                  ? { fontSize: 24, lineHeight: 32 }
                  : { fontSize: 14, lineHeight: 24 },
              ]}
            >
              {display(value)}
            </Text>
          )}
        </View>
      ))}
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button small onPress={() => setExpanded(!expanded)}>
          {expanded ? "نمایش خلاصه" : "مشاهده نتیجه کامل"}
        </Button>
        <Button small icon={FileText} busy={pdfBusy} onPress={() => void exportPdf()}>
          ساخت PDF
        </Button>
      </View>
      <ErrorNotice error={pdfError} />
    </Card>
  );
}
function FinanceArtifact({ artifact }: { artifact: AgentArtifact }) {
  const [details, setDetails] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { mutate } = useAgentWorkspace();
  const [goalTitle, setGoalTitle] = useState("");
  const [goalSaved, setGoalSaved] = useState(false);
  const [goalBusy, setGoalBusy] = useState(false);
  const [goalError, setGoalError] = useState("");
  const saveGoal = async () => {
    setGoalBusy(true);
    setGoalError("");
    try {
      await mutate("/goals", {
        title: goalTitle.trim(),
        category: "Finances",
        description: `الهام‌گرفته از ${artifact.title}: ${artifact.summary}`,
        milestones: ["یک هدف پس‌انداز انتخاب کنید", "هر هفته هزینه‌ها را مرور کنید"],
      });
      setGoalSaved(true);
    } catch (error) {
      setGoalError(errorText(error));
    } finally {
      setGoalBusy(false);
    }
  };
  // Amounts stay in the imported file's own currency (unknown here), so no unit is invented.
  const amount = (value: unknown) =>
    faNumber(Number(value ?? 0) || 0, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const categories = Array.isArray(artifact.data.categories) ? artifact.data.categories : [];
  const transactions = Array.isArray(artifact.data.transactions) ? artifact.data.transactions : [];
  const spending = Number(artifact.data.spending) || 1;
  const period = record(artifact.data.period);
  return (
    <Card
      style={{ gap: 12, padding: 10, backgroundColor: colors.subtle, maxWidth: 440, width: "100%" }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`باز کردن ردیاب مالی: ${artifact.title}`}
        accessibilityState={{ expanded: details }}
        onPress={() => setDetails(!details)}
      >
        <View
          style={{
            minHeight: 200,
            borderRadius: 16,
            overflow: "hidden",
            backgroundColor: "#080B10",
            padding: 20,
          }}
        >
          <View style={{ position: "absolute", top: 0, start: 0, end: 0, height: 142 }}>
            <Svg width="100%" height="100%">
              <Defs>
                <LinearGradient id="finance" x1="0" y1="0" x2="0.5" y2="1">
                  <Stop offset="0" stopColor="#281066" />
                  <Stop offset="0.5" stopColor="#163BBF" />
                  <Stop offset="1" stopColor="#148CE8" />
                </LinearGradient>
              </Defs>
              <Rect width="100%" height="100%" fill="url(#finance)" />
            </Svg>
          </View>
          <Text
            style={{
              fontFamily: FONT,
              color: "#D4DCFC",
              fontSize: 11,
              lineHeight: 19,
              marginBottom: 20,
            }}
          >
            خوانده‌شده از تراکنش‌های واردشده‌ی شما.{"\n"}
            {period?.from || period?.to ? `از ${day(period?.from)} تا ${day(period?.to)}` : ""}
            {"\n"}
            {faNumber(transactions.length)} تراکنش، دسته‌بندی و خلاصه‌شده.
          </Text>
          <View style={[s.row, { gap: 7 }]}>
            {(
              [
                ["درآمد", "income"],
                ["هزینه", "spending"],
                ["باقی‌مانده", "saved"],
              ] as const
            ).map(([label, key]) => (
              <View
                key={key}
                style={{ flex: 1, padding: 11, borderRadius: 12, backgroundColor: "#1D2025" }}
              >
                <Text style={{ fontFamily: FONT, color: "#A4A7AD", fontSize: 9, lineHeight: 14 }}>
                  {label}
                </Text>
                <Text
                  selectable
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.65}
                  style={{
                    fontSize: 17,
                    lineHeight: 26,
                    ...fw("600"),
                    color: key === "saved" ? "#58D3AE" : "#FFF",
                    marginTop: 5,
                  }}
                >
                  {amount(artifact.data[key])}
                </Text>
                <Text
                  style={{
                    fontFamily: FONT,
                    color: "#7E8289",
                    fontSize: 8,
                    lineHeight: 13,
                    marginTop: 4,
                  }}
                >
                  ارز مبدأ
                </Text>
              </View>
            ))}
          </View>
        </View>
        <View style={[s.row, { gap: 11, paddingHorizontal: 8, paddingTop: 13, paddingBottom: 4 }]}>
          <Text style={{ fontSize: 25 }}>💸</Text>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[s.text, { ...fw("600") }]}>ردیاب مالی</Text>
            <Text style={s.small}>هزینه‌ها، پس‌انداز و برنامه‌ای برای گام بعد.</Text>
          </View>
          <ChevronLeft size={17} color={colors.muted} />
        </View>
      </Pressable>
      {details && (
        <View style={{ gap: 16, padding: 10 }}>
          <Text style={s.label}>پول شما کجا خرج شد</Text>
          {categories.map((category) => {
            const row = record(category);
            if (!row) return null;
            return (
              <View key={String(row.name)} style={{ gap: 8 }}>
                <View style={s.between}>
                  <Text style={s.text}>{String(row.name)}</Text>
                  <Text style={s.text}>{amount(row.amount)}</Text>
                </View>
                <View style={{ height: 7, backgroundColor: colors.line, borderRadius: 8 }}>
                  <View
                    style={{
                      width: `${Math.min(100, (Number(row.amount) / spending) * 100)}%`,
                      height: 7,
                      backgroundColor: colors.blueDark,
                      borderRadius: 8,
                    }}
                  />
                </View>
              </View>
            );
          })}
          <Text style={s.small}>
            مبالغ به ارز مبدأ شماست. این خلاصه بازه‌ی تاریخ‌های واردشده را پوشش می‌دهد.
          </Text>
          {goalSaved ? (
            <Text style={s.text}>هدف پس‌انداز شما در «هدف‌ها» ذخیره شد.</Text>
          ) : (
            <View style={{ gap: 10 }}>
              <Field
                label="این را به هدف پس‌انداز تبدیل کنید"
                value={goalTitle}
                onChangeText={setGoalTitle}
                placeholder="برای چه چیزی می‌خواهید پس‌انداز کنید؟"
              />
              <ErrorNotice error={goalError} />
              <Button
                small
                busy={goalBusy}
                disabled={!goalTitle.trim()}
                onPress={() => void saveGoal()}
              >
                ساخت هدف پس‌انداز
              </Button>
            </View>
          )}
          <Button small onPress={() => setExpanded(!expanded)}>
            {expanded ? "پنهان کردن تراکنش‌ها" : "مشاهده تراکنش‌ها"}
          </Button>
          {expanded &&
            transactions.slice(0, 100).map((transaction) => {
              const row = record(transaction);
              return row ? (
                <View key={String(row.id ?? display(row))} style={s.between}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.text}>{String(row.description)}</Text>
                    <Text style={s.small}>
                      {day(row.date)} · {String(row.category)}
                    </Text>
                  </View>
                  <Text style={s.text}>{amount(row.amount)}</Text>
                </View>
              ) : null;
            })}
          {expanded && transactions.length > 100 && (
            <Text style={s.small}>
              {faNumber(100)} تراکنش نخست نمایش داده شده است. جمع‌ها همه‌ی ردیف‌ها را شامل می‌شوند.
            </Text>
          )}
        </View>
      )}
    </Card>
  );
}
export function DelegateSheet() {
  const { workspace, close, open } = useWorkspace();
  const { delegate } = useAgentWorkspace();
  const [kind, setKind] = useState<AgentTask["kind"]>("plan");
  const [prompt, setPrompt] = useState("");
  const [messageId, setMessageId] = useState("");
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true);
    setError("");
    try {
      const task = await delegate({
        prompt: prompt.trim(),
        kind,
        input:
          kind === "finance"
            ? { csv: toLatinDigits(csv) }
            : kind === "document"
              ? { messageId }
              : {},
      });
      open({ type: "task", taskId: task.id });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title="سپردن یک کار"
      subtitle={`${BRAND.nameFa} برنامه‌ای ذخیره می‌کند و روی سرور به کار ادامه می‌دهد.`}
      onClose={close}
    >
      <View style={[s.row, { flexWrap: "wrap", gap: 8, marginBottom: 20 }]}>
        {(["plan", "document", "finance", "agent"] as const).map((item) => (
          <Button small primary={kind === item} key={item} onPress={() => setKind(item)}>
            {statusLabel(item)}
          </Button>
        ))}
      </View>
      <Field
        label="چه کاری می‌خواهید انجام شود؟"
        value={prompt}
        onChangeText={setPrompt}
        multiline
        placeholder={
          kind === "document"
            ? "فرم پیوست را پر کنید و پاسخی برای بازبینی من آماده کنید"
            : kind === "finance"
              ? "هزینه‌هایم را خلاصه کنید و یک برنامه‌ی پس‌انداز پیشنهاد دهید"
              : "یک برنامه‌ی عملی برای هفته‌ام بچینید"
        }
      />
      {kind === "document" && (
        <View style={{ gap: 8, marginBottom: 18 }}>
          <Text style={s.heading}>ایمیل دارای PDF را انتخاب کنید</Text>
          {workspace.mail
            .filter((mail) => mail.attachments.length)
            .map((mail) => (
              <CheckRow
                key={mail.id}
                checked={mail.id === messageId}
                label={`${mail.subject} · ${mail.sender}`}
                onPress={() => setMessageId(mail.id)}
              />
            ))}
          {!workspace.mail.some((mail) => mail.attachments.length) && (
            <Text style={s.muted}>
              ایمیل‌های دارای پیوست PDF اینجا نمایش داده می‌شوند. هنوز ایمیلی با PDF ندارید؛ در
              «برنامه‌ها» ایمیل را وصل کنید.
            </Text>
          )}
        </View>
      )}
      {kind === "finance" && (
        <>
          <Field
            label="CSV تراکنش‌ها"
            value={csv}
            onChangeText={setCsv}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            style={{ writingDirection: "ltr" }}
            placeholder={"date,description,amount,category\n2026-09-01,Groceries,54.20,Food"}
          />
          {workspace.mode === "sample" && (
            <Button
              onPress={() =>
                setCsv(
                  "date,description,amount,category\n2026-09-01,Salary,-4200,Income\n2026-09-02,Groceries,84.50,Food\n2026-09-03,Subscription,19.99,Subscriptions\n2026-09-04,Coffee,6.50,Food",
                )
              }
            >
              امتحان با تراکنش‌های نمونه
            </Button>
          )}
          <Text style={[s.small, { marginVertical: 12 }]}>
            مبالغ مثبت هزینه و مبالغ منفی درآمد هستند. فقط داده‌های واردشده استفاده می‌شود و هیچ
            اتصالی به بانک برقرار نمی‌شود.
          </Text>
        </>
      )}
      {kind === "agent" && !workspace.runtime.configured && (
        <Text style={[s.muted, { marginBottom: 16 }]}>
          کارهای عمومی و برنامه‌ها به یک مدل پیکربندی‌شده نیاز دارند. کارهای اسناد، پیگیری صفحه‌ها و
          خلاصه‌ی هزینه‌ها روند هدایت‌شده دارند.
        </Text>
      )}
      <ErrorNotice error={error} />
      <Button
        primary
        busy={busy}
        disabled={
          !prompt.trim() ||
          (kind === "document" && !messageId) ||
          (kind === "finance" && !csv.trim())
        }
        onPress={() => void submit()}
      >
        سپردن کار
      </Button>
    </Sheet>
  );
}
export function IdeasScreen() {
  const { data, mutate } = useAgentWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function refreshIdeas() {
    setBusy(true);
    setError("");
    try {
      await mutate("/ideas/refresh", {});
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const ideas = data?.ideas.filter((idea) => idea.status === "new") || [];
  return (
    <View style={{ gap: 20 }}>
      <AgentStatus />
      <View style={s.between}>
        <Text style={s.small}>برگرفته از برنامه‌های متصل شما</Text>
        <Button small icon={RefreshCw} busy={busy} onPress={() => void refreshIdeas()}>
          یافتن ایده
        </Button>
      </View>
      <ErrorNotice error={error} />
      {ideas.map((idea) => (
        <IdeaCard key={idea.id} idea={idea} />
      ))}
      {!ideas.length && (
        <Empty
          icon={Lightbulb}
          title="هنوز ایده‌ای پیدا نشده است"
          detail="ایده‌هایی که از برنامه‌های متصل شما به دست می‌آیند، همراه با شواهدشان اینجا نمایش داده می‌شوند. برای شروع «یافتن ایده» را بزنید."
        />
      )}
      {(data?.ideas || [])
        .filter((idea) => idea.status === "accepted")
        .map((idea) => (
          <Card key={idea.id} style={{ gap: 7 }}>
            <Text style={s.heading}>{idea.title}</Text>
            <Chip tint={colors.green}>آغازشده</Chip>
            {idea.taskId && <TaskLink taskId={idea.taskId} />}
          </Card>
        ))}
    </View>
  );
}
function TaskLink({ taskId, onOpen }: { taskId: string; onOpen?: () => void }) {
  const { open } = useWorkspace();
  return (
    <Button
      small
      icon={ArrowLeft}
      onPress={() => {
        onOpen?.();
        open({ type: "task", taskId });
      }}
    >
      مشاهده کار
    </Button>
  );
}
function IdeaCard({ idea }: { idea: Idea }) {
  const { mutate } = useAgentWorkspace();
  const { open } = useWorkspace();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState(idea.prompt);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function act(action: "accept" | "dismiss") {
    setBusy(true);
    setError("");
    try {
      const result = await mutate<Idea>(`/ideas/${idea.id}`, { action, prompt });
      if (result.taskId && action === "accept") open({ type: "task", taskId: result.taskId });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: colors.line }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`مشاهده ایده: ${idea.title}`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        style={{ flexDirection: "row", gap: 14 }}
      >
        <Text style={{ fontSize: 27, width: 34, paddingTop: 3 }}>
          {/document|permission|form/i.test(idea.title)
            ? "📋"
            : /money|spend|saving/i.test(idea.title)
              ? "💸"
              : /goal|plan|training/i.test(idea.title)
                ? "👟"
                : /dinner|table/i.test(idea.title)
                  ? "🍽️"
                  : "💡"}
        </Text>
        <View style={{ flex: 1, gap: 5 }}>
          <Text style={[s.heading, { fontSize: 16, lineHeight: 23 }]}>{idea.title}</Text>
          <Text style={s.muted}>{idea.reason}</Text>
        </View>
      </Pressable>
      {expanded && (
        <View style={{ gap: 15, marginTop: 18, paddingStart: 48 }}>
          <EvidenceList items={idea.evidence} />
          {editing && (
            <Field
              label={`${BRAND.nameFa} چه کاری انجام دهد؟`}
              value={prompt}
              onChangeText={setPrompt}
              multiline
            />
          )}
          <ErrorNotice error={error} />
          <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
            <Button
              primary
              busy={busy}
              disabled={!prompt.trim()}
              onPress={() => void act("accept")}
            >
              شروع کار
            </Button>
            <Button disabled={busy} onPress={() => setEditing(!editing)}>
              {editing ? "تمام" : "ویرایش"}
            </Button>
            <Button disabled={busy} onPress={() => void act("dismiss")}>
              کنار گذاشتن
            </Button>
          </View>
        </View>
      )}
    </View>
  );
}
export function GoalsScreen() {
  const { data } = useAgentWorkspace();
  const [adding, setAdding] = useState<string>();
  const [selectedGoal, setSelectedGoal] = useState<string>();
  const [selectedMonitor, setSelectedMonitor] = useState<string>();
  const [showAll, setShowAll] = useState(false);
  const goal = data?.goals.find((item) => item.id === selectedGoal);
  const monitor = data?.monitors.find((item) => item.id === selectedMonitor);
  const monitors = data?.monitors || [];
  return (
    <View style={{ gap: 22 }}>
      <AgentStatus />
      <View style={{ gap: 8 }}>
        <View style={[s.between, { marginBottom: 5 }]}>
          <View style={[s.row, { gap: 10 }]}>
            <View
              style={{
                width: 16,
                height: 16,
                borderRadius: 8,
                borderWidth: 5,
                borderColor: colors.green,
                backgroundColor: "#24A46B",
              }}
            />
            <Text style={[s.heading, { color: colors.success }]}>پیگیری‌ها</Text>
          </View>
          <Button small icon={Plus} onPress={() => setAdding("Tracking")}>
            افزودن پیگیری
          </Button>
        </View>
        {(showAll ? monitors : monitors.slice(0, 3)).map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={`باز کردن پیگیری: ${item.title}`}
            onPress={() => setSelectedMonitor(item.id)}
            style={[s.row, { gap: 12, paddingVertical: 13 }]}
          >
            <Square size={21} color={colors.faint} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.text}>{item.title}</Text>
              <Text numberOfLines={1} style={s.muted}>
                {item.status === "active"
                  ? `بررسی هر ${faNumber(item.intervalMinutes)} دقیقه`
                  : statusLabel(item.status)}
              </Text>
            </View>
            <ChevronLeft size={18} color={colors.faint} />
          </Pressable>
        ))}
        {!monitors.length && (
          <Text style={[s.muted, { paddingVertical: 10 }]}>
            هنوز پیگیری‌ای ندارید. قیمت بلیت، یک رزرو یا هر صفحه‌ای را که می‌خواهید زیر نظر بگیرید با
            «افزودن پیگیری» اضافه کنید.
          </Text>
        )}
        {monitors.length > 3 && (
          <Button small onPress={() => setShowAll(!showAll)}>
            {showAll ? "نمایش کمتر" : `نمایش ${faNumber(monitors.length - 3)} مورد دیگر`}
          </Button>
        )}
      </View>
      <View style={{ height: 1, backgroundColor: colors.line }} />
      <View style={{ gap: 8 }}>
        <View style={[s.row, { gap: 10, marginBottom: 5 }]}>
          <View
            style={{
              width: 16,
              height: 16,
              borderRadius: 8,
              borderWidth: 5,
              borderColor: colors.sky,
              backgroundColor: "#3D9BDE",
            }}
          />
          <Text style={[s.heading, { color: colors.blueDark }]}>هدف‌ها</Text>
        </View>
        {data?.goals.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={`باز کردن هدف: ${item.title}`}
            onPress={() => setSelectedGoal(item.id)}
            style={[s.row, { gap: 12, paddingVertical: 13 }]}
          >
            <Square
              size={21}
              color={colors.faint}
              fill={item.status === "completed" ? colors.green : "transparent"}
            />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.text}>{item.title}</Text>
              <Text numberOfLines={2} style={s.muted}>
                {item.description || statusLabel(item.status)}
              </Text>
            </View>
            <ChevronLeft size={18} color={colors.faint} />
          </Pressable>
        ))}
        {!data?.goals.length && (
          <Text style={[s.muted, { paddingVertical: 10 }]}>
            هدف‌های شما اینجا نمایش داده می‌شوند. برای شروع، از بخش «ساخت هدف» یک موضوع را انتخاب
            کنید.
          </Text>
        )}
      </View>
      <View style={{ height: 1, backgroundColor: colors.line }} />
      <Text style={s.heading}>ساخت هدف</Text>
      {[
        { name: "Health", label: "سلامت", icon: Heart },
        { name: "Relationships", label: "روابط", icon: Users },
        { name: "Finances", label: "امور مالی", icon: CircleDollarSign },
        { name: "Something else", label: "موضوعی دیگر", icon: Target },
      ].map((item) => (
        <Pressable
          key={item.name}
          accessibilityRole="button"
          accessibilityLabel={`ساخت هدف ${item.label}`}
          onPress={() => setAdding(item.name)}
          style={[s.row, { gap: 12, minHeight: 38 }]}
        >
          <item.icon size={23} color={colors.faint} />
          <Text style={[s.text, { flex: 1, color: colors.muted }]}>{item.label}</Text>
          <Plus size={18} color={colors.faint} />
        </Pressable>
      ))}
      {adding && (
        <Sheet
          title={adding === "Tracking" ? "پیگیری تازه" : "ساخت هدف"}
          onClose={() => setAdding(undefined)}
        >
          {adding === "Tracking" ? (
            <MonitorForm onDone={() => setAdding(undefined)} />
          ) : (
            <GoalForm category={adding} onDone={() => setAdding(undefined)} />
          )}
        </Sheet>
      )}
      {goal && (
        <Sheet title={goal.title} onClose={() => setSelectedGoal(undefined)}>
          <GoalCard goal={goal} onOpenTask={() => setSelectedGoal(undefined)} />
        </Sheet>
      )}
      {monitor && (
        <Sheet title={monitor.title} onClose={() => setSelectedMonitor(undefined)}>
          <MonitorCard monitor={monitor} onOpenTask={() => setSelectedMonitor(undefined)} />
        </Sheet>
      )}
    </View>
  );
}
function GoalForm({ onDone, category }: { onDone: () => void; category?: string }) {
  const { mutate } = useAgentWorkspace();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [milestones, setMilestones] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      await mutate("/goals", {
        title: title.trim(),
        category,
        description,
        milestones: milestones
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      });
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <Field
        label="هدف شما"
        value={title}
        onChangeText={setTitle}
        placeholder="ساختن اندوخته‌ی اضطراری سه‌ماهه"
      />
      <Field
        label="موفقیت چه شکلی است؟"
        value={description}
        onChangeText={setDescription}
        multiline
      />
      <Field
        label="نقاط عطف (هر کدام در یک خط)"
        value={milestones}
        onChangeText={setMilestones}
        multiline
      />
      <ErrorNotice error={error} />
      <Button primary disabled={!title.trim()} busy={busy} onPress={() => void save()}>
        ساخت هدف
      </Button>
    </Card>
  );
}
function GoalCard({ goal, onOpenTask }: { goal: Goal; onOpenTask?: () => void }) {
  const { data, mutate, delegate } = useAgentWorkspace();
  const { open } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const done = goal.milestones.filter((item) => item.done).length;
  async function update(body: unknown) {
    setBusy(true);
    setError("");
    try {
      await mutate(`/goals/${goal.id}`, body);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function plan() {
    setBusy(true);
    setError("");
    try {
      const task = await delegate({
        title: `برنامه: ${goal.title}`,
        prompt: `یک برنامه‌ی عملی برای این هدف بسازید: ${goal.title}. ${goal.description}`,
        kind: "plan",
        goalId: goal.id,
        input: {},
      });
      onOpenTask?.();
      open({ type: "task", taskId: task.id });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card style={{ gap: 12 }}>
      <View style={s.between}>
        <Text style={[s.heading, { flex: 1 }]}>{goal.title}</Text>
        <Chip tint={goal.status === "completed" ? colors.green : colors.sky}>
          {statusLabel(goal.status)}
        </Chip>
      </View>
      <Text style={s.muted}>{goal.description}</Text>
      <Text style={s.small}>
        {faNumber(done)} از {faNumber(goal.milestones.length)} نقطه‌ی عطف
      </Text>
      {goal.milestones.map((milestone) => (
        <CheckRow
          key={milestone.id}
          checked={milestone.done}
          label={milestone.title}
          onPress={() => {
            if (!busy)
              void update({
                milestones: goal.milestones.map((item) =>
                  item.id === milestone.id ? { ...item, done: !item.done } : item,
                ),
              });
          }}
        />
      ))}
      <ErrorNotice error={error} />
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button
          small
          busy={busy}
          onPress={() => void update({ status: goal.status === "active" ? "paused" : "active" })}
        >
          {goal.status === "active" ? "توقف" : "ادامه"}
        </Button>
        {goal.status !== "completed" && (
          <Button small busy={busy} onPress={() => void update({ status: "completed" })}>
            تکمیل هدف
          </Button>
        )}
        <Button small primary busy={busy} onPress={() => void plan()}>
          برنامه‌ریزی گام‌های بعدی
        </Button>
      </View>
      {data?.tasks
        .filter((task) => task.goalId === goal.id)
        .map((task) => (
          <TaskCard key={task.id} task={task} compact onOpen={onOpenTask} />
        ))}
    </Card>
  );
}
function MonitorForm({ onDone }: { onDone: () => void }) {
  const { workspace } = useWorkspace();
  const { mutate } = useAgentWorkspace();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [condition, setCondition] = useState<Monitor["condition"]>("change");
  const [value, setValue] = useState("");
  const [interval, setInterval] = useState(faNumber(15));
  const [sample, setSample] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError("");
    try {
      const minutes = typedNumber(interval);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080)
        throw new Error(
          `بازه‌ی بررسی پذیرفته نشد. عددی بین ${faNumber(1)} تا ${faNumber(10080)} دقیقه وارد کنید.`,
        );
      let target = value;
      if (condition === "price_below") {
        const price = typedNumber(value);
        if (!Number.isFinite(price) || price <= 0)
          throw new Error("قیمت هدف پذیرفته نشد. عددی بزرگ‌تر از صفر وارد کنید.");
        target = String(price);
      }
      if (!sample && !/^https?:\/\//i.test(url.trim()))
        throw new Error("نشانی صفحه پذیرفته نشد. نشانی کامل با http یا https وارد کنید.");
      await mutate("/monitors", {
        title: title.trim(),
        url: sample ? "sample://availability" : url.trim(),
        condition,
        value: target,
        intervalMinutes: minutes,
      });
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <Field
        label="چه چیزی را زیر نظر دارید؟"
        value={title}
        onChangeText={setTitle}
        placeholder="یک میز در رستوران محبوبم"
      />
      {workspace.mode === "sample" && (
        <CheckRow
          checked={sample}
          label="امتحان با صفحه‌ی موجودی داخلی"
          onPress={() => setSample(!sample)}
        />
      )}
      {!sample && (
        <Field
          label="نشانی صفحه‌ی عمومی"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={{ writingDirection: "ltr" }}
          placeholder="https://example.com/product"
        />
      )}
      <Text style={[s.small, { marginBottom: 10 }]}>وقتی خبرتان می‌کنیم که</Text>
      <View style={[s.row, { gap: 7, flexWrap: "wrap", marginBottom: 16 }]}>
        {(["change", "contains", "price_below"] as const).map((item) => (
          <Button small primary={condition === item} key={item} onPress={() => setCondition(item)}>
            {item === "change"
              ? "صفحه تغییر کند"
              : item === "contains"
                ? "متنی ظاهر شود"
                : "قیمت پایین‌تر از"}
          </Button>
        ))}
      </View>
      {condition !== "change" && (
        <Field
          label={condition === "contains" ? "متن مورد جست‌وجو" : "قیمت هدف (به واحد پول همان صفحه)"}
          value={value}
          onChangeText={setValue}
          keyboardType={condition === "price_below" ? "decimal-pad" : "default"}
        />
      )}
      <Field
        label="بررسی هر (دقیقه)"
        value={interval}
        onChangeText={setInterval}
        keyboardType="number-pad"
      />
      <Text style={[s.small, { marginBottom: 14 }]}>
        {sample
          ? "تغییرات این صفحه‌ی داخلی در فضای کاری شما می‌ماند."
          : `${BRAND.nameFa} این صفحه‌ی عمومی را روی سرور بررسی می‌کند و تغییرات مهم را در «اعلان‌ها» ذخیره می‌کند.`}
      </Text>
      <ErrorNotice error={error} />
      <Button
        primary
        busy={busy}
        disabled={
          !title.trim() || (!sample && !url.trim()) || (condition !== "change" && !value.trim())
        }
        onPress={() => void save()}
      >
        شروع پیگیری
      </Button>
    </Card>
  );
}
function MonitorCard({ monitor, onOpenTask }: { monitor: Monitor; onOpenTask?: () => void }) {
  const { mutate } = useAgentWorkspace();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function act(action: string) {
    setBusy(true);
    setError("");
    try {
      await mutate(`/monitors/${monitor.id}/control`, { action });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function changeSample() {
    setBusy(true);
    setError("");
    try {
      await mutate("/sample-page", {
        text: `موجودی: یک میز خالی است. به‌روزرسانی ${faDateTime(new Date())}`,
      });
      await mutate(`/monitors/${monitor.id}/control`, { action: "check" });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card style={{ gap: 13 }}>
      <View style={s.between}>
        <Text style={[s.heading, { flex: 1 }]}>{monitor.title}</Text>
        <Chip tint={colors.sky}>{statusLabel(monitor.status)}</Chip>
      </View>
      {monitor.url.startsWith("sample:") ? (
        <Text style={s.small}>صفحه‌ی موجودی داخلی</Text>
      ) : (
        <Text selectable style={[s.small, { writingDirection: "ltr" }]}>
          {monitor.url}
        </Text>
      )}
      <Text style={s.text}>
        {monitor.condition === "change"
          ? "زیر نظر گرفتن تغییر صفحه"
          : monitor.condition === "contains"
            ? `زیر نظر گرفتن «${monitor.value}»`
            : `قیمت کمتر از ${
                Number.isFinite(Number(monitor.value))
                  ? faNumber(Number(monitor.value))
                  : faDigits(monitor.value ?? "")
              }`}
      </Text>
      <Text style={s.small}>
        هر {faNumber(monitor.intervalMinutes)} دقیقه · {faNumber(monitor.checks)} بررسی
      </Text>
      <Text style={s.small}>
        آخرین بررسی: {stamp(monitor.lastCheckedAt)}
        {monitor.status === "active" ? `\nبررسی بعدی: ${stamp(monitor.nextCheckAt, "به‌زودی")}` : ""}
      </Text>
      {monitor.lastValue && (
        <Text selectable numberOfLines={5} style={s.muted}>
          {monitor.lastValue}
        </Text>
      )}
      <ErrorNotice error={error || monitor.error} />
      {monitor.status !== "stopped" && (
        <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
          <Button
            small
            busy={busy}
            onPress={() => void act(monitor.status === "active" ? "pause" : "resume")}
          >
            {monitor.status === "active" ? "توقف" : "ادامه"}
          </Button>
          <Button small busy={busy} onPress={() => void act("check")}>
            بررسی اکنون
          </Button>
          <Button small danger busy={busy} onPress={() => void act("stop")}>
            پایان پیگیری
          </Button>
        </View>
      )}
      {monitor.url.startsWith("sample:") && monitor.status !== "stopped" && (
        <Button small busy={busy} onPress={() => void changeSample()}>
          تغییر موجودی
        </Button>
      )}
      <TaskLink taskId={monitor.taskId} onOpen={onOpenTask} />
    </Card>
  );
}
export function NotificationsSheet() {
  const { data, mutate } = useAgentWorkspace();
  const { close, open } = useWorkspace();
  const [error, setError] = useState("");
  async function read(id: string, taskId?: string) {
    try {
      await mutate(`/notifications/${id}/read`, {});
      if (taskId) open({ type: "task", taskId });
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <Sheet title="اعلان‌ها" subtitle="نتایج و تصمیم‌هایی که به توجه شما نیاز دارند." onClose={close}>
      <View style={{ gap: 14 }}>
        <ErrorNotice error={error} />
        {data?.notifications.map((item) => (
          <Card
            key={item.id}
            style={{ gap: 8, backgroundColor: item.read ? colors.card : colors.sky }}
          >
            <View style={s.between}>
              <Text style={s.heading}>{item.title}</Text>
              {!item.read && <Chip>تازه</Chip>}
            </View>
            <Text style={s.muted}>{item.body}</Text>
            <Text style={s.small}>{stamp(item.createdAt)}</Text>
            <Button small onPress={() => void read(item.id, item.taskId)}>
              {item.taskId
                ? "مشاهده کار"
                : item.read
                  ? "خوانده‌شده"
                  : "علامت‌گذاری به‌عنوان خوانده‌شده"}
            </Button>
          </Card>
        ))}
        {!data?.notifications.length && (
          <Empty
            icon={Bell}
            title="اعلان تازه‌ای ندارید"
            detail="نتیجه‌ی کارها، تغییرات مهم پیگیری‌ها و پرسش‌هایی که به پاسخ شما نیاز دارند اینجا نمایش داده می‌شوند. برای شروع، در گفت‌وگو کاری بسپارید."
          />
        )}
      </View>
    </Sheet>
  );
}
export function AppsScreen() {
  const { navigate, open } = useWorkspace();
  const { data, mutate } = useAgentWorkspace();
  const [query, setQuery] = useState("");
  const [settings, setSettings] = useState(false);
  const [name, setName] = useState(data?.identity.name || BRAND.nameFa);
  const [tone, setTone] = useState(data?.identity.tone || "warm");
  const [avatar, setAvatar] = useState(data?.identity.avatar || "sky");
  const [showChatUpdates, setShowChatUpdates] = useState(data?.identity.showChatUpdates !== false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data?.identity) {
      setName(data.identity.name);
      setTone(data.identity.tone);
      setAvatar(data.identity.avatar || "sky");
      setShowChatUpdates(data.identity.showChatUpdates !== false);
    }
  }, [
    data?.identity.name,
    data?.identity.tone,
    data?.identity.avatar,
    data?.identity.showChatUpdates,
  ]);
  async function save(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      await mutate(path, body);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const shortcuts = [
    {
      section: "mail" as const,
      title: "ایمیل",
      detail: "خواندن پیام‌ها و آماده کردن پاسخ",
      icon: Mail,
    },
    {
      section: "calendar" as const,
      title: "تقویم",
      detail: "رویدادها و دعوت‌نامه‌های بازبینی‌شده",
      icon: CalendarDays,
    },
    {
      section: "browser" as const,
      title: "رایانه‌ی دستیار",
      detail: "نشست‌های ماندگار مرورگر",
      icon: Globe2,
    },
    {
      section: "files" as const,
      title: "فایل‌ها",
      detail: "PDFها، فرم‌ها و نسخه‌های پرشده",
      icon: FileText,
    },
  ];
  return (
    <View style={{ gap: 22 }}>
      <AgentStatus />
      <Field
        label="جست‌وجوی برنامه‌ها"
        value={query}
        onChangeText={setQuery}
        placeholder="جست‌وجوی اتصال‌دهنده‌ها"
      />
      <ConnectionsScreen query={query} />
      <Text style={s.heading}>روی رایانه‌ی شما</Text>
      <Card style={{ paddingVertical: 3, backgroundColor: colors.subtle }}>
        {shortcuts
          .filter((item) =>
            `${item.title} ${item.detail}`.toLowerCase().includes(query.toLowerCase()),
          )
          .map((item) => (
            <LinkRow
              key={item.section}
              icon={item.icon}
              title={item.title}
              detail={item.detail}
              onPress={() =>
                item.section === "browser" ? open({ type: "computer" }) : navigate(item.section)
              }
            />
          ))}
      </Card>
      <Card style={{ paddingVertical: 3, backgroundColor: colors.subtle }}>
        <LinkRow
          icon={Brain}
          title="حافظه"
          detail="دستورهای سفارشی و نکته‌هایی که دستیار به خاطر می‌سپارد"
          onPress={() => open({ type: "memory" })}
        />
      </Card>
      <Button onPress={() => setSettings(!settings)}>
        {settings ? "بستن تنظیمات دستیار" : "تنظیم شخصیت دستیار"}
      </Button>
      {settings && (
        <>
          <Card style={{ gap: 10 }}>
            <SectionHeading title="دستیار شما" />
            <View style={[s.row, { gap: 16, justifyContent: "center", marginBottom: 12 }]}>
              {(["sky", "sand", "lilac"] as const).map((item) => (
                <Pressable
                  key={item}
                  accessibilityRole="radio"
                  accessibilityLabel={`آواتار ${statusLabel(item)}`}
                  accessibilityState={{ checked: avatar === item }}
                  onPress={() => setAvatar(item)}
                  style={{
                    padding: 7,
                    borderRadius: 24,
                    backgroundColor: avatar === item ? colors.sky : colors.canvas,
                  }}
                >
                  <Mascot size={62} variant={item} />
                </Pressable>
              ))}
            </View>
            <Field label="نام" value={name} onChangeText={setName} />
            <View style={[s.row, { gap: 8 }]}>
              {(["warm", "concise", "thoughtful"] as const).map((item) => (
                <Button key={item} small primary={tone === item} onPress={() => setTone(item)}>
                  {statusLabel(item)}
                </Button>
              ))}
            </View>
            <CheckRow
              label="نمایش به‌روزرسانی‌های پس‌زمینه در گفت‌وگو"
              checked={showChatUpdates}
              onPress={() => setShowChatUpdates(!showChatUpdates)}
            />
            <Text style={s.small}>
              فعالیت و اعلان‌ها همیشه سابقه‌ی کامل را نگه می‌دارند، از جمله درخواست‌های تأیید.
            </Text>
            <Button
              busy={busy}
              disabled={!name.trim()}
              onPress={() =>
                void save("/identity", { name: name.trim(), tone, avatar, showChatUpdates })
              }
            >
              ذخیره‌ی ترجیحات
            </Button>
          </Card>
        </>
      )}
      <ErrorNotice error={error} />
    </View>
  );
}
