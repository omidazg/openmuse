import type { Artifact } from "../../../packages/domain/src";
import { faNumber } from "./locale";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const IMAGE_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

/** MIME types offered by the document picker: PDF, Word, Excel, CSV and photos. */
export const DOCUMENT_PICKER_TYPES = [
  "application/pdf",
  DOCX,
  XLSX,
  "text/csv",
  "text/comma-separated-values",
  // Windows reports .csv files as this legacy Excel type.
  "application/vnd.ms-excel",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];

/** Upload MIME type from the picker, falling back to the file extension. */
export function uploadMimeType(name: string, mimeType?: string | null): string {
  if (mimeType && mimeType !== "application/octet-stream") return mimeType;
  const extension = name.toLowerCase().split(".").at(-1);
  if (extension === "docx") return DOCX;
  if (extension === "xlsx") return XLSX;
  if (extension === "csv") return "text/csv";
  if (extension && IMAGE_TYPES[extension]) return IMAGE_TYPES[extension];
  return "application/pdf";
}

export function isPdf(file: Pick<Artifact, "mimeType">): boolean {
  return file.mimeType === "application/pdf";
}

export function isImage(file: Pick<Artifact, "mimeType">): boolean {
  return file.mimeType.startsWith("image/");
}

/** Short type badge; product names stay as they are. */
export function fileKindLabel(file: Pick<Artifact, "mimeType">): string {
  if (file.mimeType === "image/png") return "PNG";
  if (file.mimeType === "image/webp") return "WebP";
  if (isImage(file)) return "JPG";
  if (file.mimeType === DOCX) return "Word";
  if (file.mimeType === XLSX) return "Excel";
  if (file.mimeType === "text/csv") return "CSV";
  return "PDF";
}

/** «۳ صفحه»، «۲ برگه» or «۱٬۲۰۰ نویسه» for a file card. */
export function fileExtent(file: Artifact): string {
  if (isPdf(file)) return `${faNumber(file.pageCount)} صفحه`;
  if (isImage(file)) return "تصویر";
  if (file.mimeType === XLSX) return `${faNumber(file.pageCount)} برگه`;
  return `${faNumber(file.textLength ?? 0)} نویسه`;
}
