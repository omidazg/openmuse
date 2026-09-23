import { Hono } from "hono";
import { z } from "zod";
import type { Billing, PaymentRecord } from "./billing.ts";
import type { Config } from "./config.ts";
import { AppError } from "./errors.ts";
import { configCatalog } from "./models.ts";
import type { Plan } from "./plans.ts";
import { RateLimiter } from "./rate-limit.ts";
import type { Usage } from "./usage.ts";
import type { Role } from "./users.ts";

type Env = { Variables: { owner: string; role: Role } };

const effective = (value: number | null, fallback: number) => {
  const chosen = value ?? fallback;
  return chosen > 0 ? chosen : null;
};

/** A plan as clients see it: limits resolved against server defaults (null = unlimited). */
export function publicPlan(plan: Plan, config: Config) {
  const labels = new Map(configCatalog(config).models.map((m) => [m.id, m.label]));
  return {
    id: plan.id,
    name: plan.name,
    price: plan.price,
    days: plan.days,
    description: plan.description ?? null,
    dailyMessages: effective(plan.dailyMessages, config.dailyMessageLimit ?? 200),
    dailyTasks: effective(plan.dailyTasks, config.dailyTaskLimit ?? 30),
    /** Labels of the allowed models; null means every model. */
    models: plan.models ? plan.models.map((id) => labels.get(id) ?? id) : null,
  };
}

/** Payment fields safe to show the payer (no authority tokens). */
export function publicPayment(payment: PaymentRecord, plans: Plan[]) {
  return {
    id: payment.id,
    plan: payment.plan,
    planName: plans.find((p) => p.id === payment.plan)?.name ?? payment.plan,
    amount: payment.amount,
    gateway: payment.gateway,
    // An in-flight verification is still "pending" to the payer.
    status: payment.status === "verifying" ? "pending" : payment.status,
    refId: payment.refId ?? null,
    cardPan: payment.cardPan ?? null,
    days: payment.days,
    periodEnd: payment.periodEnd ?? null,
    createdAt: payment.createdAt,
    paidAt: payment.paidAt ?? null,
  };
}

/** /api/billing for signed-in people. Every route is 404 while billing is disabled. */
export function billingRoutes(billing: Billing, usage: Usage, config: Config) {
  const app = new Hono<Env>();
  const checkouts = new RateLimiter(10, 10 * 60 * 1000);
  app.use("*", async (_c, next) => {
    if (!billing.enabled) throw new AppError("پرداخت آنلاین روی این سرور فعال نیست.", 404);
    await next();
  });
  app.get("/", async (c) => {
    const owner = c.get("owner");
    const plans = billing.plans();
    const subscription = await usage.subscription(owner);
    return c.json({
      enabled: true,
      plan: { id: subscription.plan.id, name: subscription.plan.name },
      currentPeriodEnd: subscription.currentPeriodEnd,
      plans: plans.map((plan) => publicPlan(plan, config)),
      payments: (await billing.payments(owner)).map((p) => publicPayment(p, plans)),
      usage: await usage.today(owner),
      limits: await usage.limits(owner),
    });
  });
  app.post("/checkout", async (c) => {
    const body = z.object({ planId: z.string().min(1).max(32) }).parse(await c.req.json());
    if (!checkouts.take(c.get("owner")))
      throw new AppError("درخواست‌های پرداخت زیاد بوده است. چند دقیقهٔ دیگر دوباره تلاش کنید.", 429);
    return c.json(await billing.checkout(c.get("owner"), body.planId), 201);
  });
  return app;
}

/**
 * GET /api/billing/callback: the browser returns here from the gateway. It carries no session,
 * so the stored payment decides whose plan is extended; the result goes back to the web app
 * as a query flag that it shows as a toast.
 */
export function billingCallback(billing: Billing, config: Config) {
  const app = new Hono();
  app.get("/", async (c) => {
    if (!billing.enabled) throw new AppError("پرداخت آنلاین روی این سرور فعال نیست.", 404);
    const result = await billing.callback(
      c.req.query("Authority") ?? "",
      c.req.query("Status") ?? "",
    );
    const target = new URL(`${config.publicUrl.replace(/\/$/, "")}/`);
    if (result.ok) {
      target.searchParams.set("billing", "success");
      target.searchParams.set("plan", result.plan.name);
      target.searchParams.set("until", result.periodEnd);
    } else target.searchParams.set("billing", result.reason === "busy" ? "pending" : "failed");
    return c.redirect(target.toString(), 302);
  });
  return app;
}
