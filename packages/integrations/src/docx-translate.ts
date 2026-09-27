import { crc32, deflateRawSync } from "node:zlib";
import { DocumentError, readZip } from "./office.ts";

/**
 * Translate a Word document in place: paragraph text is sent to a translator and written back
 * into the same runs, so paragraph styles, run formatting (bold, italic, colour, size), tables,
 * images, headers and footers are preserved. When a paragraph mixes formats, the segments are
 * wrapped in <s1>…</s1> tags that the translator keeps; if the tags do not survive, the whole
 * translation goes into the first run. Paragraphs and runs get right-to-left (bidi) settings for
 * Persian/Arabic targets and lose them for left-to-right targets.
 */

export type LanguageCode = "fa" | "en" | "ar";

export const LANGUAGE_NAMES: Record<LanguageCode, { en: string; fa: string; rtl: boolean }> = {
  fa: { en: "Persian (Farsi)", fa: "فارسی", rtl: true },
  en: { en: "English", fa: "انگلیسی", rtl: false },
  ar: { en: "Arabic", fa: "عربی", rtl: true },
};

/** Supported translation directions. */
export const TRANSLATION_PAIRS: [LanguageCode, LanguageCode][] = [
  ["fa", "en"],
  ["en", "fa"],
  ["ar", "fa"],
  ["fa", "ar"],
  ["ar", "en"],
  ["en", "ar"],
];

/**
 * Translates a batch of segments. Must return the same number of strings in the same order.
 * Segments may contain <sN>…</sN> tags that must be kept around the corresponding words.
 */
export type Translator = (
  segments: string[],
  options: { from?: LanguageCode; to: LanguageCode },
) => Promise<string[]>;

/** Minimal ZIP writer (deflate) used to repackage OOXML documents. */
export function writeZip(entries: { name: string; data: Uint8Array }[]): Uint8Array {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const packed = deflateRawSync(data);
    const nameBytes = Buffer.from(name, "utf8");
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0x21, 12); // 1980-01-01 00:00
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt16LE(0x21, 14);
    header.writeUInt32LE(checksum, 16);
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
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const decodeXml = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    const key = entity.toLowerCase();
    const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (named[key]) return named[key];
    const value = key.startsWith("#x") ? Number.parseInt(key.slice(2), 16) : Number(key.slice(1));
    return Number.isFinite(value) && value > 0 && value <= 0x10ffff
      ? String.fromCodePoint(value)
      : "";
  });

/**
 * Insert `element` into a property container before the first child that must follow it in
 * the OOXML schema order, or at the end.
 */
function insertOrdered(inner: string, element: string, following: string[]): string {
  const pattern = new RegExp(`<w:(${following.join("|")})[\\s/>]`);
  const match = pattern.exec(inner);
  return match ? inner.slice(0, match.index) + element + inner.slice(match.index) : inner + element;
}

const P_AFTER_BIDI = [
  "adjustRightInd",
  "snapToGrid",
  "spacing",
  "ind",
  "contextualSpacing",
  "mirrorIndents",
  "suppressOverlap",
  "jc",
  "textDirection",
  "textAlignment",
  "textboxTightWrap",
  "outlineLvl",
  "divId",
  "cnfStyle",
  "rPr",
  "sectPr",
  "pPrChange",
];
const R_AFTER_RTL = ["cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath", "rPrChange"];

/** Set or clear <w:bidi/> in a paragraph's pPr. */
function setParagraphDirection(paragraphOpen: string, body: string, rtl: boolean): string {
  const pPr = /^(\s*)<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(body);
  const pPrEmpty = /^(\s*)<w:pPr\s*\/>/.exec(body);
  let inner = pPr ? pPr[2] : "";
  const rest = pPr ? body.slice(pPr[0].length) : pPrEmpty ? body.slice(pPrEmpty[0].length) : body;
  // Only the paragraph's own bidi, not one nested in the paragraph-mark rPr.
  inner = inner.replace(/<w:bidi(\s[^>]*)?\/>/g, "");
  if (rtl) inner = insertOrdered(inner, "<w:bidi/>", P_AFTER_BIDI);
  return `${paragraphOpen}${inner ? `<w:pPr>${inner}</w:pPr>` : ""}${rest}`;
}

