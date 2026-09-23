import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import {
  CalendarDays,
  Check,
  Clock3,
  Download,
  Edit3,
  ExternalLink,
  FileText,
  Globe2,
  Mail as MailIcon,
  Reply,
  RotateCw,
  Save,
  Send,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Linking, Platform, Text, View } from "react-native";
import {
  type ActionProposal,
  type Artifact,
  type BrowserSession,
  type CalendarEvent,
  type EmailDraft,
  type EventDraft,
  emailDraftSchema,
  eventDraftSchema,
  type Mail,
  type ProposalInput,
} from "../../../packages/domain/src";
import { BRAND } from "../../../packages/domain/src/brand";
import { DelegateSheet, NotificationsSheet, TaskDetail } from "./agent-ui";
import BrowserConsole from "./BrowserConsole";
import { browserAddress, browserSite } from "./browser-address";
import { ComputerSheet } from "./computer";
import DateTimeEditor from "./DateTimeEditor";
import { localDateTime, zonedInstant } from "./date-time";
import { fileExtent, isPdf } from "./file-kind";
import { faDate, faDateTime, faNumber, LOCALE, toLatinDigits } from "./locale";
import PdfReader from "./PdfReader";
import {
  Button,
  Card,
  CheckRow,
  Chip,
  colors,
  dateLabel,
  Empty,
  ErrorNotice,
  Field,
  LinkRow,
  resultSummary,
  SectionHeading,
  Sheet,
  s,
  timeLabel,
} from "./ui";
import { type Detail, useWorkspace } from "./workspace";

