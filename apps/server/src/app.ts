// Loads .env and disables CopilotKit telemetry before @copilotkit/runtime evaluates; its
// telemetry client reads COPILOTKIT_TELEMETRY_DISABLED/DO_NOT_TRACK once at import time.
import "./config.ts";
import { randomUUID } from "node:crypto";
import { MessageSchema } from "@ag-ui/core";
import { CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { z } from "zod";
import { BRAND } from "../../../packages/domain/src/brand.ts";
import { emailDraftSchema, proposalSchema } from "../../../packages/domain/src/index.ts";
import type { MailboxDeps } from "../../../packages/integrations/src/mailbox.ts";
import { documentHtml } from "../../../packages/integrations/src/pdf-html.ts";
import { ActionService } from "./actions.ts";
import { adminRoutes } from "./admin-routes.ts";
import { agentConfigured, makeRuntime } from "./agent.ts";
import { createAuth } from "./auth.ts";
import { botRoutes } from "./bot/routes.ts";
import { BrowserService } from "./browser.ts";
import { ComputerService, type DockerRunner } from "./computer.ts";
import { computerRoutes } from "./computer-routes.ts";
import { type Config, otpEnabled, threadsBackend } from "./config.ts";
import type { Store } from "./db.ts";
import { agentRoutes } from "./engine/routes.ts";
import { AgentService } from "./engine/service.ts";
import { AppError } from "./errors.ts";
import { reportError } from "./errors-report.ts";
import { fallbackConfigured } from "./fallback.ts";
import { Files, fileKind } from "./files.ts";
import { GoogleAuth } from "./google-auth.ts";
import { MailboxService } from "./mailbox.ts";
import {
  configCatalog,
  defaultChoice,
  modelOptions,
  saveSelectedModel,
  selectedModel,
} from "./models.ts";
import { OtpService } from "./otp.ts";
import { PdfRenderer } from "./pdf-render.ts";
import { clientIp, RateLimiter } from "./rate-limit.ts";
import { responseLength, responseLengthSchema, saveResponseLength } from "./response-length.ts";
import { localThreadRoutes, localThreadsEnabled } from "./threads.ts";
import { transcribeAudio, transcriptionEnabled } from "./transcribe.ts";
import { Usage } from "./usage.ts";
import { publicUser, type Role } from "./users.ts";
import { purposeOf, WorkspaceService } from "./workspace.ts";

export async function createApp(
  db: Store,
  config: Config,
  options: { docker?: DockerRunner; fetch?: typeof fetch; mailbox?: MailboxDeps } = {},
) {
  const auth = await createAuth(db, config),
    files = new Files(db, config, auth, new PdfRenderer(config)),
    google = new GoogleAuth(db, config),
    mailbox = new MailboxService(db, config, options.mailbox),
    workspace = new WorkspaceService(db, config, files, google, mailbox);
  const actions = new ActionService(db, {
    execute: (owner, input, connectionId, targetVersion) =>
      workspace.execute(owner, input, connectionId, targetVersion),
    prepare: (owner, input, connectionId) => workspace.prepare(owner, input, connectionId),
    connected: (owner, kind) => workspace.connected(owner, kind && purposeOf(kind)),
    connection: (owner, kind) => workspace.connection(owner, kind && purposeOf(kind)),
  });
  const browser = new BrowserService(db, config, auth, files);
  const computer = new ComputerService(db, config, options.docker);
  const agent = new AgentService(db, config, workspace, files, actions, browser, computer);
  const users = auth.users;
  const usage = new Usage(db, config, users);
  agent.usage = usage;
  const otp = new OtpService(db, config, users, auth, options.fetch);
  const intelligence =
    threadsBackend(config) === "intelligence" && config.intelligenceApiKey?.trim()
      ? new CopilotKitIntelligence({ apiKey: config.intelligenceApiKey })
      : undefined;
  const localThreads = localThreadsEnabled(config);
  const runtime = makeRuntime(config, agent, auth, intelligence);
  const app = new Hono<{ Variables: { owner: string; role: Role } }>();
  const origins = new Set([...config.allowedOrigins, new URL(config.publicUrl).origin]);
  app.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    if (origin && !origins.has(origin)) return c.json({ error: "این مبدأ مجاز نیست" }, 403);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.use(
    "*",
    cors({
      origin: (origin) => (origins.has(origin) ? origin : undefined),
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
    }),
  );
  app.use(
    "*",
    bodyLimit({
      maxSize: 12 * 1024 * 1024,
      onError: (c) =>
        c.json({ error: "درخواست خیلی بزرگ است؛ حجم سند باید حداکثر ۱۰ مگابایت باشد" }, 413),
    }),
  );
  app.onError((error, c) => {
    if (error instanceof z.ZodError)
      return c.json({ error: error.issues.map((i) => i.message).join("; ") }, 422);
    if (error instanceof AppError) return c.json({ error: error.message }, error.status);
    if (
      error.name === "PdfError" ||
      error.name === "DocumentError" ||
      error.name === "RecurringEventError"
    )
      return c.json({ error: error.message }, 422);
    if (error instanceof SyntaxError) return c.json({ error: "داده‌های درخواست نامعتبر است" }, 400);
    // Provider and document errors are useful, but raw stack traces and token-bearing responses are not.
    console.error(`[${BRAND.name}] ${error.name}`);
    void reportError(error, { component: "api", method: c.req.method, route: c.req.routePath });
    return c.json(
      {
        error:
          error.name === "PdfError" || error.name === "GoogleApiError"
            ? error.message
            : "درخواست ناموفق بود. تنظیمات سرور را بررسی کنید و دوباره تلاش کنید.",
      },
      502,
    );
  });
  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      mode: config.mode,
      agentConfigured: agentConfigured(config),
      browserConfigured: Boolean(config.workerUrl && config.workerToken),
      transcriptionEnabled: transcriptionEnabled(),
      otpEnabled: otpEnabled(config),
      fallbackConfigured: fallbackConfigured(),
    }),
  );
  // Key logins: 10 attempts per client address every 10 minutes, plus a global safety cap.
  const loginsPerIp = new RateLimiter(10, 10 * 60 * 1000);
  const loginsGlobal = new RateLimiter(120, 60 * 1000);
  const opened = async (owner: string) => {
    await workspace.ensureSample(owner, actions);
    await agent.ensure(owner);
    if (config.mode === "sample") await agent.refreshIdeas(owner);
  };
  app.post("/api/session", async (c) => {
    const body = z.object({ accessKey: z.string().max(512).optional() }).parse(await c.req.json());
    // A keyless probe cannot guess anything, so only real key attempts count.
    if (body.accessKey && config.mode === "live") {
      if (!loginsGlobal.take("all"))
        throw new AppError("تلاش‌های ورود بیش از حد بوده است. یک دقیقهٔ دیگر دوباره تلاش کنید.", 429);
      if (!loginsPerIp.take(clientIp(c)))
        throw new AppError("تلاش‌های ورود بیش از حد بوده است. ده دقیقهٔ دیگر دوباره تلاش کنید.", 429);
    }
    const { owner, ...session } = await auth.session(body.accessKey);
    await opened(owner);
    return c.json(session);
  });
  app.post("/api/otp/request", async (c) => {
    const body = z.object({ phone: z.string().max(32) }).parse(await c.req.json());
    return c.json(await otp.request(body.phone, clientIp(c)));
  });
  app.post("/api/otp/verify", async (c) => {
    const body = z
      .object({ phone: z.string().max(32), code: z.string().max(16) })
      .parse(await c.req.json());
    const { owner, ...session } = await otp.verify(body.phone, body.code, clientIp(c));
    await opened(owner);
    return c.json(session);
  });
  app.get("/api/google/callback", async (c) => {
    if (c.req.query("error"))
      return c.html(
        `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><h1>اتصال گوگل لغو شد</h1><p>می‌توانید به ${BRAND.nameFa} برگردید.</p></html>`,
        400,
      );
    const state = c.req.query("state"),
      code = c.req.query("code");
    if (!state || !code) throw new AppError("پاسخ بازگشتی گوگل ناقص است");
    await google.callback(state, code);
    return c.html(
      `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><h1>گوگل متصل شد</h1><p>به ${BRAND.nameFa} برگردید و فضای کاری خود را تازه کنید.</p></html>`,
    );
  });
  app.use("/api/*", async (c, next) => {
    const signedRoute =
      /^\/api\/files\/[^/]+\/content$|^\/api\/browsers\/[^/]+\/(?:preview|console)$/.test(
        c.req.path,
      );
    if (signedRoute && c.req.query("signature")) {
      c.set("owner", auth.verify(new URL(c.req.url)));
      c.set("role", "user");
    } else {
      const identity = await auth.identity(c.req.header("authorization"));
      c.set("owner", identity.owner);
      c.set("role", identity.role);
    }
    await next();
  });
  app.delete("/api/session", async (c) => {
    await auth.end(c.req.header("authorization"));
    return c.json({ ok: true });
  });
  app.get("/api/me", async (c) => {
    const owner = c.get("owner");
    const user = await users.get(owner);
    return c.json({
      owner,
      role: c.get("role"),
      user: user ? publicUser(user) : null,
      usage: await usage.today(owner),
      limits: await usage.limits(owner),
      otpEnabled: otpEnabled(config),
    });
  });
  app.route("/api/admin", adminRoutes(users, usage, config));
  app.get("/api/workspace", async (c) => {
    const snapshot = await workspace.snapshot(c.get("owner"), c.req.query("q"));
    snapshot.browsers = snapshot.browsers.map((s) => browser.decorate(c.get("owner"), s));
    return c.json(snapshot);
  });
  app.route("/api/agent", agentRoutes(agent));
  app.route("/api/bot", botRoutes(db));
  if (localThreads) app.route("/api/threads", localThreadRoutes(db));
  app.route("/api/computer", computerRoutes(computer, files));
  app.get("/api/models", async (c) => {
    const catalog = configCatalog(config);
    return c.json({
      models: modelOptions(catalog),
      selected:
        (await selectedModel(db, catalog, c.get("owner"))) ?? defaultChoice(catalog) ?? null,
      length: await responseLength(db, c.get("owner")),
    });
  });
  app.put("/api/models/length", async (c) => {
    const body = z.object({ length: responseLengthSchema }).parse(await c.req.json());
    return c.json({ length: await saveResponseLength(db, c.get("owner"), body.length) });
  });
  app.put("/api/models/selected", async (c) => {
    const body = z.object({ model: z.string().min(1).max(200) }).parse(await c.req.json());
    const selected = await saveSelectedModel(db, configCatalog(config), c.get("owner"), body.model);
    return c.json({ selected });
  });
  const transcribes = new RateLimiter(20, 10 * 60 * 1000);
  app.post("/api/transcribe", async (c) => {
    if (!transcribes.take(c.get("owner")))
      throw new AppError("تعداد تبدیل صدا زیاد بوده است. چند دقیقهٔ دیگر دوباره تلاش کنید.", 429);
    const data = await c.req.parseBody();
    return c.json({ text: await transcribeAudio(data.file) });
  });
  app.get("/api/calendars", async (c) => c.json(await workspace.calendars(c.get("owner"))));
  app.get("/api/calendar/events", async (c) => {
    const query = z
      .object({
        calendarId: z.string().min(1).max(1024).optional(),
        timeMin: z.iso.datetime({ offset: true }).optional(),
        timeMax: z.iso.datetime({ offset: true }).optional(),
      })
      .parse(c.req.query());
    if (
      query.timeMin &&
      query.timeMax &&
      (Date.parse(query.timeMax) <= Date.parse(query.timeMin) ||
        Date.parse(query.timeMax) - Date.parse(query.timeMin) > 366 * 86400000)
    )
      throw new AppError("بازهٔ تقویم باید بیشتر از صفر و حداکثر ۳۶۶ روز باشد", 422);
    return c.json(await workspace.events(c.get("owner"), query));
  });
  app.get("/api/mail/threads/:id", async (c) =>
    c.json(await workspace.thread(c.get("owner"), c.req.param("id"))),
  );
  app.post("/api/actions", async (c) => {
    const input = proposalSchema.parse(await c.req.json());
    if (input.kind === "email.send")
      for (const id of input.data.attachmentIds) await files.get(c.get("owner"), id);
    return c.json(await actions.propose(c.get("owner"), input), 201);
  });
  app.post("/api/actions/:id/decide", async (c) => {
    const body = z
      .object({ hash: z.string(), decision: z.enum(["approve", "deny"]) })
      .parse(await c.req.json());
    return c.json(
      await actions.decide(c.get("owner"), c.req.param("id"), body.hash, body.decision),
    );
  });
  app.get("/api/drafts", async (c) => c.json(await db.list(c.get("owner"), "drafts")));
  app.post("/api/drafts", async (c) => {
    const body = emailDraftSchema.extend({ id: z.string().optional() }).parse(await c.req.json());
    const existing = body.id
      ? await db.get<{ createdAt: string }>(c.get("owner"), "drafts", body.id)
      : null;
    if (body.id && !existing) throw new AppError("پیش‌نویس پیدا نشد", 404);
    return c.json(
      await db.put(c.get("owner"), "drafts", {
        ...body,
        id: body.id ?? randomUUID(),
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      }),
      201,
    );
  });
  app.get("/api/main-thread", async (c) => {
    const owner = c.get("owner");
    await db.insertIfAbsent(owner, "conversation-settings", {
      id: "main",
      threadId: randomUUID(),
      existing: false,
    });
    const main = await db.get<{ threadId: string }>(owner, "conversation-settings", "main");
    if (!main) throw new AppError("گفت‌وگوی اصلی بارگیری نشد", 503);
    if (intelligence) {
      try {
        await intelligence.getOrCreateThread({
          threadId: main.threadId,
          userId: owner,
          agentId: "default",
        });
      } catch {
        throw new AppError(
          "گفت‌وگوی اصلی در دسترس نیست. اتصال Rich Threads را بررسی کنید و دوباره تلاش کنید.",
          502,
        );
      }
    }
    return c.json({ threadId: main.threadId, existing: Boolean(intelligence) || localThreads });
  });
  app.get("/api/conversation", async (c) =>
    c.json((await db.get(c.get("owner"), "conversations", "default")) ?? { messages: [] }),
  );
  app.put("/api/conversation", async (c) => {
    const body = await c.req.json();
    const messages = z.array(z.unknown()).max(1000).parse(body.messages);
    for (const message of messages) MessageSchema.parse(message);
    await db.put(c.get("owner"), "conversations", { id: "default", messages });
    return c.json({ ok: true });
  });
  app.post("/api/files", async (c) => {
    const data = await c.req.parseBody();
    const file = data.file;
    if (!(file instanceof File)) throw new AppError("یک سند PDF، Word، Excel یا CSV انتخاب کنید");
    return c.json(
      await files.import(
        c.get("owner"),
        file.name,
        new Uint8Array(await file.arrayBuffer()),
        "بارگذاری‌شده توسط شما",
        undefined,
        file.type,
      ),
      201,
    );
  });
  app.post("/api/files/pdf", async (c) => {
    const body = z
      .object({ title: z.string().trim().min(1).max(160), content: z.string().max(200_000) })
      .parse(await c.req.json());
    return c.json(
      await files.createPdf(
        c.get("owner"),
        body.title,
        documentHtml({ title: body.title, body: body.content }),
        "ساخته‌شده توسط شما",
        body.title,
      ),
      201,
    );
  });
  app.get("/api/files/:id/content", async (c) => {
    const file = await files.get(c.get("owner"), c.req.param("id"));
    const pdf = fileKind(file) === "pdf";
    c.header("Content-Type", pdf ? "application/pdf" : file.mimeType);
    c.header(
      "Content-Disposition",
      `${pdf ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    return c.body(await files.bytes(c.get("owner"), file.id));
  });
  app.get("/api/files/:id/text", async (c) => {
    const offset = Number(c.req.query("offset") ?? 0);
    return c.json(
      await files.text(c.get("owner"), c.req.param("id"), Number.isFinite(offset) ? offset : 0),
    );
  });
  app.post("/api/files/:id/fill", async (c) => {
    const body = z
      .object({ fields: z.record(z.string(), z.union([z.string(), z.boolean()])) })
      .parse(await c.req.json());
    return c.json(await files.fill(c.get("owner"), c.req.param("id"), body.fields), 201);
  });
  app.post("/api/mail/import-attachment", async (c) => {
    const body = z.object({ reference: z.string() }).parse(await c.req.json());
    return c.json(await workspace.importAttachment(c.get("owner"), body.reference), 201);
  });
  app.post("/api/google/connect", async (c) => {
    const body = z.object({ capability: z.enum(["read", "write"]) }).parse(await c.req.json());
    if (config.mode === "sample") {
      await db.put(c.get("owner"), "settings", {
        id: "google",
        enabled: true,
        connectionId: randomUUID(),
      });
      return c.json({ url: null, connected: true });
    }
    return c.json(await google.connect(c.get("owner"), body.capability === "write"));
  });
  app.get("/api/mailbox", async (c) => c.json(await mailbox.status(c.get("owner"))));
  // The body carries an app password: it is validated, encrypted and never echoed or logged.
  app.post("/api/mailbox/connect", async (c) =>
    c.json(await mailbox.connect(c.get("owner"), await c.req.json()), 201),
  );
  app.post("/api/mailbox/sync", async (c) => {
    await mailbox.sync(c.get("owner"));
    return c.json(await mailbox.status(c.get("owner")));
  });
  app.post("/api/mailbox/disconnect", async (c) => {
    await mailbox.disconnect(c.get("owner"));
    return c.json({ ok: true });
  });
  app.post("/api/google/disconnect", async (c) => {
    if (config.mode === "sample")
      await db.put(c.get("owner"), "settings", { id: "google", enabled: false });
    else await google.disconnect(c.get("owner"));
    return c.json({ ok: true });
  });
  app.post("/api/browsers", async (c) => {
    const body = z.object({ url: z.url().max(4096) }).parse(await c.req.json());
    return c.json(await browser.create(c.get("owner"), body.url), 201);
  });
  app.get("/api/browsers/:id", async (c) => {
    const owner = c.get("owner");
    return c.json(browser.decorate(owner, await browser.get(owner, c.req.param("id"))));
  });
  app.post("/api/browsers/:id/navigate", async (c) => {
    const body = z.object({ url: z.url().max(4096) }).parse(await c.req.json());
    return c.json(await browser.navigate(c.get("owner"), c.req.param("id"), body.url));
  });
  app.post("/api/browsers/:id/close", async (c) =>
    c.json(await browser.close(c.get("owner"), c.req.param("id"))),
  );
  app.get("/api/browsers/:id/read", async (c) =>
    c.json(await browser.read(c.get("owner"), c.req.param("id"))),
  );
  app.post("/api/browsers/:id/reopen", async (c) => {
    const raw = await c.req.text();
    const body = z.object({ url: z.url().max(4096).optional() }).parse(raw ? JSON.parse(raw) : {});
    return c.json(await browser.reopen(c.get("owner"), c.req.param("id"), body.url));
  });
  app.post("/api/browsers/:id/import-downloads", async (c) =>
    c.json(await browser.imports(c.get("owner"), c.req.param("id"))),
  );
  app.get("/api/browsers/:id/preview", async (c) => {
    const response = await browser.preview(c.get("owner"), c.req.param("id"));
    c.header("Content-Type", "image/png");
    return c.body(await response.arrayBuffer());
  });
  app.get("/api/browsers/:id/console", async (c) => {
    await browser.get(c.get("owner"), c.req.param("id"));
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' blob:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
    );
    return c.html(browser.console(c.get("owner"), c.req.param("id")));
  });
  app.post("/api/browsers/:id/console", async (c) => {
    await browser.input(c.get("owner"), c.req.param("id"), await c.req.json());
    return c.json({ ok: true });
  });
  app.all("/api/copilotkit/*", async (c) => {
    if (!agentConfigured(config))
      throw new AppError(
        "برای شروع گفت‌وگو، یک مدل و کلید API ارائه‌دهنده یا یک نقطهٔ پایانی معتبر AG-UI پیکربندی کنید",
        503,
      );
    if (await isAgentRun(c.req.raw)) await usage.consume(c.get("owner"), "messages");
    const response = await runtime.fetch(c.req.raw);
    // Runtime 1.70 emits SSE strings; a WHATWG Response body requires byte chunks.
    const encoder = new TextEncoder();
    const body = response.body?.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
        },
      }),
    );
    return new Response(body, { status: response.status, headers: response.headers });
  });
  app.get("/", (c) =>
    c.json({ name: BRAND.name, app: "http://localhost:8081", health: "/api/health" }),
  );
  return { app, auth, files, actions, workspace, agent, computer, usage, users, otp, mailbox };
}

/** A chat turn: REST `POST …/agent/:id/run` or a single-endpoint `{"method":"agent/run"}` call. */
async function isAgentRun(request: Request) {
  if (request.method !== "POST") return false;
  const path = new URL(request.url).pathname;
  if (/\/agent\/[^/]+\/run$/.test(path)) return true;
  if (!/^\/api\/copilotkit\/?$/.test(path)) return false;
  try {
    const body = (await request.clone().json()) as { method?: unknown };
    return body?.method === "agent/run";
  } catch {
    return false;
  }
}
