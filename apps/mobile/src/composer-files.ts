/**
 * Pure helpers for attaching files in the chat composer: validation before upload, progress
 * labels, and turning server/network failures into Persian messages. No React Native imports,
 * so they run under the plain Node test runner.
 */

/** The server rejects documents above 10 MB (apps/server/src/files.ts). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const SUPPORTED_EXTENSIONS = ["pdf", "docx", "xlsx", "csv"];
const SUPPORTED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/comma-separated-values",
  "application/vnd.ms-excel",
];

export const SUPPORTED_UPLOADS_LABEL = "PDF، Word، Excel یا CSV";

export type UploadCandidate = { name: string; size?: number; type?: string };

/** Persian digits for a display string: 42 → ۴۲. */
export function persianDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

function extension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** Why a file cannot be uploaded, in Persian, or undefined when it can. */
export function uploadProblem(file: UploadCandidate): string | undefined {
  const ext = extension(file.name);
  const type = (file.type || "").toLowerCase();
  const supported =
    SUPPORTED_EXTENSIONS.includes(ext) || (!!type && SUPPORTED_TYPES.includes(type) && ext === "");
  if (!supported) {
    if (type.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "heic"].includes(ext))
      return `«${file.name}» تصویر است و پیوست تصویر هنوز پشتیبانی نمی‌شود. یک سند ${SUPPORTED_UPLOADS_LABEL} انتخاب کنید.`;
    return `نوع فایل «${file.name}» پشتیبانی نمی‌شود. یک سند ${SUPPORTED_UPLOADS_LABEL} انتخاب کنید.`;
  }
  if (typeof file.size === "number" && file.size > MAX_UPLOAD_BYTES)
    return `حجم «${file.name}» ${fileSizeLabel(file.size)} است؛ حداکثر ${persianDigits(10)} مگابایت مجاز است. فایل کوچک‌تری انتخاب کنید.`;
  if (file.size === 0) return `«${file.name}» خالی است. فایل دیگری انتخاب کنید.`;
  return undefined;
}

/** «۲٫۴ مگابایت» or «۳۲۰ کیلوبایت». */
export function fileSizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = Math.round((bytes / (1024 * 1024)) * 10) / 10;
    return `${persianDigits(String(mb).replace(".", "٫"))} مگابایت`;
  }
  return `${persianDigits(Math.max(1, Math.round(bytes / 1024)))} کیلوبایت`;
}

/** Whole percent 0–100, or undefined when the total is unknown. */
export function uploadPercent(loaded: number, total: number): number | undefined {
  if (!(total > 0)) return undefined;
  return Math.max(0, Math.min(100, Math.floor((loaded / total) * 100)));
}

/** «۴۲٪»; the percent sign follows the number. */
export function percentLabel(percent: number): string {
  return `${persianDigits(Math.round(percent))}٪`;
}

/** Persian message for a failed upload response. */
export function uploadFailure(status: number, body: string): string {
  let message: unknown;
  try {
    message = JSON.parse(body)?.error;
  } catch {}
  if (typeof message === "string" && message) return message;
  if (status === 413)
    return `فایل خیلی بزرگ است؛ حداکثر ${persianDigits(10)} مگابایت مجاز است. فایل کوچک‌تری انتخاب کنید.`;
  if (status === 0)
    return "اتصال به سرور برقرار نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.";
  return `بارگذاری انجام نشد (کد ${persianDigits(status)}). دوباره تلاش کنید.`;
}

/** Files carried by a drag or paste event: real files only, never plain text. */
export function transferFiles(
  data: { files?: ArrayLike<File> | null; items?: ArrayLike<DataTransferItem> | null } | null,
): File[] {
  if (!data) return [];
  const files = Array.from(data.files ?? []);
  if (files.length) return files;
  return Array.from(data.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => !!file);
}
