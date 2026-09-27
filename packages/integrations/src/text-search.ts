/**
 * Persian-aware text chunking and keyword ranking for searching uploaded files.
 *
 * Chunks follow paragraph and sentence boundaries (Persian «.» «؟» «!» «؛» and Latin
 * punctuation) and overlap slightly so an answer that straddles a boundary is still found.
 * Keyword search (BM25) is the fallback when no embeddings model is available; its tokens
 * are normalized so Arabic/Persian letter variants, digits, diacritics and ZWNJ spellings match.
 */

export interface TextChunk {
  /** 0-based position of the chunk within its file. */
  index: number;
  /** Character offsets in the source text. */
  start: number;
  end: number;
  text: string;
}

export interface ChunkOptions {
  /** Approximate chunk size in tokens (default 800). */
  targetTokens?: number;
  /** Approximate overlap between neighbouring chunks in tokens (default 100). */
  overlapTokens?: number;
  /** Hard cap on chunks per document (default 600). */
  maxChunks?: number;
}

/**
 * Rough token estimate without a tokenizer: Latin text averages ~4 characters per token,
 * Arabic-script text is split more finely by BPE tokenizers (~2.5 characters per token).
 */
export function estimateTokens(text: string): number {
  let arabic = 0;
  for (const character of text) if (/[\u0600-\u06FF\uFB50-\uFEFF]/.test(character)) arabic++;
  const other = text.length - arabic;
  return Math.ceil(arabic / 2.5 + other / 4);
}

interface Span {
  start: number;
  end: number;
}

