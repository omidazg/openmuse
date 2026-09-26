import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Hono } from "hono";
import { createApp } from "../apps/server/src/app.ts";
import { type Config, parseUserKeys } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { clientIp, RateLimiter } from "../apps/server/src/rate-limit.ts";
import { QUOTA_EXCEEDED, tehranDay } from "../apps/server/src/usage.ts";
import { normalizePhone, sha256 } from "../apps/server/src/users.ts";

const adminKey = "admin-key-aaaaaaaaaaaaaaaaaaaaaaaa";
const aliKey = "ali-key-bbbbbbbbbbbbbbbbbbbbbbbbbbbb";
type App = Awaited<ReturnType<typeof createApp>>;

let db: Store, directory: string;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "openmuse-users-"));
  db = await createStore();
});
after(async () => {
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

let counter = 0;
function liveConfig(extra: Partial<Config> = {}): Config {
  return {
    mode: "live",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: join(directory, String(counter++)),
    accessKey: adminKey,
    userKeys: parseUserKeys(`ali:${aliKey}`),
    encryptionKey: randomBytes(32).toString("base64"),
    agentBackend: "agui",
    agentUrl: "http://127.0.0.1:1/unreachable",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: ["http://localhost:8081"],
    dailyMessageLimit: 200,
    dailyTaskLimit: 30,
    ...extra,
  };
}
const json = (token?: string, ip = "203.0.113.1") => ({
  "Content-Type": "application/json",
  "X-Forwarded-For": `10.0.0.1, ${ip}`,
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});
async function login(app: App["app"], accessKey: string, ip?: string) {
  const response = await app.request("/api/session", {
    method: "POST",
    headers: json(undefined, ip),
    body: JSON.stringify({ accessKey }),
  });
  return { status: response.status, body: await response.json() };
}
async function call(app: App["app"], token: string, path: string, method = "GET", body?: unknown) {
  const response = await app.request(path, {
    method,
    headers: json(token),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test("phone numbers normalize from Persian digits and international forms", () => {
  for (const raw of [
    "۰۹۱۲۱۲۳۴۵۶۷",
    "+989121234567",
    "00989121234567",
    "9121234567",
    "0912 123 4567",
  ])
    assert.equal(normalizePhone(raw), "09121234567");
  assert.equal(normalizePhone("02112345678"), undefined);
  assert.equal(normalizePhone("0912123"), undefined);
});

test("rate limiter allows N attempts per window and then recovers", () => {
  let now = 0;
  const limiter = new RateLimiter(2, 1000, () => now);
  assert.equal(limiter.take("a"), true);
  assert.equal(limiter.take("a"), true);
  assert.equal(limiter.take("a"), false);
  assert.equal(limiter.take("b"), true);
  now = 1001;
  assert.equal(limiter.take("a"), true);
});

test("client address prefers Caddy's X-Real-IP over the CDN edge in X-Forwarded-For", async () => {
  const app = new Hono().get("/", (c) => c.text(clientIp(c)));
  const ip = async (headers: Record<string, string>) =>
    (await app.request("/", { headers })).text();
  assert.equal(
    await ip({ "x-real-ip": "5.160.1.2", "x-forwarded-for": "5.160.1.2, 185.143.233.130" }),
    "5.160.1.2",
  );
  assert.equal(await ip({ "x-forwarded-for": "9.9.9.9, 172.18.0.1" }), "172.18.0.1");
  assert.equal(await ip({}), "unknown");
});

test("env keys keep their owners; admin creates, disables, re-enables and rotates db users", async () => {
  const { app } = await createApp(db, liveConfig());
  const admin = await login(app, adminKey);
  assert.equal(admin.status, 200);
  const ali = await login(app, aliKey);
  assert.equal(ali.status, 200);
  const me = await call(app, ali.body.token, "/api/me");
  assert.equal(me.body.owner, "user-ali");
  assert.equal(me.body.role, "user");
  assert.equal((await call(app, admin.body.token, "/api/me")).body.role, "admin");

  // Non-admins cannot reach the admin API.
  assert.equal((await call(app, ali.body.token, "/api/admin/users")).status, 403);

  const created = await call(app, admin.body.token, "/api/admin/users", "POST", {
    name: "Reza",
    label: "رضا",
    phone: "۰۹۱۲۱۲۳۴۵۶۷",
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.user.id, "user-reza");
  assert.equal(created.body.user.phone, "09121234567");
  assert.equal(created.body.user.keyHash, undefined);
  const key: string = created.body.key;
  assert.ok(key.length >= 24);
  // Only the hash is stored.
  const stored = await db.get<{ keyHash: string }>("system", "users", "user-reza");
  assert.equal(stored?.keyHash, sha256(key));
  assert.ok(!JSON.stringify(stored).includes(key));

  assert.equal(
    (await call(app, admin.body.token, "/api/admin/users", "POST", { name: "reza" })).status,
    409,
  );
  assert.equal(
    (await call(app, admin.body.token, "/api/admin/users", "POST", { name: "bad name" })).status,
    422,
  );

  const reza = await login(app, key);
  assert.equal(reza.status, 200);
  assert.equal((await call(app, reza.body.token, "/api/me")).body.owner, "user-reza");

  const listed = await call(app, admin.body.token, "/api/admin/users");
  assert.deepEqual(listed.body.users.map((u: { id: string }) => u.id).sort(), [
    "local-user",
    "user-ali",
    "user-reza",
  ]);
  assert.equal(listed.body.users.find((u: { id: string }) => u.id === "user-reza").sessions, 1);

  // Disabling rejects new logins and invalidates the open session.
  const disabled = await call(app, admin.body.token, "/api/admin/users/user-reza", "PATCH", {
    status: "disabled",
  });
  assert.equal(disabled.body.user.status, "disabled");
  assert.equal((await call(app, reza.body.token, "/api/workspace")).status, 401);
  assert.equal((await login(app, key)).status, 403);
  // Env users can be disabled too; their open sessions end.
  await call(app, admin.body.token, "/api/admin/users/user-ali", "PATCH", { status: "disabled" });
  assert.equal((await call(app, ali.body.token, "/api/me")).status, 401);
  assert.equal((await login(app, aliKey)).status, 403);
  await call(app, admin.body.token, "/api/admin/users/user-ali", "PATCH", { status: "active" });
  assert.equal((await login(app, aliKey)).status, 200);
  // The server admin cannot be disabled.
  assert.equal(
    (
      await call(app, admin.body.token, "/api/admin/users/local-user", "PATCH", {
        status: "disabled",
      })
    ).status,
    409,
  );

  await call(app, admin.body.token, "/api/admin/users/user-reza", "PATCH", { status: "active" });
  const again = await login(app, key);
  assert.equal(again.status, 200);
  const rotated = await call(
    app,
    admin.body.token,
    "/api/admin/users/user-reza/rotate-key",
    "POST",
  );
  assert.equal(rotated.status, 200);
  assert.notEqual(rotated.body.key, key);
  assert.equal((await login(app, key)).status, 401);
  assert.equal((await call(app, again.body.token, "/api/me")).status, 401);
  assert.equal((await login(app, rotated.body.key)).status, 200);
  // Env keys rotate through server configuration, not the API.
  assert.equal(
    (await call(app, admin.body.token, "/api/admin/users/user-ali/rotate-key", "POST")).status,
    409,
  );

  const sessions = await call(
    app,
    admin.body.token,
    "/api/admin/users/user-reza/sessions",
    "DELETE",
  );
  assert.equal(sessions.body.deleted, 1);

  // Logout ends only this session.
  const out = await login(app, rotated.body.key);
  assert.equal((await call(app, out.body.token, "/api/session", "DELETE")).status, 200);
  assert.equal((await call(app, out.body.token, "/api/me")).status, 401);
  assert.equal((await call(app, admin.body.token, "/api/me")).status, 200);
});

test("key logins are limited per client address", async () => {
  const { app } = await createApp(db, liveConfig());
  for (let i = 0; i < 10; i++)
    assert.equal(
      (await login(app, "wrong-key-xxxxxxxxxxxxxxxxxxxxxxxx", "198.51.100.7")).status,
      401,
    );
  const blocked = await login(app, adminKey, "198.51.100.7");
  assert.equal(blocked.status, 429);
  assert.match(blocked.body.error, /ده دقیقهٔ دیگر/);
  // Another address is unaffected.
  assert.equal((await login(app, adminKey, "198.51.100.8")).status, 200);
});

test("daily quotas return a Persian 429; admins are unlimited and usage is visible", async () => {
  const { app, usage } = await createApp(db, liveConfig({ dailyTaskLimit: 2 }));
  const admin = await login(app, adminKey);
  const ali = await login(app, aliKey);
  const task = () =>
    call(app, ali.body.token, "/api/agent/tasks", "POST", {
      kind: "agent",
      prompt: "یک کار آزمایشی",
    });
  assert.equal((await task()).status, 201);
  assert.equal((await task()).status, 201);
  const third = await task();
  assert.equal(third.status, 429);
  assert.equal(third.body.error, QUOTA_EXCEEDED);
  for (let i = 0; i < 3; i++)
    assert.equal(
      (
        await call(app, admin.body.token, "/api/agent/tasks", "POST", {
          kind: "agent",
          prompt: `کار مدیر ${i}`,
        })
      ).status,
      201,
    );

  // Chat turns: a per-user override of 1 message.
  await call(app, admin.body.token, "/api/admin/users/user-ali", "PATCH", {
    quota: { dailyMessages: 1 },
  });
  await usage.consume("user-ali", "messages");
  const run = await app.request("/api/copilotkit/agent/default/run", {
    method: "POST",
    headers: json(ali.body.token),
    body: JSON.stringify({ threadId: "t", runId: "r", messages: [] }),
  });
  assert.equal(run.status, 429);
  assert.equal((await run.json()).error, QUOTA_EXCEEDED);

  await usage.recordModelRun("user-ali", [{ inputTokens: 10, outputTokens: 5, totalTokens: 15 }]);
  const me = await call(app, ali.body.token, "/api/me");
  assert.equal(me.body.usage.date, tehranDay());
  assert.equal(me.body.usage.tasks, 2);
  assert.equal(me.body.usage.messages, 1);
  assert.equal(me.body.usage.modelCalls, 1);
  assert.equal(me.body.usage.totalTokens, 15);
  assert.deepEqual(me.body.limits, { messages: 1, tasks: 2 });
  const history = await call(app, admin.body.token, "/api/admin/users/user-ali/usage?days=7");
  assert.equal(history.body.days[0].tasks, 2);
  const list = await call(app, admin.body.token, "/api/admin/users");
  assert.equal(
    list.body.users.find((u: { id: string }) => u.id === "local-user").limits.tasks,
    null,
  );
});

test("Tehran day rolls over at local midnight", () => {
  assert.equal(tehranDay(Date.parse("2026-09-22T20:29:00Z")), "2026-09-22");
  assert.equal(tehranDay(Date.parse("2026-09-22T20:31:00Z")), "2026-09-23");
});

test("SMS login: codes are hashed, expire, allow 5 attempts and are rate limited", async () => {
  const sent: URL[] = [];
  const fetch = (async (input: string | URL | Request) => {
    sent.push(new URL(String(input)));
    return new Response(JSON.stringify({ return: { status: 200, message: "ok" }, entries: [] }), {
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  const off = await createApp(db, liveConfig());
  assert.equal((await (await off.app.request("/api/health")).json()).otpEnabled, false);
  assert.equal(
    (
      await off.app.request("/api/otp/request", {
        method: "POST",
        headers: json(),
        body: JSON.stringify({ phone: "09121234567" }),
      })
    ).status,
    404,
  );

  const { app } = await createApp(
    db,
    liveConfig({ kavenegarApiKey: "test-api-key", kavenegarTemplate: "verify" }),
    { fetch },
  );
  assert.equal((await (await app.request("/api/health")).json()).otpEnabled, true);
  const admin = await login(app, adminKey);
  await call(app, admin.body.token, "/api/admin/users", "POST", {
    name: "mina",
    phone: "09351112233",
  });
  const request = (phone: string, ip = "192.0.2.10") =>
    app.request("/api/otp/request", {
      method: "POST",
      headers: json(undefined, ip),
      body: JSON.stringify({ phone }),
    });
  const verify = async (phone: string, code: string, ip = "192.0.2.10") => {
    const response = await app.request("/api/otp/verify", {
      method: "POST",
      headers: json(undefined, ip),
      body: JSON.stringify({ phone, code }),
    });
    return { status: response.status, body: await response.json() };
  };

  assert.equal((await request("123")).status, 422);
  assert.equal((await request("09120000000")).status, 404);
  assert.equal((await request("+98 935 111 2233")).status, 200);
  const url = sent.at(-1) as URL;
  assert.equal(url.origin, "https://api.kavenegar.com");
  assert.equal(url.pathname, "/v1/test-api-key/verify/lookup.json");
  assert.equal(url.searchParams.get("receptor"), "09351112233");
  assert.equal(url.searchParams.get("template"), "verify");
  const code = url.searchParams.get("token") as string;
  assert.match(code, /^\d{6}$/);
  const stored = await db.get<{ codeHash: string }>("system", "otp", "09351112233");
  assert.ok(stored && !JSON.stringify(stored).includes(code));
  // A second code within a minute is refused.
  assert.equal((await request("09351112233")).status, 429);

  const wrong = code === "111111" ? "222222" : "111111";
  for (let i = 0; i < 5; i++) assert.equal((await verify("09351112233", wrong)).status, 401);
  assert.equal((await verify("09351112233", code)).status, 429);

  // After too many wrong codes the code is gone; a new API process (fresh per-phone limiter)
  // sends a new one, and typing it with Persian digits opens mina's workspace.
  assert.equal(await db.get("system", "otp", "09351112233"), null);
  const own = await createApp(db, liveConfig({ kavenegarApiKey: "k", kavenegarTemplate: "t" }), {
    fetch,
  });
  await own.app.request("/api/otp/request", {
    method: "POST",
    headers: json(undefined, "192.0.2.20"),
    body: JSON.stringify({ phone: "09351112233" }),
  });
  const fresh = (sent.at(-1) as URL).searchParams.get("token") as string;
  const persian = fresh.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
  const ok = await (async () => {
    const response = await own.app.request("/api/otp/verify", {
      method: "POST",
      headers: json(undefined, "192.0.2.20"),
      body: JSON.stringify({ phone: "۰۹۳۵۱۱۱۲۲۳۳", code: persian }),
    });
    return { status: response.status, body: await response.json() };
  })();
  assert.equal(ok.status, 200);
  assert.equal((await call(own.app, ok.body.token, "/api/me")).body.owner, "user-mina");
  // Codes are single-use.
  assert.equal(
    (
      await own.app.request("/api/otp/verify", {
        method: "POST",
        headers: json(undefined, "192.0.2.20"),
        body: JSON.stringify({ phone: "09351112233", code: fresh }),
      })
    ).status,
    401,
  );

  // Expired codes are rejected.
  await db.put("system", "otp", {
    id: "09351112233",
    codeHash: own.auth.mac("otp:09351112233:654321"),
    expiresAt: Date.now() - 1,
    attempts: 0,
  });
  const expired = await own.app.request("/api/otp/verify", {
    method: "POST",
    headers: json(undefined, "192.0.2.20"),
    body: JSON.stringify({ phone: "09351112233", code: "654321" }),
  });
  assert.equal(expired.status, 401);
});

test("SMS signup creates a free user when OTP_SIGNUP is on; provider failures are reported", async () => {
  let fail = false;
  const sent: URL[] = [];
  const fetch = (async (input: string | URL | Request) => {
    sent.push(new URL(String(input)));
    return new Response(JSON.stringify({ return: { status: fail ? 418 : 200 } }), {
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  const { app } = await createApp(
    db,
    liveConfig({ kavenegarApiKey: "k", kavenegarTemplate: "t", otpSignup: true }),
    { fetch },
  );
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: json(undefined, "192.0.2.30"),
      body: JSON.stringify(body),
    });
  fail = true;
  const failed = await post("/api/otp/request", { phone: "09190001122" });
  assert.equal(failed.status, 502);
  assert.equal(await db.get("system", "otp", "09190001122"), null);
  fail = false;
  assert.equal((await post("/api/otp/request", { phone: "09190001122" })).status, 200);
  const code = (sent.at(-1) as URL).searchParams.get("token");
  const response = await post("/api/otp/verify", { phone: "09190001122", code });
  assert.equal(response.status, 200);
  const { token } = await response.json();
  const me = await call(app, token, "/api/me");
  assert.equal(me.body.owner, "user-p9190001122");
  assert.equal(me.body.user.plan, "free");
  assert.equal(me.body.user.phone, "09190001122");
});
