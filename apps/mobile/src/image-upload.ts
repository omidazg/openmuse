/**
 * The vision models accept JPG, PNG and WebP but not HEIC (the iPhone camera default). Browsers
 * that can decode HEIC (Safari) convert it to JPEG here before uploading; elsewhere the file is
 * sent as-is and the server answers with a Persian message asking for JPG or PNG.
 */
export async function prepareUpload(file: File): Promise<File> {
  const heic = /^image\/hei[cf]$/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
  if (!heic || typeof document === "undefined" || typeof createImageBitmap !== "function")
    return file;
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
    if (!blob) return file;
    return new File([blob], `${file.name.replace(/\.(heic|heif)$/i, "")}.jpg`, {
      type: "image/jpeg",
    });
  } catch {
    return file;
  }
}
