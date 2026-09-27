import { ChartPie, RefreshCw } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { DEADLINE_RULES, PATHS, type PathId } from "../../../packages/domain/src/paths";
import { findPersona } from "../../../packages/domain/src/personal";
import type { MuseApi } from "./api";
import type { InsightEvent } from "./insights";
import { faNumber, fw } from "./locale";
import { Button, Card, colors, ErrorNotice, s } from "./ui";

/** GET /api/admin/insights (see apps/server/src/insights.ts). */
export type InsightReport = {
  days: number;
  from: string;
  to: string;
  total: number;
  events: Record<InsightEvent, { id: string; count: number }[]>;
  paths: { profiles: number; none: number; counts: Record<PathId, number> };
};

const DAYS = 30;
const TOP = 5;
const EMPTY =
  "هنوز داده‌ای ثبت نشده است. پس از استفادهٔ کاربران از مسیرها، آمار اینجا نمایش داده می‌شود.";

const starterLabels = new Map(
  PATHS.flatMap((path) => path.starters.map((item) => [item.id, item.label] as const)),
);
const shortcutLabels = new Map(
  PATHS.flatMap((path) => path.shortcuts.map((item) => [item.id, item.label] as const)),
);
const deadlineLabels = new Map(DEADLINE_RULES.map((rule) => [rule.id, rule.title] as const));

/** Sum of one event's counts, optionally for a single id. */
function countOf(report: InsightReport, event: InsightEvent, id?: string) {
  return (report.events[event] ?? [])
    .filter((item) => id === undefined || item.id === id)
    .reduce((sum, item) => sum + item.count, 0);
}

function Bar({ value, max }: { value: number; max: number }) {
  const width = max > 0 ? Math.max(value > 0 ? 3 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <View
      style={{ height: 6, borderRadius: 3, backgroundColor: colors.subtle, overflow: "hidden" }}
    >
      <View
        style={{ width: `${width}%`, height: 6, borderRadius: 3, backgroundColor: colors.blueDark }}
      />
    </View>
  );
}

function CountRow({
  label,
  count,
  max,
  note,
}: {
  label: string;
  count: number;
  max: number;
  note?: string;
}) {
  return (
    <View style={{ gap: 4 }}>
      <View style={[s.between, { gap: 10 }]}>
        <Text style={[s.text, { flex: 1, fontSize: 14, lineHeight: 22 }]}>{label}</Text>
        <Text style={[s.text, { fontSize: 14, lineHeight: 22, ...fw("600") }]}>
          {faNumber(count)}
        </Text>
      </View>
      <Bar value={count} max={max} />
      {note ? <Text style={s.small}>{note}</Text> : null}
    </View>
  );
}

function TopList({
  title,
  items,
  label,
}: {
  title: string;
  items: { id: string; count: number }[];
  label: (id: string) => string;
}) {
  if (!items.length) return null;
  const top = items.slice(0, TOP);
  const max = top[0]?.count ?? 0;
  return (
    <View style={{ gap: 10 }}>
      <Text style={[s.label, { color: colors.text }]}>{title}</Text>
      {top.map((item) => (
        <CountRow key={item.id} label={label(item.id)} count={item.count} max={max} />
      ))}
    </View>
  );
}

/**
 * Admin-only «آمار مسیرها»: the current choice of paths across people and the most used starters,
 * shortcuts and suggestions. Counts are anonymous daily totals; no person is identified.
 */
export function AdminInsights({ api }: { api: MuseApi }) {
  const [report, setReport] = useState<InsightReport>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      setReport(await api.request<InsightReport>(`/api/admin/insights?days=${DAYS}`));
      setError("");
    } catch (e) {
      setError(
        `آمار مسیرها بارگذاری نشد. دوباره تلاش کنید. ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setBusy(false);
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  const paths = report?.paths;
  const pathMax = paths ? Math.max(paths.none, ...Object.values(paths.counts)) : 0;
  const hasData = !!report && (report.total > 0 || (paths?.profiles ?? 0) > 0);
  const invites = report
    ? { opened: countOf(report, "invite_opened"), dismissed: countOf(report, "invite_dismissed") }
    : undefined;

  return (
    <Card style={{ gap: 14 }}>
      <View style={[s.between, { gap: 10 }]}>
        <View style={[s.row, { gap: 10, flex: 1 }]}>
          <ChartPie size={18} color={colors.blueDark} />
          <View style={{ flex: 1 }}>
            <Text style={s.heading}>آمار مسیرها</Text>
            <Text style={s.small}>
              {faNumber(report?.days ?? DAYS)} روز گذشته؛ شمارش‌ها بی‌نام و روزانه ثبت می‌شوند.
            </Text>
          </View>
        </View>
        <Button small icon={RefreshCw} busy={busy} onPress={() => void load()}>
          به‌روزرسانی
        </Button>
      </View>
      <ErrorNotice error={error} />
      {!report && !error && <ActivityIndicator color={colors.blueDark} />}
      {report && !hasData && <Text style={s.muted}>{EMPTY}</Text>}
      {report && hasData && paths && (
        <>
          <View style={{ gap: 10 }}>
            <Text style={[s.label, { color: colors.text }]}>مسیرهای انتخاب‌شدهٔ کاربران</Text>
            <Text style={s.small}>
              {faNumber(paths.profiles)} نفر «مسیرهای من» را ذخیره کرده‌اند. هر نفر تا سه مسیر انتخاب
              می‌کند.
            </Text>
            {PATHS.map((path) => {
              const selected = countOf(report, "path_selected", path.id);
              const removed = countOf(report, "path_removed", path.id);
              return (
                <CountRow
                  key={path.id}
                  label={path.name}
                  count={paths.counts[path.id] ?? 0}
                  max={pathMax}
                  note={
                    selected || removed
                      ? `در این دوره ${faNumber(selected)} بار انتخاب و ${faNumber(removed)} بار حذف شده است.`
                      : undefined
                  }
                />
              );
            })}
            <CountRow label="بدون مسیر" count={paths.none} max={pathMax} />
          </View>
          {report.total === 0 ? (
            <Text style={s.muted}>{EMPTY}</Text>
          ) : (
            <>
              <TopList
                title="پیشنهادهای شروع گفت‌وگو"
                items={report.events.starter_used ?? []}
                label={(id) => starterLabels.get(id) ?? id}
              />
              <TopList
                title="میان‌برها"
                items={report.events.shortcut_used ?? []}
                label={(id) => shortcutLabels.get(id) ?? id}
              />
              <TopList
                title="یادآوری مهلت‌ها"
                items={report.events.deadline_action ?? []}
                label={(id) => deadlineLabels.get(id) ?? id}
              />
              <TopList
                title="دستیارهای پیشنهادی"
                items={report.events.persona_suggestion_used ?? []}
                label={(id) => findPersona(id)?.name ?? id}
              />
              {invites && (invites.opened > 0 || invites.dismissed > 0) && (
                <Text style={s.small}>
                  کارت دعوت به انتخاب مسیر: {faNumber(invites.opened)} بار باز و{" "}
                  {faNumber(invites.dismissed)} بار بسته شد.
                </Text>
              )}
            </>
          )}
        </>
      )}
    </Card>
  );
}
