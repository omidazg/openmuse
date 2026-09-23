/**
 * Subscriptions paid through an Iranian payment gateway (Zarinpal v4).
 *
 * Flow: POST /api/billing/checkout stores a pending payment and asks the gateway for an
 * authority; the browser goes to StartPay; the gateway redirects back to
 * GET /api/billing/callback, which verifies the stored amount server-side and extends the
 * owner's plan. The payment record, not the callback query, decides owner, plan and amount.
 */
import { randomUUID } from "node:crypto";
import { BRAND } from "../../../packages/domain/src/brand.ts";
import { billingEnabled, type Config } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";
import { activeSubscription, configPlans, FREE_PLAN_ID, type Plan } from "./plans.ts";
import type { Users } from "./users.ts";

const SYSTEM = "system";
const PAYMENTS = "payments";
const AUTHORITIES = "payment-authorities";
const DAY = 86_400_000;
/** A verification claim older than this is assumed abandoned (process restart). */
const STALE_CLAIM = 2 * 60_000;

export type PaymentStatus = "pending" | "verifying" | "paid" | "failed";
export interface PaymentRecord {
  id: string;
  owner: string;
  plan: string;
  /** Toman. */
  amount: number;
  currency: "IRT";
  gateway: "zarinpal" | "manual";
  status: PaymentStatus;
  days: number;
  authority?: string;
  refId?: string;
  /** Masked card number as reported by the gateway, e.g. 502229******5995. */
  cardPan?: string;
  /** Last gateway result code (for support). */
  code?: number;
  /** Period end this payment produced. */
  periodEnd?: string;
  /** Admin who granted a manual plan. */
  grantedBy?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
  paidAt?: string;
}

