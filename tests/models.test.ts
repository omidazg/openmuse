import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type { RunAgentInput } from "@ag-ui/core";
import { lastValueFrom, toArray } from "rxjs";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";
import { ConversationAgent } from "../apps/server/src/engine/conversation.ts";
import {
  AUTO_MODEL,
  autoTier,
  isSimpleMessage,
  parseModels,
  readModelCatalog,
  resolveModel,
} from "../apps/server/src/models.ts";
import { modelFixture } from "./helpers/model.ts";

const catalogEnv = {
  MODEL: "openai/strong-fixture",
  MODELS:
    "openai/strong-fixture:مدل قوی,openai/fast-fixture:مدل سریع و ارزان,google/gemini-2.5-flash",
  MODEL_FAST: "openai/fast-fixture",
};

async function appFixture(t: TestContext, overrides: Partial<Config> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-models-"));
  const db = await createStore();
  const config: Config = {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "sample",
    model: catalogEnv.MODEL,
    models: readModelCatalog(catalogEnv),
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: ["http://localhost:8081"],
    ...overrides,
  };
  const server = await createApp(db, config);
  t.after(async () => {
    await server.agent.stop();
    await db.close();
    await rm(directory, { recursive: true, force: true });
  });
  const { token } = await server.auth.session();
  const request = (path: string, init: RequestInit = {}) =>
    server.app.request(path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    });
  return { ...server, db, config, request };
}

function withEnv(t: TestContext, values: Record<string, string | undefined>) {
  const previous = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]));
  for (const [key, value] of Object.entries(values))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  t.after(() => {
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
}

test("MODELS parses ids with Persian labels and marks MODEL as the default", () => {
  const models = parseModels(
    " anthropic/claude-sonnet-5:کلاد سونت ۵ (قوی) , openai/gpt-4.1-mini:جی‌پی‌تی ۴٫۱ مینی,google/gemini-2.5-flash ",
    "anthropic/claude-sonnet-5",
  );
  assert.deepEqual(models, [
    { id: "anthropic/claude-sonnet-5", label: "کلاد سونت ۵ (قوی)", default: true },
    { id: "openai/gpt-4.1-mini", label: "جی‌پی‌تی ۴٫۱ مینی", default: false },
    { id: "google/gemini-2.5-flash", label: "google/gemini-2.5-flash", default: false },
  ]);
  // MODEL is always selectable even when MODELS omits it.
  assert.deepEqual(parseModels("openai/gpt-4.1-mini:مینی", "openai/gpt-4.1")[0], {
    id: "openai/gpt-4.1",
    label: "مدل پیش‌فرض",
    default: true,
  });
  assert.deepEqual(parseModels("", undefined), []);
  assert.throws(() => parseModels("gpt-4.1:بدون ارائه‌دهنده"), /provider\/model-id/);
  assert.throws(() => parseModels("evil/model"), /provider\/model-id/);
  assert.throws(() => parseModels("openai/a:x,openai/a:y"), /more than once/);
});

test("auto is offered only with a distinct allowlisted MODEL_FAST", () => {
  assert.equal(readModelCatalog(catalogEnv).fastModel, "openai/fast-fixture");
  assert.equal(
    readModelCatalog({ ...catalogEnv, MODEL_FAST: "openai/not-listed" }).fastModel,
    undefined,
  );
  assert.equal(
    readModelCatalog({ ...catalogEnv, MODEL_FAST: catalogEnv.MODEL }).fastModel,
    undefined,
  );
  assert.equal(isSimpleMessage("سلام، امروز چه خبر؟"), true);
  assert.equal(isSimpleMessage("این صفحه را خلاصه کن https://example.org"), false);
  assert.equal(isSimpleMessage("خط اول\nخط دوم"), false);
  assert.equal(isSimpleMessage("ا".repeat(201)), false);
});

test("the «خودکار» router sends chit-chat to the fast model and real work to the main model", () => {
  const fast = [
    "سلام",
    "سلام، خوبی؟",
    "ممنون از کمکت",
    "پایتخت فرانسه کجاست؟",
    "کدام فصل برای سفر به شیراز بهتر است؟",
    "یک اسم خوب برای گربه پیشنهاد بده",
    "۲ + ۲ چند می‌شود؟",
    "hello, how are you?",
  ];
  for (const text of fast) assert.equal(autoTier(text), "fast", text);
  const main = [
    "این متن را تحلیل کن",
    "یک مقاله دربارهٔ انرژی خورشیدی بنویس",
    "برنامه‌نویسی با پایتون را از کجا شروع کنم؟",
    "برنامه ریزی سفر سه‌روزه به اصفهان",
    "یک نامهٔ رسمی برای مرخصی بنویس",
    "ایمیل‌های امروزم را ببین",
    "جلسهٔ فردا را در تقویم بگذار",
    "این کد را درست کن: const x = 1;",
    "قیمت دلار امروز چند است؟",
    "این صفحه را خلاصه کن https://example.org",
    "digikala.com را بررسی کن",
    "خط اول\nخط دوم",
    "ا".repeat(201),
    "summarize this report",
  ];
  for (const text of main) assert.equal(autoTier(text), "main", text);
  // Attached documents and follow-ups to tool turns always need the main model.
  assert.equal(autoTier("خلاصه‌اش را بگو", { attachments: true }), "main");
  assert.equal(autoTier("بله، انجام بده", { toolHistory: true }), "main");
  assert.equal(autoTier("بله، انجام بده"), "fast");
  assert.equal(autoTier("این را بخوان\n\nاسناد پیوست‌شده: قرارداد.pdf (شناسهٔ سند: f1)"), "main");
});

test("GET /api/models lists the allowlist and the choice persists per owner", async (t) => {
  const fixture = await appFixture(t);
  assert.equal((await fixture.app.request("/api/models")).status, 401);
  const initial = await (await fixture.request("/api/models")).json();
  assert.deepEqual(
    initial.models.map((m: { id: string }) => m.id),
    [AUTO_MODEL, "openai/strong-fixture", "openai/fast-fixture", "google/gemini-2.5-flash"],
  );
  // With MODEL_FAST, «خودکار» is the default until someone picks a model.
  assert.equal(initial.selected, AUTO_MODEL);
  assert.deepEqual(
    initial.models.filter((m: { default: boolean }) => m.default).map((m: { id: string }) => m.id),
    [AUTO_MODEL],
  );

  const saved = await fixture.request("/api/models/selected", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "google/gemini-2.5-flash" }),
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { selected: "google/gemini-2.5-flash" });
  assert.equal(
    (await (await fixture.request("/api/models")).json()).selected,
    "google/gemini-2.5-flash",
  );
  const catalog = fixture.config.models;
  assert.ok(catalog);
  assert.equal(
    await resolveModel(fixture.db, catalog, "local-user", "سلام"),
    "google/gemini-2.5-flash",
  );
  // Other owners keep the default: auto, which is the strong model for tasks and complex turns.
  assert.equal(await resolveModel(fixture.db, catalog, "user-sara"), "openai/strong-fixture");
  assert.equal(await resolveModel(fixture.db, catalog, "user-sara", "سلام"), "openai/fast-fixture");

  await fixture.request("/api/models/selected", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: AUTO_MODEL }),
  });
  assert.equal(
    await resolveModel(fixture.db, catalog, "local-user", "سلام"),
    "openai/fast-fixture",
  );
  assert.equal(
    await resolveModel(fixture.db, catalog, "local-user", "یک گزارش کامل\nبا جزئیات"),
    "openai/strong-fixture",
  );
  // Delegated tasks never get the fast model from auto.
  assert.equal(await resolveModel(fixture.db, catalog, "local-user"), "openai/strong-fixture");
});

