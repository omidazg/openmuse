import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  type PDFRef,
  StandardFonts,
} from "pdf-lib";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";
import { PdfRenderer } from "../apps/server/src/pdf-render.ts";
import { printDocument, validatePdfRequest } from "../apps/worker/src/pdf.ts";
import { createWorkerServer } from "../apps/worker/src/server.ts";
import type { Artifact, Workspace } from "../packages/domain/src/index.ts";
import {
  createSamplePdf,
  fillPdf,
  inspectPdf,
  PdfError,
} from "../packages/integrations/src/pdf.ts";
import {
  documentHtml,
  markdownToHtml,
  overlayHtml,
} from "../packages/integrations/src/pdf-html.ts";

const TOKEN = "test-worker-token-at-least-32-characters";

/**
 * Stand-in for Chromium: one PDF page per `.page` element (overlay HTML) or two A4
 * pages otherwise, sized from the `@page` rule like the real renderer.
 */
async function fakeRender(html: string): Promise<Uint8Array> {
  const size = /@page \{ size: ([\d.]+)pt ([\d.]+)pt/.exec(html);
  const pages = Math.max(html.match(/class="page"/g)?.length ?? 0, size ? 1 : 2);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage(size ? [Number(size[1]), Number(size[2])] : [595, 842]);
    page.drawText(`page ${i + 1}`, { x: 2, y: 2, size: 6, font });
  }
  return doc.save();
}

async function worker(t: TestContext) {
  const requests: { html: string; title: string; direction: string; lang: string }[] = [];
  const dataDir = await mkdtemp(join(tmpdir(), "openmuse-pdf-worker-"));
  const instance = await createWorkerServer({
    token: TOKEN,
    dataDir,
    pdf: {
      async render(request) {
        requests.push(request);
        return fakeRender(request.html);
      },
      async close() {},
    },
  });
  instance.server.listen(0, "127.0.0.1");
  await once(instance.server, "listening");
  const address = instance.server.address();
  assert(address && typeof address !== "string");
  t.after(async () => {
    await instance.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  return { url: `http://127.0.0.1:${address.port}`, requests };
}

function config(directory: string, workerUrl?: string): Config {
  return {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "sample",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: [],
    ...(workerUrl ? { workerUrl, workerToken: TOKEN } : {}),
  };
}

test("worker POST /pdf requires auth, validates input and returns application/pdf", async (t) => {
  const { url, requests } = await worker(t);
  const post = (body: unknown, auth = true) =>
    fetch(`${url}/pdf`, {
      method: "POST",
      headers: {
        ...(auth ? { authorization: `Bearer ${TOKEN}` } : {}),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  assert.equal((await post({ html: "<p>سلام</p>" }, false)).status, 401);
  for (const [body, code] of [
    [{}, "INVALID_HTML"],
    [{ html: "  " }, "INVALID_HTML"],
    [{ html: "<p>x</p>", direction: "up" }, "INVALID_DIRECTION"],
    [{ html: "<p>x</p>", lang: "not a tag" }, "INVALID_LANG"],
  ] as const) {
    const response = await post(body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, code);
  }
  const ok = await post({ html: "<h1>گزارش</h1>", title: "گزارش ماهانه", lang: "fa-IR" });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "application/pdf");
  const bytes = new Uint8Array(await ok.arrayBuffer());
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), "%PDF-");
  assert.deepEqual(requests.at(-1), {
    html: "<h1>گزارش</h1>",
    title: "گزارش ماهانه",
    direction: "rtl",
    lang: "fa-IR",
  });
});

test("print document is RTL, embeds Vazirmatn and blocks scripts and remote loads", async () => {
  const html = await printDocument(validatePdfRequest({ html: "<p>متن</p>", title: "<عنوان>" }));
  assert(html.includes(`<html lang="fa-IR" dir="rtl">`));
  assert(html.includes("<title>&lt;عنوان&gt;</title>"));
  assert(
    /@font-face[^}]*Vazirmatn[^}]*url\(data:font\/ttf;base64,/.test(html),
    "Vazirmatn is embedded",
  );
  assert(
    /Content-Security-Policy" content="default-src 'none';/.test(html),
    "CSP blocks scripts and remote loads",
  );
  assert(!html.includes("letter-spacing"));
});

test("HTML helpers escape content and keep Persian layout hints", () => {
  const body = markdownToHtml(
    "## عنوان\n\n- مورد <b>اول</b>\n۱. گام\n\n| نام | مبلغ |\n| --- | --- |\n| علی | ۵۰۰ |",
  );
  // Headings shift one level down: the document title is the only <h1>.
  assert.match(body, /<h3[^>]*>عنوان<\/h3>/);
  assert.match(body, /&lt;b&gt;اول&lt;\/b&gt;/);
  assert.match(body, /<ol/);
  assert.match(body, /<table/);
  const document = documentHtml({
    title: "گزارش",
    body: "متن",
    date: new Date("2026-03-21T08:00:00Z"),
  });
  assert.match(document, /۱۴۰۵/);
  const overlay = overlayHtml([
    { width: 200, height: 20, text: "سارا <رضایی>", fontSize: 11, multiline: false },
    { width: 300, height: 80, text: "خط اول\nخط دوم", fontSize: 10, multiline: true },
  ]);
  assert.equal(overlay.pageWidth, 300);
  assert.equal(overlay.pageHeight, 80);
  assert.equal(overlay.html.match(/class="page"/g)?.length, 2);
  assert.match(overlay.html, /سارا &lt;رضایی&gt;/);
});

test("PdfRenderer reports missing, failing and invalid worker output as Persian errors", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-pdf-render-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const missing = new PdfRenderer(config(directory));
  assert.equal(missing.available, false);
  await assert.rejects(missing.render("<p>x</p>"), { status: 503 });
  const { url } = await worker(t);
  const renderer = new PdfRenderer(config(directory, url));
  const bytes = await renderer.render("<p>سلام</p>", { title: "آزمایش" });
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 2);
  const wrongToken = new PdfRenderer({ ...config(directory, url), workerToken: `${TOKEN}-other` });
  await assert.rejects(wrongToken.render("<p>x</p>"), (error: Error & { status?: number }) => {
    assert.equal(error.status, 502);
    assert.match(error.message, /ساخت PDF ناموفق بود/);
    return true;
  });
  const offline = new PdfRenderer(config(directory, "http://127.0.0.1:9"));
  await assert.rejects(offline.render("<p>x</p>"), { status: 503 });
});

