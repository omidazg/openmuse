import { Copy, ScanText } from "lucide-react-native";
import { useState } from "react";
import { Platform, Share, Text, View } from "react-native";
import type { Artifact } from "../../../packages/domain/src";
import type { MuseApi } from "./api";
import { isImage } from "./file-kind";
import { useServerFeatures } from "./server-features";
import { Button, Card, ErrorNotice, s } from "./ui";

/** Copies on web; on phones opens the share sheet, which offers «Copy». */
async function copyText(text: string) {
  if (Platform.OS === "web" && globalThis.navigator?.clipboard) {
    await globalThis.navigator.clipboard.writeText(text);
    return true;
  }
  await Share.share({ message: text });
  return false;
}

/** «استخراج متن از تصویر» for photos and scanned PDFs, with a copy button for the result. */
export function OcrCard({ api, file }: { api: MuseApi; file: Artifact }) {
  const features = useServerFeatures();
  const [text, setText] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  if (!features?.visionEnabled) return null;
  const image = isImage(file);

  async function extract() {
    setBusy(true);
    setError("");
    try {
      const result = await api.request<{ text: string }>(`/api/files/${file.id}/ocr`, {});
      setText(result.text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    if (!text) return;
    setError("");
    try {
      setCopied(await copyText(text));
    } catch {
      setError("کپی متن انجام نشد. متن را انتخاب کنید و دستی کپی کنید.");
    }
  }

  return (
    <Card style={{ gap: 12 }}>
      <Text style={s.heading}>{image ? "متن تصویر" : "متن PDF اسکن‌شده"}</Text>
      {text === undefined ? (
        <>
          <Text style={s.muted}>
            {image
              ? "متن این تصویر، از جمله دست‌نوشته، فاکتور یا کارت ویزیت، استخراج می‌شود تا بتوانید آن را کپی کنید."
              : "اگر این PDF اسکن‌شده است و متن آن انتخاب نمی‌شود، متن صفحه‌ها را از تصویرشان استخراج کنید."}
          </Text>
          <Button
            icon={ScanText}
            busy={busy}
            onPress={() => void extract()}
            style={{ alignSelf: "flex-start" }}
          >
            استخراج متن از تصویر
          </Button>
        </>
      ) : (
        <>
          <Text
            selectable
            style={[s.text, { textAlign: "auto", writingDirection: "auto", lineHeight: 28 }]}
          >
            {text}
          </Text>
          <View style={[s.row, { gap: 10 }]}>
            <Button small icon={Copy} onPress={() => void copy()}>
              {copied ? "کپی شد" : "کپی متن"}
            </Button>
          </View>
        </>
      )}
      <ErrorNotice error={error} />
    </Card>
  );
}
