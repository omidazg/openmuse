import { inflateRawSync } from "node:zlib";

/**
 * Text extraction for Word (.docx), Excel (.xlsx) and CSV documents without third-party
 * dependencies: a bounded ZIP reader plus small, tolerant OOXML parsers. The output is
 * plain text for the agent, so layout and formatting are intentionally dropped.
 */

export type DocumentKind = "pdf" | "docx" | "xlsx" | "csv";

export const DOCUMENT_TYPES: Record<
  DocumentKind,
  { mimeType: string; extension: string; label: string }
> = {
  pdf: { mimeType: "application/pdf", extension: "pdf", label: "PDF" },
  docx: {
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extension: "docx",
    label: "Word",
  },
  xlsx: {
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extension: "xlsx",
    label: "Excel",
  },
  csv: { mimeType: "text/csv", extension: "csv", label: "CSV" },
};

export class DocumentError extends Error {
  readonly status = 422;
  constructor(message: string) {
    super(message);
    this.name = "DocumentError";
  }
}

/** Largest extracted text kept for one document (characters). */
export const MAX_EXTRACTED_CHARS = 1_000_000;
const MAX_ENTRY_BYTES = 40 * 1024 * 1024;
const MAX_TOTAL_BYTES = 120 * 1024 * 1024;
const MAX_ENTRIES = 5000;

const hasPrefix = (bytes: Uint8Array, text: string) =>
  bytes.length >= text.length &&
  Buffer.from(bytes.subarray(0, text.length)).toString("latin1") === text;

/** Identify a supported document from its bytes, then its name or MIME type. */
export function detectDocumentKind(
  name: string,
  bytes: Uint8Array,
  mimeType = "",
): DocumentKind | undefined {
  if (Buffer.from(bytes.subarray(0, 1024)).indexOf("%PDF-") >= 0) return "pdf";
  const lower = name.toLowerCase();
  if (hasPrefix(bytes, "PK\u0003\u0004")) {
    let entries: string[];
    try {
      entries = readZip(bytes).names;
    } catch {
      return undefined;
    }
    if (entries.includes("word/document.xml")) return "docx";
    if (entries.includes("xl/workbook.xml")) return "xlsx";
    return undefined;
  }
  if (/\.(csv|tsv)$/.test(lower) || /^text\/(csv|tab-separated-values|plain)\b/.test(mimeType)) {
    // Binary files (NUL bytes) are never treated as CSV.
    return bytes.subarray(0, 8192).includes(0) ? undefined : "csv";
  }
  return undefined;
}

interface Zip {
  names: string[];
  read(name: string): Uint8Array | undefined;
}

/** Minimal ZIP reader (stored and deflate entries, no ZIP64 or encryption). */
export function readZip(input: Uint8Array): Zip {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new DocumentError("فایل فشرده خوانده نشد. سند ممکن است خراب باشد.");
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  if (count > MAX_ENTRIES || offset === 0xffffffff)
    throw new DocumentError("این سند خیلی بزرگ یا پیچیده است و خوانده نمی‌شود.");
  const entries = new Map<
    string,
    { method: number; compressed: number; size: number; local: number; flags: number }
  >();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw new DocumentError("ساختار سند خراب است.");
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const compressed = bytes.readUInt32LE(offset + 20);
    const size = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    const name = bytes.toString("utf8", offset + 46, offset + 46 + nameLength);
    entries.set(name, { method, compressed, size, local, flags });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  let total = 0;
  return {
    names: [...entries.keys()],
    read(name) {
      const entry = entries.get(name);
      if (!entry) return undefined;
      if (entry.flags & 1) throw new DocumentError("اسناد رمزگذاری‌شده پشتیبانی نمی‌شوند.");
      if (entry.size > MAX_ENTRY_BYTES || total + entry.size > MAX_TOTAL_BYTES)
        throw new DocumentError("محتوای این سند خیلی بزرگ است و خوانده نمی‌شود.");
      const at = entry.local;
      if (at + 30 > bytes.length || bytes.readUInt32LE(at) !== 0x04034b50)
        throw new DocumentError("ساختار سند خراب است.");
      const start = at + 30 + bytes.readUInt16LE(at + 26) + bytes.readUInt16LE(at + 28);
      const data = bytes.subarray(start, start + entry.compressed);
      let output: Uint8Array;
      if (entry.method === 0) output = data;
      else if (entry.method === 8) {
        try {
          output = inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
        } catch {
          throw new DocumentError("بخشی از سند باز نشد. سند ممکن است خراب باشد.");
        }
      } else throw new DocumentError("روش فشرده‌سازی این سند پشتیبانی نمی‌شود.");
      total += output.length;
      return output;
    },
  };
}