/** Set or clear <w:rtl/> in a run's rPr. */
function setRunDirection(run: string, rtl: boolean): string {
  const match = /^<w:r(\s[^>]*)?>(\s*<w:rPr>([\s\S]*?)<\/w:rPr>|\s*<w:rPr\s*\/>)?/.exec(run);
  if (!match) return run;
  let inner = (match[3] ?? "").replace(/<w:rtl(\s[^>]*)?\/>/g, "");
  if (rtl) {
    // Word formats right-to-left text with the complex-script variants of bold, italic and
    // size; mirror the Latin settings so formatting survives translation.
    for (const [latin, complex] of [
      ["b", "bCs"],
      ["i", "iCs"],
      ["sz", "szCs"],
    ]) {
      const element = new RegExp(`<w:${latin}(\\s[^>]*)?\\/>`).exec(inner);
      if (element && !new RegExp(`<w:${complex}[\\s/>]`).test(inner)) {
        const at = element.index + element[0].length;
        inner = `${inner.slice(0, at)}<w:${complex}${element[1] ?? ""}/>${inner.slice(at)}`;
      }
    }
    inner = insertOrdered(inner, "<w:rtl/>", R_AFTER_RTL);
  }
  const open = `<w:r${match[1] ?? ""}>`;
  return `${open}${inner ? `<w:rPr>${inner}</w:rPr>` : ""}${run.slice(match[0].length)}`;
}

const RUN = /<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g;
const TEXT = /<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:t(\s[^>]*)?\/>/g;
const PARAGRAPH = /(<w:p(?:\s[^>]*)?>)((?:(?!<w:p[\s>])[\s\S])*?)<\/w:p>/g;

const runText = (run: string) =>
  [...run.matchAll(TEXT)].map((match) => decodeXml(match[2] ?? "")).join("");

const runFormat = (run: string) =>
  (/<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(run)?.[1] ?? "")
    .replace(/<w:(lang|rtl|noProof)(\s[^>]*)?\/>/g, "")
    .replace(/\s+/g, "");

/** Put `text` into the first <w:t> of a run and empty the others. */
function writeRunText(run: string, text: string): string {
  let first = true;
  return run.replace(TEXT, () => {
    if (!first) return "";
    first = false;
    return `<w:t xml:space="preserve">${escapeXml(text)}</w:t>`;
  });
}

interface ParagraphPlan {
  /** Groups of consecutive runs (by index) with the same formatting and some text. */
  groups: number[][];
  source: string;
}

function planParagraph(runs: string[]): ParagraphPlan | undefined {
  const groups: number[][] = [];
  let lastFormat: string | undefined;
  runs.forEach((run, index) => {
    if (!runText(run)) return;
    const format = runFormat(run);
    if (groups.length && format === lastFormat) groups[groups.length - 1].push(index);
    else groups.push([index]);
    lastFormat = format;
  });
  if (!groups.length) return undefined;
  const texts = groups.map((group) => group.map((index) => runText(runs[index])).join(""));
  const joined = texts.join("");
  // Nothing to translate: numbers, punctuation or whitespace only.
  if (!/\p{L}/u.test(joined)) return undefined;
  const source =
    groups.length === 1
      ? joined
      : texts.map((text, i) => `<s${i + 1}>${text}</s${i + 1}>`).join("");
  return { groups, source };
}

/** Split a tagged translation back into its segments; undefined when tags were lost. */
export function splitTagged(translation: string, count: number): string[] | undefined {
  const strip = (text: string) => text.replace(/<\/?s\d+>/g, "");
  if (count === 1) return [strip(translation)];
  const parts: string[] = [];
  let cursor = 0;
  for (let i = 1; i <= count; i++) {
    const tag = new RegExp(`<s${i}>(.*?)</s${i}>`, "gs");
    tag.lastIndex = cursor;
    const match = tag.exec(translation);
    if (!match) return undefined;
    // Words the translator left between tags stay with the preceding segment.
    const between = strip(translation.slice(cursor, match.index));
    if (parts.length) parts[parts.length - 1] += between;
    parts.push((parts.length ? "" : between) + match[1]);
    cursor = match.index + match[0].length;
  }
  parts[parts.length - 1] += strip(translation.slice(cursor));
  return parts;
}

/** Word parts with document text: body, headers, footers, footnotes, endnotes. */
const TEXT_PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;

export interface DocxTranslation {
  bytes: Uint8Array;
  paragraphs: number;
}

