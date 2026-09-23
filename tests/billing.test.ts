import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import { maskCardPan } from "../apps/server/src/billing.ts";
import { type Config, parseUserKeys } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { parseModels } from "../apps/server/src/models.ts";
import { activeSubscription, DEFAULT_PLANS, parsePlans } from "../apps/server/src/plans.ts";

const adminKey = "admin-key-aaaaaaaaaaaaaaaaaaaaaaaa";
const aliKey = "ali-key-bbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const saraKey = "sara-key-cccccccccccccccccccccccccccc";
const MERCHANT = "00000000-1111-2222-3333-444444444444";
const DAY = 86_400_000;
type App = Awaited<ReturnType<typeof createApp>>;

let db: Store, directory: string;
const stores: Store[] = [];
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "openmuse-billing-"));
});
// Every test starts with empty users and payments.
beforeEach(async () => {
  db = await createStore();
  stores.push(db);
});
after(async () => {
  for (const store of stores) await store.close();
  await rm(directory, { recursive: true, force: true });
});

let counter = 0;
function liveConfig(extra: Partial<Config> = {}): Config {
  return {
    mode: "live",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "https://dastyar.example.ir",
    dataDir: join(directory, String(counter++)),
    accessKey: adminKey,
    userKeys: parseUserKeys(`ali:${aliKey},sara:${saraKey}`),
    encryptionKey: randomBytes(32).toString("base64"),
    agentBackend: "agui",
    agentUrl: "http://127.0.0.1:1/unreachable",
    googleRedirectUri: "https://dastyar.example.ir/api/google/callback",
    allowedOrigins: ["http://localhost:8081"],
    dailyMessageLimit: 200,
    dailyTaskLimit: 30,
    zarinpalMerchantId: MERCHANT,
    ...extra,
  };
}

