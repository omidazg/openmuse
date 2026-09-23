import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Artifact } from "../../../packages/domain/src/index.ts";
import {
  DOCUMENT_TYPES,
  type DocumentKind,
  detectDocumentKind,
  extractDocumentText,
} from "../../../packages/integrations/src/office.ts";
import { fillPdf, inspectPdf, type RenderHtml } from "../../../packages/integrations/src/pdf.ts";
import { extractPdfText } from "../../../packages/integrations/src/pdf-text.ts";
import type { Auth } from "./auth.ts";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";
import { FileIndex } from "./file-search.ts";
import { detectImageKind, IMAGE_TYPES, type ImageKind, imageKindOf, isHeic } from "./images.ts";
import type { PdfRenderer } from "./pdf-render.ts";

const kindByMime = new Map(
  Object.entries(DOCUMENT_TYPES).map(([kind, type]) => [type.mimeType, kind as DocumentKind]),
);

export function fileKind(file: Pick<Artifact, "mimeType">): DocumentKind | ImageKind {
  return imageKindOf(file.mimeType) ?? kindByMime.get(file.mimeType) ?? "pdf";
}

export function isImageFile(file: Pick<Artifact, "mimeType">): boolean {
  return imageKindOf(file.mimeType) !== undefined;
}

function storedExtension(file: Pick<Artifact, "mimeType">): string {
  const kind = fileKind(file);
  return kind in IMAGE_TYPES
    ? IMAGE_TYPES[kind as ImageKind].extension
    : DOCUMENT_TYPES[kind as DocumentKind].extension;
}