/** Sentence spans of a text: paragraphs first, then sentence-final punctuation. */
function sentenceSpans(text: string): Span[] {
  const spans: Span[] = [];
  const boundary = /[.!?؟!؛;…]+["'»)\]]*(?=\s)|\n\s*\n|\n/g;
  let start = 0;
  for (let match = boundary.exec(text); match; match = boundary.exec(text)) {
    const end = match.index + match[0].length;
    if (text.slice(start, end).trim()) spans.push({ start, end });
    start = end;
  }
  if (text.slice(start).trim()) spans.push({ start, end: text.length });
  return spans;
}

/** Split an over-long span on whitespace so no piece exceeds `maxChars`. */
function splitLong(text: string, span: Span, maxChars: number): Span[] {
  if (span.end - span.start <= maxChars) return [span];
  const pieces: Span[] = [];
  let start = span.start;
  while (span.end - start > maxChars) {
    let cut = text.lastIndexOf(" ", start + maxChars);
    if (cut <= start + maxChars / 2) cut = start + maxChars;
    pieces.push({ start, end: cut });
    start = cut;
  }
  pieces.push({ start, end: span.end });
  return pieces;
}

/** Split text into overlapping chunks along paragraph and sentence boundaries. */
export function chunkText(text: string, options: ChunkOptions = {}): TextChunk[] {
  const target = options.targetTokens ?? 800;
  const overlap = options.overlapTokens ?? 100;
  const maxChunks = options.maxChunks ?? 600;
  // Characters per token for this text, so long unbroken runs are split at the right size.
  const ratio = Math.max(1, text.length / Math.max(1, estimateTokens(text)));
  const spans = sentenceSpans(text).flatMap((span) =>
    splitLong(text, span, Math.floor(target * ratio)),
  );
  const chunks: TextChunk[] = [];
  let current: Span[] = [];
  let tokens = 0;
  const flush = () => {
    if (!current.length) return;
    const start = current[0].start;
    const end = current.at(-1)?.end ?? start;
    const body = text.slice(start, end).trim();
    if (body) chunks.push({ index: chunks.length, start, end, text: body });
  };
  for (let i = 0; i < spans.length && chunks.length < maxChunks; i++) {
    const span = spans[i];
    const size = estimateTokens(text.slice(span.start, span.end));
    if (current.length && tokens + size > target) {
      flush();
      // Carry trailing sentences (up to the overlap budget) into the next chunk.
      const carried: Span[] = [];
      let carriedTokens = 0;
      for (let j = current.length - 1; j >= 1; j--) {
        const piece = estimateTokens(text.slice(current[j].start, current[j].end));
        if (carriedTokens + piece > overlap) break;
        carried.unshift(current[j]);
        carriedTokens += piece;
      }
      current = carried;
      tokens = carriedTokens;
    }
    current.push(span);
    tokens += size;
  }
  if (chunks.length < maxChunks) flush();
  return chunks;
}

const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
const arabicDigits = "٠١٢٣٤٥٦٧٨٩";

/** Normalize text for matching: letter variants, digits, diacritics, ZWNJ and case. */
export function normalizeSearchText(text: string): string {
  return (
    text
      .normalize("NFKC")
      .replace(/[يى]/g, "ی")
      .replace(/ك/g, "ک")
      .replace(/[ةۀ]/g, "ه")
      .replace(/[أإآٱ]/g, "ا")
      .replace(/ؤ/g, "و")
      .replace(/ئ/g, "ی")
      // Harakat, tanwin, superscript alef and tatweel carry no meaning for search.
      .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
      // «می‌شود» / «میشود» / «می شود» should all match: ZWNJ joins the parts.
      .replace(/\u200C|\u200D|\u200E|\u200F/g, "")
      .replace(/[۰-۹]/g, (digit) => String(persianDigits.indexOf(digit)))
      .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
      .toLowerCase()
  );
}

const stopwords = new Set(
  [
    // Persian
    "و",
    "در",
    "به",
    "از",
    "که",
    "این",
    "آن",
    "را",
    "با",
    "است",
    "برای",
    "یک",
    "تا",
    "هم",
    "بر",
    "یا",
    "اما",
    "اگر",
    "هر",
    "شد",
    "شود",
    "بود",
    "باشد",
    "کرد",
    "کند",
    "کنید",
    "میشود",
    "چه",
    "چی",
    "کجا",
    "کی",
    "آیا",
    "ها",
    "های",
    "ای",
    "من",
    "ما",
    "شما",
    "او",
    "هست",
    "نیست",
    "دارد",
    // English
    "the",
    "a",
    "an",
    "of",
    "and",
    "or",
    "to",
    "in",
    "on",
    "for",
    "is",
    "are",
    "was",
    "be",
    "it",
    "this",
    "that",
    "with",
    "as",
    "by",
    "at",
    "what",
    "which",
    "how",
  ].map(normalizeSearchText),
);

const persianSuffixes = ["هایی", "هایم", "هایت", "هایش", "های", "ها"];

/** Light Persian stemming: strip plural suffixes from longer words. */
function stem(token: string): string {
  if (!/[\u0600-\u06FF]/.test(token)) return token;
  for (const suffix of persianSuffixes)
    if (token.length - suffix.length >= 2 && token.endsWith(suffix))
      return token.slice(0, -suffix.length);
  return token;
}

/** Normalized, stemmed search tokens without stopwords. */
export function searchTokens(text: string): string[] {
  return (normalizeSearchText(text).match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((token) => !stopwords.has(token))
    .map(stem)
    .filter((token) => token.length > 1 || /\d/.test(token));
}

export interface Ranked<T> {
  item: T;
  score: number;
}

/** BM25 ranking of documents for a query; documents without any query term are dropped. */
export function rankBm25<T>(
  query: string,
  documents: T[],
  text: (document: T) => string,
  options: { k1?: number; b?: number } = {},
): Ranked<T>[] {
  const k1 = options.k1 ?? 1.2;
  const b = options.b ?? 0.75;
  const terms = [...new Set(searchTokens(query))];
  if (!terms.length || !documents.length) return [];
  const tokenized = documents.map((document) => searchTokens(text(document)));
  const average = tokenized.reduce((sum, tokens) => sum + tokens.length, 0) / documents.length || 1;
  const frequency = new Map<string, number>();
  for (const tokens of tokenized)
    for (const term of new Set(tokens)) frequency.set(term, (frequency.get(term) ?? 0) + 1);
  const results: Ranked<T>[] = [];
  tokenized.forEach((tokens, i) => {
    const counts = new Map<string, number>();
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
    let score = 0;
    for (const term of terms) {
      const tf = counts.get(term) ?? 0;
      if (!tf) continue;
      const df = frequency.get(term) ?? 0;
      const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
      score += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * tokens.length) / average));
    }
    if (score > 0) results.push({ item: documents[i], score });
  });
  return results.sort((a, b) => b.score - a.score);
}

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Compact jsonb storage for embedding vectors: base64 of little-endian float32. */
export function encodeVector(vector: ArrayLike<number>): string {
  return Buffer.from(new Float32Array(Array.from(vector)).buffer).toString("base64");
}

export function decodeVector(encoded: string): Float32Array {
  const bytes = Buffer.from(encoded, "base64");
  const copy = new Uint8Array(bytes.length - (bytes.length % 4));
  copy.set(bytes.subarray(0, copy.length));
  return new Float32Array(copy.buffer);
}