/** A fake Zarinpal: remembers each authority's amount and whether it was verified. */
function fakeZarinpal() {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const issued = new Map<string, { amount: number; verified: boolean }>();
  let next = 0;
  const reply = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url, body });
    if (body.merchant_id !== MERCHANT) return reply({ data: [], errors: { code: -10 } });
    if (url.endsWith("/pg/v4/payment/request.json")) {
      const authority = `A${String(++next).padStart(35, "0")}`;
      issued.set(authority, { amount: Number(body.amount), verified: false });
      return reply({ data: { code: 100, authority, fee_type: "Merchant", fee: 0 }, errors: [] });
    }
    if (url.endsWith("/pg/v4/payment/verify.json")) {
      const entry = issued.get(String(body.authority));
      if (!entry) return reply({ data: [], errors: { code: -54 } });
      if (entry.amount !== body.amount) return reply({ data: [], errors: { code: -50 } });
      const code = entry.verified ? 101 : 100;
      entry.verified = true;
      return reply({
        data: { code, ref_id: 201, card_pan: "502229******5995", card_hash: "x", fee: 0 },
        errors: [],
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetcher, calls, issued };
}

const json = (token?: string) => ({
  "Content-Type": "application/json",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});
async function login(app: App["app"], accessKey: string) {
  const response = await app.request("/api/session", {
    method: "POST",
    headers: json(),
    body: JSON.stringify({ accessKey }),
  });
  assert.equal(response.status, 200);
  return ((await response.json()) as { token: string }).token;
}
async function call(app: App["app"], token: string, path: string, method = "GET", body?: unknown) {
  const response = await app.request(path, {
    method,
    headers: json(token),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
async function callback(app: App["app"], authority: string, status = "OK") {
  const response = await app.request(
    `/api/billing/callback?Authority=${encodeURIComponent(authority)}&Status=${status}`,
  );
  assert.equal(response.status, 302);
  return new URL(response.headers.get("location") ?? "");
}

test("plans parse from PLANS JSON, keep a free plan and reject bad prices", () => {
  assert.equal(parsePlans(""), DEFAULT_PLANS);
  const plans = parsePlans(
    '[{"id":"pro","name":"حرفه‌ای","price":150000,"dailyMessages":500,"models":["openai/gpt-4.1-mini"]}]',
  );
  assert.deepEqual(
    plans.map((p) => p.id),
    ["free", "pro"],
  );
  assert.equal(plans[1].days, 30);
  assert.equal(plans[1].dailyTasks, null);
  assert.throws(() => parsePlans('[{"id":"free","name":"رایگان","price":1000}]'), /price 0/);
  assert.throws(() => parsePlans('[{"id":"pro","name":"حرفه‌ای","price":50}]'), /1000 Toman/);
  assert.throws(() => parsePlans("{"), /JSON array/);
  assert.equal(maskCardPan("5022291234565995"), "502229******5995");
  assert.equal(maskCardPan("502229******5995"), "502229******5995");
  assert.equal(maskCardPan("12"), undefined);
});

test("billing is off without ZARINPAL_MERCHANT_ID", async () => {
  const { app } = await createApp(db, liveConfig({ zarinpalMerchantId: undefined }));
  const health = await (await app.request("/api/health")).json();
  assert.equal(health.billingEnabled, false);
  const ali = await login(app, aliKey);
  assert.equal((await call(app, ali, "/api/billing")).status, 404);
  assert.equal(
    (await call(app, ali, "/api/billing/checkout", "POST", { planId: "pro" })).status,
    404,
  );
  assert.equal((await app.request("/api/billing/callback?Authority=A1&Status=OK")).status, 404);
  const me = await call(app, ali, "/api/me");
  assert.equal(me.body.billingEnabled, false);
  assert.equal(me.body.subscription.plan.id, "free");
});

test("checkout stores a pending payment and asks Zarinpal in Toman", async () => {
  const zarinpal = fakeZarinpal();
  const { app } = await createApp(db, liveConfig({ zarinpalSandbox: true }), {
    fetch: zarinpal.fetcher,
  });
  assert.equal((await (await app.request("/api/health")).json()).billingEnabled, true);
  const admin = await login(app, adminKey);
  await call(app, admin, "/api/admin/users/user-ali", "PATCH", { phone: "09121234567" });
  const ali = await login(app, aliKey);
  const started = await call(app, ali, "/api/billing/checkout", "POST", { planId: "pro" });
  assert.equal(started.status, 201);
  const [request] = zarinpal.calls;
  assert.equal(request.url, "https://sandbox.zarinpal.com/pg/v4/payment/request.json");
  assert.equal(request.body.amount, 199000);
  assert.equal(request.body.currency, "IRT");
  assert.equal(request.body.callback_url, "https://dastyar.example.ir/api/billing/callback");
  assert.match(String(request.body.description), /حرفه‌ای/);
  assert.deepEqual(request.body.metadata, {
    mobile: "09121234567",
    order_id: started.body.paymentId,
  });
  const authority = [...zarinpal.issued.keys()][0];
  assert.equal(started.body.url, `https://sandbox.zarinpal.com/pg/StartPay/${authority}`);
  const record = await db.get<Record<string, unknown>>(
    "system",
    "payments",
    started.body.paymentId,
  );
  assert.equal(record?.status, "pending");
  assert.equal(record?.owner, "user-ali");
  assert.equal(record?.amount, 199000);
  assert.equal(record?.authority, authority);
  // Free and unknown plans cannot be bought.
  assert.equal(
    (await call(app, ali, "/api/billing/checkout", "POST", { planId: "free" })).status,
    422,
  );
  assert.equal(
    (await call(app, ali, "/api/billing/checkout", "POST", { planId: "gold" })).status,
    404,
  );
  const summary = await call(app, ali, "/api/billing");
  assert.equal(summary.body.plan.id, "free");
  assert.equal(summary.body.payments.length, 1);
  assert.equal(summary.body.payments[0].status, "pending");
  assert.equal(summary.body.payments[0].authority, undefined);
});

test("a verified callback activates pro for 30 days; replays do not extend it", async () => {
  const zarinpal = fakeZarinpal();
  const { app } = await createApp(db, liveConfig(), { fetch: zarinpal.fetcher });
  const ali = await login(app, aliKey);
  const sara = await login(app, saraKey);
  const started = await call(app, ali, "/api/billing/checkout", "POST", { planId: "pro" });
  const authority = [...zarinpal.issued.keys()][0];
  const before = Date.now();
  const location = await callback(app, authority);
  assert.equal(location.origin, "https://dastyar.example.ir");
  assert.equal(location.searchParams.get("billing"), "success");
  assert.equal(location.searchParams.get("plan"), "حرفه‌ای");
  const until = Date.parse(location.searchParams.get("until") ?? "");
  assert.ok(until >= before + 30 * DAY && until <= Date.now() + 30 * DAY);
  const verify = zarinpal.calls.find((c) => c.url.endsWith("verify.json"));
  assert.deepEqual(verify?.body, { merchant_id: MERCHANT, amount: 199000, authority });

  const me = await call(app, ali, "/api/me");
  assert.equal(me.body.subscription.plan.id, "pro");
  assert.deepEqual(me.body.limits, { messages: 1000, tasks: 100 });
  const record = await db.get<Record<string, unknown>>(
    "system",
    "payments",
    started.body.paymentId,
  );
  assert.equal(record?.status, "paid");
  assert.equal(record?.refId, "201");
  assert.equal(record?.cardPan, "502229******5995");

  // Replay: same answer, no second verify, no second extension.
  const verifies = zarinpal.calls.length;
  const again = await callback(app, authority);
  assert.equal(again.searchParams.get("billing"), "success");
  assert.equal(again.searchParams.get("until"), location.searchParams.get("until"));
  assert.equal(zarinpal.calls.length, verifies);
  assert.equal((await call(app, ali, "/api/billing")).body.currentPeriodEnd, record?.periodEnd);

  // The payment belonged to ali; sara is untouched and cannot see it.
  const saraBilling = await call(app, sara, "/api/billing");
  assert.equal(saraBilling.body.plan.id, "free");
  assert.equal(saraBilling.body.payments.length, 0);

  // Renewing adds 30 days to the current end.
  await call(app, ali, "/api/billing/checkout", "POST", { planId: "pro" });
  const renewed = await callback(app, [...zarinpal.issued.keys()][1]);
  assert.equal(Date.parse(renewed.searchParams.get("until") ?? ""), until + 30 * DAY);
});

test("cancelled, unknown and tampered callbacks fail without activating a plan", async () => {
  const zarinpal = fakeZarinpal();
  const { app } = await createApp(db, liveConfig(), { fetch: zarinpal.fetcher });
  const ali = await login(app, aliKey);

  // Cancelled at the gateway: marked failed; a later "OK" replay is still a failure.
  await call(app, ali, "/api/billing/checkout", "POST", { planId: "pro" });
  const cancelled = [...zarinpal.issued.keys()][0];
  assert.equal((await callback(app, cancelled, "NOK")).searchParams.get("billing"), "failed");
  assert.equal((await callback(app, cancelled, "OK")).searchParams.get("billing"), "failed");
  assert.equal(zarinpal.calls.filter((c) => c.url.endsWith("verify.json")).length, 0);

  // Unknown or malformed authorities.
  assert.equal((await callback(app, "A999")).searchParams.get("billing"), "failed");
  assert.equal((await callback(app, "../../x")).searchParams.get("billing"), "failed");

  // Amount tampering: the stored amount no longer matches what the gateway charged.
  const started = await call(app, ali, "/api/billing/checkout", "POST", { planId: "pro" });
  const record = await db.get<Record<string, unknown> & { id: string }>(
    "system",
    "payments",
    started.body.paymentId,
  );
  assert.ok(record);
  await db.put("system", "payments", { ...record, amount: 1000 });
  const tampered = [...zarinpal.issued.keys()][1];
  assert.equal((await callback(app, tampered)).searchParams.get("billing"), "failed");
  const failed = await db.get<Record<string, unknown>>("system", "payments", record.id);
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.code, -50);
  assert.equal((await call(app, ali, "/api/me")).body.subscription.plan.id, "free");

  // A gateway outage during checkout is a Persian 502 and a failed record.
  const down = await createApp(db, liveConfig(), {
    fetch: (async () => {
      throw new Error("offline");
    }) as typeof fetch,
  });
  const token = await login(down.app, aliKey);
  const result = await call(down.app, token, "/api/billing/checkout", "POST", { planId: "pro" });
  assert.equal(result.status, 502);
  assert.match(result.body.error, /درگاه پرداخت/);
});

test("an already-verified (101) payment still activates once after a lost claim", async () => {
  const zarinpal = fakeZarinpal();
  let now = Date.now();
  const { app } = await createApp(db, liveConfig(), { fetch: zarinpal.fetcher, now: () => now });
  const ali = await login(app, aliKey);
  const started = await call(app, ali, "/api/billing/checkout", "POST", { planId: "pro" });
  const authority = [...zarinpal.issued.keys()][0];
  // Simulate a crash after Zarinpal verified but before the plan was saved.
  const issued = zarinpal.issued.get(authority);
  assert.ok(issued);
  issued.verified = true;
  const record = await db.get<Record<string, unknown> & { id: string }>(
    "system",
    "payments",
    started.body.paymentId,
  );
  assert.ok(record);
  await db.put("system", "payments", {
    ...record,
    status: "verifying",
    updatedAt: new Date(now).toISOString(),
  });
  assert.equal((await callback(app, authority)).searchParams.get("billing"), "pending");
  now += 5 * 60_000;
  assert.equal((await callback(app, authority)).searchParams.get("billing"), "success");
  const paid = await db.get<Record<string, unknown>>("system", "payments", record.id);
  assert.equal(paid?.status, "paid");
  assert.equal(paid?.code, 101);
});

test("limits follow the active plan, admin overrides win, and expiry falls back to free", async () => {
  let now = Date.now();
  const { app } = await createApp(db, liveConfig(), {
    fetch: fakeZarinpal().fetcher,
    now: () => now,
  });
  const admin = await login(app, adminKey);
  const ali = await login(app, aliKey);
  assert.deepEqual((await call(app, ali, "/api/me")).body.limits, { messages: 200, tasks: 30 });

  // Only admins can grant plans.
  assert.equal(
    (await call(app, ali, "/api/admin/users/user-ali/plan", "POST", { planId: "pro" })).status,
    403,
  );
  const granted = await call(app, admin, "/api/admin/users/user-ali/plan", "POST", {
    planId: "pro",
    days: 10,
    amount: 199000,
    note: "پرداخت نقدی",
  });
  assert.equal(granted.status, 200);
  assert.equal(Date.parse(granted.body.periodEnd), now + 10 * DAY);
  assert.deepEqual((await call(app, ali, "/api/me")).body.limits, { messages: 1000, tasks: 100 });

  // Granting again extends from the current end.
  const extended = await call(app, admin, "/api/admin/users/user-ali/plan", "POST", {
    planId: "pro",
  });
  assert.equal(Date.parse(extended.body.periodEnd), now + 40 * DAY);

  const list = await call(app, admin, "/api/admin/users");
  const row = list.body.users.find((u: { id: string }) => u.id === "user-ali");
  assert.equal(row.subscription.plan.id, "pro");
  assert.equal(row.subscription.currentPeriodEnd, extended.body.periodEnd);
  assert.ok(list.body.plans.some((p: { id: string }) => p.id === "pro"));
  const payments = await call(app, admin, "/api/admin/payments");
  assert.equal(payments.body.payments.length, 2);
  assert.equal(payments.body.payments[0].gateway, "manual");
  assert.equal(payments.body.payments[0].ownerName, "ali");
  assert.equal(payments.body.payments[1].note, "پرداخت نقدی");

  // A per-user admin override beats the plan.
  await call(app, admin, "/api/admin/users/user-ali", "PATCH", { quota: { dailyMessages: 5 } });
  assert.deepEqual((await call(app, ali, "/api/me")).body.limits, { messages: 5, tasks: 100 });
  await call(app, admin, "/api/admin/users/user-ali", "PATCH", { quota: { dailyMessages: null } });

  // After the period ends the user is on free again, without any job running.
  now += 41 * DAY;
  const me = await call(app, ali, "/api/me");
  assert.equal(me.body.subscription.plan.id, "free");
  assert.equal(me.body.subscription.currentPeriodEnd, null);
  assert.deepEqual(me.body.limits, { messages: 200, tasks: 30 });

  // Admin can move someone back to free explicitly.
  await call(app, admin, "/api/admin/users/user-ali/plan", "POST", { planId: "pro" });
  await call(app, admin, "/api/admin/users/user-ali/plan", "POST", { planId: "free" });
  assert.equal((await call(app, ali, "/api/me")).body.subscription.plan.id, "free");
  assert.equal(
    (await call(app, admin, "/api/admin/users/user-nobody/plan", "POST", { planId: "pro" })).status,
    404,
  );
  assert.equal(
    activeSubscription(DEFAULT_PLANS, { plan: "pro", currentPeriodEnd: "garbage" }).plan.id,
    "free",
  );
});

test("a plan can restrict which models its users may pick", async () => {
  const cheap = "openai/gpt-4.1-mini";
  const strong = "anthropic/claude-sonnet-5";
  const plans = parsePlans(
    JSON.stringify([
      { id: "free", name: "رایگان", price: 0, models: [cheap] },
      { id: "pro", name: "حرفه‌ای", price: 199000, dailyMessages: 1000 },
    ]),
  );
  const config = liveConfig({
    plans,
    model: strong,
    models: {
      models: parseModels(`${strong}:قوی,${cheap}:سریع`, strong),
      defaultModel: strong,
    },
  });
  const { app } = await createApp(db, config, { fetch: fakeZarinpal().fetcher });
  const admin = await login(app, adminKey);
  const ali = await login(app, aliKey);
  const free = await call(app, ali, "/api/models");
  assert.deepEqual(
    free.body.models.map((m: { id: string }) => m.id),
    [cheap],
  );
  assert.equal(free.body.selected, cheap);
  assert.equal(
    (await call(app, ali, "/api/models/selected", "PUT", { model: strong })).status,
    422,
  );
  const billing = await call(app, ali, "/api/billing");
  assert.deepEqual(billing.body.plans[0].models, ["سریع"]);
  assert.equal(billing.body.plans[1].models, null);

  await call(app, admin, "/api/admin/users/user-ali/plan", "POST", { planId: "pro" });
  const pro = await call(app, ali, "/api/models");
  assert.deepEqual(
    pro.body.models.map((m: { id: string }) => m.id),
    [strong, cheap],
  );
  assert.equal(
    (await call(app, ali, "/api/models/selected", "PUT", { model: strong })).status,
    200,
  );
  // Admins always see every model.
  assert.equal((await call(app, admin, "/api/models")).body.models.length, 2);
});