/** Translate a .docx and return the new document bytes. */
export async function translateDocx(
  input: Uint8Array,
  translate: Translator,
  options: { from?: LanguageCode; to: LanguageCode; batchChars?: number },
): Promise<DocxTranslation> {
  const zip = readZip(input);
  if (!zip.names.includes("word/document.xml"))
    throw new DocumentError("متن اصلی سند Word پیدا نشد.");
  const rtl = LANGUAGE_NAMES[options.to].rtl;
  const parts = new Map<string, string>();
  const jobs: { part: string; paragraph: number; runs: string[]; plan: ParagraphPlan }[] = [];
  const paragraphs = new Map<string, { open: string; body: string; runs: string[] }[]>();
  for (const name of zip.names) {
    if (!TEXT_PARTS.test(name)) continue;
    const xml = Buffer.from(zip.read(name) ?? new Uint8Array()).toString("utf8");
    parts.set(name, xml);
    const list: { open: string; body: string; runs: string[] }[] = [];
    for (const match of xml.matchAll(PARAGRAPH)) {
      const runs = [...match[2].matchAll(RUN)].map((run) => run[0]);
      const plan = planParagraph(runs);
      if (plan) jobs.push({ part: name, paragraph: list.length, runs, plan });
      list.push({ open: match[1], body: match[2], runs });
    }
    paragraphs.set(name, list);
  }
  // Translate in batches bounded by characters so each request stays small.
  const limit = options.batchChars ?? 6000;
  const translations: string[] = [];
  for (let start = 0; start < jobs.length; ) {
    let end = start;
    let size = 0;
    while (end < jobs.length && (end === start || size + jobs[end].plan.source.length <= limit)) {
      size += jobs[end].plan.source.length;
      end++;
    }
    const batch = jobs.slice(start, end).map((job) => job.plan.source);
    const result = await translate(batch, { from: options.from, to: options.to });
    if (result.length !== batch.length)
      throw new DocumentError("ترجمهٔ بخشی از سند ناقص برگشت. دوباره تلاش کنید.");
    translations.push(...result);
    start = end;
  }
  const replaced = new Map<string, Map<number, string[]>>();
  jobs.forEach((job, i) => {
    const runs = [...job.runs];
    const segments = splitTagged(translations[i] ?? "", job.plan.groups.length);
    job.plan.groups.forEach((group, g) => {
      const text = segments
        ? segments[g]
        : g === 0
          ? (translations[i] ?? "").replace(/<\/?s\d+>/g, "")
          : "";
      group.forEach((index, position) => {
        runs[index] = writeRunText(runs[index], position === 0 ? text : "");
      });
    });
    const byPart = replaced.get(job.part) ?? new Map<number, string[]>();
    byPart.set(job.paragraph, runs);
    replaced.set(job.part, byPart);
  });
  const output = new Map<string, Uint8Array>();
  for (const [name, xml] of parts) {
    let index = 0;
    const byPart = replaced.get(name);
    let updated = xml.replace(PARAGRAPH, (_, open: string, body: string) => {
      const current = index++;
      const runs = byPart?.get(current);
      let next = body;
      if (runs) {
        let r = 0;
        next = body.replace(RUN, () => runs[r++] ?? "");
      }
      // Direction follows the target language for every paragraph and run in the part.
      next = next.replace(RUN, (run) => setRunDirection(run, rtl));
      return `${setParagraphDirection(open, next, rtl)}</w:p>`;
    });
    // Tables read right to left in Persian/Arabic output.
    updated = updated.replace(/<w:tblPr>([\s\S]*?)<\/w:tblPr>/g, (_, inner: string) => {
      const cleaned = inner.replace(/<w:bidiVisual(\s[^>]*)?\/>/g, "");
      return `<w:tblPr>${rtl ? insertOrdered(cleaned, "<w:bidiVisual/>", ["tblW", "jc", "tblCellSpacing", "tblInd", "tblBorders", "shd", "tblLayout", "tblCellMar", "tblLook", "tblCaption", "tblDescription"]) : cleaned}</w:tblPr>`;
    });
    output.set(name, Buffer.from(updated, "utf8"));
  }
  const entries = zip.names.map((name) => ({
    name,
    data: output.get(name) ?? zip.read(name) ?? new Uint8Array(),
  }));
  return { bytes: writeZip(entries), paragraphs: jobs.length };
}