test("Persian form values are drawn by the renderer and keep their field values", async () => {
  const sample = await createSamplePdf();
  let calls = 0;
  const filled = await fillPdf(
    sample,
    { participant_name: "سارا رضایی", guardian_name: "Ali Rezaei", permission_granted: true },
    {
      renderHtml: async (html) => {
        calls++;
        assert.match(html, /سارا رضایی/);
        assert.doesNotMatch(html, /Ali Rezaei/);
        return fakeRender(html);
      },
    },
  );
  assert.equal(calls, 1);
  const details = await inspectPdf(filled);
  const value = (name: string) => details.fields.find((field) => field.name === name)?.value;
  assert.equal(value("participant_name"), "سارا رضایی");
  assert.equal(value("guardian_name"), "Ali Rezaei");
  assert.equal(value("permission_granted"), "true");
  const doc = await PDFDocument.load(filled);
  const widget = doc.getForm().getTextField("participant_name").acroField.getWidgets()[0];
  const appearance = widget.getNormalAppearance();
  assert(appearance, "the Persian value has its own appearance stream");
  const stream = doc.context.lookup(appearance as PDFRef);
  assert(stream instanceof PDFRawStream);
  const rect = widget.getRectangle();
  assert.deepEqual(stream.dict.lookup(PDFName.of("BBox"), PDFArray).asRectangle(), {
    x: 0,
    y: 0,
    width: rect.width,
    height: rect.height,
  });
  const content = new TextDecoder().decode(decodePDFRawStream(stream).decode());
  // The widget frame is drawn first; the rendered value follows without an extra offset.
  assert.match(content, /\bRG\b/);
  assert.match(content, /Q\nq\n\/Fa0 Do\nQ\n$/);
  const resources = stream.dict.lookup(PDFName.of("Resources"), PDFDict);
  const xObjects = resources.lookup(PDFName.of("XObject"), PDFDict);
  const embedded = xObjects.lookup(PDFName.of("Fa0"));
  assert(embedded instanceof PDFRawStream);
  const bbox = embedded.dict.lookup(PDFName.of("BBox"), PDFArray).asRectangle();
  const matrix = embedded.dict.lookup(PDFName.of("Matrix"), PDFArray).asArray().map(String);
  // The rendered value sits at the top-left of its page; the matrix moves that box to the origin.
  assert.deepEqual(matrix, ["1", "0", "0", "1", "0", String(-bbox.y)]);
  assert.equal(bbox.x, 0);
  assert.equal(bbox.height, rect.height);
});