const actionStatusLabels: Record<ActionProposal["status"], string> = {
  awaiting_review: "در انتظار بررسی",
  executing: "در حال اجرا",
  succeeded: "انجام شد",
  failed: "ناموفق",
  outcome_unknown: "نتیجه نامشخص",
  denied: "رد شد",
  cancelled: "لغو شد",
  expired: "منقضی شد",
};
const actionKindLabels: Record<ActionProposal["kind"], string> = {
  "email.send": "ایمیل · ارسال",
  "calendar.create": "تقویم · ایجاد",
  "calendar.update": "تقویم · ویرایش",
  "calendar.delete": "تقویم · حذف",
};
const browserStatusLabels: Record<BrowserSession["status"], string> = {
  idle: "آماده",
  active: "فعال",
  closed: "بسته",
  error: "خطا",
};
/** Splits address lists on Latin and Persian separators. */
const ADDRESS_SEPARATORS = /[,،;؛\n]/;
const FIELD_LABELS: Record<string, string> = {
  to: "گیرنده",
  cc: "رونوشت",
  bcc: "رونوشت پنهان",
  subject: "موضوع",
  body: "متن پیام",
  title: "عنوان رویداد",
  start: "شروع",
  end: "پایان",
  timeZone: "منطقهٔ زمانی",
  location: "مکان",
  description: "یادداشت‌ها",
  attendees: "شرکت‌کنندگان",
};
/** Persian validation messages; keeps schema messages that are already Persian. */
function issuesText(
  issues: readonly { path: readonly PropertyKey[]; message: string; code: string }[],
) {
  return issues
    .map((issue) => {
      const label = FIELD_LABELS[String(issue.path[0])] ?? "یکی از فیلدها";
      if (/[\u0600-\u06FF]/.test(issue.message)) return `${label}: ${issue.message}.`;
      if (issue.code === "invalid_format")
        return `${label}: نشانی ایمیل معتبر نیست. آن را بررسی کنید.`;
      if (issue.code === "too_small") return `${label} را وارد کنید.`;
      if (issue.code === "too_big") return `${label} بیش از حد مجاز است. آن را کوتاه‌تر کنید.`;
      return `${label} معتبر نیست. آن را بررسی کنید.`;
    })
    .join("\n");
}
/** Jalali date of an all-day value (YYYY-MM-DD); `shift` moves it by whole days. */
function allDayLabel(value: string, shift = 0) {
  const date = new Date(`${toLatinDigits(value).slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return value;
  date.setUTCDate(date.getUTCDate() + shift);
  return faDate(date, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}
/** Jalali date and 24-hour time in the event's own time zone. */
function zonedLabel(value: string, timeZone: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  try {
    const time = new Intl.DateTimeFormat(LOCALE, {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone,
    }).format(date);
    return `${faDate(date, { year: "numeric", month: "long", day: "numeric", timeZone })}، ساعت ${time}`;
  } catch {
    return faDateTime(date);
  }
}
function kilobytes(size: number) {
  return `${faNumber(Math.max(1, Math.round(size / 1024)))} کیلوبایت`;
}
export function Details({ detail }: { detail: Detail }) {
  const { close, navigate } = useWorkspace();
  if (detail.type === "computer") return <ComputerSheet />;
  if (detail.type === "task") return <TaskDetail taskId={detail.taskId} />;
  if (detail.type === "delegate") return <DelegateSheet />;
  if (detail.type === "notifications") return <NotificationsSheet />;
  if (detail.type === "mail") return <MailDetail mail={detail.mail} />;
  if (detail.type === "email") return <EmailEditor draft={detail.draft} />;
  if (detail.type === "event")
    return <EventEditor event={detail.event} draft={detail.draft} neighbors={detail.neighbors} />;
  if (detail.type === "file") return <FileDetail file={detail.file} />;
  if (detail.type === "review") return <ReviewDetail initial={detail.action} />;
  if (detail.type === "browser") return <BrowserDetail initial={detail.browser} />;
  return (
    <Sheet title="فضای کار شما" subtitle="جایی کوچک برای همه‌چیز." onClose={close}>
      {[
        { section: "mail" as const, title: "ایمیل", icon: MailIcon },
        { section: "calendar" as const, title: "تقویم", icon: CalendarDays },
        { section: "browser" as const, title: "مرورگر", icon: Globe2 },
        { section: "files" as const, title: "فایل‌ها", icon: FileText },
        { section: "activity" as const, title: "فعالیت‌ها", icon: Clock3 },
        { section: "connections" as const, title: "اتصال‌ها", icon: ShieldCheck },
      ].map((item) => (
        <LinkRow
          key={item.section}
          title={item.title}
          icon={item.icon}
          onPress={() => {
            navigate(item.section);
            close();
          }}
        />
      ))}
    </Sheet>
  );
}
function MailDetail({ mail: m }: { mail: Mail }) {
  const { workspace: w, api, refresh, open, close } = useWorkspace();
  const [error, setError] = useState("");
  const [importing, setImporting] = useState("");
  async function importAttachment(reference: string) {
    setError("");
    setImporting(reference);
    try {
      const file = await api.request<Artifact>("/api/mail/import-attachment", { reference });
      await refresh();
      open({ type: "file", file });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting("");
    }
  }
  const [thread, setThread] = useState<Mail[]>([m]);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void api
      .request<Mail[]>(`/api/mail/threads/${encodeURIComponent(m.threadId)}`)
      .then((items) => {
        if (active) setThread(items.sort((a, b) => a.date.localeCompare(b.date)));
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, m.threadId, retry]);
  return (
    <Sheet
      title={m.subject}
      subtitle={`${faNumber(thread.length)} پیام در این گفت‌وگو`}
      onClose={close}
    >
      {loading && (
        <View style={[s.row, { gap: 10, paddingBottom: 20 }]}>
          <ActivityIndicator color={colors.blueDark} />
          <Text style={s.muted}>در حال بارگذاری گفت‌وگو…</Text>
        </View>
      )}
      {thread.map((message) => (
        <Card key={message.id} style={{ marginBottom: 16 }}>
          <View style={s.between}>
            <View style={{ gap: 4, flex: 1 }}>
              <Text style={s.heading}>{message.sender}</Text>
              <Text style={[s.small, { writingDirection: "ltr" }]}>{message.from}</Text>
              <Text style={s.small}>به: {message.to.join("، ")}</Text>
            </View>
            <Text style={s.small}>
              {dateLabel(message.date)} · {timeLabel(message.date)}
            </Text>
          </View>
          <View style={s.divider} />
          <Text selectable style={s.text}>
            {message.body}
          </Text>
          {message.attachments.map((id) => {
            const file = w.files.find((f) => f.id === id);
            return file ? (
              <LinkRow
                key={id}
                title={file.name}
                detail={`${faNumber(file.pageCount)} صفحه · پیوست PDF`}
                icon={FileText}
                onPress={() => open({ type: "file", file })}
              />
            ) : (
              <Button
                key={id}
                busy={importing === id}
                icon={FileText}
                onPress={() => void importAttachment(id)}
              >
                {decodeURIComponent(id.split(":").slice(2).join(":")) || "باز کردن پیوست"}
              </Button>
            );
          })}
        </Card>
      ))}
      <ErrorNotice error={error} />
      {error && <Button onPress={() => setRetry(retry + 1)}>بارگذاری دوباره گفت‌وگو</Button>}
      <Button
        primary
        icon={Reply}
        style={{ alignSelf: "flex-start" }}
        onPress={() =>
          open({
            type: "email",
            draft: {
              to: [m.from],
              subject: /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`,
              body: "",
              cc: [],
              bcc: [],
              attachmentIds: [],
              threadId: m.threadId,
              replyToMessageId: m.id,
            },
          })
        }
      >
        نوشتن پاسخ
      </Button>
    </Sheet>
  );
}
function EmailEditor({ draft }: { draft?: Partial<EmailDraft> & { id?: string } }) {
  const { workspace: w, api, refresh, open, close, notify } = useWorkspace();
  const [to, setTo] = useState(draft?.to?.join(", ") || "");
  const [cc, setCc] = useState(draft?.cc?.join(", ") || "");
  const [bcc, setBcc] = useState(draft?.bcc?.join(", ") || "");
  const [subject, setSubject] = useState(draft?.subject || "");
  const [body, setBody] = useState(draft?.body || "");
  const [attachments, setAttachments] = useState(draft?.attachmentIds || []);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  function emails(value: string) {
    return value
      .split(ADDRESS_SEPARATORS)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  async function save(review: boolean) {
    setBusy(review ? "review" : "draft");
    setError("");
    try {
      const parsed = emailDraftSchema.safeParse({
        to: emails(to),
        cc: emails(cc),
        bcc: emails(bcc),
        subject,
        body,
        attachmentIds: attachments,
        threadId: draft?.threadId,
        replyToMessageId: draft?.replyToMessageId,
      });
      if (!parsed.success) throw new Error(issuesText(parsed.error.issues));
      if (review) {
        const action = await api.request<ActionProposal>("/api/actions", {
          kind: "email.send",
          data: parsed.data,
        });
        await refresh();
        open({ type: "review", action });
      } else {
        await api.request("/api/drafts", {
          ...parsed.data,
          ...(draft?.id ? { id: draft.id } : {}),
        });
        await refresh();
        notify(`پیش‌نویس در ${BRAND.nameFa} ذخیره شد.`);
        close();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <Sheet
      title={draft?.threadId ? "نوشتن پاسخ" : "پیام تازه"}
      subtitle={`از ${w.profile.email} · به‌صورت خصوصی در ${BRAND.nameFa} ذخیره می‌شود`}
      onClose={close}
    >
      <Field
        label="گیرنده"
        value={to}
        onChangeText={setTo}
        placeholder="person@example.com"
        autoCapitalize="none"
        keyboardType="email-address"
        style={{ writingDirection: "ltr" }}
      />
      <View style={{ flexDirection: "row", gap: 16 }}>
        <View style={{ flex: 1 }}>
          <Field
            label="رونوشت"
            value={cc}
            onChangeText={setCc}
            placeholder="اختیاری"
            autoCapitalize="none"
            keyboardType="email-address"
            style={{ writingDirection: "ltr" }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="رونوشت پنهان"
            value={bcc}
            onChangeText={setBcc}
            placeholder="اختیاری"
            autoCapitalize="none"
            keyboardType="email-address"
            style={{ writingDirection: "ltr" }}
          />
        </View>
      </View>
      <Field
        label="موضوع"
        value={subject}
        onChangeText={setSubject}
        placeholder="موضوع پیام چیست؟"
      />
      <Field
        label="متن پیام"
        value={body}
        onChangeText={setBody}
        multiline
        placeholder="پیامتان را بنویسید…"
        style={{ minHeight: 210 }}
      />
      {w.files.length > 0 && (
        <Card style={{ padding: 16, marginBottom: 18 }}>
          <Text style={[s.heading, { fontSize: 13, marginBottom: 5 }]}>پیوست‌ها</Text>
          {w.files.map((f) => (
            <CheckRow
              key={f.id}
              checked={attachments.includes(f.id)}
              label={`${f.name} · ${kilobytes(f.size)}`}
              onPress={() =>
                setAttachments(
                  attachments.includes(f.id)
                    ? attachments.filter((id) => id !== f.id)
                    : [...attachments, f.id],
                )
              }
            />
          ))}
        </Card>
      )}
      <ErrorNotice error={error} />
      <View style={[s.row, { gap: 10, flexWrap: "wrap" }]}>
        <Button
          primary
          icon={ShieldCheck}
          busy={busy === "review"}
          disabled={!!busy}
          onPress={() => void save(true)}
        >
          بررسی ایمیل
        </Button>
        <Button
          icon={Save}
          busy={busy === "draft"}
          disabled={!!busy}
          onPress={() => void save(false)}
        >
          ذخیرهٔ پیش‌نویس
        </Button>
      </View>
      <Text style={[s.small, { marginTop: 13 }]}>
        پیش از ارسال، گیرندگان، متن پیام و پیوست‌ها را یک بار دیگر بررسی می‌کنید.
      </Text>
    </Sheet>
  );
}
function EventEditor({
  event: e,
  draft,
  neighbors,
}: {
  event?: CalendarEvent;
  draft?: EventDraft;
  neighbors?: CalendarEvent[];
}) {
  const seed = e || draft;
  const { workspace: w, api, open, close, refresh } = useWorkspace();
  const initialStart = new Date();
  initialStart.setMinutes(0, 0, 0);
  initialStart.setHours(initialStart.getHours() + 1);
  const [title, setTitle] = useState(seed?.title || "");
  const [start, setStart] = useState(seed?.start || initialStart.toISOString());
  const [end, setEnd] = useState(
    seed?.end || new Date(initialStart.getTime() + 3600000).toISOString(),
  );
  const [allDay, setAllDay] = useState(seed?.allDay || false);
  const [zone, setZone] = useState(
    seed?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [location, setLocation] = useState(seed?.location || "");
  const [description, setDescription] = useState(seed?.description || "");
  const [attendees, setAttendees] = useState(seed?.attendees.join(", ") || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const conflicts = (neighbors || w.events).filter(
    (item) =>
      item.id !== e?.id &&
      Date.parse(start) < Date.parse(item.end) &&
      Date.parse(end) > Date.parse(item.start),
  );
  async function propose(remove = false) {
    setBusy(true);
    setError("");
    try {
      let data: ProposalInput;
      if (remove && e) {
        data = {
          kind: "calendar.delete",
          data: { eventId: e.id, calendarId: e.calendarId, title: e.title },
        };
      } else {
        const parsed = eventDraftSchema.safeParse({
          calendarId: e?.calendarId || draft?.calendarId || "primary",
          title,
          start,
          end,
          allDay,
          timeZone: zone,
          location,
          description,
          attendees: attendees
            .split(ADDRESS_SEPARATORS)
            .map((a) => a.trim())
            .filter(Boolean),
        });
        if (!parsed.success) throw new Error(issuesText(parsed.error.issues));
        data = e
          ? { kind: "calendar.update", data: { ...parsed.data, eventId: e.id } }
          : { kind: "calendar.create", data: parsed.data };
      }
      const action = await api.request<ActionProposal>("/api/actions", data);
      await refresh();
      open({ type: "review", action });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title={e ? "ویرایش رویداد" : "رویداد تازه"}
      subtitle={
        e ? "این رویداد را ویرایش کنید و سپس تغییرات را بررسی کنید." : "رویدادی در تقویمتان بسازید."
      }
      onClose={close}
    >
      <Field
        label="عنوان رویداد"
        value={title}
        onChangeText={setTitle}
        placeholder="برای چه چیزی وقت می‌گذارید؟"
      />
      <CheckRow
        label="رویداد تمام‌روز"
        checked={allDay}
        onPress={() => {
          try {
            if (!allDay) {
              const local = localDateTime(start, zone);
              const endDay = new Date(`${local.date}T12:00:00Z`);
              endDay.setUTCDate(endDay.getUTCDate() + 1);
              setStart(local.date);
              setEnd(endDay.toISOString().slice(0, 10));
            } else {
              setStart(zonedInstant(start, "09:00", zone));
              setEnd(zonedInstant(start, "10:00", zone));
            }
            setAllDay(!allDay);
            setError("");
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        }}
      />
      <DateTimeEditor
        label="شروع"
        value={start}
        onChange={setStart}
        timeZone={zone}
        allDay={allDay}
      />
      <DateTimeEditor label="پایان" value={end} onChange={setEnd} timeZone={zone} allDay={allDay} />
      {allDay && (
        <Text style={[s.small, { marginBottom: 15 }]}>
          تاریخ پایان، روزِ بعد از آخرین روز رویداد است.
        </Text>
      )}
      <Field
        label="منطقهٔ زمانی"
        value={zone}
        onChangeText={setZone}
        placeholder="Asia/Tehran"
        autoCapitalize="none"
        autoCorrect={false}
        style={{ writingDirection: "ltr" }}
      />
      <Field
        label="مکان یا پیوند جلسه"
        value={location}
        onChangeText={setLocation}
        placeholder="اختیاری"
      />
      <Field
        label="شرکت‌کنندگان"
        value={attendees}
        onChangeText={setAttendees}
        placeholder="نشانی‌های ایمیل، جداشده با ویرگول"
        autoCapitalize="none"
        keyboardType="email-address"
        style={{ writingDirection: "ltr" }}
      />
      <Field
        label="یادداشت‌ها"
        value={description}
        onChangeText={setDescription}
        multiline
        placeholder="نکتهٔ دیگری هست که باید در نظر داشت؟"
      />
      {!!conflicts.length && (
        <Card style={{ backgroundColor: colors.orange, padding: 16, marginBottom: 16 }}>
          <Text style={s.heading}>این زمان با رویدادهای دیگر هم‌پوشانی دارد</Text>
          {conflicts.map((c) => (
            <Text key={c.id} style={s.muted}>
              {c.title} · {timeLabel(c.start, c.timeZone)} تا {timeLabel(c.end, c.timeZone)}
            </Text>
          ))}
        </Card>
      )}
      <ErrorNotice error={error} />
      <View style={[s.row, { gap: 10, flexWrap: "wrap" }]}>
        <Button primary icon={ShieldCheck} busy={busy} onPress={() => void propose()}>
          {e ? "بررسی تغییرات" : "بررسی رویداد"}
        </Button>
        {e && (
          <Button icon={Trash2} disabled={busy} danger onPress={() => void propose(true)}>
            بررسی حذف رویداد
          </Button>
        )}
      </View>
    </Sheet>
  );
}
function ReviewDetail({ initial }: { initial: ActionProposal }) {
  const { workspace: w, api, refresh, close, open } = useWorkspace();
  const [local, setLocal] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const action =
    local.status !== initial.status ? local : w.actions.find((a) => a.id === initial.id) || local;
  const d = action.data;
  const pending = action.status === "awaiting_review";
  async function decide(decision: "approve" | "deny") {
    setBusy(true);
    setError("");
    try {
      const result = await api.request<ActionProposal>(`/api/actions/${action.id}/decide`, {
        decision,
        hash: action.hash,
      });
      setLocal(result);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function edit() {
    setBusy(true);
    setError("");
    try {
      let next: Detail;
      if (action.kind === "email.send")
        next = { type: "email", draft: emailDraftSchema.parse(action.data) };
      else {
        const draft = eventDraftSchema.parse(action.data);
        if (action.kind === "calendar.update") {
          const eventId = action.data.eventId;
          if (typeof eventId !== "string" || !eventId)
            throw new Error("شناسهٔ رویداد پیدا نشد. رویداد را دوباره از تقویم باز کنید.");
          next = { type: "event", event: { ...draft, id: eventId } };
        } else next = { type: "event", draft };
      }
      await api.request(`/api/actions/${action.id}/decide`, {
        decision: "deny",
        hash: action.hash,
      });
      await refresh();
      open(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const email = action.kind === "email.send";
  return (
    <Sheet
      title={pending ? "یک نگاه آخر" : action.title}
      subtitle={
        w.mode === "sample"
          ? "این اقدام فقط در فضای کاری محلی شما می‌ماند."
          : "پیش از آنکه این اقدام حساب متصل شما را تغییر دهد، دقیقاً بررسی‌اش کنید."
      }
      onClose={close}
    >
      <View style={[s.row, { gap: 13, marginBottom: 21 }]}>
        <View style={[s.iconBox, { backgroundColor: colors.lavender }]}>
          <ShieldCheck size={22} color={colors.text} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={s.heading}>{action.title}</Text>
          <Text style={s.small}>{actionKindLabels[action.kind] ?? action.kind}</Text>
        </View>
        <Chip tint={pending ? colors.lavender : colors.green}>
          {actionStatusLabels[action.status] ?? action.status.replace(/_/g, " ")}
        </Chip>
      </View>
      <Card style={{ gap: 13 }}>
        <ReviewLine label="حساب" value={action.account || w.profile.email} />
        {email ? (
          <>
            <ReviewLine label="گیرنده" value={arrayText(d.to)} />
            <ReviewLine label="رونوشت" value={arrayText(d.cc) || "ندارد"} />
            <ReviewLine label="رونوشت پنهان" value={arrayText(d.bcc) || "ندارد"} />
            <ReviewLine label="موضوع" value={String(d.subject || "")} />
            <View style={s.divider} />
            <Text selectable style={s.text}>
              {String(d.body || "")}
            </Text>
            <View style={s.divider} />
            <Text style={s.label}>پیوست‌ها</Text>
            {Array.isArray(d.attachmentIds) && d.attachmentIds.length ? (
              d.attachmentIds.map((id) => {
                const file = w.files.find((f) => f.id === id);
                return (
                  <Text key={String(id)} style={s.text}>
                    {file?.name || String(id)} · نسخهٔ {String(id).slice(-8)}
                  </Text>
                );
              })
            ) : (
              <Text style={s.muted}>بدون پیوست</Text>
            )}
          </>
        ) : (
          <>
            <ReviewLine label="رویداد" value={String(d.title || "")} />
            {action.kind !== "calendar.delete" && (
              <>
                <ReviewLine
                  label="شروع"
                  value={
                    d.allDay
                      ? allDayLabel(String(d.start || ""))
                      : zonedLabel(String(d.start || ""), String(d.timeZone || "UTC"))
                  }
                />
                <ReviewLine
                  label="پایان"
                  value={
                    d.allDay
                      ? `${allDayLabel(String(d.end || ""), -1)} (تا پایان روز)`
                      : zonedLabel(String(d.end || ""), String(d.timeZone || "UTC"))
                  }
                />
                <ReviewLine label="منطقهٔ زمانی" value={String(d.timeZone || "")} ltr />
                <ReviewLine label="زمان‌بندی" value={d.allDay ? "تمام‌روز" : "ساعت مشخص"} />
                <ReviewLine label="مکان" value={String(d.location || "ندارد")} />
                <ReviewLine label="شرکت‌کنندگان" value={arrayText(d.attendees) || "فقط خودتان"} />
                <ReviewLine label="یادداشت‌ها" value={String(d.description || "ندارد")} />
              </>
            )}
            <ReviewLine
              label="تقویم"
              value={!d.calendarId || d.calendarId === "primary" ? "اصلی" : String(d.calendarId)}
            />
            <Text style={s.small}>
              {action.kind === "calendar.delete"
                ? "این کار رویداد را حذف می‌کند و ممکن است به شرکت‌کنندگان اطلاع داده شود."
                : "ممکن است شرکت‌کنندگان از تقویم متصل شما دعوت‌نامه یا به‌روزرسانی دریافت کنند."}
            </Text>
          </>
        )}
      </Card>
      <ErrorNotice error={error || action.error} />
      {action.result && (
        <Card style={{ marginTop: 16, backgroundColor: colors.green, padding: 18 }}>
          <Text selectable style={s.text}>
            {resultSummary(action.result)}
          </Text>
        </Card>
      )}
      {pending ? (
        <>
          <Text style={[s.small, { marginVertical: 17 }]}>
            {`مهلت بررسی تا ${faDateTime(action.expiresAt)} است. تأیید شما فقط برای جزئیات بالا اعمال می‌شود.`}
          </Text>
          <View style={[s.row, { gap: 10, flexWrap: "wrap" }]}>
            <Button primary icon={Check} busy={busy} onPress={() => void decide("approve")}>
              {w.mode === "sample" ? "تأیید محلی" : email ? "تأیید و ارسال" : "تأیید تغییر"}
            </Button>
            {action.kind !== "calendar.delete" && (
              <Button icon={Edit3} disabled={busy} onPress={() => void edit()}>
                ویرایش جزئیات
              </Button>
            )}
            <Button icon={X} disabled={busy} onPress={() => void decide("deny")}>
              رد کردن
            </Button>
          </View>
        </>
      ) : (
        <Button style={{ alignSelf: "flex-start", marginTop: 19 }} onPress={close}>
          تمام
        </Button>
      )}
    </Sheet>
  );
}
function arrayText(value: unknown) {
  return Array.isArray(value) ? value.map(String).join("، ") : "";
}
function ReviewLine({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.label}>{label}</Text>
      <Text selectable style={[s.text, ltr && { writingDirection: "ltr" }]}>
        {value}
      </Text>
    </View>
  );
}
function FileDetail({ file: f }: { file: Artifact }) {
  const { api, refresh, open, close } = useWorkspace();
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(
      (f.fields || [])
        .filter((field) => field.type !== "unsupported")
        .map((field) => [
          field.name,
          field.type === "checkbox" ? field.value === "true" || field.value === "Yes" : field.value,
        ]),
    ),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const url = api.url(f.url || `/api/files/${f.id}/content`);
  const pdf = isPdf(f);
  const [preview, setPreview] = useState<{ text: string; more: boolean } | null>(null);
  useEffect(() => {
    if (pdf) return;
    let active = true;
    api
      .request<{ text: string; more: boolean }>(`/api/files/${f.id}/text`)
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [api, f.id, pdf]);
  async function fill() {
    setBusy(true);
    setError("");
    try {
      const file = await api.request<Artifact>(`/api/files/${f.id}/fill`, { fields: values });
      await refresh();
      open({ type: "file", file });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function share() {
    setError("");
    try {
      if (Platform.OS === "web") {
        await Linking.openURL(url);
        return;
      }
      const extension = (f.name.includes(".") && f.name.split(".").at(-1)?.toLowerCase()) || "pdf";
      const target = `${FileSystem.cacheDirectory}${f.id}.${extension}`;
      await FileSystem.downloadAsync(url, target, {
        headers: { Authorization: `Bearer ${api.token}` },
      });
      if (await Sharing.isAvailableAsync())
        await Sharing.shareAsync(target, {
          mimeType: f.mimeType || "application/pdf",
          ...(pdf ? { UTI: "com.adobe.pdf" } : {}),
        });
      else
        throw new Error(
          `اشتراک‌گذاری در این دستگاه پشتیبانی نمی‌شود. فایل را از نسخهٔ وب ${BRAND.nameFa} دانلود کنید.`,
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <Sheet
      title={f.name}
      subtitle={`${fileExtent(f)} · ${kilobytes(f.size)} · ${f.source}`}
      onClose={close}
      wide
    >
      {pdf ? (
        <PdfReader url={url} token={api.token} pageCount={f.pageCount} />
      ) : (
        <Card>
          <SectionHeading title="متن سند" />
          {preview ? (
            <>
              <Text selectable style={s.text}>
                {preview.text || "متنی در این سند پیدا نشد."}
              </Text>
              {preview.more && (
                <Text style={[s.muted, { marginTop: 12 }]}>
                  فقط بخش نخست سند نمایش داده می‌شود. برای خواندن همهٔ آن، فایل را دانلود کنید.
                </Text>
              )}
            </>
          ) : (
            !error && <ActivityIndicator />
          )}
        </Card>
      )}
      <View style={[s.row, { gap: 10, marginVertical: 18, flexWrap: "wrap" }]}>
        <Button icon={Download} onPress={() => void share()}>
          {Platform.OS === "web" ? "دانلود فایل" : "اشتراک‌گذاری فایل"}
        </Button>
        <Button
          icon={Send}
          onPress={() => open({ type: "email", draft: { attachmentIds: [f.id] } })}
        >
          پیوست به ایمیل
        </Button>
      </View>
      {f.fields && f.fields.length > 0 && (
        <Card>
          <SectionHeading title="پر کردن این فرم" />
          <Text style={[s.muted, { marginBottom: 18 }]}>
            اطلاعاتتان را در زیر وارد کنید. با ذخیره، نسخهٔ تازه‌ای ساخته می‌شود و نسخهٔ اصلی دست‌نخورده
            می‌ماند.
          </Text>
          {f.fields.map((field) =>
            field.type === "unsupported" ? (
              <Text key={field.name} style={s.muted}>
                {field.name} · این نوع فیلد پشتیبانی نمی‌شود
              </Text>
            ) : field.type === "checkbox" ? (
              <CheckRow
                key={field.name}
                checked={!!values[field.name]}
                label={field.name.replace(/_/g, " ").replace(/^./, (s) => s.toUpperCase())}
                onPress={() => setValues({ ...values, [field.name]: !values[field.name] })}
              />
            ) : (
              <Field
                key={field.name}
                label={field.name.replace(/_/g, " ").replace(/^./, (s) => s.toUpperCase())}
                value={String(values[field.name] || "")}
                onChangeText={(value) =>
                  setValues({ ...values, [field.name]: toLatinDigits(value) })
                }
              />
            ),
          )}
          <Button primary icon={Save} busy={busy} onPress={() => void fill()}>
            ذخیرهٔ نسخهٔ پرشده
          </Button>
        </Card>
      )}
      <ErrorNotice error={error} />
      <Text style={[s.small, { marginTop: 15 }]}>
        افزوده‌شده در {dateLabel(f.createdAt)}
        {f.parentId ? " · نسخهٔ پرشده" : ""}
      </Text>
    </Sheet>
  );
}
function BrowserDetail({ initial }: { initial: BrowserSession }) {
  const { workspace: w, api, refresh, close, notify } = useWorkspace();
  const [local, setLocal] = useState(initial);
  const [url, setUrl] = useState(initial.url);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const latest = w.browsers.find((b) => b.id === initial.id);
  const browser = {
    ...(latest && latest.updatedAt > local.updatedAt ? latest : local),
    consoleUrl: local.consoleUrl,
    previewUrl: local.previewUrl,
  };
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void api
      .request<BrowserSession>(`/api/browsers/${initial.id}`)
      .then((session) => {
        if (active) {
          setLocal(session);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [api, initial.id, retry]);
  async function importDownloads() {
    setBusy(true);
    setError("");
    try {
      const result = await api.request<{
        files: Artifact[];
        failures: { name: string; message: string }[];
      }>(`/api/browsers/${browser.id}/import-downloads`, {});
      await refresh();
      if (result.failures.length)
        setError(
          result.failures.map((failure) => `${failure.name}: ${failure.message}`).join("\n"),
        );
      const files = result.files;
      notify(
        files.length
          ? `${faNumber(files.length)} دانلود PDF به فایل‌ها افزوده شد.`
          : "دانلود PDF تازه‌ای در این نشست نیست.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function mutate(end = false) {
    if (busy || loading) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.request<BrowserSession>(
        `/api/browsers/${browser.id}/${end ? "close" : browser.status === "closed" ? "reopen" : "navigate"}`,
        end ? {} : { url: browserAddress(url) },
      );
      setLocal(result);
      setUrl(result.url);
      await refresh();
      if (end) close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title={browserSite(browser.url)}
      subtitle={`${browserStatusLabels[browser.status] ?? browser.status} · به‌روزرسانی در ساعت ${timeLabel(browser.updatedAt)}`}
      onClose={close}
      wide
    >
      <View style={[s.row, { gap: 10, marginBottom: 16 }]}>
        <View style={{ flex: 1 }}>
          <Field
            label="نشانی وب‌سایت"
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            keyboardType="url"
            style={{ writingDirection: "ltr" }}
            onSubmitEditing={() => void mutate()}
          />
        </View>
        <Button primary busy={busy} disabled={loading || !url.trim()} onPress={() => void mutate()}>
          {browser.status === "closed"
            ? "باز کردن دوباره"
            : browser.status === "error"
              ? "اتصال دوباره"
              : "باز کردن"}
        </Button>
      </View>
      <ErrorNotice error={error} />
      {loading ? (
        <View style={[s.row, { gap: 10, paddingVertical: 24 }]}>
          {error ? (
            <Button onPress={() => setRetry(retry + 1)}>تلاش دوباره</Button>
          ) : (
            <>
              <ActivityIndicator color={colors.blueDark} />
              <Text style={s.muted}>در حال اتصال به مرورگر شما…</Text>
            </>
          )}
        </View>
      ) : browser.status === "active" && browser.consoleUrl ? (
        <BrowserConsole url={api.url(browser.consoleUrl)} />
      ) : browser.status === "active" && browser.previewUrl ? (
        <Image
          source={{ uri: api.url(browser.previewUrl) }}
          style={{ width: "100%", height: 450, backgroundColor: colors.canvas }}
          resizeMode="contain"
        />
      ) : (
        <Empty
          icon={Globe2}
          title={browser.status === "closed" ? "این نشست بسته شده است" : "پیش‌نمایش در دسترس نیست"}
          detail={
            browser.status === "closed"
              ? "نمایه و دانلودهای شما ذخیره شده‌اند. برای ادامه از همان جایی که بودید، دوباره بازش کنید."
              : "برای ادامه با نمایهٔ ذخیره‌شدهٔ مرورگر، دوباره وصل شوید."
          }
        />
      )}
      <View style={[s.row, { gap: 10, marginTop: 18, flexWrap: "wrap" }]}>
        {!loading && browser.status === "active" && browser.consoleUrl && (
          <Button
            icon={ExternalLink}
            onPress={() => void Linking.openURL(api.url(browser.consoleUrl || ""))}
          >
            باز کردن مرورگر در پنجره‌ای جدا
          </Button>
        )}
        {!loading && (
          <Button icon={RotateCw} disabled={busy} onPress={() => setRetry(retry + 1)}>
            تازه‌سازی اتصال
          </Button>
        )}
        {!loading && browser.status !== "closed" && (
          <Button icon={Download} busy={busy} onPress={() => void importDownloads()}>
            وارد کردن دانلودهای PDF
          </Button>
        )}
        {!loading && browser.status !== "closed" && (
          <Button icon={X} danger busy={busy} onPress={() => void mutate(true)}>
            بستن نشست
          </Button>
        )}
      </View>
    </Sheet>
  );
}
