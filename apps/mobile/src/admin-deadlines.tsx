import { CalendarClock, RefreshCw } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import {
  formatJalali,
  gregorianToJalali,
  jalaliMonthLength,
  jalaliToGregorian,
} from "../../../packages/domain/src/iran-holidays";
import type { DeadlineOverride } from "../../../packages/domain/src/paths";
import type { MuseApi } from "./api";
import { faDigits, faNumber, fw, toLatinDigits } from "./locale";
import { Button, Card, Chip, colors, Empty, ErrorNotice, Field, s } from "./ui";

/** One occurrence from GET /api/admin/deadlines. */
export type AdminDeadline = {
  id: string;
  ruleId: string;
  pathId: string;
  title: string;
  /** Gregorian YYYY-MM-DD set by the law. */
  legalDate: string;
  /** Effective due day (the extension's date when there is one). */
  date: string;
  override?: DeadlineOverride;
};

const ltr = { writingDirection: "ltr" as const, textAlign: "auto" as const };
const COLLAPSED = 6;
const NOTE_MAX = 120;

/** «۱۴۰۵/۰۸/۳۰» for a Gregorian day, the format the date field accepts. */
function jalaliInput(date: string): string {
  const { year, month, day } = gregorianToJalali(date);
  return faDigits(`${year}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`);
}

/** Gregorian YYYY-MM-DD for a typed Jalali date (Persian or Latin digits), or an error message. */
export function parseJalaliInput(raw: string): { date: string } | { error: string } {
  const match = /^(\d{4})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{1,2})$/.exec(toLatinDigits(raw).trim());
  if (!match) return { error: "تاریخ را به شکل ۱۴۰۵/۰۸/۳۰ وارد کنید." };
  const [year, month, day] = match.slice(1).map(Number);
  if (year < 1400 || year > 1500 || month < 1 || month > 12)
    return { error: "این تاریخ وجود ندارد. سال، ماه و روز را بررسی کنید." };
  if (day < 1 || day > jalaliMonthLength(year, month))
    return {
      error: `این ماه ${faNumber(jalaliMonthLength(year, month))} روز دارد. روز را بررسی کنید.`,
    };
  return { date: jalaliToGregorian(year, month, day) };
}

function ExtendForm({
  api,
  item,
  onSaved,
  onCancel,
}: {
  api: MuseApi;
  item: AdminDeadline;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(item.override ? jalaliInput(item.override.date) : "");
  const [note, setNote] = useState(item.override?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    const parsed = parseJalaliInput(date);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    if (parsed.date <= item.legalDate) {
      setError(
        `تاریخ تمدید باید بعد از مهلت قانونی (${formatJalali(item.legalDate, false)}) باشد.`,
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.request(
        `/api/admin/deadlines/${encodeURIComponent(item.id)}`,
        { date: parsed.date, note: note.trim() || undefined },
        "PUT",
      );
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ marginTop: 4 }}>
      <ErrorNotice error={error} />
      <Field
        label="مهلت تازه (تاریخ شمسی)"
        value={date}
        onChangeText={setDate}
        keyboardType="numbers-and-punctuation"
        placeholder={jalaliInput(item.legalDate)}
        style={ltr}
      />
      <Field
        label="یادداشت کوتاه (اختیاری)"
        value={note}
        onChangeText={setNote}
        maxLength={NOTE_MAX}
        placeholder="طبق اطلاعیهٔ سازمان امور مالیاتی"
      />
      <View style={[s.row, { gap: 8 }]}>
        <Button small primary busy={busy} disabled={!date.trim()} onPress={() => void save()}>
          ذخیره
        </Button>
        <Button small onPress={onCancel}>
          انصراف
        </Button>
      </View>
    </View>
  );
}

function DeadlineRow({
  api,
  item,
  reload,
}: {
  api: MuseApi;
  item: AdminDeadline;
  reload: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await api.request(`/api/admin/deadlines/${encodeURIComponent(item.id)}`, undefined, "DELETE");
      setConfirming(false);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View
      style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 6 }}
    >
      <Text style={[s.text, fw("600")]}>{item.title}</Text>
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        <Text style={s.small}>مهلت قانونی: {formatJalali(item.legalDate, false)}</Text>
        {item.override && (
          <Chip
            tint={colors.green}
          >{`تمدیدشده تا ${formatJalali(item.override.date, false)}`}</Chip>
        )}
      </View>
      {item.override?.note ? <Text style={s.small}>{item.override.note}</Text> : null}
      <ErrorNotice error={error} />
      {editing ? (
        <ExtendForm
          api={api}
          item={item}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void reload();
          }}
        />
      ) : confirming ? (
        <View style={{ gap: 8, padding: 12, borderRadius: 14, backgroundColor: colors.canvas }}>
          <Text style={[s.text, fw("600")]}>تمدید این مهلت حذف شود؟</Text>
          <Text style={s.small}>
            {`یادآوری‌ها دوباره مهلت قانونی (${formatJalali(item.legalDate, false)}) را نشان می‌دهند.`}
          </Text>
          <View style={[s.row, { gap: 8 }]}>
            <Button small danger busy={busy} onPress={() => void remove()}>
              حذف تمدید
            </Button>
            <Button small onPress={() => setConfirming(false)}>
              انصراف
            </Button>
          </View>
        </View>
      ) : (
        <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
          <Button small onPress={() => setEditing(true)}>
            {item.override ? "ویرایش تمدید" : "ثبت تمدید"}
          </Button>
          {item.override && (
            <Button small danger onPress={() => setConfirming(true)}>
              حذف تمدید
            </Button>
          )}
        </View>
      )}
    </View>
  );
}