test("without a renderer Persian form values fail with a clear Persian error", async () => {
  const sample = await createSamplePdf();
  await assert.rejects(
    fillPdf(sample, { participant_name: "سارا" }),
    (error: unknown) =>
      error instanceof PdfError &&
      error.status === 422 &&
      /participant_name/.test(error.message) &&
      /سرویس ساخت PDF فارسی/.test(error.message),
  );
  await assert.rejects(
    fillPdf(sample, { participant_name: "سارا" }, { renderHtml: async () => new Uint8Array([1]) }),
    (error: unknown) => error instanceof PdfError && /پاسخ نداد|ناقص/.test(error.message),
  );
});

test("the server creates Persian PDFs, fills forms in Persian and seeds a Persian sample form", async (t) => {
  const { url, requests } = await worker(t);
  const directory = await mkdtemp(join(tmpdir(), "openmuse-pdf-api-"));
  const db = await createStore();
  t.after(async () => {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  });
  const { app } = await createApp(db, config(directory, url));
  const { token } = await (
    await app.request("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
  ).json();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const workspace: Workspace = await (await app.request("/api/workspace", { headers })).json();
  const sample = workspace.files[0];
  assert.equal(sample.mimeType, "application/pdf");
  assert(sample.fields?.some((field) => field.name === "participant_name"));
  assert(
    requests.some((request) => /رضایت‌نامه|فرم/.test(request.html)),
    "sample form was rendered in Persian",
  );

  const created = await app.request("/api/files/pdf", {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "برنامهٔ سفر", content: "## روز اول\n- بازدید از موزه" }),
  });
  assert.equal(created.status, 201);
  const file: Artifact = await created.json();
  assert.equal(file.mimeType, "application/pdf");
  assert.match(file.name, /برنامهٔ سفر\.pdf$/);
  const request = requests.at(-1);
  assert.equal(request?.title, "برنامهٔ سفر");
  assert.match(request?.html ?? "", /<h3[^>]*>روز اول<\/h3>/);
  const content = await app.request(`/api/files/${file.id}/content`, { headers });
  assert.equal(content.headers.get("content-type"), "application/pdf");

  const fill = await app.request(`/api/files/${sample.id}/fill`, {
    method: "POST",
    headers,
    body: JSON.stringify({ fields: { participant_name: "مریم احمدی" } }),
  });
  assert.equal(fill.status, 201);
  const output: Artifact = await fill.json();
  assert.equal(
    output.fields?.find((field) => field.name === "participant_name")?.value,
    "مریم احمدی",
  );
});

test("without a worker, Persian PDF creation is unavailable but English forms still work", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-pdf-none-"));
  const db = await createStore();
  t.after(async () => {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  });
  const { app } = await createApp(db, config(directory));
  const { token } = await (
    await app.request("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
  ).json();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const created = await app.request("/api/files/pdf", {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "گزارش", content: "متن" }),
  });
  assert.equal(created.status, 503);
  const workspace: Workspace = await (await app.request("/api/workspace", { headers })).json();
  const fill = await app.request(`/api/files/${workspace.files[0].id}/fill`, {
    method: "POST",
    headers,
    body: JSON.stringify({ fields: { participant_name: "Sample Student" } }),
  });
  assert.equal(fill.status, 201);
});
