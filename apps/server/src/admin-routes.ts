import { Hono } from "hono";
import { z } from "zod";
import type { Billing } from "./billing.ts";
import { publicPayment } from "./billing-routes.ts";
import type { Config } from "./config.ts";
import { AppError } from "./errors.ts";
import type { Usage } from "./usage.ts";
import { normalizePhone, publicUser, type Role, type Users } from "./users.ts";

type Env = { Variables: { owner: string; role: Role } };

const limit = z.number().int().min(0).max(1000000).nullable().optional();
const quotaSchema = z.object({ dailyMessages: limit, dailyTasks: limit }).optional();
const phoneSchema = z
  .string()
  .trim()
  .max(32)
  .transform((value, ctx) => {
    if (!value) return undefined;
    const phone = normalizePhone(value);
    if (!phone)
      ctx.addIssue({
        code: "custom",
        message: "شمارهٔ موبایل نامعتبر است. آن را به شکل ۰۹۱۲۱۲۳۴۵۶۷ وارد کنید.",
      });
    return phone;
  });
const createSchema = z.object({
  name: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9_-]{1,32}$/,
      "نام کاربری فقط می‌تواند حروف کوچک انگلیسی، عدد، «_» یا «-» باشد (حداکثر ۳۲ نویسه).",
    ),
  label: z.string().trim().max(80).optional(),
  phone: phoneSchema.optional(),
  role: z.enum(["admin", "user"]).optional(),
  quota: quotaSchema,
});
const patchSchema = z.object({
  label: z.string().trim().max(80).nullable().optional(),
  phone: phoneSchema.nullable().optional(),
  role: z.enum(["admin", "user"]).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  quota: quotaSchema,
});

/** /api/admin: user management and usage, for admin sessions only. */
const grantSchema = z.object({
  planId: z.string().min(1).max(32),
  days: z.number().int().min(1).max(3660).optional(),
  amount: z.number().int().min(0).max(1_000_000_000).optional(),
  note: z.string().trim().max(200).optional(),
});

export function adminRoutes(users: Users, usage: Usage, config: Config, billing: Billing) {
  const app = new Hono<Env>();
  app.use("*", async (c, next) => {
    if (c.get("role") !== "admin")
      throw new AppError("این بخش فقط برای مدیر سرویس در دسترس است.", 403);
    await next();
  });
  app.get("/users", async (c) => {
    const [list, sessions] = await Promise.all([users.list(), users.sessionCounts()]);
    const rows = await Promise.all(
      list.map(async (user) => ({
        ...publicUser(user),
        sessions: sessions.get(user.id) ?? 0,
        usage: await usage.today(user.id),
        limits: await usage.limits(user.id),
        subscription: await usage.subscription(user.id).then((sub) => ({
          plan: { id: sub.plan.id, name: sub.plan.name },
          currentPeriodEnd: sub.currentPeriodEnd,
        })),
      })),
    );
    rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return c.json({
      users: rows,
      defaults: {
        messages: config.dailyMessageLimit ?? 200,
        tasks: config.dailyTaskLimit ?? 30,
      },
      plans: billing.plans().map(({ id, name, days, price }) => ({ id, name, days, price })),
      billingEnabled: billing.enabled,
    });
  });
  app.post("/users", async (c) => {
    const body = createSchema.parse(await c.req.json());
    const { user, key } = await users.create(body);
    // The key is shown once; only its hash is stored.
    return c.json({ user: publicUser(user), key }, 201);
  });
  app.patch("/users/:id", async (c) => {
    const id = c.req.param("id");
    const body = patchSchema.parse(await c.req.json());
    if (id === c.get("owner") && (body.status === "disabled" || body.role === "user"))
      throw new AppError("حساب خودتان را نمی‌توانید غیرفعال یا محدود کنید.", 409);
    return c.json({ user: publicUser(await users.update(id, body)) });
  });
  app.post("/users/:id/rotate-key", async (c) => {
    const { user, key } = await users.rotateKey(c.req.param("id"));
    return c.json({ user: publicUser(user), key });
  });
  app.delete("/users/:id/sessions", async (c) =>
    c.json({ deleted: await users.deleteSessions(c.req.param("id")) }),
  );
  /** Grant or extend a plan by hand (cash or bank transfer); "free" ends the subscription. */
  app.post("/users/:id/plan", async (c) => {
    const body = grantSchema.parse(await c.req.json());
    const result = await billing.grant({ ...body, owner: c.req.param("id"), by: c.get("owner") });
    return c.json({
      plan: { id: result.plan.id, name: result.plan.name },
      periodEnd: result.periodEnd,
    });
  });
  app.get("/payments", async (c) => {
    const [payments, list] = await Promise.all([billing.payments(), users.list()]);
    const names = new Map(list.map((user) => [user.id, user.label || user.name]));
    const plans = billing.plans();
    return c.json({
      payments: payments.slice(0, 200).map((payment) => ({
        ...publicPayment(payment, plans),
        owner: payment.owner,
        ownerName: names.get(payment.owner) ?? payment.owner,
        code: payment.code ?? null,
        grantedBy: payment.grantedBy ?? null,
        note: payment.note ?? null,
      })),
    });
  });
  app.get("/users/:id/usage", async (c) => {
    const days = z.coerce.number().int().min(1).max(90).catch(30).parse(c.req.query("days"));
    const id = c.req.param("id");
    if (!(await users.get(id))) throw new AppError("این کاربر پیدا نشد.", 404);
    return c.json({ days: await usage.history(id, days), limits: await usage.limits(id) });
  });
  return app;
}