test("model ids outside the allowlist are rejected and stale choices fall back", async (t) => {
  const fixture = await appFixture(t);
  for (const model of ["openai/gpt-5-pro", "anthropic/claude-opus-5-5", "../../etc", ""]) {
    const response = await fixture.request("/api/models/selected", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });
    assert.equal(response.status, 422, model);
  }
  assert.equal(await fixture.db.get("local-user", "conversation-settings", "model"), null);
  // A value written before MODELS changed (or tampered with) is ignored.
  await fixture.db.put("local-user", "conversation-settings", {
    id: "model",
    model: "openai/removed",
  });
  const catalog = fixture.config.models;
  assert.ok(catalog);
  assert.equal(await resolveModel(fixture.db, catalog, "local-user"), "openai/strong-fixture");
  assert.equal((await (await fixture.request("/api/models")).json()).selected, AUTO_MODEL);
});

test("chat turns use the owner's chosen model", async (t) => {
  const { requests } = await modelFixture(t, () => undefined);
  const fixture = await appFixture(t, { agentBackend: "model" });
  await fixture.request("/api/models/selected", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "openai/fast-fixture" }),
  });
  const input: RunAgentInput = {
    threadId: "model-choice",
    runId: randomUUID(),
    messages: [{ id: randomUUID(), role: "user", content: "سلام" }],
    tools: [],
    context: [],
    state: {},
  };
  const agent = new ConversationAgent(fixture.config, fixture.agent, "local-user");
  await lastValueFrom(agent.run(input).pipe(toArray()));
  assert.equal(requests.length, 1);
  assert.equal(JSON.parse(requests[0].body).model, "fast-fixture");
});

test("delegated tasks use the owner's chosen model, and auto uses the strong default", async (t) => {
  const { requests } = await modelFixture(t, () => ({
    name: "finish_task",
    arguments: { summary: "انجام شد." },
  }));
  const fixture = await appFixture(t, { agentBackend: "model" });
  const choose = (model: string) =>
    fixture.request("/api/models/selected", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });
  await choose("google/gemini-2.5-flash");
  await choose("openai/fast-fixture");
  const first = await fixture.agent.createTask("local-user", { prompt: "یک برنامه بنویس" });
  await fixture.agent.worker.tick();
  assert.equal((await fixture.agent.getTask("local-user", first.id)).status, "succeeded");
  assert.equal(JSON.parse(requests[0].body).model, "fast-fixture");

  requests.length = 0;
  await choose(AUTO_MODEL);
  const second = await fixture.agent.createTask("local-user", { prompt: "سلام" });
  await fixture.agent.worker.tick();
  assert.equal((await fixture.agent.getTask("local-user", second.id)).status, "succeeded");
  assert.equal(JSON.parse(requests[0].body).model, "strong-fixture");
});

