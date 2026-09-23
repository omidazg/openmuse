import { CreditCard, ReceiptText } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, Text, View } from "react-native";
import type { DailyUsage, Limits } from "./admin";
import type { MuseApi } from "./api";
import { faDate, faDateTime, faDigits, faMoney, faNumber, fw } from "./locale";
import { Button, Card, Chip, colors, Empty, ErrorNotice, Sheet, s } from "./ui";

export type PlanInfo = {
  id: string;
  name: string;
  price: number;
  days: number;
  description: string | null;
  /** null = unlimited */
  dailyMessages: number | null;
  dailyTasks: number | null;
  /** Model labels; null = every model. */
  models: string[] | null;
};
export type PaymentStatus = "pending" | "paid" | "failed";
export type PaymentInfo = {
  id: string;
  plan: string;
  planName: string;
  amount: number;
  gateway: "zarinpal" | "manual";
  status: PaymentStatus;
  refId: string | null;
  cardPan: string | null;
  days: number;
  periodEnd: string | null;
  createdAt: string;
  paidAt: string | null;
};
export type SubscriptionInfo = {
  plan: { id: string; name: string };
  currentPeriodEnd: string | null;
};
type BillingSummary = SubscriptionInfo & {
  enabled: boolean;
  plans: PlanInfo[];
  payments: PaymentInfo[];
  usage: DailyUsage;
  limits: Limits;
};

export const paymentStatusLabel: Record<PaymentStatus, string> = {
  paid: "پرداخت‌شده",
  pending: "در انتظار پرداخت",
  failed: "ناموفق",
};
export const paymentStatusTint: Record<PaymentStatus, string> = {
  paid: colors.green,
  pending: colors.orange,
  failed: colors.dangerSoft,
};
const ltr = { writingDirection: "ltr" as const, textAlign: "auto" as const };
const perDay = (value: number | null, noun: string) =>
  value === null ? `${noun} نامحدود` : `${faNumber(value)} ${noun} در روز`;
const used = (count: number, limit: number | null) =>
  limit === null ? `${faNumber(count)} (نامحدود)` : `${faNumber(count)} از ${faNumber(limit)}`;

/** «اشتراک حرفه‌ای تا ۲۹ مهر ۱۴۰۵» or «طرح رایگان». */
export function subscriptionLabel(sub: SubscriptionInfo) {
  return sub.currentPeriodEnd
    ? `اشتراک ${sub.plan.name} تا ${faDate(sub.currentPeriodEnd)}`
    : `طرح ${sub.plan.name}`;
}

/**
 * The gateway sends people back to `/?billing=…`; turn that flag into a Persian toast once and
 * clean the address bar so a refresh does not repeat it.
 */
export function readBillingReturn(): string | undefined {
  if (Platform.OS !== "web" || typeof window === "undefined") return undefined;
  const url = new URL(window.location.href);
  const flag = url.searchParams.get("billing");
  if (!flag) return undefined;
  const plan = url.searchParams.get("plan") || "حرفه‌ای";
  const until = url.searchParams.get("until");
  for (const key of ["billing", "plan", "until"]) url.searchParams.delete(key);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  if (flag === "success")
    return `پرداخت موفق بود؛ اشتراک ${plan} شما${until ? ` تا ${faDate(until)}` : ""} فعال است.`;
  if (flag === "pending")
    return "پرداخت شما در حال بررسی است. چند دقیقهٔ دیگر بخش «اشتراک» را باز کنید.";
  return "پرداخت انجام نشد. اگر مبلغی کسر شده، ظرف ۷۲ ساعت برمی‌گردد.";
}

function PlanCard({
  plan,
  current,
  busy,
  onBuy,
}: {
  plan: PlanInfo;
  current: boolean;
  busy: boolean;
  onBuy: () => void;
}) {
  const paid = plan.price > 0;
  return (
    <Card
      style={{
        gap: 6,
        borderWidth: current ? 2 : 1,
        borderColor: current ? colors.blueDark : colors.line,
      }}
    >
      <View style={[s.between, { gap: 8 }]}>
        <Text style={s.heading}>{plan.name}</Text>
        {current && <Chip tint={colors.sky}>طرح فعلی شما</Chip>}
      </View>
      {paid && (
        <Text style={[s.text, fw("700"), { fontSize: 18, lineHeight: 30 }]}>
          {faMoney(plan.price)}
          <Text style={[s.muted, fw("400")]}> برای {faNumber(plan.days)} روز</Text>
        </Text>
      )}
      {plan.description ? <Text style={s.muted}>{plan.description}</Text> : null}
      <Text style={s.small}>
        {perDay(plan.dailyMessages, "پیام")}، {perDay(plan.dailyTasks, "کار")}
      </Text>
      <Text style={s.small}>
        مدل‌ها: {plan.models ? plan.models.join("، ") : "همهٔ مدل‌های سرویس"}
      </Text>
      {paid && (
        <Button primary icon={CreditCard} busy={busy} onPress={onBuy} style={{ marginTop: 8 }}>
          {current ? "تمدید اشتراک" : "خرید اشتراک"}
        </Button>
      )}
    </Card>
  );
}

