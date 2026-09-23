import * as FileSystem from "expo-file-system/legacy";
import type { Artifact } from "../../../packages/domain/src";
import { API_URL, type MuseApi } from "./api";
import { uploadFailure, uploadPercent } from "./composer-files";
import { uploadMimeType } from "./file-kind";
import { expired } from "./session-errors";

/** A file to upload: a browser File/Blob on web, or a local file URI on native. */
export type UploadSource =
  | { kind: "web"; file: Blob; name: string }
  | { kind: "native"; uri: string; name: string; mimeType?: string | null };

export type UploadHandle = {
  promise: Promise<Artifact>;
  cancel: () => void;
};

export class UploadCancelled extends Error {
  constructor() {
    super("بارگذاری لغو شد");
    this.name = "UploadCancelled";
  }
}

function settle(status: number, body: string): Artifact {
  if (status === 401) {
    let message: unknown;
    try {
      message = JSON.parse(body)?.error;
    } catch {}
    expired(message);
  }
  if (status < 200 || status >= 300) throw new Error(uploadFailure(status, body));
  try {
    return JSON.parse(body) as Artifact;
  } catch {
    throw new Error("پاسخ سرور خوانده نشد. دوباره تلاش کنید.");
  }
}

/**
 * Upload one document to /api/files. `onProgress` receives a whole percent, or undefined when
 * the platform cannot report progress (the chip then shows an indeterminate indicator).
 * Web uses XMLHttpRequest for upload progress; native uses expo-file-system's upload task.
 */
export function startUpload(
  api: MuseApi,
  source: UploadSource,
  onProgress: (percent: number | undefined) => void,
): UploadHandle {
  const url = `${API_URL}/api/files`;
  if (source.kind === "web") {
    const xhr = new XMLHttpRequest();
    let cancelled = false;
    const promise = new Promise<Artifact>((resolve, reject) => {
      xhr.open("POST", url);
      xhr.setRequestHeader("Authorization", `Bearer ${api.token}`);
      xhr.upload.onprogress = (event) =>
        onProgress(event.lengthComputable ? uploadPercent(event.loaded, event.total) : undefined);
      xhr.onload = () => {
        try {
          resolve(settle(xhr.status, xhr.responseText));
        } catch (e) {
          reject(e);
        }
      };
      xhr.onerror = () => reject(new Error(uploadFailure(0, "")));
      xhr.onabort = () => reject(new UploadCancelled());
      const form = new FormData();
      form.append("file", source.file, source.name);
      xhr.send(form);
    });
    return {
      promise,
      cancel: () => {
        if (cancelled) return;
        cancelled = true;
        xhr.abort();
      },
    };
  }
  let cancelled = false;
  const task = FileSystem.createUploadTask(
    url,
    source.uri,
    {
      httpMethod: "POST",
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: "file",
      mimeType: uploadMimeType(source.name, source.mimeType),
      headers: { Authorization: `Bearer ${api.token}` },
    },
    ({ totalBytesSent, totalBytesExpectedToSend }) =>
      onProgress(uploadPercent(totalBytesSent, totalBytesExpectedToSend)),
  );
  const promise = (async () => {
    let result: FileSystem.FileSystemUploadResult | null | undefined;
    try {
      result = await task.uploadAsync();
    } catch {
      if (cancelled) throw new UploadCancelled();
      throw new Error(uploadFailure(0, ""));
    }
    if (cancelled || !result) throw new UploadCancelled();
    return settle(result.status, result.body);
  })();
  return {
    promise,
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      void task.cancelAsync().catch(() => {});
    },
  };
}