/** Persian-friendly normalization: Arabic Yeh/Kaf to Persian, keeping ZWNJ (U+200C). */
export function normalizePersianText(text: string): string {
  return (
    text
      .replace(/[يى]/g, "ی")
      .replace(/ك/g, "ک")
      .replace(/\r\n?/g, "\n")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: this strips stray control characters.
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
  );
}

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    const key = entity.toLowerCase();
    if (key === "amp") return "&";
    if (key === "lt") return "<";
    if (key === "gt") return ">";
    if (key === "quot") return '"';
    if (key === "apos") return "'";
    const code = key.startsWith("#x") ? Number.parseInt(key.slice(2), 16) : Number(key.slice(1));
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}

const utf8 = (bytes: Uint8Array | undefined) => (bytes ? Buffer.from(bytes).toString("utf8") : "");

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag);
  return match ? decodeXml(match[2] ?? match[3] ?? "") : undefined;
}

/** Paragraph text of a WordprocessingML part; table cells are tab-separated. */
function wordText(xml: string): string {
  const out: string[] = [];
  let inText = false;
  let cellDepth = 0;
  const token = /<(\/?)(w:t|w:p|w:tab|w:br|w:cr|w:tc|w:tr)\b([^>]*?)(\/?)>|<[^>]*>|([^<]+)/g;
  for (let match = token.exec(xml); match; match = token.exec(xml)) {
    const [, close, tag, , selfClose, text] = match;
    if (text !== undefined) {
      if (inText) out.push(decodeXml(text));
      continue;
    }
    if (!tag) continue;
    if (tag === "w:t") inText = !close && !selfClose;
    else if ((tag === "w:tab" || tag === "w:br" || tag === "w:cr") && !close)
      out.push(tag === "w:tab" ? "\t" : "\n");
    else if (tag === "w:p" && close) out.push(cellDepth ? " " : "\n");
    else if (tag === "w:tc") {
      if (close) {
        cellDepth = Math.max(0, cellDepth - 1);
        out.push("\uE000");
      } else if (!selfClose) cellDepth++;
    } else if (tag === "w:tr" && close) out.push("\uE001");
  }
  return out
    .join("")
    .replace(/ *\uE000(?=\uE001)/g, "")
    .replace(/ *\uE000/g, "\t")
    .replace(/\uE001/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractDocx(zip: Zip): { text: string; parts: number } {
  const body = zip.read("word/document.xml");
  if (!body) throw new DocumentError("متن اصلی سند Word پیدا نشد.");
  const sections = [wordText(utf8(body))];
  for (const name of zip.names.sort()) {
    if (/^word\/(footnotes|endnotes)\.xml$/.test(name)) {
      const text = wordText(utf8(zip.read(name)));
      if (text) sections.push(text);
    }
  }
  return { text: sections.join("\n\n"), parts: 1 };
}

function columnIndex(reference: string): number {
  let index = 0;
  for (const character of reference.replace(/\d+$/, "").toUpperCase())
    index = index * 26 + character.charCodeAt(0) - 64;
  return index - 1;
}

/** Style indexes whose number format is a date, from xl/styles.xml. */
function dateStyles(xml: string): Set<number> {
  const custom = new Map<number, string>();
  for (const match of xml.matchAll(/<numFmt\b[^>]*>/g)) {
    const id = Number(attribute(match[0], "numFmtId"));
    custom.set(id, attribute(match[0], "formatCode") ?? "");
  }
  const isDate = (id: number) => {
    if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47)) return true;
    const code = custom.get(id)?.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
    return !!code && /[dmyhs]/i.test(code) && !/^[#0.,%\s]+$/.test(code);
  };
  const result = new Set<number>();
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? "";
  let index = 0;
  for (const match of cellXfs.matchAll(/<xf\b[^>]*>/g)) {
    if (isDate(Number(attribute(match[0], "numFmtId") ?? 0))) result.add(index);
    index++;
  }
  return result;
}

function excelDate(serial: number): string {
  const time = Date.UTC(1899, 11, 30) + Math.round(serial * 86_400_000);
  const iso = new Date(time).toISOString();
  return serial % 1 === 0 ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function extractXlsx(zip: Zip): { text: string; parts: number } {
  const workbook = utf8(zip.read("xl/workbook.xml"));
  if (!workbook) throw new DocumentError("فهرست برگه‌های فایل Excel پیدا نشد.");
  const targets = new Map<string, string>();
  for (const match of utf8(zip.read("xl/_rels/workbook.xml.rels")).matchAll(
    /<Relationship\b[^>]*>/g,
  )) {
    const id = attribute(match[0], "Id");
    const target = attribute(match[0], "Target");
    if (id && target)
      targets.set(
        id,
        target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`,
      );
  }
  const shared: string[] = [];
  for (const match of utf8(zip.read("xl/sharedStrings.xml")).matchAll(
    /<si\b[^>]*>([\s\S]*?)<\/si>/g,
  )) {
    const withoutPhonetic = match[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
    shared.push(
      [...withoutPhonetic.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
        .map((t) => decodeXml(t[1]))
        .join(""),
    );
  }
  const dates = dateStyles(utf8(zip.read("xl/styles.xml")));
  const sections: string[] = [];
  let sheets = 0;
  for (const match of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attribute(match[0], "name") ?? `Sheet${sheets + 1}`;
    const relation = attribute(match[0], "r:id");
    const path = relation ? targets.get(relation) : undefined;
    const xml = path ? utf8(zip.read(path)) : "";
    sheets++;
    const rows: string[] = [];
    for (const row of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const cells: string[] = [];
      let next = 0;
      for (const cell of (row[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = `<c${cell[1]}>`;
        const reference = attribute(tag, "r");
        const index = reference ? columnIndex(reference) : next;
        const type = attribute(tag, "t");
        const style = Number(attribute(tag, "s") ?? -1);
        const inner = cell[2] ?? "";
        const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        let value = "";
        if (type === "s") value = shared[Number(raw)] ?? "";
        else if (type === "inlineStr")
          value = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
            .map((t) => decodeXml(t[1]))
            .join("");
        else if (type === "b") value = raw === "1" ? "TRUE" : raw === undefined ? "" : "FALSE";
        else if (raw !== undefined) {
          value = decodeXml(raw);
          const number = Number(value);
          if (type !== "str" && type !== "e" && dates.has(style) && Number.isFinite(number))
            value = excelDate(number);
        }
        if (index < 0 || index > 16_384) continue;
        while (cells.length < index) cells.push("");
        cells[index] = value.replace(/[\t\n\r]+/g, " ");
        next = index + 1;
      }
      while (cells.length && cells.at(-1) === "") cells.pop();
      if (cells.length) rows.push(cells.join("\t"));
    }
    sections.push(`## ${name}\n${rows.join("\n") || "(برگهٔ خالی)"}`);
  }
  return { text: sections.join("\n\n"), parts: Math.max(1, sheets) };
}

/** Decode CSV bytes: UTF-8 (with or without BOM), UTF-16 with BOM, else Windows-1256. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    // Persian CSV exported by older Excel versions uses the Arabic Windows code page.
    return new TextDecoder("windows-1256").decode(bytes);
  }
}

export interface ExtractedDocument {
  kind: DocumentKind;
  text: string;
  truncated: boolean;
  /** Worksheets for Excel, otherwise 1. */
  parts: number;
}

/** Extract plain text from a Word, Excel or CSV document. PDFs are not handled here. */
export function extractDocumentText(kind: DocumentKind, bytes: Uint8Array): ExtractedDocument {
  if (kind === "pdf") throw new DocumentError("استخراج متن PDF در این بخش پشتیبانی نمی‌شود.");
  let result: { text: string; parts: number };
  if (kind === "csv") result = { text: decodeText(bytes), parts: 1 };
  else {
    const zip = readZip(bytes);
    result = kind === "docx" ? extractDocx(zip) : extractXlsx(zip);
  }
  const text = normalizePersianText(result.text);
  return {
    kind,
    text: text.slice(0, MAX_EXTRACTED_CHARS),
    truncated: text.length > MAX_EXTRACTED_CHARS,
    parts: result.parts,
  };
}
