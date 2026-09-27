import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  type PDFObject,
  PDFRawStream,
  PDFRef,
} from "pdf-lib";
import { normalizePersianText } from "./office.ts";

/**
 * Best-effort plain-text extraction from PDFs with text layers, built on pdf-lib's object
 * model (no extra dependency). Supports simple fonts, Type0/CID fonts with ToUnicode maps,
 * TJ spacing, form XObjects and Persian/Arabic lines stored in visual order (the order
 * Chromium and many other generators write glyphs). Scanned PDFs have no text layer and
 * return an empty string. Layout is approximated: lines sorted top to bottom, blank lines
 * between larger vertical gaps.
 */

export class PdfTextError extends Error {
  readonly status = 422;
}

const MAX_OPERATIONS = 2_000_000;
const MAX_TEXT = 1_000_000;

interface FontInfo {
  twoByte: boolean;
  map?: Map<number, string>;
}

interface Item {
  x: number;
  y: number;
  size: number;
  text: string;
}

const hexBytes = (hex: string) => {
  const clean = hex.replace(/[^0-9a-f]/gi, "");
  const padded = clean.length % 2 ? `${clean}0` : clean;
  return Buffer.from(padded, "hex");
};

const utf16 = (bytes: Uint8Array) => {
  let out = "";
  for (let i = 0; i + 1 < bytes.length; i += 2)
    out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
  return out;
};

const code = (hex: string) => Number.parseInt(hex.replace(/[^0-9a-f]/gi, "") || "0", 16);

/** Parse a ToUnicode CMap (bfchar and bfrange sections). */
export function parseToUnicode(cmap: string): { map: Map<number, string>; twoByte: boolean } {
  const map = new Map<number, string>();
  const range = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(cmap)?.[1] ?? "";
  const first = /<([0-9a-fA-F]+)>/.exec(range)?.[1];
  const twoByte = first ? first.length >= 4 : true;
  for (const section of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const pair of section[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g))
      map.set(code(pair[1]), utf16(hexBytes(pair[2])));
  for (const section of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = section[1];
    const entry = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<([0-9a-fA-F]*)>|\[([^\]]*)\])/g;
    for (let m = entry.exec(body); m; m = entry.exec(body)) {
      const low = code(m[1]);
      const high = Math.min(code(m[2]), low + 65_535);
      if (m[4] !== undefined) {
        const base = hexBytes(m[4]);
        for (let c = low; c <= high; c++) {
          const bytes = Buffer.from(base);
          if (bytes.length >= 2) {
            const last = bytes.readUInt16BE(bytes.length - 2) + (c - low);
            bytes.writeUInt16BE(last & 0xffff, bytes.length - 2);
          }
          map.set(c, utf16(bytes));
        }
      } else {
        const targets = [...(m[5] ?? "").matchAll(/<([0-9a-fA-F]*)>/g)];
        targets.forEach((target, i) => {
          if (low + i <= high) map.set(low + i, utf16(hexBytes(target[1])));
        });
      }
    }
  }
  return { map, twoByte };
}

type Token =
  | { type: "op"; value: string }
  | { type: "num"; value: number }
  | { type: "str"; value: Uint8Array }
  | { type: "name"; value: string }
  | { type: "array"; value: Token[] }
  | { type: "other" };

