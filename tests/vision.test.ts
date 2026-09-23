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
import { detectImageKind, isHeic } from "../apps/server/src/images.ts";
import {
  attachedFileIds,
  enrichBusinessCard,
  enrichReceipt,
  extractFromFile,
  imagePart,
  normalizePersianText,
  visionModel,
  withImageParts,
} from "../apps/server/src/vision.ts";
import { modelFixture } from "./helpers/model.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0]);
const HEIC = new Uint8Array([0, 0, 0, 24, ...Buffer.from("ftypheic"), 0, 0, 0, 0]);
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n160\n%%EOF",
);

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

async function appFixture(t: TestContext, overrides: Partial<Config> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-vision-"));
  const db = await createStore();
  const config: Config = {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "sample",
    model: "openai/vision-fixture",
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
  const upload = async (bytes: Uint8Array, name: string, type = "") => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type }), name);
    return request("/api/files", { method: "POST", body: form });
  };
  return { ...server, db, config, request, upload };
}

// biome-ignore lint/suspicious/noExplicitAny: the tests inspect arbitrary provider JSON bodies.
type Json = any;

/** Replaces fetch for the test; every call is recorded and answered by `reply`. */
function fakeFetch(t: TestContext, reply: (url: string, body: Json) => Response) {
  const calls: { url: string; body: Json; auth: string | null }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    calls.push({ url: String(url), body, auth: new Headers(init?.headers).get("authorization") });
    return reply(String(url), body);
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  return calls;
}
const completion = (content: string) => Response.json({ choices: [{ message: { content } }] });

test("OCR output is normalized to clean Persian", () => {
  assert.equal(
    normalizePersianText(
      "```\nمي خواهم كتاب ها را ببينم\u200c \n\n\n\nنمی شود  ١٢٣ ـــ بزرگ تر\n```",
    ),
    "می‌خواهم کتاب‌ها را ببینم\n\nنمی‌شود ۱۲۳ بزرگ‌تر",
  );
  // Latin text, URLs and emails stay untouched; real words are not glued.
  assert.equal(
    normalizePersianText("ایمیل: info@example.com  https://a.ir/x"),
    "ایمیل: info@example.com https://a.ir/x",
  );
  assert.equal(normalizePersianText("همین جا"), "همین جا");
  assert.equal(normalizePersianText("\u200f\u200d  "), "");
});

test("image uploads are detected by content, HEIC gets a Persian message", async (t) => {
  assert.equal(detectImageKind(PNG), "png");
  assert.equal(detectImageKind(JPEG), "jpg");
  assert.equal(detectImageKind(Buffer.from("RIFF\0\0\0\0WEBPVP8 ")), "webp");
  assert.equal(detectImageKind(PDF), undefined);
  assert.ok(isHeic(HEIC));

  const fixture = await appFixture(t);
  const response = await fixture.upload(PNG, "receipt.png", "image/png");
  assert.equal(response.status, 201);
  const file = await response.json();
  assert.equal(file.mimeType, "image/png");
  const content = await fixture.request(`/api/files/${file.id}/content`);
  assert.equal(content.headers.get("content-type"), "image/png");
  assert.deepEqual(new Uint8Array(await content.arrayBuffer()), new Uint8Array(PNG));
  const text = await (await fixture.request(`/api/files/${file.id}/text`)).json();
  assert.match(text.note, /extract_from_image/);
  // A claimed image type does not matter; the bytes do.
  const heic = await fixture.upload(HEIC, "IMG_0001.HEIC", "image/heic");
  assert.equal(heic.status, 415);
  assert.match((await heic.json()).error, /HEIC/);
  assert.equal((await fixture.upload(new Uint8Array([1, 2, 3]), "x.gif", "image/gif")).status, 422);
});

