import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { crc32, deflateRawSync } from "node:zlib";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";
import type { Artifact } from "../packages/domain/src/index.ts";
import {
  DocumentError,
  detectDocumentKind,
  extractDocumentText,
  normalizePersianText,
} from "../packages/integrations/src/office.ts";

const ZWNJ = "‌";

/** Minimal ZIP writer (deflate, or stored when `store` is set) for OOXML fixtures. */
function zip(files: Record<string, string>, store = false): Uint8Array {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, "utf8");
    const packed = store ? data : deflateRawSync(data);
    const nameBytes = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(store ? 0 : 8, 10);
    header.writeUInt32LE(crc32(data), 16);
    header.writeUInt32LE(packed.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed);
    central.push(header, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
function docx(): Uint8Array {
  return zip({
    "[Content_Types].xml": "<Types/>",
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>
<w:p><w:r><w:t>گزارش ماهانهٔ پروژه</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">این سند </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>می${ZWNJ}شود</w:t></w:r><w:r><w:t xml:space="preserve"> با يك متن &amp; نشانه.</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>نام</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>مبلغ</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>علی</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>۱۲٬۰۰۰ تومان</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:t>خط اول</w:t></w:r><w:r><w:br/><w:t>خط دوم</w:t></w:r></w:p>
</w:body></w:document>`,
  });
}

function xlsx(): Uint8Array {
  return zip({
    "[Content_Types].xml": "<Types/>",
    "xl/workbook.xml": `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="فروش" sheetId="1" r:id="rId1"/><sheet name="خالی" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<sst><si><t>محصول</t></si><si><t>تعداد</t></si><si><r><t>کتاب </t></r><r><t>فارسي</t></r></si></sst>`,
    "xl/styles.xml": `<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>تاریخ</t></is></c></row>
<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>42</v></c><c r="C2" t="b"><v>1</v></c><c r="D2" s="1"><v>45737</v></c></row>
</sheetData></worksheet>`,
    "xl/worksheets/sheet2.xml": "<worksheet><sheetData/></worksheet>",
  });
}

test("Word text keeps Persian letters, ZWNJ, table cells and line breaks", () => {
  const bytes = docx();
  assert.equal(detectDocumentKind("report.docx", bytes), "docx");
  // Detection trusts the content, not the extension.
  assert.equal(detectDocumentKind("report.pdf", bytes), "docx");
  const result = extractDocumentText("docx", bytes);
  assert.equal(result.kind, "docx");
  assert.equal(result.truncated, false);
  assert.match(result.text, /^گزارش ماهانهٔ پروژه\n/);
  assert(result.text.includes(`این سند می${ZWNJ}شود با یک متن & نشانه.`));
  assert(result.text.includes("نام\tمبلغ\nعلی\t۱۲٬۰۰۰ تومان"));
  assert(result.text.includes("خط اول\nخط دوم"));
  assert(!/[يك]/.test(result.text), "Arabic Yeh/Kaf are normalized to Persian");
});

test("Excel text lists sheets with tab-separated cells, dates and shared strings", () => {
  const bytes = xlsx();
  assert.equal(detectDocumentKind("sales.xlsx", bytes), "xlsx");
  const result = extractDocumentText("xlsx", bytes);
  assert.equal(result.parts, 2);
  assert.equal(
    result.text,
    "## فروش\nمحصول\tتعداد\t\tتاریخ\nکتاب فارسی\t42\tTRUE\t2025-03-21\n\n## خالی\n(برگهٔ خالی)",
  );
  // Stored (uncompressed) entries are read too.
  const stored = zip(
    { "word/document.xml": `<w:document ${W}><w:p><w:t>سلام</w:t></w:p></w:document>` },
    true,
  );
  assert.equal(extractDocumentText("docx", stored).text.trim(), "سلام");
});

test("CSV decodes UTF-8 with BOM and legacy Windows-1256 Persian", () => {
  const utf8 = new Uint8Array(Buffer.from(`﻿نام,شهر\nمريم,تهران\n`, "utf8"));
  assert.equal(detectDocumentKind("people.csv", utf8), "csv");
  assert.equal(detectDocumentKind("people.bin", utf8, "text/csv"), "csv");
  assert.equal(extractDocumentText("csv", utf8).text, "نام,شهر\nمریم,تهران\n");
  // "سلام,علي" in Windows-1256; the Arabic Yeh (0xED) becomes Persian ی.
  const legacy = new Uint8Array([0xd3, 0xe1, 0xc7, 0xe3, 0x2c, 0xda, 0xe1, 0xed, 0x0d, 0x0a]);
  assert.equal(extractDocumentText("csv", legacy).text, "سلام,علی\n");
  assert.equal(normalizePersianText(`ك${ZWNJ}ي`), `ک${ZWNJ}ی`);
});

test("unsupported or broken documents are rejected clearly", () => {
  assert.equal(
    detectDocumentKind("image.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
    undefined,
  );
  assert.equal(detectDocumentKind("data.csv", new Uint8Array([0x61, 0, 0x62])), undefined);
  assert.equal(detectDocumentKind("other.zip", zip({ "readme.txt": "hi" })), undefined);
  assert.throws(
    () => extractDocumentText("docx", new Uint8Array(Buffer.from("PK\u0003\u0004broken"))),
    (error: unknown) => error instanceof DocumentError && error.status === 422,
  );
  assert.throws(
    () => extractDocumentText("docx", zip({ "word/other.xml": "<x/>" })),
    /متن اصلی سند Word/,
  );
});

test("uploaded Word, Excel and CSV files are stored with their text", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-office-"));
  const db = await createStore();
  t.after(async () => {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  });
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
  const { app } = await createApp(db, config);
  const session = await app.request("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const { token } = await session.json();
  const auth = { Authorization: `Bearer ${token}` };
  const upload = async (name: string, bytes: Uint8Array, type: string) => {
    const form = new FormData();
    form.set("file", new File([Buffer.from(bytes)], name, { type }));
    return app.request("/api/files", { method: "POST", headers: auth, body: form });
  };

  const word = await upload(
    "گزارش.docx",
    docx(),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  assert.equal(word.status, 201);
  const wordFile: Artifact = await word.json();
  assert.equal(
    wordFile.mimeType,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  assert(wordFile.textLength && wordFile.textLength > 50);
  const text = await (
    await app.request(`/api/files/${wordFile.id}/text`, { headers: auth })
  ).json();
  assert.equal(text.kind, "docx");
  assert.equal(text.more, false);
  assert.match(text.text, /گزارش ماهانهٔ پروژه/);
  const content = await app.request(`/api/files/${wordFile.id}/content`, { headers: auth });
  assert.equal(content.headers.get("content-type"), wordFile.mimeType);
  assert.match(content.headers.get("content-disposition") ?? "", /^attachment/);
  assert.deepEqual(new Uint8Array(await content.arrayBuffer()), docx());

  const sheet: Artifact = await (
    await upload("فروش.xlsx", xlsx(), "application/octet-stream")
  ).json();
  assert.equal(sheet.pageCount, 2);
  const paged = await (
    await app.request(`/api/files/${sheet.id}/text?offset=3`, { headers: auth })
  ).json();
  assert.equal(paged.offset, 3);
  assert.match(paged.text, /^فروش\n/);

  const csv: Artifact = await (
    await upload("list.csv", new Uint8Array(Buffer.from("نام,مبلغ\nسارا,۵۰۰\n")), "text/csv")
  ).json();
  assert.equal(csv.mimeType, "text/csv");
  const fill = await app.request(`/api/files/${csv.id}/fill`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: {} }),
  });
  assert.equal(fill.status, 422);

  const rejected = await upload("image.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "image/png");
  assert.equal(rejected.status, 422);
  assert.match((await rejected.json()).error, /پشتیبانی نمی‌شود/);
});