/** Tokenize a content stream into operands and operators. */
function* tokens(data: Uint8Array): Generator<Token> {
  const n = data.length;
  let i = 0;
  const isSpace = (c: number) => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;
  const isDelimiter = (c: number) => "()<>[]{}/%".includes(String.fromCharCode(c));
  const stack: Token[][] = [];
  const emit = function* (token: Token): Generator<Token> {
    if (stack.length) stack[stack.length - 1].push(token);
    else yield token;
  };
  while (i < n) {
    const c = data[i];
    if (isSpace(c)) {
      i++;
      continue;
    }
    if (c === 37) {
      while (i < n && data[i] !== 10 && data[i] !== 13) i++;
      continue;
    }
    if (c === 40) {
      const out: number[] = [];
      let depth = 1;
      i++;
      while (i < n && depth > 0) {
        const ch = data[i];
        if (ch === 92) {
          const next = data[++i];
          const escapes: Record<number, number> = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 };
          if (next in escapes) out.push(escapes[next]);
          else if (next >= 48 && next <= 55) {
            let octal = "";
            while (octal.length < 3 && data[i] >= 48 && data[i] <= 55)
              octal += String.fromCharCode(data[i++]);
            out.push(Number.parseInt(octal, 8) & 255);
            continue;
          } else if (next === 13 || next === 10) {
            if (next === 13 && data[i + 1] === 10) i++;
          } else out.push(next);
          i++;
          continue;
        }
        if (ch === 40) depth++;
        else if (ch === 41 && --depth === 0) {
          i++;
          break;
        }
        out.push(ch);
        i++;
      }
      yield* emit({ type: "str", value: Uint8Array.from(out) });
      continue;
    }
    if (c === 60 && data[i + 1] === 60) {
      // Dictionary (e.g. inline image or marked-content properties): skip to the matching >>.
      let depth = 0;
      while (i < n) {
        if (data[i] === 60 && data[i + 1] === 60) {
          depth++;
          i += 2;
        } else if (data[i] === 62 && data[i + 1] === 62) {
          depth--;
          i += 2;
          if (!depth) break;
        } else i++;
      }
      yield* emit({ type: "other" });
      continue;
    }
    if (c === 60) {
      const end = data.indexOf(62, i);
      const stop = end < 0 ? n : end;
      yield* emit({
        type: "str",
        value: hexBytes(Buffer.from(data.subarray(i + 1, stop)).toString("latin1")),
      });
      i = stop + 1;
      continue;
    }
    if (c === 91) {
      stack.push([]);
      i++;
      continue;
    }
    if (c === 93) {
      const array = stack.pop() ?? [];
      i++;
      yield* emit({ type: "array", value: array });
      continue;
    }
    if (c === 47) {
      let j = i + 1;
      while (j < n && !isSpace(data[j]) && !isDelimiter(data[j])) j++;
      yield* emit({ type: "name", value: Buffer.from(data.subarray(i + 1, j)).toString("latin1") });
      i = j;
      continue;
    }
    let j = i;
    while (j < n && !isSpace(data[j]) && !isDelimiter(data[j])) j++;
    if (j === i) {
      i++;
      continue;
    }
    const word = Buffer.from(data.subarray(i, j)).toString("latin1");
    i = j;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) yield* emit({ type: "num", value: Number(word) });
    else if (stack.length) yield* emit({ type: "other" });
    else {
      yield { type: "op", value: word };
      if (word === "BI") {
        // Inline image data: skip to "EI" surrounded by whitespace.
        let k = i;
        while (
          k < n - 2 &&
          !(
            isSpace(data[k]) &&
            data[k + 1] === 69 &&
            data[k + 2] === 73 &&
            (k + 3 >= n || isSpace(data[k + 3]))
          )
        )
          k++;
        i = k + 3;
      }
    }
  }
}

function lookup(doc: PDFDocument, object: PDFObject | undefined): PDFObject | undefined {
  return object instanceof PDFRef ? doc.context.lookup(object) : object;
}

function streamBytes(doc: PDFDocument, object: PDFObject | undefined): Uint8Array[] {
  const value = lookup(doc, object);
  if (value instanceof PDFArray) return value.asArray().flatMap((part) => streamBytes(doc, part));
  if (value instanceof PDFRawStream) {
    try {
      return [decodePDFRawStream(value).decode()];
    } catch {
      return [];
    }
  }
  return [];
}

function fontInfo(
  doc: PDFDocument,
  font: PDFObject | undefined,
  cache: Map<PDFObject, FontInfo>,
): FontInfo {
  const dict = lookup(doc, font);
  if (!(dict instanceof PDFDict)) return { twoByte: false };
  const cached = cache.get(dict);
  if (cached) return cached;
  const subtype = dict.get(PDFName.of("Subtype"));
  const type0 = subtype instanceof PDFName && subtype.asString() === "/Type0";
  let info: FontInfo = { twoByte: type0 };
  const toUnicode = streamBytes(doc, dict.get(PDFName.of("ToUnicode")))[0];
  if (toUnicode) {
    const parsed = parseToUnicode(Buffer.from(toUnicode).toString("latin1"));
    info = { twoByte: type0, map: parsed.map };
  }
  cache.set(dict, info);
  return info;
}

