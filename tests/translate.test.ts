import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { Auth } from "../apps/server/src/auth.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";
import { Files } from "../apps/server/src/files.ts";
import type { PdfRenderer } from "../apps/server/src/pdf-render.ts";
import { llmTranslator, translateFile } from "../apps/server/src/translate.ts";
import {
  splitTagged,
  type Translator,
  translateDocx,
  writeZip,
} from "../packages/integrations/src/docx-translate.ts";
import { extractDocumentText, readZip } from "../packages/integrations/src/office.ts";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function docx(body: string, extra: Record<string, string> = {}): Uint8Array {
  const entries = {
    "[Content_Types].xml": "<Types/>",
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
    "word/styles.xml": "<w:styles/>",
    ...extra,
  };
  return writeZip(
    Object.entries(entries).map(([name, text]) => ({
      name,
      data: new Uint8Array(Buffer.from(text, "utf8")),
    })),
  );
}

/** Fake translator: a small dictionary, keeping <sN> tags in place. */
const dictionary: Record<string, string> = {
  "Monthly report": "گزارش ماهانه",
  "The project is ": "پروژه ",
  "on schedule": "طبق برنامه",
  " and within budget.": " و در حد بودجه است.",
  Name: "نام",
  Amount: "مبلغ",
  "Page footer": "پانویس صفحه",
};
function fakeTranslator(log: string[][] = []): Translator {
  return async (segments, { to }) => {
    log.push(segments);
    assert.equal(to, "fa");
    return segments.map((segment) =>
      segment.replace(/(<s\d+>)?([^<]*)(<\/s\d+>)?/g, (_, open = "", text: string, close = "") =>
        text ? `${open}${dictionary[text] ?? `[${text}]`}${close}` : `${open}${close}`,
      ),
    );
  };
}

const read = (bytes: Uint8Array, name: string) =>
  Buffer.from(readZip(bytes).read(name) ?? new Uint8Array()).toString("utf8");

test("docx translation keeps run formatting, styles and tables and sets RTL for Persian", async () => {
  const input = docx(
    `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>Monthly report</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">The project is </w:t></w:r><w:r><w:rPr><w:i/><w:color w:val="FF0000"/></w:rPr><w:t>on schedule</w:t></w:r><w:r><w:t xml:space="preserve"> and within budget.</w:t></w:r></w:p>
<w:p><w:r><w:t>2025</w:t></w:r></w:p>
<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tr><w:tc><w:p><w:r><w:t>Name</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Amount</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:drawing><wp:inline/></w:drawing></w:r></w:p>`,
    {
      "word/footer1.xml": `<w:ftr ${W}><w:p><w:r><w:t>Page footer</w:t></w:r></w:p></w:ftr>`,
      "word/media/image1.png": "PNG-BYTES",
    },
  );
  const log: string[][] = [];
  const { bytes, paragraphs } = await translateDocx(input, fakeTranslator(log), {
    from: "en",
    to: "fa",
  });
  assert.equal(paragraphs, 5, "numbers-only and image-only paragraphs are not sent");
  assert(
    log.flat().includes("<s1>The project is </s1><s2>on schedule</s2><s3> and within budget.</s3>"),
  );
  const xml = read(bytes, "word/document.xml");
  // Heading keeps its style and bold/size, gains bidi in schema order and complex-script bold.
  assert.match(
    xml,
    /<w:pPr><w:pStyle w:val="Heading1"\/><w:bidi\/><w:jc w:val="left"\/><\/w:pPr><w:r><w:rPr><w:b\/><w:bCs\/><w:sz w:val="32"\/><w:szCs w:val="32"\/><w:rtl\/><\/w:rPr><w:t xml:space="preserve">گزارش ماهانه<\/w:t>/,
  );
  // Italic red run keeps its formatting and gets its own translated words.
  assert.match(
    xml,
    /<w:rPr><w:i\/><w:iCs\/><w:color w:val="FF0000"\/><w:rtl\/><\/w:rPr><w:t xml:space="preserve">طبق برنامه<\/w:t>/,
  );
  assert.match(xml, /<w:t xml:space="preserve">پروژه <\/w:t>/);
  assert.match(xml, /<w:t>2025<\/w:t>/, "untranslated runs keep their text");
  assert.match(xml, /<w:tblPr><w:bidiVisual\/><w:tblW w:w="0" w:type="auto"\/><\/w:tblPr>/);
  assert.match(xml, /<w:drawing><wp:inline\/><\/w:drawing>/);
  assert.match(read(bytes, "word/footer1.xml"), /پانویس صفحه/);
  assert.equal(read(bytes, "word/media/image1.png"), "PNG-BYTES");
  assert.equal(read(bytes, "word/styles.xml"), "<w:styles/>");
  // The output is a valid document for the existing reader.
  const text = extractDocumentText("docx", bytes).text;
  assert.match(text, /^گزارش ماهانه\nپروژه طبق برنامه و در حد بودجه است\.\n2025\nنام\tمبلغ/);
});

