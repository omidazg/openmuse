import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { Auth } from "../apps/server/src/auth.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";
import { type Embedder, openAiEmbedder } from "../apps/server/src/file-search.ts";
import { fileTools } from "../apps/server/src/file-tools.ts";
import { Files } from "../apps/server/src/files.ts";
import { extractPdfText, parseToUnicode } from "../packages/integrations/src/pdf-text.ts";
import {
  chunkText,
  estimateTokens,
  normalizeSearchText,
  rankBm25,
  searchTokens,
} from "../packages/integrations/src/text-search.ts";

const ZWNJ = String.fromCharCode(0x200c);

async function filesFixture(t: TestContext, embedder?: Embedder) {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-file-search-"));
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
  const files = new Files(db, config, new Auth(db, config, "test-signing-key"));
  // Never reach a real gateway from tests.
  files.index.embedder = embedder;
  t.after(async () => {
    await files.index.idle();
    await db.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { db, files };
}

const csv = (text: string) => new Uint8Array(Buffer.from(text, "utf8"));

test("chunks follow Persian sentence boundaries, stay near the target size and overlap", () => {
  const sentence = (i: number) =>
    `جملهٔ شمارهٔ ${i} دربارهٔ قرارداد اجاره و شرایط پرداخت ماهانه است؛ جزئیات بیشتر در بند بعدی آمده است.`;
  const text = Array.from({ length: 120 }, (_, i) => sentence(i + 1)).join(" ");
  const chunks = chunkText(text, { targetTokens: 200, overlapTokens: 40 });
  assert(chunks.length > 5);
  for (const [i, chunk] of chunks.entries()) {
    assert.equal(chunk.index, i);
    assert.equal(text.slice(chunk.start, chunk.end).trim(), chunk.text);
    assert.match(chunk.text, /است\.$/, "chunks end at a sentence boundary");
    assert(estimateTokens(chunk.text) <= 200 + 60, "chunks stay close to the target");
  }
  // Neighbouring chunks overlap by at least one sentence.
  for (let i = 1; i < chunks.length; i++) assert(chunks[i].start < chunks[i - 1].end);
  // Paragraph breaks are boundaries too, and a single long run is split on spaces.
  const long = "واژه ".repeat(3000);
  const pieces = chunkText(long, { targetTokens: 300 });
  assert(pieces.length > 3);
  assert(pieces.every((piece) => estimateTokens(piece.text) <= 320));
  assert.deepEqual(chunkText("   "), []);
});

test("Persian normalization matches Arabic letters, digits, diacritics and ZWNJ spellings", () => {
  assert.equal(normalizeSearchText("كتاب‌هاي"), normalizeSearchText(`کتاب${ZWNJ}های`));
  assert.equal(normalizeSearchText("۱۴۰۳ و ١٤٠٣"), "1403 و 1403");
  assert.equal(normalizeSearchText("مُحَمَّد"), "محمد");
  assert.deepEqual(searchTokens(`می${ZWNJ}شود کتاب‌ها`), searchTokens("میشود كتابها"));
  assert.deepEqual(searchTokens("قرارداد‌ها و خانه‌های ما"), ["قرارداد", "خانه"]);
});

test("keyword fallback ranks the passage with the query terms first", () => {
  const documents = [
    { id: "menu", text: "فهرست غذای رستوران: کباب، جوجه و سالاد." },
    {
      id: "lease",
      text: `مبلغ اجارهٔ ماهانه ۱۲٬۰۰۰٬۰۰۰ تومان است و ودیعه در سال ۱۴۰۳ پرداخت می${ZWNJ}شود.`,
    },
    { id: "other", text: "اجاره خودرو برای سفر." },
  ];
  const ranked = rankBm25("اجاره ماهانه چقدر است؟ ودیعه 1403", documents, (d) => d.text);
  assert.equal(ranked[0].item.id, "lease");
  assert(
    ranked.every((r) => r.item.id !== "menu"),
    "documents without query terms are dropped",
  );
  assert.deepEqual(
    rankBm25("و از به", documents, (d) => d.text),
    [],
    "stopwords alone match nothing",
  );
});

test("search_files finds passages across uploaded files with keyword search when embeddings are off", async (t) => {
  const { files } = await filesFixture(t);
  const lease = await files.import(
    "owner-a",
    "قرارداد.csv",
    csv("بند,متن\n۱,مبلغ اجاره ماهانه ۱۲ میلیون تومان است.\n۲,ودیعه ۲۰۰ میلیون تومان است.\n"),
    "test",
  );
  await files.import("owner-a", "خرید.csv", csv("کالا,قیمت\nنان,۵۰ هزار تومان\n"), "test");
  await files.index.idle();
  const search = fileTools(files, "owner-a").find(
    (tool) => tool.name === "search_files",
  ) as unknown as {
    execute: (args: { query: string }) => Promise<unknown>;
  };
  const result = (await search.execute({ query: "اجارهٔ ماهانه چقدر است" })) as {
    method: string;
    passages: { fileId: string; fileName: string; part: number; parts: number; text: string }[];
  };
  assert.equal(result.method, "keyword");
  assert.equal(result.passages[0].fileId, lease.id);
  assert.equal(result.passages[0].fileName, "قرارداد.csv");
  assert.equal(result.passages[0].part, 1);
  assert.match(result.passages[0].text, /اجاره/);
});

test("file indexes are isolated per owner and use embeddings when available", async (t) => {
  // Deterministic fake embedder: bag of normalized tokens hashed into 64 dimensions.
  const calls: string[][] = [];
  const embedder = Object.assign(
    async (texts: string[]) => {
      calls.push(texts);
      return texts.map((text) => {
        const vector = new Array(64).fill(0);
        for (const token of searchTokens(text))
          vector[[...token].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 64] += 1;
        return vector;
      });
    },
    { model: "fake/embedding" },
  );
  const { db, files } = await filesFixture(t, embedder);
  await files.import("owner-a", "a.csv", csv("موضوع\nبیمهٔ تکمیلی دندان‌پزشکی\n"), "test");
  await files.import("owner-b", "b.csv", csv("موضوع\nبیمهٔ تکمیلی دندان‌پزشکی سارا\n"), "test");
  await files.index.idle();
  assert(calls.length >= 2, "chunks were embedded on upload");
  const a = await files.index.search("owner-a", await files.list("owner-a"), "بیمه دندان");
  assert.equal(a.method, "semantic");
  assert.deepEqual(new Set(a.hits.map((hit) => hit.fileName)), new Set(["a.csv"]));
  const b = await files.index.search("owner-b", await files.list("owner-b"), "بیمه دندان");
  assert.deepEqual(new Set(b.hits.map((hit) => hit.fileName)), new Set(["b.csv"]));
  // Another owner cannot scope a search to someone else's file ID.
  const foreign = (await db.list<{ fileId: string }>("owner-b", "file-index"))[0].fileId;
  const leaked = await files.index.search("owner-a", await files.list("owner-a"), "بیمه", {
    fileIds: [foreign],
  });
  assert.deepEqual(leaked.hits, []);
});

test("files uploaded before indexing existed are backfilled lazily on search", async (t) => {
  const { db, files } = await filesFixture(t);
  await files.import(
    "owner-a",
    "old.csv",
    csv("یادداشت\nرمز وای‌فای مهمانان در کشوی میز است\n"),
    "test",
  );
  await files.index.idle();
  for (const record of await db.list<{ id: string }>("owner-a", "file-index"))
    await db.remove("owner-a", "file-index", record.id);
  const result = await files.index.search("owner-a", await files.list("owner-a"), "رمز وای‌فای");
  assert.equal(result.hits[0]?.fileName, "old.csv");
  assert.equal((await db.list("owner-a", "file-index")).length, 1);
});

test("embeddings stay off without a key or when EMBEDDING_MODEL=off", () => {
  assert.equal(openAiEmbedder({}), undefined);
  assert.equal(openAiEmbedder({ OPENAI_API_KEY: "k", EMBEDDING_MODEL: "off" }), undefined);
  assert.equal(openAiEmbedder({ OPENAI_API_KEY: "k" })?.model, "openai/text-embedding-3-small");
});

test("PDF text layers are extracted and ToUnicode maps are decoded", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 300]);
  page.drawText("Monthly rent is 12 million.", { x: 30, y: 250, size: 14, font });
  page.drawText("Deposit is paid in March.", { x: 30, y: 232, size: 14, font });
  const { text, pages } = await extractPdfText(await doc.save());
  assert.equal(pages, 1);
  assert.equal(text, "Monthly rent is 12 million.\nDeposit is paid in March.");
  const cmap = parseToUnicode(
    "begincodespacerange <0000> <FFFF> endcodespacerange\n2 beginbfchar <0003> <0633> <0004> <0644> endbfchar\n1 beginbfrange <0010> <0012> <0627> endbfrange",
  );
  assert.equal(cmap.twoByte, true);
  assert.equal(cmap.map.get(3), "س");
  assert.equal(cmap.map.get(0x11), "ب");
});
