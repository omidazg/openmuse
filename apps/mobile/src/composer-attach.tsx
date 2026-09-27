import * as DocumentPicker from "expo-document-picker";
import { FileText, Upload, X } from "lucide-react-native";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, type TextInput, View } from "react-native";
import type { Artifact } from "../../../packages/domain/src";
import type { MuseApi } from "./api";
import {
  MAX_UPLOAD_BYTES,
  percentLabel,
  persianDigits,
  SUPPORTED_UPLOADS_LABEL,
  transferFiles,
  uploadProblem,
} from "./composer-files";
import { startUpload, UploadCancelled, type UploadSource } from "./composer-upload";
import { DOCUMENT_PICKER_TYPES } from "./file-kind";
import { fw } from "./locale";
import { colors, s } from "./ui";

export type PendingUpload = {
  id: string;
  name: string;
  /** Whole percent, or undefined while the platform cannot report progress. */
  percent?: number;
  cancel: () => void;
};

/**
 * Uploads started from the composer (picker, drag and drop, paste). Each finished upload is
 * handed to `onUploaded` so the chat can attach it to the next message.
 */
export function useComposerUploads({
  api,
  refresh,
  onUploaded,
}: {
  api: MuseApi;
  refresh: () => Promise<void>;
  onUploaded: (artifact: Artifact) => void;
}) {
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const active = useRef(new Map<string, () => void>());
  useEffect(
    () => () => {
      mounted.current = false;
      for (const cancel of active.current.values()) cancel();
    },
    [],
  );
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;

  const upload = useCallback(
    (source: UploadSource) => {
      const id = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const handle = startUpload(api, source, (percent) => {
        if (mounted.current)
          setUploads((items) =>
            items.map((item) => (item.id === id ? { ...item, percent } : item)),
          );
      });
      active.current.set(id, handle.cancel);
      setUploads((items) => [
        ...items,
        { id, name: source.name, percent: undefined, cancel: handle.cancel },
      ]);
      void handle.promise
        .then(async (artifact) => {
          await refresh().catch(() => {});
          if (mounted.current) onUploadedRef.current(artifact);
        })
        .catch((e) => {
          if (mounted.current && !(e instanceof UploadCancelled))
            setError(
              `«${source.name}» بارگذاری نشد. ${e instanceof Error ? e.message : String(e)}`,
            );
        })
        .finally(() => {
          active.current.delete(id);
          if (mounted.current) setUploads((items) => items.filter((item) => item.id !== id));
        });
    },
    [api, refresh],
  );

  /** Validate browser files (drop or paste) and upload the acceptable ones. */
  const addFiles = useCallback(
    (files: File[]) => {
      const problems: string[] = [];
      for (const file of files) {
        const problem = uploadProblem({ name: file.name, size: file.size, type: file.type });
        if (problem) problems.push(problem);
        else upload({ kind: "web", file, name: file.name });
      }
      setError(problems.join("\n"));
    },
    [upload],
  );

  const pick = useCallback(async () => {
    setError("");
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: DOCUMENT_PICKER_TYPES,
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled) return;
      const problems: string[] = [];
      for (const asset of result.assets) {
        const problem = uploadProblem({
          name: asset.name,
          size: asset.size ?? asset.file?.size,
          type: asset.mimeType ?? undefined,
        });
        if (problem) problems.push(problem);
        else if (Platform.OS === "web") {
          if (asset.file) upload({ kind: "web", file: asset.file, name: asset.name });
          else problems.push(`«${asset.name}» خوانده نشد. آن را دوباره انتخاب کنید.`);
        } else
          upload({ kind: "native", uri: asset.uri, name: asset.name, mimeType: asset.mimeType });
      }
      setError(problems.join("\n"));
    } catch (e) {
      setError(`فایل انتخاب نشد. ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [upload]);

  return {
    uploads,
    uploading: uploads.length > 0,
    error,
    clearError: () => setError(""),
    addFiles,
    pick,
  };
}

/** Web only: files dragged over the whole window while the chat is visible. */
export function useWebFileDrop(active: boolean, onFiles: (files: File[]) => void) {
  const [dragging, setDragging] = useState(false);
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;
  useEffect(() => {
    if (Platform.OS !== "web" || !active || typeof window === "undefined") return;
    let depth = 0;
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const over = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      // Without this the browser would navigate away to the dropped file.
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const files = transferFiles(event.dataTransfer);
      if (files.length) onFilesRef.current(files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      setDragging(false);
    };
  }, [active]);
  return dragging;
}

/** Web only: a file or image pasted into the composer is uploaded; pasted text is left alone. */
export function useWebPasteFiles(
  input: RefObject<TextInput | null>,
  onFiles: (files: File[]) => void,
) {
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;
  useEffect(() => {
    if (Platform.OS !== "web") return;
    // On web the TextInput ref is the underlying <textarea>.
    const node = input.current as unknown as HTMLElement | null;
    if (!node?.addEventListener) return;
    const paste = (event: ClipboardEvent) => {
      const files = transferFiles(event.clipboardData);
      if (!files.length) return;
      event.preventDefault();
      onFilesRef.current(files);
    };
    node.addEventListener("paste", paste);
    return () => node.removeEventListener("paste", paste);
  }, [input]);
}

/** Full-area overlay shown while files are dragged over the chat. */
export function DropOverlay() {
  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={{
        position: "absolute",
        top: 8,
        bottom: 8,
        start: 0,
        end: 0,
        zIndex: 20,
        borderRadius: 28,
        borderWidth: 2,
        borderStyle: "dashed",
        borderColor: colors.blueDark,
        backgroundColor: colors.sky,
        opacity: 0.96,
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: 24,
      }}
    >
      <Upload size={34} strokeWidth={1.6} color={colors.blueDark} />
      <Text style={[s.heading, { textAlign: "center" }]}>فایل را اینجا رها کنید</Text>
      <Text style={[s.muted, { textAlign: "center" }]}>
        {SUPPORTED_UPLOADS_LABEL}، حداکثر {persianDigits(MAX_UPLOAD_BYTES / (1024 * 1024))} مگابایت
      </Text>
    </View>
  );
}

/** One chip per upload in flight: name, percentage (or spinner) and «لغو». */
export function UploadChips({ uploads }: { uploads: PendingUpload[] }) {
  if (!uploads.length) return null;
  return (
    <View style={{ gap: 6, paddingHorizontal: 9, paddingTop: 9 }}>
      {uploads.map((upload) => (
        <View
          key={upload.id}
          accessibilityLabel={
            upload.percent === undefined
              ? `در حال بارگذاری ${upload.name}`
              : `در حال بارگذاری ${upload.name}، ${percentLabel(upload.percent)}`
          }
          style={{
            backgroundColor: colors.subtle,
            borderRadius: 16,
            paddingHorizontal: 11,
            paddingVertical: 7,
            gap: 6,
          }}
        >
          <View style={[s.row, { gap: 7 }]}>
            <FileText size={14} color={colors.blueDark} />
            <Text
              numberOfLines={1}
              style={{
                flex: 1,
                fontSize: 12,
                lineHeight: 18,
                color: colors.text,
                ...fw("400"),
              }}
            >
              {upload.name}
            </Text>
            {upload.percent === undefined ? (
              <ActivityIndicator size="small" color={colors.blueDark} />
            ) : (
              <Text style={{ fontSize: 12, lineHeight: 18, color: colors.muted, ...fw("500") }}>
                {percentLabel(upload.percent)}
              </Text>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`لغو بارگذاری ${upload.name}`}
              hitSlop={8}
              onPress={upload.cancel}
              style={[s.row, { gap: 3, paddingHorizontal: 4 }]}
            >
              <X size={13} color={colors.muted} />
              <Text style={{ fontSize: 12, lineHeight: 18, color: colors.muted, ...fw("500") }}>
                لغو
              </Text>
            </Pressable>
          </View>
          <View
            style={{ height: 3, borderRadius: 2, backgroundColor: colors.line, overflow: "hidden" }}
          >
            <View
              style={{
                height: 3,
                width: `${upload.percent ?? 15}%`,
                backgroundColor: colors.blueDark,
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}
