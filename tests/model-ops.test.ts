import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type { BaseEvent, RunAgentInput } from "@ag-ui/core";
import { lastValueFrom, toArray } from "rxjs";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";
import { ConversationAgent } from "../apps/server/src/engine/conversation.ts";
import { isGatewayFailure, readFallback, withFallback } from "../apps/server/src/fallback.ts";
import { readModelCatalog } from "../apps/server/src/models.ts";
import {
  costMicroUsd,
  DEFAULT_MODEL_PRICES,
  parseModelPrices,
  priceFor,
} from "../apps/server/src/pricing.ts";
import {
  cacheablePrompt,
  normalizePrompt,
  ResponseCache,
  stablePrompt,
} from "../apps/server/src/response-cache.ts";
import { lengthInstruction, maxOutputTokens } from "../apps/server/src/response-length.ts";
import { jalaliMonthStart, Usage } from "../apps/server/src/usage.ts";

const catalogEnv = {
  MODEL: "openai/strong-fixture",
  MODELS: "openai/strong-fixture:مدل قوی,openai/fast-fixture:مدل سریع",
  MODEL_FAST: "openai/fast-fixture",
};

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

type Handler = (body: Record<string, unknown>, response: ServerResponse) => void;

/** A local HTTP server standing in for a model gateway; nothing leaves the machine. */
async function gateway(t: TestContext, handle: Handler) {
  const requests: Record<string, unknown>[] = [];
  const server = createServer(async (request: IncomingMessage, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw || "{}");
    requests.push({ ...body, path: request.url });
    handle(body, response);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { url: `http://127.0.0.1:${address.port}/v1`, requests };
}

/** OpenAI Responses stream with one text answer and fixed usage (10 in, 5 out). */
function responsesText(text: string): Handler {
  return (_body, response) => {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const emit = (type: string, value: object) =>
      response.write(`data: ${JSON.stringify({ type, ...value })}\n\n`);
    const base = { id: "response-1", created_at: 1000, model: "fixture" };
    const item = { id: "msg-1", type: "message", role: "assistant" };
    emit("response.created", { response: { ...base, status: "in_progress" } });
    emit("response.output_item.added", {
      output_index: 0,
      item: { ...item, status: "in_progress", content: [] },
    });
    emit("response.output_text.delta", { item_id: "msg-1", output_index: 0, delta: text });
    emit("response.output_item.done", {
      output_index: 0,
      item: {
        ...item,
        status: "completed",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    });
    emit("response.completed", {
      response: {
        ...base,
        status: "completed",
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      },
    });
    response.end("data: [DONE]\n\n");
  };
}

async function appFixture(t: TestContext, overrides: Partial<Config> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-model-ops-"));
  const db = await createStore();
  const config: Config = {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "model",
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
  const request = (path: string, body?: unknown, method = body === undefined ? "GET" : "PUT") =>
    server.app.request(path, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const chat = async (content: string, owner = "local-user") => {
    const input: RunAgentInput = {
      threadId: randomUUID(),
      runId: randomUUID(),
      messages: [{ id: randomUUID(), role: "user", content }],
      tools: [],
      context: [],
      state: {},
    };
    const agent = new ConversationAgent(config, server.agent, owner);
    return (await lastValueFrom(agent.run(input).pipe(toArray()))) as (BaseEvent &
      Record<string, unknown>)[];
  };
  // Usage is written asynchronously after RUN_FINISHED; wait for it instead of racing.
  const recorded = async (calls: number, owner = "local-user") => {
    for (let i = 0; i < 100; i++) {
      const today = await server.agent.usage?.today(owner);
      if ((today?.modelCalls ?? 0) >= calls) return today;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail("usage was not recorded");
  };
  return { ...server, db, config, request, chat, recorded };
}
const textOf = (events: Record<string, unknown>[]) =>
  events
    .filter((e) => e.type === "TEXT_MESSAGE_CONTENT" || e.type === "TEXT_MESSAGE_CHUNK")
    .map((e) => e.delta)
    .join("");
const modelOf = (events: Record<string, unknown>[]) =>
  (events.find((e) => e.type === "CUSTOM" && e.name === "dastyar.model")?.value ?? {}) as {
    model?: string;
    cached?: boolean;
  };

test("MODEL_PRICES merges over the defaults and prices bare usage model ids", () => {
  const table = parseModelPrices(
    '{"openai/gpt-4.1":{"input":1,"output":2},"x/y":{"input":0,"output":0}}',
  );
  assert.deepEqual(table["openai/gpt-4.1"], { input: 1, output: 2 });
  assert.deepEqual(
    table["anthropic/claude-sonnet-5"],
    DEFAULT_MODEL_PRICES["anthropic/claude-sonnet-5"],
  );
  assert.deepEqual(priceFor(table, "gpt-4.1-mini"), DEFAULT_MODEL_PRICES["openai/gpt-4.1-mini"]);
  assert.deepEqual(priceFor(table, "unknown", "openai/gpt-4.1"), { input: 1, output: 2 });
  assert.equal(priceFor(table, "unknown"), undefined);
  // 1M input tokens at 3 USD plus 1M output tokens at 15 USD = 18 USD = 18e6 micro-dollars.
  assert.equal(
    costMicroUsd(table, { inputTokens: 1e6, outputTokens: 1e6 }, "claude-sonnet-5"),
    18e6,
  );
  assert.equal(costMicroUsd(table, { inputTokens: 1, outputTokens: 0 }, "gpt-4.1-mini"), 1);
  assert.throws(() => parseModelPrices("{bad"), /MODEL_PRICES/);
  assert.throws(() => parseModelPrices('{"a/b":{"input":-1,"output":1}}'), /non-negative/);
});

test("usage records cost per run, estimates missing usage and sums the Jalali month", async (t) => {
  assert.equal(jalaliMonthStart("2026-09-23"), "2026-09-23"); // ۱ مهر ۱۴۰۵
  assert.equal(jalaliMonthStart("2026-09-22"), "2026-08-23"); // ۳۱ شهریور ← ۱ شهریور
  const db = await createStore();
  t.after(() => db.close());
  let now = Date.parse("2026-09-21T08:00:00Z");
  const config = { modelPrices: parseModelPrices() } as Config;
  const usage = new Usage(db, config, { isAdmin: async () => false } as never, () => now);
  await usage.recordModelRun(
    "user-a",
    [{ provider: "openai.responses", model: "gpt-4.1-mini", inputTokens: 1000, outputTokens: 500 }],
    { model: "openai/gpt-4.1-mini" },
  );
  now = Date.parse("2026-09-23T08:00:00Z");
  await usage.recordModelRun("user-a", undefined, {
    model: "anthropic/claude-sonnet-5",
    estimate: { inputTokens: 100, outputTokens: 100 },
  });
  const today = await usage.today("user-a");
  assert.equal(today.costMicroUsd, 100 * 3 + 100 * 15);
  assert.equal(today.estimatedRuns, 1);
  const summary = await usage.summary("user-a");
  // The first run was in شهریور, the second on ۱ مهر.
  assert.equal(summary.month.costMicroUsd, 1800);
  assert.equal(summary.total.costMicroUsd, 1800 + 1000 * 0.4 + 500 * 1.6);
  assert.equal(summary.total.modelCalls, 2);
});

test("chat runs record cost, report the answering model and admins see totals", async (t) => {
  const primary = await gateway(t, responsesText("سلام! چه کمکی از دستم برمی‌آید؟"));
  withEnv(t, { OPENAI_BASE_URL: primary.url, OPENAI_API_KEY: "local-test-fixture" });
  const fixture = await appFixture(t, {
    modelPrices: parseModelPrices('{"openai/fast-fixture":{"input":2,"output":10}}'),
  });
  const events = await fixture.chat("سلام");
  assert.equal(textOf(events), "سلام! چه کمکی از دستم برمی‌آید؟");
  // «خودکار» is the default and routes a greeting to the fast model.
  assert.equal(primary.requests[0].model, "fast-fixture");
  assert.deepEqual(modelOf(events), { model: "openai/fast-fixture", cached: false });
  await fixture.recorded(1);
  const admin = await (await fixture.request("/api/admin/users")).json();
  const me = admin.users.find((u: { id: string }) => u.id === "local-user");
  assert.equal(me.summary.today.costMicroUsd, 10 * 2 + 5 * 10);
  assert.equal(admin.totals.month.costMicroUsd, 70);
  assert.equal(admin.totals.total.totalTokens, 15);
});

test("answer length is saved per person and caps output tokens with a prompt hint", async (t) => {
  assert.equal(maxOutputTokens("short"), 1500);
  assert.equal(maxOutputTokens("short", 800), 800);
  assert.equal(maxOutputTokens("normal"), undefined);
  assert.equal(maxOutputTokens("long", 8000), 8000);
  assert.equal(lengthInstruction("normal"), "");
  const primary = await gateway(t, responsesText("کوتاه."));
  withEnv(t, { OPENAI_BASE_URL: primary.url, OPENAI_API_KEY: "local-test-fixture" });
  const fixture = await appFixture(t, { maxOutputTokens: 4000 });
  assert.equal((await (await fixture.request("/api/models")).json()).length, "normal");
  const invalid = await fixture.request("/api/models/length", { length: "huge" });
  assert.equal(invalid.status, 422);
  assert.match((await invalid.json()).error, /کوتاه/);

  await fixture.chat("این متن را تحلیل کن");
  assert.equal(primary.requests[0].model, "strong-fixture");
  assert.equal(primary.requests[0].max_output_tokens, 4000);

  const saved = await fixture.request("/api/models/length", { length: "short" });
  assert.deepEqual(await saved.json(), { length: "short" });
  assert.equal((await (await fixture.request("/api/models")).json()).length, "short");
  await fixture.chat("این متن را تحلیل کن");
  assert.equal(primary.requests[1].max_output_tokens, 1500);
  assert.match(JSON.stringify(primary.requests[1]), /Answer length preference: SHORT/);
});

test("Persian prompts normalize to one cache key and only stateless first turns qualify", () => {
  assert.equal(normalizePrompt("  سلام،  خوبي؟ "), normalizePrompt("سلام، خوبی"));
  assert.equal(normalizePrompt("۲ + ۲ چند می‌شود؟"), "2 + 2 چند می شود");
  assert.equal(normalizePrompt("كتاب"), "کتاب");
  const input = (content: string, extra: Partial<RunAgentInput> = {}): RunAgentInput => ({
    threadId: "t",
    runId: "r",
    messages: [{ id: "m", role: "user", content }],
    tools: [],
    context: [],
    state: {},
    ...extra,
  });
  assert.equal(cacheablePrompt(input("سلام")), "سلام");
  assert.equal(cacheablePrompt(input("این را ببین https://example.org")), undefined);
  assert.equal(cacheablePrompt(input("امروز چندم است؟")), undefined);
  assert.equal(cacheablePrompt(input("قیمت دلار؟")), undefined);
  assert.equal(cacheablePrompt(input("ا".repeat(201))), undefined);
  assert.equal(
    cacheablePrompt(input("خلاصه کن\n\nاسناد پیوست‌شده: الف.pdf (شناسهٔ سند: f1)")),
    undefined,
  );
  assert.equal(
    cacheablePrompt(input("سلام", { context: [{ description: "x", value: "y" }] })),
    undefined,
  );
  assert.equal(
    cacheablePrompt(
      input("سلام", {
        messages: [
          { id: "a", role: "user", content: "قبلی" },
          { id: "b", role: "assistant", content: "پاسخ" },
          { id: "c", role: "user", content: "سلام" },
        ],
      }),
    ),
    undefined,
  );
  assert.equal(
    stablePrompt(
      'x {"nowIso":"2026-09-23T10:00:00.000Z","tehranTime":"13:30","gregorianDate":"2026-09-23"}',
    ),
    'x {,,"gregorianDate":"2026-09-23"}',
  );
  let now = 0;
  const cache = new ResponseCache(1000, 2, () => now);
  cache.set("a", "1");
  cache.set("b", "2");
  assert.equal(cache.get("a"), "1");
  cache.set("c", "3"); // evicts the least recently used entry, "b"
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.size, 2);
  now = 1001;
  assert.equal(cache.get("a"), undefined);
});

test("RESPONSE_CACHE replays identical first turns per owner without a model call", async (t) => {
  const primary = await gateway(t, responsesText("پایتخت فرانسه پاریس است."));
  withEnv(t, { OPENAI_BASE_URL: primary.url, OPENAI_API_KEY: "local-test-fixture" });
  const fixture = await appFixture(t, { responseCache: true, responseCacheTtl: 60 });
  const question = `پایتخت فرانسه کجاست؟ ${randomUUID().slice(0, 8)}`;
  await fixture.chat(question);
  const replay = await fixture.chat(` ${question.replace("ی", "ي")} `);
  assert.equal(primary.requests.length, 1);
  assert.equal(textOf(replay), "پایتخت فرانسه پاریس است.");
  assert.deepEqual(modelOf(replay), { model: "openai/fast-fixture", cached: true });
  assert.deepEqual(
    replay.map((e) => e.type),
    [
      "RUN_STARTED",
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_END",
      "CUSTOM",
      "RUN_FINISHED",
    ],
  );
  // Another person never receives this owner's cached answer.
  await fixture.chat(question, "user-sara");
  assert.equal(primary.requests.length, 2);
  // Cached replays are not model runs.
  assert.equal((await fixture.recorded(1))?.modelCalls, 1);
});

test("the response cache stays off by default", async (t) => {
  const primary = await gateway(t, responsesText("پاسخ"));
  withEnv(t, { OPENAI_BASE_URL: primary.url, OPENAI_API_KEY: "local-test-fixture" });
  const fixture = await appFixture(t);
  const question = `یک اسم برای گربه ${randomUUID().slice(0, 8)}`;
  await fixture.chat(question);
  await fixture.chat(question);
  assert.equal(primary.requests.length, 2);
});

test("gateway failures before streaming retry once on the fallback gateway", async (t) => {
  assert.equal(isGatewayFailure({ statusCode: 503 }), true);
  assert.equal(isGatewayFailure({ statusCode: 401 }), false);
  assert.equal(isGatewayFailure(new TypeError("fetch failed")), true);
  assert.equal(isGatewayFailure(new Error("Invalid prompt")), false);
  assert.equal(
    readFallback({ FALLBACK_BASE_URL: "https://x/v1", FALLBACK_API_KEY: "k" }),
    undefined,
  );
  assert.equal(withFallback("openai/gpt-4.1", {}), "openai/gpt-4.1");

  const primary = await gateway(t, (_body, response) => {
    response.writeHead(503, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { message: "upstream unavailable" } }));
  });
  const fallback = await gateway(t, (_body, response) => {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = (delta: object, finish: string | null, usage?: object) =>
      response.write(
        `data: ${JSON.stringify({
          id: "chat-1",
          object: "chat.completion.chunk",
          created: 1,
          model: "backup-model",
          choices: [{ index: 0, delta, finish_reason: finish }],
          ...(usage ? { usage } : {}),
        })}\n\n`,
      );
    chunk({ role: "assistant", content: "پاسخ از درگاه پشتیبان" }, null);
    chunk({}, "stop", { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 });
    response.end("data: [DONE]\n\n");
  });
  withEnv(t, {
    OPENAI_BASE_URL: primary.url,
    OPENAI_API_KEY: "local-test-fixture",
    FALLBACK_BASE_URL: fallback.url,
    FALLBACK_API_KEY: "fallback-fixture",
    FALLBACK_MODEL: "backup-model",
  });
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (message: string) => warnings.push(String(message));
  t.after(() => {
    console.warn = warn;
  });
  const fixture = await appFixture(t);
  assert.equal((await (await fixture.app.request("/api/health")).json()).fallbackConfigured, true);
  const events = await fixture.chat("سلام");
  assert.equal(textOf(events), "پاسخ از درگاه پشتیبان");
  assert.equal(primary.requests.length, 1);
  assert.equal(fallback.requests.length, 1);
  assert.equal(fallback.requests[0].path, "/v1/chat/completions");
  assert.equal(fallback.requests[0].model, "backup-model");
  assert.ok(warnings.some((w) => /fallback gateway/.test(w) && /HTTP 503/.test(w)));
  assert.equal((await fixture.recorded(1))?.totalTokens, 10);
});