test("attached images become image content parts of the latest user message", async () => {
  const owned = new Map([
    ["img-1", { id: "img-1", mimeType: "image/png", bytes: PNG }],
    ["doc-1", { id: "doc-1", mimeType: "application/pdf", bytes: PDF }],
  ]);
  const files = {
    get: async (_owner: string, id: string) => {
      const file = owned.get(id);
      if (!file) throw new Error("فایل پیدا نشد");
      return file as never;
    },
    bytes: async (_owner: string, id: string) => owned.get(id)?.bytes as never,
  };
  const text =
    "این فاکتور را بخوان\n\nاسناد پیوست‌شده: a.png (شناسهٔ سند: img-1)، b.pdf (شناسهٔ سند: doc-1)، c (شناسهٔ سند: missing)";
  assert.deepEqual(attachedFileIds(text), ["img-1", "doc-1", "missing"]);
  const messages = [
    { id: "1", role: "user", content: "قبلی (شناسهٔ سند: img-1)" },
    { id: "2", role: "assistant", content: "باشه" },
    { id: "3", role: "user", content: text },
  ];
  const result = await withImageParts(messages, files, "owner");
  assert.equal(result[0].content, messages[0].content, "older turns stay text");
  assert.deepEqual(result[2].content, [{ type: "text", text }, imagePart(PNG, "image/png")]);
  assert.deepEqual(imagePart(PNG, "image/png").source, {
    type: "data",
    value: PNG.toString("base64"),
    mimeType: "image/png",
  });
  // Nothing attached: the same array comes back.
  const plain = [{ id: "1", role: "user", content: "سلام" }];
  assert.equal(await withImageParts(plain, files, "owner"), plain);
});

test("the chat model receives an uploaded photo as an image input", async (t) => {
  const { requests } = await modelFixture(t, () => undefined);
  const fixture = await appFixture(t, { agentBackend: "model" });
  const file = await (await fixture.upload(PNG, "card.png")).json();
  const input: RunAgentInput = {
    threadId: "vision",
    runId: randomUUID(),
    messages: [
      {
        id: randomUUID(),
        role: "user",
        content: `این کارت ویزیت را بخوان\n\nاسناد پیوست‌شده: card.png (شناسهٔ سند: ${file.id})`,
      },
    ],
    tools: [],
    context: [],
    state: {},
  };
  const agent = new ConversationAgent(fixture.config, fixture.agent, "local-user");
  await lastValueFrom(agent.run(input).pipe(toArray()));
  assert.equal(requests.length, 1);
  const body = JSON.parse(requests[0].body);
  const content = body.input.find((item: { role?: string }) => item.role === "user").content;
  assert.ok(
    content.some(
      (part: { type: string; image_url?: string }) =>
        part.type === "input_image" && part.image_url?.includes(PNG.toString("base64")),
    ),
  );
  assert.ok(body.tools.some((tool: { name: string }) => tool.name === "extract_from_image"));
});

