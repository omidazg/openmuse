import type { Artifact } from "../../../packages/domain/src/index.ts";
import {
  chunkText,
  cosineSimilarity,
  decodeVector,
  encodeVector,
  rankBm25,
} from "../../../packages/integrations/src/text-search.ts";
import type { Store } from "./db.ts";

/**
 * Question answering over uploaded files: each file's extracted text is split into ~800-token
 * chunks, embedded through the OpenAI-compatible /embeddings endpoint (Metis documents
 * text-embedding-3-small on its OpenAI wrapper) and stored per owner in `records`
 * (kind "file-index", one row per file, vectors as base64 float32). Search combines cosine
 * similarity with Persian-normalized BM25; without embeddings it is keyword search only.
 */

export const EMBEDDING_DEFAULT_MODEL = "openai/text-embedding-3-small";
const INDEX_VERSION = 1;
const EMBED_BATCH = 64;
const BACKFILL_PER_SEARCH = 25;

export type Embedder = ((texts: string[]) => Promise<number[][]>) & { model: string };

/** EMBEDDING_MODEL (default openai/text-embedding-3-small); "off" disables embeddings. */
export function openAiEmbedder(env: NodeJS.ProcessEnv = process.env): Embedder | undefined {
  const configured = env.EMBEDDING_MODEL?.trim();
  if (configured && /^(off|none|false|0)$/i.test(configured)) return undefined;
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) return undefined;
  const model = configured || EMBEDDING_DEFAULT_MODEL;
  const base = (env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
  const embed = async (texts: string[]) => {
    const response = await fetch(`${base}/embeddings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: model.replace(/^openai\//, ""), input: texts }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`embeddings request failed (${response.status})`);
    const payload = (await response.json()) as {
      data?: { index?: number; embedding?: number[] }[];
    };
    const data = [...(payload.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (data.length !== texts.length || data.some((item) => !Array.isArray(item.embedding)))
      throw new Error("embeddings response is incomplete");
    return data.map((item) => item.embedding as number[]);
  };
  return Object.assign(embed, { model });
}

interface IndexedChunk {
  index: number;
  start: number;
  end: number;
  text: string;
  /** base64 float32 vector when embeddings were available. */
  vector?: string;
}

export interface FileIndexRecord {
  id: string;
  fileId: string;
  fileName: string;
  version: number;
  model?: string;
  /** Last failed embeddings attempt; retried after an hour. */
  embeddingFailedAt?: string;
  chunks: IndexedChunk[];
  indexedAt: string;
}

export interface FileSearchHit {
  fileId: string;
  fileName: string;
  /** 1-based chunk position and the file's chunk count. */
  part: number;
  parts: number;
  /** Character offsets in the extracted text (usable with read_file's offset). */
  start: number;
  end: number;
  text: string;
  score: number;
}

export interface FileSearchResult {
  method: "semantic" | "keyword";
  hits: FileSearchHit[];
  /** Files that have no extractable text (for example scanned PDFs). */
  unreadable: string[];
}

export class FileIndex {
  private readonly pending = new Set<Promise<unknown>>();
  constructor(
    private readonly db: Store,
    private readonly loadText: (owner: string, file: Artifact) => Promise<string>,
    public embedder: Embedder | undefined = openAiEmbedder(),
  ) {}

  /** Index a file in the background (after upload); failures leave it for lazy backfill. */
  schedule(owner: string, file: Artifact): void {
    const job = this.index(owner, file).catch(() => undefined);
    this.pending.add(job);
    void job.finally(() => this.pending.delete(job));
  }

  /** Resolves when background indexing started so far has finished. */
  async idle(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  async index(owner: string, file: Artifact): Promise<FileIndexRecord> {
    const text = await this.loadText(owner, file).catch(() => "");
    const chunks: IndexedChunk[] = chunkText(text).map(({ index, start, end, text }) => ({
      index,
      start,
      end,
      text,
    }));
    let model: string | undefined;
    let embeddingFailedAt: string | undefined;
    if (this.embedder && chunks.length) {
      try {
        const vectors: number[][] = [];
        for (let i = 0; i < chunks.length; i += EMBED_BATCH)
          vectors.push(
            ...(await this.embedder(chunks.slice(i, i + EMBED_BATCH).map((chunk) => chunk.text))),
          );
        chunks.forEach((chunk, i) => {
          chunk.vector = encodeVector(vectors[i]);
        });
        model = this.embedder.model;
      } catch {
        // Embeddings unavailable: keep the chunks for keyword search.
        for (const chunk of chunks) delete chunk.vector;
        embeddingFailedAt = new Date().toISOString();
      }
    }
    return this.db.put(owner, "file-index", {
      id: file.id,
      fileId: file.id,
      fileName: file.name,
      version: INDEX_VERSION,
      ...(model ? { model } : {}),
      ...(embeddingFailedAt ? { embeddingFailedAt } : {}),
      chunks,
      indexedAt: new Date().toISOString(),
    });
  }

  /** Index the owner's files that have no index yet (bounded per call). */
  async backfill(owner: string, files: Artifact[]): Promise<FileIndexRecord[]> {
    const existing = await this.db.list<FileIndexRecord>(owner, "file-index");
    const known = new Map(existing.map((record) => [record.fileId, record]));
    const missing = files.filter((file) => {
      const record = known.get(file.id);
      if (!record || record.version !== INDEX_VERSION) return true;
      // Re-embed keyword-only indexes once embeddings become available.
      return (
        !!this.embedder &&
        !record.model &&
        record.chunks.length > 0 &&
        Date.now() - Date.parse(record.embeddingFailedAt ?? "1970-01-01") > 3_600_000
      );
    });
    for (const file of missing.slice(0, BACKFILL_PER_SEARCH))
      known.set(file.id, await this.index(owner, file));
    const ids = new Set(files.map((file) => file.id));
    return [...known.values()].filter((record) => ids.has(record.fileId));
  }

  async search(
    owner: string,
    files: Artifact[],
    query: string,
    options: { limit?: number; fileIds?: string[] } = {},
  ): Promise<FileSearchResult> {
    const limit = Math.max(1, Math.min(options.limit ?? 6, 20));
    const scope = options.fileIds?.length
      ? files.filter((file) => options.fileIds?.includes(file.id))
      : files;
    const records = await this.backfill(owner, scope);
    const unreadable = records.filter((record) => !record.chunks.length).map((r) => r.fileName);
    const all = records.flatMap((record) => record.chunks.map((chunk) => ({ record, chunk })));
    const keyword = rankBm25(query, all, ({ chunk }) => `${chunk.text}`);
    let semantic: { item: (typeof all)[number]; score: number }[] = [];
    const vectored = all.filter(
      ({ record, chunk }) => chunk.vector && record.model === this.embedder?.model,
    );
    if (this.embedder && vectored.length) {
      try {
        const [queryVector] = await this.embedder([query]);
        semantic = vectored
          .map((item) => ({
            item,
            score: cosineSimilarity(queryVector, decodeVector(item.chunk.vector ?? "")),
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 50);
      } catch {
        semantic = [];
      }
    }
    // Reciprocal rank fusion of semantic and keyword rankings.
    const fused = new Map<(typeof all)[number], number>();
    const add = (ranking: { item: (typeof all)[number] }[]) =>
      ranking.forEach(({ item }, rank) => {
        fused.set(item, (fused.get(item) ?? 0) + 1 / (60 + rank));
      });
    add(semantic);
    add(keyword.slice(0, 50));
    const hits = [...fused.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([{ record, chunk }, score]) => ({
        fileId: record.fileId,
        fileName: record.fileName,
        part: chunk.index + 1,
        parts: record.chunks.length,
        start: chunk.start,
        end: chunk.end,
        text: chunk.text,
        score: Number(score.toFixed(4)),
      }));
    return { method: semantic.length ? "semantic" : "keyword", hits, unreadable };
  }
}
