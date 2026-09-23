import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import {
  ArrowDownToLine,
  ArrowUpLeft,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Globe2,
  Inbox,
  Link2,
  Mail,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import type {
  Artifact,
  BrowserSession,
  CalendarEvent,
  EmailDraft,
} from "../../../packages/domain/src";
import { BRAND } from "../../../packages/domain/src/brand";
import { API_URL } from "./api";
import { localDateTime, zonedInstant } from "./date-time";
import { faDate, faDigits, faNumber, fw } from "./locale";
import {
  Button,
  Card,
  Chip,
  colors,
  dateLabel,
  Empty,
  ErrorNotice,
  IconButton,
  LinkRow,
  Mascot,
  relativeDate,
  resultSummary,
  SectionHeading,
  Sheet,
  s,
  timeLabel,
} from "./ui";
import { useWorkspace } from "./workspace";

function todayDate() {
  return localDateTime(new Date().toISOString(), Intl.DateTimeFormat().resolvedOptions().timeZone)
    .date;
}
const statusNames: Record<string, string> = {
  awaiting_review: "در انتظار بررسی",
  executing: "در حال اجرا",
  succeeded: "انجام شد",
  failed: "ناموفق",
  outcome_unknown: "نتیجه نامشخص",
  denied: "رد شد",
  cancelled: "لغو شد",
  expired: "منقضی شد",
  idle: "آماده",
  active: "فعال",
  closed: "بسته",
  error: "خطا",
};
function statusName(value: string) {
  return statusNames[value] || value.replace(/_/g, " ");
}
function eventDate(event: CalendarEvent) {
  return event.allDay ? event.start : localDateTime(event.start, event.timeZone).date;
}
export function TodayScreen() {
  const { workspace: w, navigate, open, ask } = useWorkspace();
  const wide = useWindowDimensions().width > 1180;
  const pending = w.actions.filter((a) => a.status === "awaiting_review");
  const unread = w.mail.filter((m) => m.unread);
  const today = todayDate();
  const events = w.events
    .filter((e) => eventDate(e) === today)
    .sort((a, b) => a.start.localeCompare(b.start));
  return (
    <View style={{ gap: 25 }}>
      <View
        style={[
          {
            backgroundColor: "#E8F2F8",
            borderRadius: 24,
            padding: 32,
            minHeight: 228,
            overflow: "hidden",
          },
          s.row,
        ]}
      >
        <View style={{ flex: 1, gap: 15, zIndex: 1 }}>
          <View style={[s.row, { gap: 7 }]}>
            <Sparkles size={13} color={colors.blueDark} />
            <Text style={[s.label, { color: colors.blueDark }]}>هر روز، کمی روشن‌تر</Text>
          </View>
          <Text
            style={{
              fontSize: wide ? 39 : 29,
              lineHeight: wide ? 50 : 38,
              ...fw("500"),
              color: colors.text,
            }}
          >
            روز شما، با کمی{"\n"}فضای بیشتر برای نفس‌کشیدن.
          </Text>
          <Text style={[s.muted, { maxWidth: 420, color: "#617680" }]}>
            {events.length
              ? `${faNumber(events.length)} مورد در تقویم شما`
              : "تقویم‌تان جای خالی دارد"}
            {unread.length ? `، ${faNumber(unread.length)} ایمیل خوانده‌نشده` : ""}.{"\n"}بیایید برای
            آنچه مهم است جا باز کنیم.
          </Text>
          <Button
            onPress={() => ask("در برنامه‌ریزی امروز کمکم کنید")}
            icon={Sparkles}
            primary
            style={{ alignSelf: "flex-start", marginTop: 5 }}
          >
            برنامه‌ریزی روزم
          </Button>
        </View>
        {wide && (
          <View style={{ width: 220, height: 210, alignItems: "center", justifyContent: "center" }}>
            <View
              style={{
                position: "absolute",
                width: 190,
                height: 190,
                borderRadius: 100,
                backgroundColor: "#DAEAF2",
              }}
            />
            <View
              style={{
                position: "absolute",
                width: 145,
                height: 145,
                borderRadius: 80,
                borderWidth: 1,
                borderColor: "#C8DBE6",
              }}
            />
            <Mascot size={94} />
            <View
              style={[
                s.row,
                {
                  position: "absolute",
                  top: 17,
                  start: -19,
                  padding: 11,
                  gap: 7,
                  backgroundColor: "#FFF",
                  borderRadius: 13,
                  transform: [{ rotate: "-7deg" }],
                },
              ]}
            >
              <Check size={14} color="#739174" />
              <Text style={s.small}>روزی سبک‌تر</Text>
            </View>
            <View
              style={[
                s.row,
                {
                  position: "absolute",
                  bottom: 18,
                  end: -8,
                  padding: 12,
                  gap: 8,
                  backgroundColor: "#FFF",
                  borderRadius: 13,
                  transform: [{ rotate: "5deg" }],
                },
              ]}
            >
              <CalendarDays size={17} color={colors.blueDark} />
              <Text style={s.small}>همه‌چیز، یک‌جا</Text>
            </View>
          </View>
        )}
      </View>
      <View style={{ flexDirection: "row", gap: 13, flexWrap: "wrap" }}>
        {[
          {
            label: "ایمیل‌های خوانده‌نشده",
            value: unread.length,
            note: "نگاهی تازه به صندوق ورودی",
            icon: Mail,
            section: "mail" as const,
            tint: colors.sky,
          },
          {
            label: "در تقویم",
            value: events.length,
            note: "برای اولویت‌هایتان جا باز کنید",
            icon: CalendarDays,
            section: "calendar" as const,
            tint: colors.green,
          },
          {
            label: "در انتظار شما",
            value: pending.length,
            note: "بررسی شما کارها را پیش می‌برد",
            icon: ShieldCheck,
            section: "activity" as const,
            tint: colors.lavender,
          },
        ].map((item) => (
          <Pressable
            key={item.label}
            accessibilityRole="button"
            onPress={() => navigate(item.section)}
            style={{ flex: 1, minWidth: 180 }}
          >
            <Card style={{ padding: 21, height: 126 }}>
              <View style={s.between}>
                <Text style={[s.label, { fontSize: 9 }]}>{item.label}</Text>
                <View
                  style={[
                    s.iconBox,
                    { width: 31, height: 31, borderRadius: 10, backgroundColor: item.tint },
                  ]}
                >
                  <item.icon size={15} color={colors.text} />
                </View>
              </View>
              <Text style={{ fontSize: 29, color: colors.text, marginTop: -2 }}>
                {faDigits(String(item.value).padStart(2, "0"))}
              </Text>
              <Text style={[s.small, { fontSize: 10, marginTop: 3 }]}>{item.note}</Text>
            </Card>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: wide ? "row" : "column", gap: 22 }}>
        <Card style={{ flex: 1 }}>
          <SectionHeading
            title="در تقویم شما"
            action="تقویم کامل"
            onPress={() => navigate("calendar")}
          />
          {events.length ? (
            events.slice(0, 3).map((e, i) => <AgendaRow key={e.id} event={e} index={i} />)
          ) : (
            <Empty
              icon={CalendarDays}
              title="کمی فرصت برای نفس‌کشیدن"
              detail="امروز رویدادی ندارید. از پایین همین کارت می‌توانید رویدادی اضافه کنید."
            />
          )}
          <Pressable
            onPress={() => open({ type: "event" })}
            style={[
              s.row,
              {
                gap: 8,
                paddingTop: 15,
                marginTop: 9,
                borderTopWidth: 1,
                borderTopColor: colors.line,
              },
            ]}
          >
            <Plus size={15} color={colors.muted} />
            <Text style={s.small}>برای کاری وقت بگذارید</Text>
          </Pressable>
        </Card>
        <Card style={{ flex: 1 }}>
          <SectionHeading
            title="از صندوق ورودی شما"
            action="باز کردن ایمیل"
            onPress={() => navigate("mail")}
          />
          {w.mail.length ? (
            w.mail.slice(0, 3).map((m, i) => (
              <Pressable
                key={m.id}
                onPress={() => open({ type: "mail", mail: m })}
                style={[
                  s.row,
                  {
                    gap: 12,
                    paddingVertical: 13,
                    borderTopWidth: i ? 1 : 0,
                    borderTopColor: colors.line,
                  },
                ]}
              >
                <Avatar name={m.sender} index={i} />
                <View style={{ flex: 1, gap: 3 }}>
                  <View style={s.between}>
                    <Text style={[s.text, { fontSize: 12, ...fw("600") }]}>{m.sender}</Text>
                    <Text style={[s.small, { fontSize: 10 }]}>{timeLabel(m.date)}</Text>
                  </View>
                  <Text numberOfLines={1} style={[s.text, { fontSize: 12, lineHeight: 20 }]}>
                    {m.subject}
                  </Text>
                  <Text numberOfLines={1} style={[s.small, { fontSize: 11 }]}>
                    {m.body.replace(/\n/g, " ")}
                  </Text>
                </View>
                {m.unread && (
                  <View
                    style={{ width: 5, height: 5, borderRadius: 4, backgroundColor: "#78ABD0" }}
                  />
                )}
              </Pressable>
            ))
          ) : (
            <Empty
              icon={Inbox}
              title="صندوق ورودی آرام است"
              detail="برای دیدن پیام‌هایتان در اینجا، Google را متصل کنید."
            />
          )}
        </Card>
      </View>
      <View style={{ flexDirection: wide ? "row" : "column", gap: 22 }}>
        <Card style={{ flex: 1, backgroundColor: "#F0F0E7" }}>
          <SectionHeading title="کمکی در کارهای کوچک" />
          <Text style={[s.muted, { marginBottom: 15 }]}>با یک فکر شروع کنید؛ بقیه‌اش با ما.</Text>
          {[
            "امروز چه چیزهایی به توجه من نیاز دارد؟",
            "در رسیدگی به صندوق ورودی کمکم کنید",
            "اسناد اخیرم را نشان دهید",
          ].map((prompt) => (
            <Pressable
              key={prompt}
              onPress={() => ask(prompt)}
              style={[
                s.between,
                { borderTopWidth: 1, borderTopColor: "#E1E2D9", paddingVertical: 13 },
              ]}
            >
              <Text style={[s.text, { fontSize: 12 }]}>{prompt}</Text>
              <ArrowUpLeft size={15} color={colors.muted} />
            </Pressable>
          ))}
        </Card>
        <Card style={{ flex: 1 }}>
          <SectionHeading
            title={pending.length ? "آماده برای بررسی شما" : "فعالیت‌های اخیر"}
            action="مشاهدهٔ همه"
            onPress={() => navigate("activity")}
          />
          {pending.length
            ? pending
                .slice(0, 3)
                .map((a) => (
                  <LinkRow
                    key={a.id}
                    title={a.title}
                    detail="آماده شده · در انتظار تأیید شما"
                    onPress={() => open({ type: "review", action: a })}
                    icon={ShieldCheck}
                    tint={colors.lavender}
                  />
                ))
            : w.activity.slice(0, 3).map((a) => (
                <View key={a.id} style={[s.row, { gap: 13, paddingVertical: 12 }]}>
                  <View
                    style={[s.iconBox, { width: 32, height: 32, backgroundColor: colors.green }]}
                  >
                    <Check size={14} color={colors.text} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.text, { fontSize: 12 }]}>{a.title}</Text>
                    <Text style={s.small}>{relativeDate(a.date)}</Text>
                  </View>
                </View>
              ))}
          {!pending.length && !w.activity.length && (
            <Text style={s.muted}>
              فضای کار شما آماده است. کارهایی که اینجا انجام می‌دهید در فعالیت‌هایتان نمایش داده
              می‌شود.
            </Text>
          )}
        </Card>
      </View>
    </View>
  );
}
function Avatar({ name, index = 0 }: { name: string; index?: number }) {
  return (
    <View
      style={{
        width: 35,
        height: 35,
        borderRadius: 12,
        backgroundColor: [colors.orange, colors.lavender, colors.green, colors.sky][index % 4],
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Text style={{ color: colors.text, fontSize: 11, ...fw("500") }}>
        {name
          .split(" ")
          .map((p) => p[0])
          .slice(0, 2)
          .join("‌")}
      </Text>
    </View>
  );
}
export function AgendaRow({
  event: e,
  index = 0,
  neighbors,
}: {
  event: CalendarEvent;
  index?: number;
  neighbors?: CalendarEvent[];
}) {
  const { open } = useWorkspace();
  return (
    <Pressable
      onPress={() => open({ type: "event", event: e, neighbors })}
      style={[s.row, { gap: 16, paddingVertical: 14 }]}
    >
      <View style={{ width: 65 }}>
        <Text style={[s.text, { fontSize: 11 }]}>
          {e.allDay ? "تمام روز" : timeLabel(e.start, e.timeZone)}
        </Text>
        {!e.allDay && (
          <Text style={[s.small, { fontSize: 10 }]}>{timeLabel(e.end, e.timeZone)}</Text>
        )}
      </View>
      <View
        style={{
          width: 3,
          height: 42,
          borderRadius: 4,
          backgroundColor: ["#BCDAEB", "#C7D6AB", "#D9CDEA"][index % 3],
        }}
      />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[s.text, { fontSize: 13, ...fw("500") }]}>{e.title}</Text>
        <Text numberOfLines={1} style={[s.small, { fontSize: 11 }]}>
          {e.location ||
            (e.attendees.length ? `${faNumber(e.attendees.length)} شرکت‌کننده` : "وقتی برای خودتان")}
        </Text>
      </View>
      <ChevronLeft size={14} color={colors.muted} />
    </Pressable>
  );
}
export function MailScreen() {
  const { workspace: w, api, open } = useWorkspace();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("all");
  const [drafts, setDrafts] = useState<(EmailDraft & { id: string; createdAt: string })[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    void api
      .request<(EmailDraft & { id: string; createdAt: string })[]>("/api/drafts")
      .then(setDrafts)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [api, w]);
  const items = w.mail.filter(
    (m) =>
      (tab !== "unread" || m.unread) &&
      `${m.sender} ${m.subject} ${m.body}`.toLowerCase().includes(query.toLowerCase()),
  );
  const filteredDrafts = drafts.filter((d) =>
    `${d.to.join(" ")} ${d.subject} ${d.body}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <View style={{ gap: 20 }}>
      <View style={[s.between, { gap: 12, flexWrap: "wrap" }]}>
        <View
          style={[
            s.row,
            {
              gap: 9,
              flex: 1,
              minWidth: 200,
              backgroundColor: "#FFF",
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: 12,
              paddingHorizontal: 14,
            },
          ]}
        >
          <Search size={16} color={colors.muted} />
          <TextInput
            accessibilityLabel="جست‌وجوی ایمیل"
            placeholder="جست‌وجو در صندوق ورودی"
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={setQuery}
            style={{ flex: 1, paddingVertical: 13, fontSize: 13, color: colors.text }}
          />
        </View>
        <Button onPress={() => open({ type: "email" })} primary icon={Plus}>
          نوشتن
        </Button>
      </View>
      <ErrorNotice error={error} />
      <Card>
        <View style={[s.row, { gap: 10, marginBottom: 15, flexWrap: "wrap" }]}>
          <Button small primary={tab === "all"} onPress={() => setTab("all")}>
            همهٔ پیام‌ها
          </Button>
          <Button small primary={tab === "unread"} onPress={() => setTab("unread")}>
            {`خوانده‌نشده · ${faNumber(w.mail.filter((m) => m.unread).length)}`}
          </Button>
          <Button small primary={tab === "drafts"} onPress={() => setTab("drafts")}>
            {`پیش‌نویس‌ها · ${faNumber(drafts.length)}`}
          </Button>
        </View>
        {tab === "drafts" ? (
          filteredDrafts.length ? (
            filteredDrafts.map((d) => (
              <LinkRow
                key={d.id}
                icon={Mail}
                title={d.subject}
                detail={`گیرنده: ${d.to.join("، ")} · ذخیره‌شده در ${dateLabel(d.createdAt)}`}
                onPress={() => open({ type: "email", draft: d })}
              />
            ))
          ) : (
            <Empty
              icon={Mail}
              title="صفحه‌ای تازه"
              detail="پیام‌هایی که به‌صورت پیش‌نویس ذخیره می‌کنید اینجا می‌مانند. برای شروع، «نوشتن» را بزنید."
            />
          )
        ) : items.length ? (
          items.map((m, i) => (
            <Pressable
              key={m.id}
              onPress={() => open({ type: "mail", mail: m })}
              style={[
                s.row,
                { gap: 15, paddingVertical: 20, borderTopWidth: 1, borderTopColor: colors.line },
              ]}
            >
              <Avatar name={m.sender} index={i} />
              <View style={{ flex: 1, gap: 5 }}>
                <View style={s.between}>
                  <Text style={[s.text, fw(m.unread ? "600" : "400")]}>{m.sender}</Text>
                  <Text style={s.small}>{dateLabel(m.date)}</Text>
                </View>
                <Text style={[s.text, { ...fw("500"), fontSize: 13 }]}>{m.subject}</Text>
                <Text style={s.muted} numberOfLines={1}>
                  {m.body.replace(/\n/g, " ")}
                </Text>
                {!!m.attachments.length && (
                  <View style={[s.row, { gap: 4, marginTop: 2 }]}>
                    <FileText size={12} color={colors.muted} />
                    <Text style={s.small}>{`${faNumber(m.attachments.length)} پیوست`}</Text>
                  </View>
                )}
              </View>
              {m.unread && (
                <View
                  style={{ width: 6, height: 6, borderRadius: 4, backgroundColor: "#83B5D3" }}
                />
              )}
            </Pressable>
          ))
        ) : (
          <Empty
            icon={Inbox}
            title={query ? "پیامی مطابق جست‌وجو پیدا نشد" : "صندوق ورودی شما خالی است"}
            detail={
              query
                ? "نام یا موضوع دیگری را امتحان کنید."
                : "برای خواندن ایمیل‌هایتان در اینجا، Google را از بخش «اتصال‌ها» متصل کنید."
            }
          />
        )}
      </Card>
    </View>
  );
}
interface CalendarChoice {
  id: string;
  name: string;
  timeZone: string;
  accessRole: string;
}
function plusDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function CalendarScreen() {
  const { workspace: w, api, open } = useWorkspace();
  const [date, setDate] = useState(todayDate());
  const [all, setAll] = useState(false);
  const [calendars, setCalendars] = useState<CalendarChoice[]>([]);
  const [calendarId, setCalendarId] = useState("primary");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const selected = calendars.find((c) => c.id === calendarId);
  const zone = selected?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const writable = !selected || ["owner", "writer"].includes(selected.accessRole);
  const anchor = new Date(`${date}T12:00:00`);
  const dates = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(anchor);
    // Persian weeks start on Saturday.
    day.setDate(anchor.getDate() - ((anchor.getDay() + 1) % 7) + i);
    return day;
  });
  useEffect(() => {
    let active = true;
    void api
      .request<CalendarChoice[]>("/api/calendars")
      .then((items) => {
        if (!active) return;
        setCalendars(items);
        setCalendarId((current) =>
          items.some((c) => c.id === current) ? current : items[0]?.id || "primary",
        );
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [api, retry]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void Promise.resolve()
      .then(() => {
        const query = new URLSearchParams({
          calendarId,
          timeMin: zonedInstant(date, "00:00", zone),
          timeMax: zonedInstant(plusDays(date, all ? 30 : 1), "00:00", zone),
        });
        return api.request<CalendarEvent[]>(`/api/calendar/events?${query}`);
      })
      .then((items) => {
        if (active) setEvents(items.sort((a, b) => a.start.localeCompare(b.start)));
      })
      .catch((e) => {
        if (active) {
          setEvents([]);
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, calendarId, date, all, zone, w, retry]);
  function newEvent() {
    open({
      type: "event",
      neighbors: events,
      draft: {
        calendarId,
        title: "",
        start: zonedInstant(date, "09:00", zone),
        end: zonedInstant(date, "10:00", zone),
        allDay: false,
        timeZone: zone,
        location: "",
        description: "",
        attendees: [],
      },
    });
  }
  return (
    <View style={{ gap: 20 }}>
      <View style={[s.between, { gap: 12, flexWrap: "wrap" }]}>
        <View style={[s.row, { gap: 8 }]}>
          <Text style={s.title}>{faDate(anchor, { month: "long", year: "numeric" })}</Text>
          <IconButton
            icon={ChevronRight}
            label="هفته قبل"
            onPress={() => setDate(plusDays(date, -7))}
          />
          <IconButton
            icon={ChevronLeft}
            label="هفته بعد"
            onPress={() => setDate(plusDays(date, 7))}
          />
        </View>
        <Button primary icon={Plus} disabled={!writable} onPress={newEvent}>
          رویداد جدید
        </Button>
      </View>
      {calendars.length > 0 && (
        <View style={{ gap: 9 }}>
          <Text style={s.label}>تقویم‌های شما</Text>
          <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
            {calendars.map((c) => (
              <Button
                key={c.id}
                small
                primary={c.id === calendarId}
                onPress={() => setCalendarId(c.id)}
              >
                {c.name}
                {["owner", "writer"].includes(c.accessRole) ? "" : " · فقط‌خواندنی"}
              </Button>
            ))}
          </View>
        </View>
      )}
      <Card style={{ padding: 12 }}>
        <View style={{ flexDirection: "row", gap: 5 }}>
          {dates.map((day) => {
            const key = localDateTime(
              day.toISOString(),
              Intl.DateTimeFormat().resolvedOptions().timeZone,
            ).date;
            return (
              <Pressable
                key={key}
                onPress={() => {
                  setDate(key);
                  setAll(false);
                }}
                style={{
                  flex: 1,
                  alignItems: "center",
                  paddingVertical: 17,
                  gap: 9,
                  borderRadius: 14,
                  backgroundColor: key === date ? colors.sky : "transparent",
                }}
              >
                <Text style={s.small}>{faDate(day, { weekday: "short" })}</Text>
                <Text
                  style={[
                    s.title,
                    { fontSize: 22, color: key === date ? colors.blueDark : colors.text },
                  ]}
                >
                  {faDate(day, { day: "numeric" })}
                </Text>
                <View
                  style={{
                    height: 4,
                    width: 4,
                    borderRadius: 4,
                    backgroundColor: [...events, ...w.events].some(
                      (e) => e.calendarId === calendarId && eventDate(e) === key,
                    )
                      ? "#8DB6CA"
                      : "transparent",
                  }}
                />
              </Pressable>
            );
          })}
        </View>
      </Card>
      <Card>
        <View style={[s.between, { gap: 10, flexWrap: "wrap" }]}>
          <Text style={s.heading}>
            {all
              ? "۳۰ روز آینده"
              : faDate(`${date}T12:00:00`, { weekday: "long", month: "long", day: "numeric" })}
          </Text>
          <Button small onPress={() => setAll(!all)}>
            {all ? "روز انتخاب‌شده" : "۳۰ روز آینده"}
          </Button>
        </View>
        <Text style={[s.small, { marginTop: 7, marginBottom: 13 }]}>
          {selected?.name || "تقویم شما"} · {zone}. هر رویداد با منطقهٔ زمانی خودش نمایش داده می‌شود.
        </Text>
        <ErrorNotice error={error} />
        {error && (
          <Button small onPress={() => setRetry(retry + 1)}>
            تلاش دوباره
          </Button>
        )}
        {loading ? (
          <View style={[s.row, { gap: 10, paddingVertical: 35, justifyContent: "center" }]}>
            <ActivityIndicator size="small" color={colors.blueDark} />
            <Text style={s.muted}>در حال بررسی تقویم شما…</Text>
          </View>
        ) : events.length ? (
          events.map((e, i) => (
            <View key={e.id}>
              {all && <Text style={[s.label, { marginTop: 16 }]}>{dateLabel(e.start)}</Text>}
              <AgendaRow event={e} index={i} neighbors={events} />
              <Text style={[s.small, { marginStart: 84, marginBottom: 8 }]}>{e.timeZone}</Text>
            </View>
          ))
        ) : (
          !error && (
            <Empty
              icon={CalendarDays}
              title="کمی فضای آزاد"
              detail={
                all
                  ? "برای ۳۰ روز آینده رویدادی در این تقویم ثبت نشده است. رویدادهای تازه اینجا نمایش داده می‌شوند."
                  : "برای این روز رویدادی در تقویم نیست. روز دیگری را انتخاب کنید یا رویدادی اضافه کنید."
              }
            >
              {writable && (
                <Button icon={Plus} onPress={newEvent}>
                  افزودن رویداد
                </Button>
              )}
            </Empty>
          )
        )}
      </Card>
    </View>
  );
}
export function BrowserScreen() {
  const { workspace: w, api, refresh, open } = useWorkspace();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function create() {
    setError("");
    setBusy(true);
    try {
      const browser = await api.request<BrowserSession>("/api/browsers", { url });
      await refresh();
      setUrl("");
      open({ type: "browser", browser });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 22 }}>
      <Card style={{ backgroundColor: colors.sky }}>
        <View style={[s.row, { gap: 12, marginBottom: 15 }]}>
          <Globe2 size={22} color={colors.blueDark} />
          <View>
            <Text style={s.heading}>جایی برای زبانه‌های باز شما</Text>
            <Text style={s.muted}>در یک نشست خصوصی و ماندگار در فضای کارتان مرور کنید.</Text>
          </View>
        </View>
        <View style={[s.row, { gap: 10 }]}>
          <TextInput
            accessibilityLabel="نشانی وب‌سایت"
            value={url}
            onChangeText={setUrl}
            onSubmitEditing={() => void create()}
            autoCapitalize="none"
            placeholder="https://example.com"
            placeholderTextColor={colors.muted}
            keyboardType="url"
            style={[s.input, { flex: 1, writingDirection: "ltr" }]}
          />
          <Button
            primary
            icon={Plus}
            busy={busy}
            disabled={!url.trim()}
            onPress={() => void create()}
          >
            باز کردن نشست
          </Button>
        </View>
        <ErrorNotice error={error} />
      </Card>
      <Card>
        <SectionHeading title="نشست‌های مرورگر" />
        {w.browsers.length ? (
          w.browsers.map((b) => (
            <Pressable
              key={b.id}
              onPress={() => open({ type: "browser", browser: b })}
              style={{
                borderTopWidth: 1,
                borderTopColor: colors.line,
                paddingVertical: 20,
                gap: 12,
              }}
            >
              <View style={[s.row, { gap: 14 }]}>
                <View style={s.iconBox}>
                  <Globe2 size={20} color={colors.blueDark} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={s.heading}>{b.title || "نشست مرورگر"}</Text>
                  <Text style={[s.muted, { writingDirection: "ltr" }]} numberOfLines={1}>
                    {b.url}
                  </Text>
                </View>
                <Chip tint={b.status === "active" ? colors.green : colors.canvas}>
                  {statusName(b.status)}
                </Chip>
                <ArrowUpLeft size={17} color={colors.muted} />
              </View>
              {b.previewUrl && (
                <Image
                  source={{ uri: api.url(b.previewUrl) }}
                  resizeMode="cover"
                  style={{
                    height: 180,
                    width: "100%",
                    borderRadius: 12,
                    backgroundColor: colors.canvas,
                  }}
                />
              )}
            </Pressable>
          ))
        ) : (
          <Empty
            icon={Globe2}
            title="با یک وب‌سایت شروع کنید"
            detail="برای اینکه مرورتان یک‌جا بماند، از بالا یک نشست باز کنید. پیش‌نمایش زنده وقتی نمایش داده می‌شود که کارگزار مرورگر پیکربندی شده باشد."
          />
        )}
      </Card>
    </View>
  );
}
export function FilesScreen() {
  const { workspace: w, api, refresh, open } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function upload() {
    setError("");
    setBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const file = result.assets[0];
      let artifact: Artifact;
      if (Platform.OS === "web") {
        const form = new FormData();
        if (!file.file) throw new Error("فایل انتخاب‌شده خوانده نشد. آن را دوباره انتخاب کنید.");
        form.append("file", file.file, file.name);
        artifact = await api.request<Artifact>("/api/files", form);
      } else {
        const result = await FileSystem.uploadAsync(`${API_URL}/api/files`, file.uri, {
          httpMethod: "POST",
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName: "file",
          mimeType: "application/pdf",
          headers: { Authorization: `Bearer ${api.token}` },
        });
        const payload = JSON.parse(result.body);
        if (result.status < 200 || result.status >= 300)
          throw new Error(payload.error || "وارد کردن این PDF ممکن نشد. دوباره تلاش کنید.");
        artifact = payload;
      }
      await refresh();
      open({ type: "file", file: artifact });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 20 }}>
      <View style={s.between}>
        <Text style={[s.muted, { flex: 1, marginEnd: 15 }]}>اسناد شما، با کمی فضا برای کار.</Text>
        <Button primary icon={Upload} busy={busy} onPress={() => void upload()}>
          وارد کردن PDF
        </Button>
      </View>
      <ErrorNotice error={error} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 18 }}>
        {w.files.map((f) => (
          <Pressable
            key={f.id}
            onPress={() => open({ type: "file", file: f })}
            style={{ flexGrow: 1, flexBasis: 250, maxWidth: 430 }}
          >
            <Card style={{ padding: 0, overflow: "hidden" }}>
              <View
                style={{
                  height: 175,
                  backgroundColor: "#EDEFEA",
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <View
                  style={{
                    width: 93,
                    height: 121,
                    borderRadius: 5,
                    backgroundColor: "#FFF",
                    padding: 14,
                    transform: [{ rotate: "-4deg" }],
                    borderWidth: 1,
                    borderColor: "#DDE3DD",
                  }}
                >
                  <View style={[s.row, { gap: 5, marginBottom: 15 }]}>
                    <FileText size={13} color={colors.blueDark} />
                    <Text style={{ fontSize: 7, color: colors.blueDark }}>سند</Text>
                  </View>
                  {[100, 75, 90, 95, 60].map((width, i) => (
                    <View
                      key={width}
                      style={{
                        height: 3,
                        backgroundColor: i === 0 ? "#A4BED0" : "#E3E7E3",
                        width: `${width}%`,
                        marginBottom: 7,
                        borderRadius: 3,
                      }}
                    />
                  ))}
                </View>
                <View style={{ position: "absolute", bottom: 12, end: 14 }}>
                  <Chip>PDF</Chip>
                </View>
              </View>
              <View style={{ padding: 21, gap: 6 }}>
                <Text numberOfLines={1} style={[s.heading, { fontSize: 14 }]}>
                  {f.name}
                </Text>
                <Text style={s.small}>
                  {`${faNumber(f.pageCount)} صفحه · ${faNumber(Math.max(1, Math.round(f.size / 1024)))} کیلوبایت`}
                </Text>
                <View style={[s.between, { marginTop: 9 }]}>
                  <Chip>{f.source}</Chip>
                  <Text style={s.small}>{dateLabel(f.createdAt)}</Text>
                </View>
              </View>
            </Card>
          </Pressable>
        ))}
      </View>
      {!w.files.length && (
        <Card>
          <Empty
            icon={FileText}
            title="اسناد شما اینجا هستند"
            detail="یک PDF وارد کنید یا پیوست یک ایمیل را باز کنید تا آن را بخوانید، فیلدهای فرم پشتیبانی‌شده را پر کنید و نسخه‌ای از آن را به اشتراک بگذارید."
          />
        </Card>
      )}
    </View>
  );
}
export function ActivityScreen() {
  const { workspace: w, open } = useWorkspace();
  const [filter, setFilter] = useState("all");
  const pending = w.actions.filter((a) => a.status === "awaiting_review");
  const actions = w.actions.filter((a) => filter === "all" || a.status === "awaiting_review");
  return (
    <View style={{ gap: 20 }}>
      <View style={[s.row, { gap: 10 }]}>
        <Button small primary={filter === "all"} onPress={() => setFilter("all")}>
          همهٔ فعالیت‌ها
        </Button>
        <Button small primary={filter === "review"} onPress={() => setFilter("review")}>
          {`نیازمند بررسی · ${faNumber(pending.length)}`}
        </Button>
      </View>
      {actions.length > 0 && (
        <Card>
          <SectionHeading title="اقدامات شما" />
          {actions.map((a) => (
            <Pressable
              key={a.id}
              onPress={() => open({ type: "review", action: a })}
              style={[
                s.row,
                { gap: 15, paddingVertical: 17, borderTopWidth: 1, borderTopColor: colors.line },
              ]}
            >
              <View
                style={[
                  s.iconBox,
                  {
                    backgroundColor:
                      a.status === "awaiting_review" ? colors.lavender : colors.green,
                  },
                ]}
              >
                {a.status === "awaiting_review" ? (
                  <ShieldCheck size={18} color={colors.text} />
                ) : (
                  <CheckCheck size={18} color={colors.text} />
                )}
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={s.text}>{a.title}</Text>
                <Text style={s.small}>{relativeDate(a.createdAt)}</Text>
              </View>
              <Chip
                tint={
                  a.status === "failed"
                    ? "#FBEFED"
                    : a.status === "awaiting_review"
                      ? colors.lavender
                      : colors.canvas
                }
              >
                {statusName(a.status)}
              </Chip>
              <ChevronLeft size={16} color={colors.muted} />
            </Pressable>
          ))}
        </Card>
      )}
      {filter === "all" && (
        <Card>
          <SectionHeading title="گاه‌شمار فضای کار" />
          {w.activity.length ? (
            w.activity.map((a, i) => (
              <View
                key={a.id}
                style={[
                  s.row,
                  {
                    alignItems: "flex-start",
                    gap: 17,
                    paddingVertical: 18,
                    borderTopWidth: i ? 1 : 0,
                    borderTopColor: colors.line,
                  },
                ]}
              >
                <View
                  style={[s.iconBox, { height: 34, width: 34, backgroundColor: colors.canvas }]}
                >
                  <Clock3 size={16} color={colors.muted} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={s.text}>{a.title}</Text>
                  <Text style={s.muted}>{resultSummary(a.detail)}</Text>
                  <Text style={s.small}>
                    {dateLabel(a.date)} · {timeLabel(a.date)}
                  </Text>
                </View>
                <Chip>{statusName(a.status)}</Chip>
              </View>
            ))
          ) : (
            <Empty
              icon={Clock3}
              title="آغاز چیزی سبک‌تر"
              detail="اقدامات شما و نتایجشان اینجا ثبت می‌شود. برای شروع، کاری را از دستیار بخواهید."
            />
          )}
        </Card>
      )}
      {filter === "review" && !actions.length && (
        <Card>
          <Empty
            icon={ShieldCheck}
            title="همه‌چیز به‌روز است"
            detail="وقتی ایمیل یا تغییری در تقویم به تأیید شما نیاز داشته باشد، اینجا نمایش داده می‌شود."
          />
        </Card>
      )}
    </View>
  );
}
export function ConnectionsScreen({ query = "" }: { query?: string }) {
  const { workspace: w, api, refresh, notify, open } = useWorkspace();
  const [selected, setSelected] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function connect(capability: "read" | "write") {
    setBusy(true);
    setError("");
    try {
      const result = await api.request<{ url: string | null; connected?: boolean }>(
        "/api/google/connect",
        { capability },
      );
      if (result.url) {
        await Linking.openURL(result.url);
        notify("اتصال را در مرورگرتان کامل کنید، سپس فضای کارتان را تازه‌سازی کنید.");
      } else {
        await refresh();
        notify("داده‌های محلی Google آماده است.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      await api.request("/api/google/disconnect", {});
      await refresh();
      notify("اتصال Google قطع شد.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const google = w.connections.find((c) => c.id === "google");
  const connected = google?.status === "connected" || google?.status === "sample";
  const googleUnconfigured = google?.status === "unconfigured";
  const rows = [
    { id: "gmail", name: "Gmail", icon: Mail, color: "#EA5B4D", connected, group: "google" },
    {
      id: "calendar",
      name: "Google Calendar",
      icon: CalendarDays,
      color: "#4285F4",
      connected,
      group: "google",
    },
    {
      id: "browser",
      name: "رایانهٔ دستیار",
      icon: Globe2,
      color: "#1987CF",
      connected: w.connections.some((c) => c.id === "browser" && c.status === "connected"),
      group: "browser",
    },
    {
      id: "openbot",
      name: "OpenBot",
      icon: Sparkles,
      color: "#6866A6",
      connected: false,
      group: "openbot",
    },
  ].filter((row) => `${row.name} ${row.group}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <View style={{ gap: 22 }}>
      {[true, false].map((isConnected) => {
        const group = rows.filter((row) => row.connected === isConnected);
        if (!group.length) return null;
        return (
          <View key={String(isConnected)} style={{ gap: 8 }}>
            <Text style={[s.small, { marginStart: 12 }]}>
              {isConnected
                ? w.mode === "sample"
                  ? "اتصال‌های شما"
                  : "متصل"
                : "یکپارچه‌سازی‌های در دسترس"}
            </Text>
            <View style={{ paddingHorizontal: 16, borderRadius: 23, backgroundColor: "#F3F4F5" }}>
              {group.map((row, index) => (
                <Pressable
                  key={row.id}
                  accessibilityRole="button"
                  accessibilityLabel={`مدیریت ${row.name}`}
                  onPress={() =>
                    row.group === "browser" ? open({ type: "computer" }) : setSelected(row.group)
                  }
                  style={[
                    s.row,
                    {
                      gap: 14,
                      minHeight: 61,
                      borderBottomWidth: index < group.length - 1 ? 1 : 0,
                      borderBottomColor: "#E5E7E9",
                    },
                  ]}
                >
                  <View
                    style={{
                      width: 29,
                      height: 29,
                      borderRadius: 7,
                      backgroundColor: "#FFF",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <row.icon size={23} color={row.color} />
                  </View>
                  <Text style={[s.text, { flex: 1 }]}>{row.name}</Text>
                  {row.connected && row.group === "google" && w.mode === "sample" && (
                    <Text style={s.small}>داده‌های محلی</Text>
                  )}
                  {row.connected ? (
                    <ChevronLeft size={18} color="#A4A7AA" />
                  ) : (
                    <Text
                      style={{
                        fontSize: 13,
                        color: row.group === "google" ? colors.blueDark : colors.muted,
                      }}
                    >
                      {row.group === "google"
                        ? googleUnconfigured
                          ? "پیکربندی نشده"
                          : "اتصال"
                        : "راه‌اندازی"}
                    </Text>
                  )}
                </Pressable>
              ))}
            </View>
          </View>
        );
      })}
      {!rows.length && (
        <Text style={s.muted}>اتصالی مطابق جست‌وجو پیدا نشد. عبارت دیگری را امتحان کنید.</Text>
      )}
      {selected && (
        <Sheet
          title={selected === "google" ? "اتصال‌های Google" : "OpenBot"}
          subtitle={selected === "google" ? google?.account : "رایانه‌ای برای دستیار شما"}
          onClose={() => setSelected(undefined)}
        >
          {selected === "google" ? (
            <View style={{ gap: 18 }}>
              <Text style={s.muted}>
                Gmail و Google Calendar را به گفت‌وگوهایتان بیاورید. ابتدا دسترسی خواندن را انتخاب
                کنید و هر وقت لازم شد، ارسال و ویرایش را فعال کنید.
              </Text>
              <View style={[s.row, { gap: 7, flexWrap: "wrap" }]}>
                {google?.capabilities.map((cap) => (
                  <Chip key={cap}>{capabilityLabel(cap)}</Chip>
                ))}
              </View>
              {googleUnconfigured && (
                <Text style={s.muted}>
                  Google روی این سرور پیکربندی نشده است. برای فعال‌سازی Gmail و تقویم، مدیر سرور باید
                  GOOGLE_CLIENT_ID و GOOGLE_CLIENT_SECRET را تنظیم کند.
                </Text>
              )}
              <ErrorNotice error={error} />
              <Button
                busy={busy}
                primary
                icon={Link2}
                disabled={googleUnconfigured}
                onPress={() => void connect("read")}
              >
                اتصال Google
              </Button>
              <Button
                busy={busy}
                disabled={googleUnconfigured}
                onPress={() => void connect("write")}
              >
                فعال‌سازی ارسال و ویرایش
              </Button>
              {connected && (
                <Button busy={busy} danger onPress={() => void disconnect()}>
                  قطع اتصال Google
                </Button>
              )}
              <SettingsLine
                label="محیط"
                value={w.mode === "sample" ? "محلی · داده‌های نمونه" : "فضای کار زنده"}
              />
              <SettingsLine
                label="دستیار"
                value={
                  w.runtime.provider === "sample"
                    ? "گردش‌کارهای راهنما"
                    : w.runtime.configured
                      ? "مدل متصل است"
                      : "مدل پیکربندی نشده است"
                }
              />
              <SettingsLine
                label="رشته‌گفت‌وگوهای غنی"
                value={
                  w.runtime.richThreads
                    ? "CopilotKit Intelligence"
                    : w.runtime.localThreads
                      ? "پایگاه‌دادهٔ همین سرور"
                      : "متصل نیست"
                }
              />
              <Button
                small
                icon={ArrowDownToLine}
                onPress={() => void refresh().catch((e) => setError(String(e)))}
              >
                تازه‌سازی اتصال‌ها
              </Button>
            </View>
          ) : (
            <View style={{ gap: 14 }}>
              <Text style={s.text}>
                آداپتور OpenBot در این پروژهٔ متن‌باز در دسترس است، اما هنوز هیچ بک‌اند زنده‌ای برای
                OpenBot پیکربندی نشده است.
              </Text>
              <Text style={s.muted}>
                رایانهٔ فعلی شما از کارگزار ماندگار Chromium در {BRAND.nameFa} استفاده می‌کند.
                یکپارچه‌سازی OpenBot بک‌اند اجرا را گسترش می‌دهد و همین رابط را حفظ می‌کند.
              </Text>
            </View>
          )}
        </Sheet>
      )}
    </View>
  );
}
function SettingsLine({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={[
        s.between,
        { gap: 15, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
      ]}
    >
      <Text style={s.muted}>{label}</Text>
      <Text style={[s.text, { fontSize: 12, flexShrink: 1, textAlign: "auto" }]}>{value}</Text>
    </View>
  );
}

function capabilityLabel(value: string) {
  const scope = value.split("/").at(-1) || value;
  const names: Record<string, string> = {
    "gmail.readonly": "خواندن Gmail",
    "gmail.send": "ارسال با Gmail",
    "calendar.events.readonly": "خواندن رویدادهای تقویم",
    "calendar.calendarlist.readonly": "خواندن فهرست تقویم‌ها",
    "calendar.events": "مدیریت رویدادهای تقویم",
    "calendar.readonly": "خواندن تقویم‌ها",
  };
  return names[scope] || scope;
}