function PaymentRow({ payment }: { payment: PaymentInfo }) {
  return (
    <View
      style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 4 }}
    >
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        <Text style={[s.text, fw("600")]}>اشتراک {payment.planName}</Text>
        <Chip tint={paymentStatusTint[payment.status]}>{paymentStatusLabel[payment.status]}</Chip>
      </View>
      <Text style={s.small}>
        {payment.gateway === "manual"
          ? payment.amount
            ? `${faMoney(payment.amount)}، ثبت‌شده توسط مدیر`
            : "ثبت‌شده توسط مدیر"
          : faMoney(payment.amount)}
        {"، "}
        {faDateTime(payment.paidAt ?? payment.createdAt)}
      </Text>
      {payment.status === "paid" && payment.periodEnd ? (
        <Text style={s.small}>
          {faNumber(payment.days)} روز، تا {faDate(payment.periodEnd)}
        </Text>
      ) : null}
      {payment.refId ? (
        <Text style={s.small}>
          کد پیگیری: <Text style={ltr}>{faDigits(payment.refId)}</Text>
        </Text>
      ) : null}
      {payment.cardPan ? (
        <Text style={s.small}>
          کارت: <Text style={ltr}>{faDigits(payment.cardPan)}</Text>
        </Text>
      ) : null}
    </View>
  );
}

/** «اشتراک»: current plan and usage, plans to buy through Zarinpal, and payment history. */
export function BillingSheet({ api, onClose }: { api: MuseApi; onClose: () => void }) {
  const [summary, setSummary] = useState<BillingSummary>();
  const [error, setError] = useState("");
  const [buying, setBuying] = useState<string>();
  const load = useCallback(async () => {
    try {
      setSummary(await api.request<BillingSummary>("/api/billing"));
      setError("");
    } catch (e) {
      setError(`اطلاعات اشتراک بارگذاری نشد. ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);
  async function buy(planId: string) {
    setBuying(planId);
    setError("");
    try {
      const { url } = await api.request<{ url: string }>("/api/billing/checkout", { planId });
      // On web the page leaves for the gateway, so the button stays busy until it does.
      if (Platform.OS === "web" && typeof window !== "undefined") window.location.assign(url);
      else {
        await Linking.openURL(url);
        setBuying(undefined);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBuying(undefined);
    }
  }
  return (
    <Sheet title="اشتراک" subtitle="طرح فعلی، مصرف امروز و خرید اشتراک" onClose={onClose}>
      <View style={{ gap: 14 }}>
        <ErrorNotice error={error} />
        {!summary && !error && <ActivityIndicator color={colors.blueDark} />}
        {summary && (
          <>
            <Card style={{ gap: 6, backgroundColor: colors.sky }}>
              <Text style={s.heading}>{subscriptionLabel(summary)}</Text>
              {!summary.currentPeriodEnd && (
                <Text style={s.small}>
                  با خرید اشتراک، سقف روزانهٔ بالاتری می‌گیرید. پس از پایان دوره، حساب شما خودکار به
                  طرح رایگان برمی‌گردد.
                </Text>
              )}
              <Text style={s.small}>
                پیام‌های امروز: {used(summary.usage.messages, summary.limits.messages)}
              </Text>
              <Text style={s.small}>
                کارهای امروز: {used(summary.usage.tasks, summary.limits.tasks)}
              </Text>
            </Card>
            <Text style={s.heading}>طرح‌ها</Text>
            {summary.plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                current={plan.id === summary.plan.id}
                busy={buying === plan.id}
                onBuy={() => void buy(plan.id)}
              />
            ))}
            <Text style={s.small}>
              پرداخت در درگاه امن زرین‌پال انجام می‌شود و پس از تأیید، اشتراک همان لحظه فعال می‌شود.
            </Text>
            <View style={s.divider} />
            <Text style={s.heading}>پرداخت‌های شما</Text>
            {summary.payments.length ? (
              summary.payments.map((payment) => <PaymentRow key={payment.id} payment={payment} />)
            ) : (
              <Empty
                icon={ReceiptText}
                title="هنوز پرداختی ندارید"
                detail="پس از خرید اشتراک، رسید هر پرداخت با کد پیگیری اینجا نمایش داده می‌شود."
              />
            )}
          </>
        )}
      </View>
    </Sheet>
  );
}
