import { colors } from "./theme";

export default function BrowserConsole({ url }: { url: string }) {
  return (
    <iframe
      title="کنسول نشست مرورگر راه‌دور"
      src={url}
      style={{ height: 540, width: "100%", border: 0, borderRadius: 12, background: colors.card }}
    />
  );
}