/** Gateway-neutral surface, so an IDPay-style provider can be added beside Zarinpal. */
export interface PaymentGateway {
  readonly id: "zarinpal";
  request(input: {
    amount: number;
    description: string;
    callbackUrl: string;
    mobile?: string;
    orderId: string;
  }): Promise<{ authority: string; redirectUrl: string }>;
  verify(input: {
    authority: string;
    amount: number;
  }): Promise<
    | { ok: true; alreadyVerified: boolean; refId: string; cardPan?: string; code: number }
    | { ok: false; code: number }
  >;
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

type ZarinpalData = {
  code?: number;
  authority?: string;
  ref_id?: number | string;
  card_pan?: string;
};
type ZarinpalBody = {
  data?: ZarinpalData | [];
  errors?: { code?: number; message?: string } | [];
};

/** Zarinpal payment gateway v4 (amounts in Toman via currency "IRT"). */
export class ZarinpalGateway implements PaymentGateway {
  readonly id = "zarinpal" as const;
  private readonly base: string;
  constructor(
    private readonly merchantId: string,
    sandbox: boolean,
    private readonly fetcher: typeof fetch = (...args) => fetch(...args),
  ) {
    this.base = sandbox ? "https://sandbox.zarinpal.com" : "https://payment.zarinpal.com";
  }
  private async post(path: string, body: Record<string, unknown>) {
    let response: Response;
    try {
      response = await this.fetcher(`${this.base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ merchant_id: this.merchantId, ...body }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new GatewayError("zarinpal unreachable");
    }
    let json: ZarinpalBody = {};
    try {
      json = (await response.json()) as ZarinpalBody;
    } catch {}
    const data: ZarinpalData = Array.isArray(json.data) ? {} : (json.data ?? {});
    const errors: { code?: number } = Array.isArray(json.errors) ? {} : (json.errors ?? {});
    return { data, code: Number(data.code ?? errors.code ?? response.status) };
  }
  async request(input: Parameters<PaymentGateway["request"]>[0]) {
    const { data, code } = await this.post("/pg/v4/payment/request.json", {
      amount: input.amount,
      currency: "IRT",
      description: input.description,
      callback_url: input.callbackUrl,
      metadata: { ...(input.mobile ? { mobile: input.mobile } : {}), order_id: input.orderId },
    });
    if (code !== 100 || typeof data.authority !== "string" || !data.authority)
      throw new GatewayError("zarinpal request rejected", code);
    return {
      authority: data.authority,
      redirectUrl: `${this.base}/pg/StartPay/${encodeURIComponent(data.authority)}`,
    };
  }
  async verify(input: Parameters<PaymentGateway["verify"]>[0]) {
    const { data, code } = await this.post("/pg/v4/payment/verify.json", {
      amount: input.amount,
      authority: input.authority,
    });
    if (code === 100 || code === 101)
      return {
        ok: true as const,
        alreadyVerified: code === 101,
        refId: String(data.ref_id ?? ""),
        cardPan: typeof data.card_pan === "string" ? data.card_pan : undefined,
        code,
      };
    return { ok: false as const, code };
  }
}

/** Never store more than the first 6 and last 4 digits of a card. */
export function maskCardPan(raw?: string): string | undefined {
  if (!raw) return undefined;
  const clean = raw.replace(/[^\d*]/g, "");
  if (clean.length < 10) return undefined;
  return `${clean.slice(0, 6)}${"*".repeat(Math.max(clean.length - 10, 2))}${clean.slice(-4)}`;
}

const faDigits = (value: number | string) =>
  String(value).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

export type CallbackResult =
  | { ok: true; plan: Plan; periodEnd: string }
  | { ok: false; reason: "cancelled" | "unknown" | "failed" | "busy" };

export class Billing {
  readonly gateway?: PaymentGateway;
  constructor(
    private readonly db: Store,
    private readonly config: Config,
    private readonly users: Users,
    options: { fetch?: typeof fetch; gateway?: PaymentGateway; now?: () => number } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.gateway =
      options.gateway ??
      (billingEnabled(config)
        ? new ZarinpalGateway(
            config.zarinpalMerchantId as string,
            Boolean(config.zarinpalSandbox),
            options.fetch,
          )
        : undefined);
  }
  private readonly now: () => number;
  get enabled() {
    return Boolean(this.gateway);
  }
  plans() {
    return configPlans(this.config);
  }
  private plan(id: string) {
    const plan = this.plans().find((p) => p.id === id);
    if (!plan) throw new AppError("این طرح اشتراک پیدا نشد. فهرست طرح‌ها را تازه کنید.", 404);
    return plan;
  }
  async payments(owner?: string) {
    const all = await this.db.list<PaymentRecord>(SYSTEM, PAYMENTS);
    return all
      .filter((p) => owner === undefined || p.owner === owner)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  /** Starts a gateway payment for a paid plan and returns the StartPay URL. */
  async checkout(owner: string, planId: string) {
    const gateway = this.gateway;
    if (!gateway) throw new AppError("پرداخت آنلاین روی این سرور فعال نیست.", 404);
    const plan = this.plan(planId);
    if (plan.id === FREE_PLAN_ID || plan.price <= 0)
      throw new AppError("طرح رایگان نیازی به پرداخت ندارد.", 422);
    const user = await this.users.get(owner);
    if (!user)
      throw new AppError("خرید اشتراک فقط برای کاربران ثبت‌شده ممکن است. دوباره وارد شوید.", 403);
    const now = new Date(this.now()).toISOString();
    const payment: PaymentRecord = {
      id: randomUUID(),
      owner,
      plan: plan.id,
      amount: plan.price,
      currency: "IRT",
      gateway: gateway.id,
      status: "pending",
      days: plan.days,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.put(SYSTEM, PAYMENTS, payment);
    let started: { authority: string; redirectUrl: string };
    try {
      started = await gateway.request({
        amount: payment.amount,
        description: `خرید اشتراک ${plan.name} ${BRAND.nameFa} برای ${faDigits(plan.days)} روز`,
        callbackUrl: `${this.config.publicUrl.replace(/\/$/, "")}/api/billing/callback`,
        mobile: user.phone,
        orderId: payment.id,
      });
    } catch (error) {
      await this.db.put(SYSTEM, PAYMENTS, {
        ...payment,
        status: "failed" as const,
        code: error instanceof GatewayError ? error.code : undefined,
        updatedAt: new Date(this.now()).toISOString(),
      });
      throw new AppError("اتصال به درگاه پرداخت برقرار نشد. چند دقیقهٔ دیگر دوباره تلاش کنید.", 502);
    }
    await this.db.put(SYSTEM, AUTHORITIES, { id: started.authority, paymentId: payment.id });
    await this.db.put(SYSTEM, PAYMENTS, {
      ...payment,
      authority: started.authority,
      updatedAt: new Date(this.now()).toISOString(),
    });
    return { url: started.redirectUrl, paymentId: payment.id };
  }
  /**
   * Handles the gateway redirect. Idempotent: a second callback for a paid payment reports the
   * same result without extending the plan again; only a pending payment can be claimed.
   */
  async callback(authority: string, status: string): Promise<CallbackResult> {
    const gateway = this.gateway;
    if (!gateway || !/^[A-Za-z0-9]{1,64}$/.test(authority)) return { ok: false, reason: "unknown" };
    const index = await this.db.get<{ paymentId: string }>(SYSTEM, AUTHORITIES, authority);
    const payment = index && (await this.db.get<PaymentRecord>(SYSTEM, PAYMENTS, index.paymentId));
    if (!payment || payment.authority !== authority) return { ok: false, reason: "unknown" };
    const settled = this.settled(payment);
    if (settled) return settled;
    const stamp = () => new Date(this.now()).toISOString();
    if (status !== "OK" && payment.status === "pending") {
      await this.db.compareAndSwap(
        SYSTEM,
        PAYMENTS,
        payment.id,
        { status: "pending" },
        { status: "failed", updatedAt: stamp() },
      );
      return { ok: false, reason: "cancelled" };
    }
    // Claim the payment so concurrent or replayed callbacks cannot verify it twice. A claim left
    // behind by a crashed process is taken over; Zarinpal then answers 101 (already verified).
    const claimed = await this.db.compareAndSwap<PaymentRecord>(
      SYSTEM,
      PAYMENTS,
      payment.id,
      payment.status === "pending"
        ? { status: "pending" }
        : { status: "verifying", updatedAt: payment.updatedAt },
      { status: "verifying", updatedAt: stamp() },
    );
    if (!claimed) {
      const latest = await this.db.get<PaymentRecord>(SYSTEM, PAYMENTS, payment.id);
      return (latest && this.settled(latest)) || { ok: false, reason: "busy" };
    }
    let result: Awaited<ReturnType<PaymentGateway["verify"]>>;
    try {
      // The amount comes from our record; Zarinpal rejects it (-50) if it differs from the payment.
      result = await gateway.verify({ authority, amount: claimed.amount });
    } catch {
      // Unknown outcome: release the claim so the same callback can be retried.
      await this.db.put(SYSTEM, PAYMENTS, { ...claimed, status: "pending", updatedAt: stamp() });
      return { ok: false, reason: "failed" };
    }
    if (!result.ok) {
      await this.db.put(SYSTEM, PAYMENTS, {
        ...claimed,
        status: "failed",
        code: result.code,
        updatedAt: stamp(),
      });
      return { ok: false, reason: "failed" };
    }
    const plan = this.plan(claimed.plan);
    const periodEnd = await this.extend(claimed.owner, plan, claimed.days);
    await this.db.put(SYSTEM, PAYMENTS, {
      ...claimed,
      status: "paid",
      code: result.code,
      refId: result.refId,
      cardPan: maskCardPan(result.cardPan),
      periodEnd,
      paidAt: stamp(),
      updatedAt: stamp(),
    });
    return { ok: true, plan, periodEnd };
  }
  /** The final answer for a payment that must not be verified (again), or null to proceed. */
  private settled(payment: PaymentRecord): CallbackResult | null {
    if (payment.status === "paid" && payment.periodEnd)
      return { ok: true, plan: this.plan(payment.plan), periodEnd: payment.periodEnd };
    if (payment.status === "failed") return { ok: false, reason: "failed" };
    if (payment.status === "verifying" && this.now() - Date.parse(payment.updatedAt) < STALE_CLAIM)
      return { ok: false, reason: "busy" };
    return null;
  }
  /** Adds `days` to the owner's plan: from the current end when renewing, otherwise from now. */
  private async extend(owner: string, plan: Plan, days: number) {
    const user = await this.users.get(owner);
    const current = activeSubscription(this.plans(), user, this.now());
    const start =
      current.plan.id === plan.id && current.currentPeriodEnd
        ? Date.parse(current.currentPeriodEnd)
        : this.now();
    const periodEnd = new Date(start + days * DAY).toISOString();
    await this.users.setPlan(owner, plan.id, periodEnd);
    return periodEnd;
  }
  /** Admin: grant or extend a plan (e.g. a cash payment), or move someone back to free. */
  async grant(input: {
    owner: string;
    planId: string;
    days?: number;
    amount?: number;
    note?: string;
    by: string;
  }) {
    const plan = this.plan(input.planId);
    if (!(await this.users.get(input.owner)))
      throw new AppError("این کاربر پیدا نشد. فهرست کاربران را تازه کنید.", 404);
    if (plan.id === FREE_PLAN_ID) {
      await this.users.setPlan(input.owner, FREE_PLAN_ID);
      return { plan, periodEnd: null };
    }
    const days = input.days ?? plan.days;
    const periodEnd = await this.extend(input.owner, plan, days);
    const now = new Date(this.now()).toISOString();
    await this.db.put<PaymentRecord>(SYSTEM, PAYMENTS, {
      id: randomUUID(),
      owner: input.owner,
      plan: plan.id,
      amount: input.amount ?? 0,
      currency: "IRT",
      gateway: "manual",
      status: "paid",
      days,
      periodEnd,
      grantedBy: input.by,
      note: input.note,
      createdAt: now,
      updatedAt: now,
      paidAt: now,
    });
    return { plan, periodEnd };
  }
}
