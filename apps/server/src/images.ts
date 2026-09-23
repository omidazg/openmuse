/**
 * Photo uploads (receipts, business cards, handwritten notes, screenshots). Only formats every
 * vision model on the gateway accepts are stored; HEIC is recognised so the user gets a clear
 * Persian message (the web app converts HEIC to JPEG in the browser before uploading when it can).
 */
export type ImageKind = "jpg" | "png" | "webp";

export const IMAGE_TYPES: Record<ImageKind, { mimeType: string; extension: string }> = {
  jpg: { mimeType: "image/jpeg", extension: "jpg" },
  png: { mimeType: "image/png", extension: "png" },
  webp: { mimeType: "image/webp", extension: "webp" },
};

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  Buffer.from(bytes.subarray(start, start + length)).toString("latin1");

/** Identify a supported image from its magic bytes (never from the name or claimed type). */
export function detectImageKind(bytes: Uint8Array): ImageKind | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "jpg";
  if (ascii(bytes, 0, 8) === "\x89PNG\r\n\x1a\n") return "png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "webp";
  return undefined;
}

/** HEIC/HEIF photos (iPhone camera default), which the vision models do not accept. */
export function isHeic(bytes: Uint8Array): boolean {
  return (
    ascii(bytes, 4, 4) === "ftyp" &&
    /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(ascii(bytes, 8, 4))
  );
}

const imageKindByMime = new Map(
  Object.entries(IMAGE_TYPES).map(([kind, type]) => [type.mimeType, kind as ImageKind]),
);

export function imageKindOf(mimeType: string): ImageKind | undefined {
  return imageKindByMime.get(mimeType);
}