test("translating to English removes RTL markers", async () => {
  const input = docx(
    `<w:p><w:pPr><w:bidi/><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rtl/></w:rPr><w:t>سلام دنیا</w:t></w:r></w:p>`,
  );
  const { bytes } = await translateDocx(
    input,
    async (segments) => segments.map(() => "Hello world"),
    {
      to: "en",
    },
  );
  const xml = read(bytes, "word/document.xml");
  assert(!xml.includes("<w:bidi/>") && !xml.includes("<w:rtl/>"));
  assert.match(
    xml,
    /<w:pPr><w:jc w:val="right"\/><\/w:pPr><w:r><w:t xml:space="preserve">Hello world<\/w:t>/,
  );
});

test("lost segment tags fall back to the first run instead of losing text", () => {
  assert.deepEqual(splitTagged("<s1>الف</s1> و <s2>ب</s2>", 2), ["الف و ", "ب"]);
  assert.deepEqual(splitTagged("<s2>ب</s2><s1>الف</s1>", 2), undefined);
  assert.equal(splitTagged("متن بدون برچسب", 2), undefined);
  assert.deepEqual(splitTagged("<s1>x</s1>", 1), ["x"]);
});

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-translate-"));
  const db = await createStore();
  const config: Config = {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "sample",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: [],
  };
  const rendered: string[] = [];
  const placeholder = await PDFDocument.create();
  placeholder.addPage();
  const pdfBytes = await placeholder.save();
  const renderer = {
    available: true,
    render: async (html: string) => {
      rendered.push(html);
      return pdfBytes;
    },
  } as unknown as PdfRenderer;
  const files = new Files(db, config, new Auth(db, config, "test-signing-key"), renderer);
  files.index.embedder = undefined;
  t.after(async () => {
    await files.index.idle();
    await db.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { files, rendered };
}

test("translate_file saves a translated Word file for the owner only", async (t) => {
  const { files } = await fixture(t);
  const source = await files.import(
    "owner-a",
    "report.docx",
    docx(`<w:p><w:r><w:t>Monthly report</w:t></w:r></w:p>`),
    "test",
  );
  const translated = await translateFile(
    files,
    "owner-a",
    source.id,
    { to: "fa" },
    fakeTranslator(),
  );
  assert.equal(translated.name, "report (ترجمهٔ فارسی).docx");
  assert.equal(translated.parentId, source.id);
  assert.equal((await files.text("owner-a", translated.id)).text, "گزارش ماهانه");
  await assert.rejects(
    translateFile(files, "owner-b", source.id, { to: "fa" }, fakeTranslator()),
    /پیدا نشد/,
  );
  await assert.rejects(
    translateFile(files, "owner-a", source.id, { to: "fa" }, undefined),
    /مدل زبانی/,
  );
});

test("PDF input is translated as text and rendered as a new Persian PDF", async (t) => {
  const { files, rendered } = await fixture(t);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([400, 300]).drawText("Monthly report", { x: 30, y: 250, size: 14, font });
  const source = await files.import("owner-a", "report.pdf", await doc.save(), "test");
  const translated = await translateFile(
    files,
    "owner-a",
    source.id,
    { to: "fa" },
    fakeTranslator(),
  );
  assert.equal(translated.name, "report (ترجمهٔ فارسی).pdf");
  assert.match(rendered[0], /گزارش ماهانه/);
});

test("the LLM translator is disabled without a key", () => {
  assert.equal(llmTranslator({}), undefined);
});