function decodeString(bytes: Uint8Array, font: FontInfo): string {
  let out = "";
  if (font.twoByte) {
    for (let i = 0; i + 1 < bytes.length; i += 2)
      out += font.map?.get((bytes[i] << 8) | bytes[i + 1]) ?? "";
    return out;
  }
  for (const byte of bytes)
    out += font.map?.get(byte) ?? (font.map ? "" : String.fromCharCode(byte));
  return out;
}

function collectItems(
  doc: PDFDocument,
  content: Uint8Array[],
  resources: PDFDict | undefined,
  items: Item[],
  cache: Map<PDFObject, FontInfo>,
  depth = 0,
) {
  const fonts = lookup(doc, resources?.get(PDFName.of("Font")));
  const xobjects = lookup(doc, resources?.get(PDFName.of("XObject")));
  let font: FontInfo = { twoByte: false };
  let size = 12;
  let scale = 1;
  let leading = 0;
  let lineX = 0;
  let lineY = 0;
  let operations = 0;
  const operands: Token[] = [];
  const show = (text: string) => {
    if (text) items.push({ x: lineX, y: lineY, size: Math.abs(size * scale) || 12, text });
  };
  const newLine = (tx: number, ty: number) => {
    lineX += tx * scale;
    lineY += ty * scale;
  };
  for (const data of content)
    for (const token of tokens(data)) {
      if (token.type !== "op") {
        operands.push(token);
        continue;
      }
      if (++operations > MAX_OPERATIONS) break;
      const nums = operands
        .filter((o): o is { type: "num"; value: number } => o.type === "num")
        .map((o) => o.value);
      switch (token.value) {
        case "BT":
          lineX = 0;
          lineY = 0;
          scale = 1;
          break;
        case "Tf": {
          const name = operands.find((o) => o.type === "name");
          if (name?.type === "name" && fonts instanceof PDFDict)
            font = fontInfo(doc, fonts.get(PDFName.of(name.value)), cache);
          size = nums.at(-1) ?? size;
          break;
        }
        case "TL":
          leading = nums[0] ?? leading;
          break;
        case "Td":
          newLine(nums[0] ?? 0, nums[1] ?? 0);
          break;
        case "TD":
          leading = -(nums[1] ?? 0);
          newLine(nums[0] ?? 0, nums[1] ?? 0);
          break;
        case "Tm":
          if (nums.length >= 6) {
            scale = Math.hypot(nums[2], nums[3]) || 1;
            lineX = nums[4];
            lineY = nums[5];
          }
          break;
        case "T*":
          newLine(0, -leading);
          break;
        case "'":
        case '"': {
          newLine(0, -leading);
          const value = operands.findLast((o) => o.type === "str");
          if (value?.type === "str") show(decodeString(value.value, font));
          break;
        }
        case "Tj": {
          const value = operands.findLast((o) => o.type === "str");
          if (value?.type === "str") show(decodeString(value.value, font));
          break;
        }
        case "TJ": {
          const array = operands.findLast((o) => o.type === "array");
          if (array?.type === "array") {
            let text = "";
            for (const part of array.value) {
              if (part.type === "str") text += decodeString(part.value, font);
              // A large negative adjustment is a visual word gap without a space glyph.
              else if (part.type === "num" && part.value < -250 && text && !text.endsWith(" "))
                text += " ";
            }
            show(text);
          }
          break;
        }
        case "Do": {
          const name = operands.find((o) => o.type === "name");
          if (depth < 4 && name?.type === "name" && xobjects instanceof PDFDict) {
            const form = lookup(doc, xobjects.get(PDFName.of(name.value)));
            if (form instanceof PDFRawStream) {
              const sub = form.dict.get(PDFName.of("Subtype"));
              if (sub instanceof PDFName && sub.asString() === "/Form") {
                const inner = lookup(doc, form.dict.get(PDFName.of("Resources")));
                collectItems(
                  doc,
                  streamBytes(doc, form),
                  inner instanceof PDFDict ? inner : resources,
                  items,
                  cache,
                  depth + 1,
                );
              }
            }
          }
          break;
        }
      }
      operands.length = 0;
    }
}