/**
 * Admin-only «تمدید مهلت‌ها»: record an announced extension of a legal deadline so the chat
 * reminder card and the reminder notifications use the new day, without a new release.
 */
export function AdminDeadlines({ api }: { api: MuseApi }) {
  const [items, setItems] = useState<AdminDeadline[]>();
  const [error, setError] = useState("");
  const [all, setAll] = useState(false);
  const load = useCallback(async () => {
    try {
      const result = await api.request<{ occurrences: AdminDeadline[] }>("/api/admin/deadlines");
      setItems(result.occurrences);
      setError("");
    } catch (e) {
      setError(`فهرست مهلت‌ها بارگذاری نشد. ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);
  // Nearest first; an active extension is never hidden behind «نمایش همه».
  const visible = all ? items : items?.filter((item, index) => index < COLLAPSED || item.override);
  return (
    <Card style={{ gap: 6 }}>
      <View style={[s.row, { gap: 8, justifyContent: "space-between", flexWrap: "wrap" }]}>
        <Text style={s.heading}>تمدید مهلت‌ها</Text>
        <Button small icon={RefreshCw} onPress={() => void load()}>
          به‌روزرسانی
        </Button>
      </View>
      <Text style={s.small}>
        وقتی سازمان امور مالیاتی یا تأمین اجتماعی مهلتی را تمدید می‌کند، تاریخ تازه را اینجا ثبت
        کنید. کارت یادآوری و اعلان‌ها (از جمله در بله) تاریخ تازه را نشان می‌دهند.
      </Text>
      <ErrorNotice error={error} />
      {!items && !error && <ActivityIndicator color={colors.blueDark} />}
      {items?.length === 0 && (
        <Empty
          icon={CalendarClock}
          title="مهلتی در دوازده ماه آینده نیست"
          detail="مهلت‌های قانونی مسیرها اینجا فهرست می‌شوند. فهرست را بعداً تازه کنید."
        />
      )}
      {visible?.map((item) => (
        <DeadlineRow key={item.id} api={api} item={item} reload={load} />
      ))}
      {!all && items && visible && items.length > visible.length && (
        <Button small onPress={() => setAll(true)} style={{ marginTop: 8 }}>
          {`نمایش همهٔ مهلت‌ها (${faNumber(items.length)})`}
        </Button>
      )}
      {all && items && items.length > COLLAPSED && (
        <Button small onPress={() => setAll(false)} style={{ marginTop: 8 }}>
          نمایش کمتر
        </Button>
      )}
    </Card>
  );
}