test("POST /api/transcribe sends audio to the OpenAI-compatible endpoint in Persian", async (t) => {
  withEnv(t, {
    OPENAI_API_KEY: "fixture-key",
    OPENAI_BASE_URL: "https://gateway.example/openai/v1",
    GOOGLE_API_KEY: undefined,
    TRANSCRIBE_MODEL: undefined,
    TRANSCRIBE_ENABLED: undefined,
  });
  const fixture = await appFixture(t);
  const calls: { url: string; form: FormData; auth: string | null }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      form: init?.body as FormData,
      auth: new Headers(init?.headers).get("authorization"),
    });
    return Response.json({ text: "  سلام، فردا ساعت ده جلسه بگذار.  " });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  const health = await (await fixture.app.request("/api/health")).json();
  assert.equal(health.transcriptionEnabled, true);

  const upload = (blob: Blob, name = "recording.webm") => {
    const form = new FormData();
    form.append("file", blob, name);
    return fixture.request("/api/transcribe", { method: "POST", body: form });
  };
  const audio = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3])], {
    type: "audio/webm;codecs=opus",
  });
  const response = await upload(audio);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { text: "سلام، فردا ساعت ده جلسه بگذار." });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://gateway.example/openai/v1/audio/transcriptions");
  assert.equal(calls[0].auth, "Bearer fixture-key");
  assert.equal(calls[0].form.get("model"), "whisper-1");
  assert.equal(calls[0].form.get("language"), "fa");
  const sent = calls[0].form.get("file");
  assert.ok(sent instanceof Blob);
  assert.equal(sent.size, audio.size);

  // Unauthenticated, oversized and non-audio uploads never reach the provider.
  assert.equal(
    (await fixture.app.request("/api/transcribe", { method: "POST", body: new FormData() })).status,
    401,
  );
  const large = await upload(
    new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: "audio/webm" }),
  );
  assert.equal(large.status, 413);
  assert.match((await large.json()).error, /۱۰ مگابایت/);
  assert.equal((await upload(new Blob(["x"], { type: "text/plain" }), "a.txt")).status, 415);
  assert.equal(
    (await fixture.request("/api/transcribe", { method: "POST", body: new FormData() })).status,
    400,
  );
  assert.equal(calls.length, 1);
});

test("transcription reports provider failures, empty speech, MP4 fallback and disabled servers", async (t) => {
  withEnv(t, {
    OPENAI_API_KEY: "fixture-key",
    OPENAI_BASE_URL: "https://gateway.example/openai/v1",
    GOOGLE_API_KEY: "fixture-google",
    GOOGLE_GENERATIVE_AI_BASE_URL: "https://gateway.example/v1beta",
    TRANSCRIBE_MODEL: "gpt-4o-transcribe",
    TRANSCRIBE_ENABLED: undefined,
  });
  const fixture = await appFixture(t);
  const urls: string[] = [];
  let next: () => Response = () => Response.json({ text: "" });
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    urls.push(String(url));
    if (String(url).includes("/audio/transcriptions"))
      assert.equal((init?.body as FormData | undefined)?.get("model"), "gpt-4o-transcribe");
    return next();
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  const upload = (type: string) => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array([1, 2, 3])], { type }), "recording");
    return fixture.request("/api/transcribe", { method: "POST", body: form });
  };

  const empty = await upload("audio/webm");
  assert.equal(empty.status, 422);
  assert.match((await empty.json()).error, /صدایی تشخیص داده نشد/);

  next = () => new Response("upstream down", { status: 500 });
  const failed = await upload("audio/ogg");
  assert.equal(failed.status, 502);
  assert.match((await failed.json()).error, /تبدیل صدا به متن انجام نشد/);

  // Safari records MP4, which Metis' whisper rejects; it goes straight to Gemini.
  urls.length = 0;
  next = () => Response.json({ candidates: [{ content: { parts: [{ text: "متن از جمنای" }] } }] });
  const mp4 = await upload("audio/mp4");
  assert.equal(mp4.status, 200);
  assert.deepEqual(await mp4.json(), { text: "متن از جمنای" });
  assert.deepEqual(urls, [
    "https://gateway.example/v1beta/models/gemini-2.5-flash:generateContent",
  ]);

  process.env.TRANSCRIBE_ENABLED = "false";
  assert.equal(
    (await (await fixture.app.request("/api/health")).json()).transcriptionEnabled,
    false,
  );
  assert.equal((await upload("audio/webm")).status, 503);
});