test("POST /api/files/:id/ocr sends the image to the vision model and caches clean text", async (t) => {
  withEnv(t, {
    OPENAI_API_KEY: "fixture-key",
    OPENAI_BASE_URL: "https://gateway.example/openai/v1",
    VISION_MODEL: "openai/gpt-4.1-mini",
    VISION_ENABLED: undefined,
  });
  assert.equal(visionModel(), "gpt-4.1-mini");
  const fixture = await appFixture(t);
  const calls = fakeFetch(t, () => completion("متن فاكتور: مبلغ ١٢٠ هزار ريال"));
  const health = await (await fixture.app.request("/api/health")).json();
  assert.equal(health.visionEnabled, true);

  const image = await (await fixture.upload(PNG, "note.png")).json();
  const first = await fixture.request(`/api/files/${image.id}/ocr`, { method: "POST" });
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { text: "متن فاکتور: مبلغ ۱۲۰ هزار ریال" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://gateway.example/openai/v1/chat/completions");
  assert.equal(calls[0].auth, "Bearer fixture-key");
  assert.equal(calls[0].body.model, "gpt-4.1-mini");
  const [prompt, part] = calls[0].body.messages[0].content;
  assert.match(prompt.text, /OCR/);
  assert.equal(part.type, "image_url");
  assert.equal(part.image_url.url, `data:image/png;base64,${PNG.toString("base64")}`);
  // Cached per file: no second provider call.
  assert.equal(
    (await fixture.request(`/api/files/${image.id}/ocr`, { method: "POST" })).status,
    200,
  );
  assert.equal(calls.length, 1);

  // Scanned PDFs go as file parts.
  const pdf = await (await fixture.upload(PDF, "scan.pdf")).json();
  assert.equal((await fixture.request(`/api/files/${pdf.id}/ocr`, { method: "POST" })).status, 200);
  const filePart = calls[1].body.messages[0].content[1];
  assert.equal(filePart.type, "file");
  assert.equal(filePart.file.filename, "scan.pdf");
  assert.match(filePart.file.file_data, /^data:application\/pdf;base64,/);

  // Word/Excel/CSV are not images.
  const csv = await (await fixture.upload(Buffer.from("a,b\n1,2"), "x.csv", "text/csv")).json();
  assert.equal((await fixture.request(`/api/files/${csv.id}/ocr`, { method: "POST" })).status, 422);

  const blank = await (await fixture.upload(JPEG, "blank.jpg")).json();
  calls.length = 0;
  globalThis.fetch = (async () => completion("  ")) as typeof fetch;
  const empty = await fixture.request(`/api/files/${blank.id}/ocr`, { method: "POST" });
  assert.equal(empty.status, 422);
  assert.match((await empty.json()).error, /متنی در این فایل پیدا نشد/);
  globalThis.fetch = (async () => new Response("down", { status: 500 })) as typeof fetch;
  const other = await (await fixture.upload(PNG, "other.png")).json();
  const failed = await fixture.request(`/api/files/${other.id}/ocr`, { method: "POST" });
  assert.equal(failed.status, 502);
  assert.match((await failed.json()).error, /خواندن تصویر انجام نشد/);

  process.env.VISION_ENABLED = "false";
  assert.equal((await (await fixture.app.request("/api/health")).json()).visionEnabled, false);
  const third = await (await fixture.upload(PNG, "third.png")).json();
  assert.equal(
    (await fixture.request(`/api/files/${third.id}/ocr`, { method: "POST" })).status,
    503,
  );
});

test("receipt and business card extraction add Jalali dates, toman totals and LTR-safe values", () => {
  const receipt = enrichReceipt({
    vendor: "فروشگاه نمونه",
    dateIso: "2025-03-21",
    currency: "IRR",
    total: 1_250_000,
    items: [],
  });
  assert.equal(receipt.dateJalali, "۱ فروردین ۱۴۰۴");
  assert.equal(receipt.totalToman, 125_000);
  assert.equal(receipt.totalDisplay, "۱۲۵٬۰۰۰ تومان");
  assert.equal(enrichReceipt({ total: "۴۵٬۰۰۰", currency: "IRT" }).totalDisplay, "۴۵٬۰۰۰ تومان");
  assert.equal(
    enrichReceipt({ total: 12, currency: "USD", dateIso: "نامعلوم" }).totalDisplay,
    undefined,
  );

  const card = enrichBusinessCard({
    name: "مریم احمدی",
    phones: [{ label: "همراه", number: "۰۹۱۲ ۳۴۵ ۶۷۸۹" }, "+98 21 8888-0000", { label: "x" }],
    emails: [" maryam@example.ir ", 5],
  });
  assert.deepEqual(card.phones, [
    { label: "همراه", number: "09123456789" },
    { label: null, number: "+982188880000" },
  ]);
  assert.deepEqual(card.emails, ["maryam@example.ir"]);
});

test("extract_from_image returns structured receipt data to the model", async (t) => {
  withEnv(t, {
    OPENAI_API_KEY: "fixture-key",
    OPENAI_BASE_URL: "https://gateway.example/openai/v1",
    VISION_MODEL: undefined,
    VISION_ENABLED: undefined,
  });
  const fixture = await appFixture(t);
  const image = await (await fixture.upload(PNG, "factor.png")).json();
  const calls = fakeFetch(t, () =>
    completion(
      JSON.stringify({ vendor: "نانوایی", dateIso: "2025-03-21", currency: "IRT", total: 80000 }),
    ),
  );
  const result = await extractFromFile(fixture.files, "local-user", image.id, "receipt");
  assert.equal(calls[0].body.model, "gpt-4.1");
  assert.deepEqual(calls[0].body.response_format, { type: "json_object" });
  assert.ok("data" in result);
  const data = result.data as Record<string, unknown>;
  assert.equal(data.dateJalali, "۱ فروردین ۱۴۰۴");
  assert.equal(data.totalDisplay, "۸۰٬۰۰۰ تومان");
});