export class Files {
  /** Chunk and embedding index for search_files; files are indexed after upload. */
  readonly index: FileIndex;
  constructor(
    private readonly db: Store,
    private readonly config: Config,
    private readonly auth: Auth,
    /** Chromium renderer for Persian PDFs; optional so pdf-lib paths keep working without it. */
    readonly renderer?: PdfRenderer,
  ) {
    this.index = new FileIndex(db, (owner, file) => this.plainText(owner, file));
  }
  async import(
    owner: string,
    name: string,
    bytes: Uint8Array,
    source: string,
    parentId?: string,
    mimeType?: string,
  ): Promise<Artifact> {
    if (bytes.length > 10 * 1024 * 1024)
      throw new AppError("حجم سند باید حداکثر ۱۰ مگابایت باشد", 413);
    const image = detectImageKind(bytes);
    const kind = image ? undefined : detectDocumentKind(name, bytes, mimeType);
    if (!image && isHeic(bytes))
      throw new AppError(
        "تصویر HEIC پشتیبانی نمی‌شود. آن را با قالب JPG یا PNG ذخیره کنید و دوباره بارگذاری کنید.",
        415,
      );
    if (!image && !kind)
      throw new AppError(
        "این نوع فایل پشتیبانی نمی‌شود. یک PDF، سند Word ‏(docx)، فایل Excel ‏(xlsx)، CSV یا تصویر JPG، PNG یا WebP انتخاب کنید.",
        422,
      );
    const type = image ? IMAGE_TYPES[image] : DOCUMENT_TYPES[kind as DocumentKind];
    let pageCount = 1;
    let fields: Artifact["fields"];
    let text: string | undefined;
    let textTruncated = false;
    if (image) {
      // Images keep pageCount 1; their text comes from the vision model on request (vision.ts).
    } else if (kind === "pdf") {
      const metadata = await inspectPdf(bytes);
      if (metadata.pageCount > 500) throw new AppError("PDF باید حداکثر ۵۰۰ صفحه داشته باشد", 422);
      pageCount = metadata.pageCount;
      fields = metadata.fields;
    } else {
      const extracted = extractDocumentText(kind as DocumentKind, bytes);
      pageCount = extracted.parts;
      text = extracted.text;
      textTruncated = extracted.truncated;
    }
    const id = randomUUID();
    const safeName = Array.from(name.split(/[\\/]/).at(-1) || `document.${type.extension}`)
      .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
      .join("")
      .slice(0, 180);
    const artifact: Artifact = {
      id,
      name: safeName,
      mimeType: type.mimeType,
      size: bytes.length,
      pageCount,
      ...(fields ? { fields } : {}),
      ...(text !== undefined ? { textLength: text.length, textTruncated } : {}),
      url: "",
      createdAt: new Date().toISOString(),
      source,
      parentId,
    };
    const directory = join(this.config.dataDir, "files");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(join(directory, `${id}.${type.extension}`), bytes, {
      mode: 0o600,
      flag: "wx",
    });
    if (text !== undefined)
      await writeFile(join(directory, `${id}.txt`), text, { mode: 0o600, flag: "wx" });
    await this.db.put(owner, "files", artifact);
    this.index.schedule(owner, artifact);
    return this.signed(owner, artifact);
  }
  /** Chromium HTML-to-PDF function when the browser worker is configured. */
  get renderHtml(): RenderHtml | undefined {
    const renderer = this.renderer;
    return renderer?.available ? (html) => renderer.render(html) : undefined;
  }
  /** Render a Persian HTML fragment (see pdf-html.ts) to a new PDF in Files. */
  async createPdf(owner: string, name: string, html: string, source: string, title = name) {
    if (!this.renderer?.available)
      throw new AppError(
        "ساخت PDF فارسی به سرویس مرورگر نیاز دارد و این سرویس روی سرور فعال نیست. از مدیر سرور بخواهید آن را راه‌اندازی کند.",
        503,
      );
    const bytes = await this.renderer.render(html, { title });
    const base =
      name
        .replace(/\.pdf$/i, "")
        .replace(/[\\/:*?"<>|]+/g, " ")
        .trim() || "سند";
    return this.import(owner, `${base.slice(0, 150)}.pdf`, bytes, source);
  }
  signed(owner: string, file: Artifact): Artifact {
    return { ...file, url: this.auth.sign(owner, `/api/files/${file.id}/content`) };
  }
  async list(owner: string) {
    return (await this.db.list<Artifact>(owner, "files")).map((file) => this.signed(owner, file));
  }
  async get(owner: string, id: string) {
    const file = await this.db.get<Artifact>(owner, "files", id);
    if (!file) throw new AppError("فایل پیدا نشد", 404);
    return file;
  }
  async bytes(owner: string, id: string) {
    const file = await this.get(owner, id);
    return readFile(join(this.config.dataDir, "files", `${id}.${storedExtension(file)}`));
  }
  /** Bytes of an owned PDF; other document types are rejected with a Persian error. */
  async pdfBytes(owner: string, id: string) {
    const file = await this.get(owner, id);
    if (fileKind(file) !== "pdf")
      throw new AppError(`«${file.name}» یک PDF نیست. این کار فقط برای فایل‌های PDF است.`, 422);
    return this.bytes(owner, id);
  }
  /**
   * Full extracted text of any owned file. PDF text is extracted on first use (best effort,
   * empty for scanned PDFs) and cached next to the file.
   */
  async plainText(owner: string, file: Artifact): Promise<string> {
    const path = join(this.config.dataDir, "files", `${file.id}.txt`);
    try {
      return await readFile(path, "utf8");
    } catch {
      if (fileKind(file) !== "pdf") return "";
    }
    const { text } = await extractPdfText(await this.bytes(owner, file.id));
    await writeFile(path, text, { mode: 0o600, flag: "wx" }).catch(() => undefined);
    return text;
  }
  /** Extracted plain text of a file (PDFs: best-effort text layer plus form fields). */
  async text(owner: string, id: string, offset = 0, limit = 30_000) {
    const file = await this.get(owner, id);
    const kind = fileKind(file);
    if (kind in IMAGE_TYPES)
      return {
        id: file.id,
        name: file.name,
        kind,
        text: "",
        note: "This is an image. Use extract_from_image with this file ID to describe it or read its text.",
      };
    const pdfText = kind === "pdf" ? await this.plainText(owner, file).catch(() => "") : "";
    if (kind === "pdf" && !pdfText)
      return {
        id: file.id,
        name: file.name,
        kind,
        pageCount: file.pageCount,
        fields: file.fields,
        text: "",
        note: "This PDF has no readable text layer (it may be scanned); use the listed form fields.",
      };
    const all =
      kind === "pdf"
        ? pdfText
        : await readFile(join(this.config.dataDir, "files", `${id}.txt`), "utf8");
    const start = Math.max(0, Math.min(offset, all.length));
    const text = all.slice(start, start + Math.max(1, Math.min(limit, 100_000)));
    return {
      id: file.id,
      name: file.name,
      kind,
      parts: file.pageCount,
      offset: start,
      totalChars: all.length,
      text,
      more: start + text.length < all.length,
      sourceTruncated: !!file.textTruncated,
    };
  }
  async fill(owner: string, id: string, values: Record<string, string | boolean>) {
    const file = await this.get(owner, id);
    const bytes = await this.pdfBytes(owner, id);
    const output = await fillPdf(bytes, values, { renderHtml: this.renderHtml });
    return this.import(
      owner,
      `${file.name.replace(/\.pdf$/i, "")} (تکمیل‌شده).pdf`,
      output,
      `تکمیل‌شده از ${file.name}`,
      id,
    );
  }
}