const rtlChar = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/g;
const ltrChar = /[A-Za-z\u00C0-\u024F]/g;
const commonSet = new Set([
  "و",
  "از",
  "به",
  "در",
  "که",
  "این",
  "را",
  "با",
  "است",
  "برای",
  "های",
  "یک",
  "آن",
  "می",
  "شما",
  "ما",
  "هر",
  "تا",
  "فی",
  "من",
  "على",
  "الى",
  "هذا",
]);

const reversed = (text: string) => Array.from(text).reverse().join("");

/** Reverse a visually ordered RTL line to logical order, keeping LTR runs readable. */
function visualToLogical(line: string): string {
  const mirrored: Record<string, string> = {
    "(": ")",
    ")": "(",
    "[": "]",
    "]": "[",
    "{": "}",
    "}": "{",
    "<": ">",
    ">": "<",
    "«": "»",
    "»": "«",
  };
  return reversed(line)
    .replace(
      /[A-Za-z0-9\u00C0-\u024F][A-Za-z0-9\u00C0-\u024F .,:;/@_+\-%#&'"]*[A-Za-z0-9\u00C0-\u024F]|[A-Za-z0-9]/g,
      reversed,
    )
    .replace(/[()[\]{}<>«»]/g, (c) => mirrored[c] ?? c);
}

function commonHits(line: string): number {
  return (line.match(/[\u0600-\u06FF]+/g) ?? []).filter((word) => commonSet.has(word)).length;
}

const isRtl = (text: string) =>
  (text.match(rtlChar)?.length ?? 0) > (text.match(ltrChar)?.length ?? 0);

/** Extract text from all pages of a PDF. Returns "" for PDFs without a text layer. */
export async function extractPdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(new Uint8Array(bytes), {
      ignoreEncryption: true,
      updateMetadata: false,
    });
  } catch {
    throw new PdfTextError("PDF خوانده نشد. سند ممکن است خراب یا رمزگذاری‌شده باشد.");
  }
  const cache = new Map<PDFObject, FontInfo>();
  const pages: Item[][][] = [];
  for (const page of doc.getPages()) {
    const items: Item[] = [];
    try {
      collectItems(
        doc,
        streamBytes(doc, page.node.get(PDFName.of("Contents"))),
        page.node.Resources(),
        items,
        cache,
      );
    } catch {
      // A malformed page contributes no text; the rest of the document is still read.
    }
    // Group items into lines by baseline, top of the page first.
    const lines: Item[][] = [];
    for (const item of [...items].sort((a, b) => b.y - a.y)) {
      const line = lines.at(-1);
      if (line && Math.abs(line[0].y - item.y) <= Math.max(2, item.size * 0.4)) line.push(item);
      else lines.push([item]);
    }
    pages.push(lines);
  }
  // Decide once per document whether RTL glyphs are stored in visual order: compare hits of
  // common Persian/Arabic words in the text as stored and reversed.
  let asStored = 0;
  let asReversed = 0;
  for (const lines of pages)
    for (const line of lines) {
      const text = line
        .map((item) => item.text)
        .join(" ")
        .normalize("NFKC");
      if (!isRtl(text)) continue;
      asStored += commonHits(text);
      asReversed += commonHits(reversed(text));
    }
  const visual = asReversed > asStored;
  const output: string[] = [];
  for (const lines of pages) {
    const pageLines: string[] = [];
    let previous: Item[] | undefined;
    for (const line of lines) {
      const raw = line.map((item) => item.text).join("");
      const rtl = isRtl(raw);
      const ordered = [...line].sort((a, b) => (rtl && !visual ? b.x - a.x : a.x - b.x));
      let text = ordered
        .map((item) => item.text)
        .reduce(
          (joined, part) =>
            joined && !/\s$/.test(joined) && !/^\s/.test(part)
              ? `${joined} ${part}`
              : joined + part,
          "",
        )
        .normalize("NFKC");
      if (rtl && visual) text = visualToLogical(text);
      text = text.replace(/[ \t]+/g, " ").trim();
      if (!text) continue;
      if (previous && previous[0].y - line[0].y > line[0].size * 1.9) pageLines.push("");
      pageLines.push(text);
      previous = line;
    }
    output.push(pageLines.join("\n"));
  }
  const text = normalizePersianText(output.join("\n\n").replace(/\n{3,}/g, "\n\n")).trim();
  return { text: text.slice(0, MAX_TEXT), pages: pages.length };
}
