/**
 * Persian-aware text matching for conversation search.
 *
 * Folding treats Arabic ي/ى and ك as Persian ی and ک, hamza-carrying alefs as ا, ة/ۀ as ه,
 * Persian and Arabic-Indic digits as Latin digits, and drops ZWNJ, tatweel, diacritics and
 * bidi marks, so «میشود»، «می‌شود» and «مي‌شود» all match. Every folded character remembers
 * its position in the original text, so a match can be highlighted in the text people read.
 */

// ZWNJ/ZWJ, bidi marks, tatweel, harakat and Quranic marks, superscript alef.
const IGNORED: [number, number][] = [
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0x0640, 0x0640],
  [0x0610, 0x061a],
  [0x064b, 0x065f],
  [0x0670, 0x0670],
  [0x06d6, 0x06ed],
];
const ignored = (char: string) => {
  const code = char.charCodeAt(0);
  return IGNORED.some(([from, to]) => code >= from && code <= to);
};
const FOLD: Record<string, string> = {
  ي: "ی",
  ى: "ی",
  ئ: "ی",
  ك: "ک",
  أ: "ا",
  إ: "ا",
  آ: "ا",
  ٱ: "ا",
  ؤ: "و",
  ة: "ه",
  ۀ: "ه",
  ە: "ه",
};

function foldChar(char: string): string {
  if (char >= "۰" && char <= "۹") return String(char.charCodeAt(0) - 0x06f0);
  if (char >= "٠" && char <= "٩") return String(char.charCodeAt(0) - 0x0660);
  return FOLD[char] ?? char.toLowerCase();
}

/** Folded text plus, for each folded character, the index of its source character. */
export function foldForSearch(text: string): { text: string; map: number[] } {
  let folded = "";
  const map: number[] = [];
  let space = true; // trims leading whitespace and collapses runs
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (ignored(char)) continue;
    if (/\s/.test(char)) {
      if (!space) {
        folded += " ";
        map.push(i);
      }
      space = true;
      continue;
    }
    space = false;
    for (const part of foldChar(char)) {
      folded += part;
      map.push(i);
    }
  }
  if (folded.endsWith(" ")) {
    folded = folded.slice(0, -1);
    map.pop();
  }
  return { text: folded, map };
}

export function normalizeSearch(text: string): string {
  return foldForSearch(text).text;
}

export type TextRange = { start: number; end: number };

/** Finds `query` in `text` after folding both; returns the range in the original text. */
export function findMatch(text: string, query: string): TextRange | null {
  const needle = normalizeSearch(query);
  if (!needle) return null;
  const folded = foldForSearch(text);
  const at = folded.text.indexOf(needle);
  if (at < 0) return null;
  return { start: folded.map[at], end: folded.map[at + needle.length - 1] + 1 };
}

/** A short excerpt around a match, with the match range inside the excerpt. */
export function snippetAround(
  text: string,
  match: TextRange,
  radius = 40,
): { text: string; start: number; end: number } {
  let from = Math.max(0, match.start - radius);
  let to = Math.min(text.length, match.end + radius);
  // Prefer word boundaries so the excerpt does not open mid-word.
  if (from > 0) {
    const space = text.indexOf(" ", from);
    if (space >= 0 && space < match.start) from = space + 1;
  }
  if (to < text.length) {
    const space = text.lastIndexOf(" ", to);
    if (space > match.end) to = space;
  }
  const head = from > 0 ? "…" : "",
    tail = to < text.length ? "…" : "";
  const body = text.slice(from, to).replace(/\s/g, " ");
  return {
    text: `${head}${body}${tail}`,
    start: head.length + match.start - from,
    end: head.length + match.end - from,
  };
}
