import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Copy, FileText, Link2, Share2 } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Share, Text, View } from "react-native";
import { BRAND } from "../../../packages/domain/src/brand";
import { API_URL, type MuseApi } from "./api";
import { faDateTime, faDigits, fw } from "./locale";
import { useMuseThread } from "./threads";
import { Button, colors, ErrorNotice, relativeDate, Sheet, s } from "./ui";
import { useWorkspace } from "./workspace";

/** A read-only share link as returned by /api/shares. */
export type ShareLink = {
  id: string;
  threadId: string;
  messageId: string | null;
  title: string;
  messageCount: number;
  path: string;
  createdAt: string;
  expiresAt: string | null;
  expired: boolean;
};

const EXPIRY: { days: number | null; label: string }[] = [
  { days: null, label: "بدون انقضا" },
  { days: 1, label: "یک روز" },
  { days: 7, label: "یک هفته" },
  { days: 30, label: "یک ماه" },
];

/**
 * Server-side id of the saved history for a chat selection: local threads use their own id,
 * the single sample conversation is "default". Rich Threads live in CopilotKit Intelligence,
 * so they cannot be exported or shared from this server (undefined).
 */
export function useShareThreadId(selectionId: string): string | undefined {
  const { backend } = useMuseThread();
  return backend === "local" ? selectionId : backend === "off" ? "default" : undefined;
}

async function download(api: MuseApi, path: string, fallbackName: string) {
  const url = api.url(path);
  if (Platform.OS === "web") {
    let response: Response;
    try {
      response = await fetch(url, { headers: { Authorization: `Bearer ${api.token}` } });
    } catch {
      throw new Error(
        `اتصال به سرور ${BRAND.nameFa} برقرار نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.`,
      );
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(
        typeof payload?.error === "string"
          ? payload.error
          : `دانلود انجام نشد (کد ${faDigits(response.status)}). دوباره تلاش کنید.`,
      );
    }
    const encoded = /filename\*=UTF-8''([^;]+)/.exec(
      response.headers.get("content-disposition") ?? "",
    )?.[1];
    const name = encoded ? decodeURIComponent(encoded) : fallbackName;
    const href = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
    return;
  }
  const target = `${FileSystem.cacheDirectory}${fallbackName}`;
  const result = await FileSystem.downloadAsync(url, target, {
    headers: { Authorization: `Bearer ${api.token}` },
  });
  if (result.status !== 200)
    throw new Error(`دانلود انجام نشد (کد ${faDigits(result.status)}). دوباره تلاش کنید.`);
  if (!(await Sharing.isAvailableAsync()))
    throw new Error(
      `ذخیرهٔ فایل در این دستگاه پشتیبانی نمی‌شود. فایل را از نسخهٔ وب ${BRAND.nameFa} دانلود کنید.`,
    );
  await Sharing.shareAsync(target, {
    mimeType: result.headers["content-type"] || result.headers["Content-Type"],
  });
}

/** Copies the link on web; opens the system share sheet on phones. Returns a short notice. */
async function passLink(url: string): Promise<string> {
  if (Platform.OS === "web") {
    await navigator.clipboard.writeText(url);
    return "پیوند رونوشت شد";
  }
  await Share.share({ message: url });
  return "";
}

function ShareRow({ share, onRevoked }: { share: ShareLink; onRevoked: (id: string) => void }) {
  const { api } = useWorkspace();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const url = `${API_URL}${share.path}`;
  async function revoke() {
    setBusy(true);
    setError("");
    try {
      await api.request(`/api/shares/${encodeURIComponent(share.id)}`, undefined, "DELETE");
      onRevoked(share.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }
  return (
    <View
      style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 8 }}
    >
      <Text style={[s.text, { ...fw("500"), textAlign: "auto", writingDirection: "auto" }]}>
        {share.title}
      </Text>
      <Text style={s.small}>
        {`ساخته‌شده ${relativeDate(share.createdAt)} · ${
          share.expired
            ? "منقضی شده است"
            : share.expiresAt
              ? `معتبر تا ${faDateTime(share.expiresAt)}`
              : "بدون تاریخ انقضا"
        }`}
      </Text>
      {!share.expired && (
        <Text selectable style={[s.small, { writingDirection: "ltr", textAlign: "auto" }]}>
          {url}
        </Text>
      )}
      <ErrorNotice error={error} />
      {!!notice && <Text style={[s.small, { color: colors.text }]}>{notice}</Text>}
      {confirming ? (
        <View style={{ gap: 8 }}>
          <Text style={s.heading}>پیوند لغو شود؟</Text>
          <Text style={s.muted}>هر کسی که این پیوند را دارد، دیگر نمی‌تواند گفت‌وگو را ببیند.</Text>
          <View style={[s.row, { gap: 8 }]}>
            <Button small danger busy={busy} onPress={() => void revoke()}>
              لغو پیوند
            </Button>
            <Button small disabled={busy} onPress={() => setConfirming(false)}>
              انصراف
            </Button>
          </View>
        </View>
      ) : (
        <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
          {!share.expired && (
            <Button
              small
              icon={Platform.OS === "web" ? Copy : Share2}
              onPress={() =>
                void passLink(url)
                  .then(setNotice)
                  .catch(() =>
                    setError("پیوند رونوشت نشد. آن را از متن بالا انتخاب و رونوشت کنید."),
                  )
              }
            >
              {Platform.OS === "web" ? "رونوشت پیوند" : "اشتراک‌گذاری پیوند"}
            </Button>
          )}
          <Button small danger onPress={() => setConfirming(true)}>
            {share.expired ? "حذف پیوند" : "لغو پیوند"}
          </Button>
        </View>
      )}
    </View>
  );
}

/**
 * Export (PDF, Word) and read-only share links for one conversation or one assistant answer.
 * Without `threadId` it lists every share link the owner has, for review and revoking.
 */
export function ShareSheet({
  threadId,
  messageId,
  onClose,
}: {
  threadId?: string;
  messageId?: string;
  onClose: () => void;
}) {
  const { api } = useWorkspace();
  const [shares, setShares] = useState<ShareLink[]>();
  const [expiry, setExpiry] = useState<number | null>(null);
  const [busy, setBusy] = useState<"pdf" | "docx" | "share" | undefined>();
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const load = useCallback(() => {
    setLoadError("");
    void api
      .request<{ shares: ShareLink[] }>(
        `/api/shares${threadId ? `?threadId=${encodeURIComponent(threadId)}` : ""}`,
      )
      .then((result) =>
        setShares(
          result.shares.filter(
            (share) => !threadId || (share.messageId ?? undefined) === messageId,
          ),
        ),
      )
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [api, threadId, messageId]);
  useEffect(load, [load]);
  async function run(kind: "pdf" | "docx" | "share", action: () => Promise<void>) {
    setBusy(kind);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  }
  const exportPath = (format: "pdf" | "docx") =>
    `/api/threads/${encodeURIComponent(threadId ?? "")}/export?format=${format}${
      messageId ? `&messageId=${encodeURIComponent(messageId)}` : ""
    }`;
  const subject = messageId ? "این پاسخ" : "این گفت‌وگو";
  return (
    <Sheet
      title={
        threadId ? (messageId ? "اشتراک‌گذاری پاسخ" : "خروجی و اشتراک‌گذاری") : "پیوندهای اشتراکی"
      }
      subtitle={
        threadId
          ? `${subject} را به‌صورت فایل دانلود کنید یا با پیوندی خصوصی و فقط‌خواندنی به اشتراک بگذارید.`
          : "پیوندهایی که ساخته‌اید. هر پیوند را می‌توانید هر زمان لغو کنید."
      }
      onClose={onClose}
    >
      <View style={{ gap: 14 }}>
        <ErrorNotice error={error} />
        {threadId && (
          <>
            <Text style={s.heading}>دانلود</Text>
            <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
              <Button
                icon={FileText}
                busy={busy === "pdf"}
                disabled={!!busy}
                onPress={() =>
                  void run("pdf", () => download(api, exportPath("pdf"), "conversation.pdf"))
                }
              >
                دانلود PDF
              </Button>
              <Button
                icon={FileText}
                busy={busy === "docx"}
                disabled={!!busy}
                onPress={() =>
                  void run("docx", () => download(api, exportPath("docx"), "conversation.docx"))
                }
              >
                دانلود Word
              </Button>
            </View>
            <View style={s.divider} />
            <Text style={s.heading}>پیوند فقط‌خواندنی</Text>
            <Text style={s.muted}>
              {`هر کسی که پیوند را داشته باشد، بدون ورود ${subject} را می‌بیند.${messageId ? "" : " پیام‌های بعدی به پیوند اضافه نمی‌شوند."}`}
            </Text>
            <Text style={s.label}>اعتبار پیوند</Text>
            <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
              {EXPIRY.map((option) => (
                <Pressable
                  key={option.label}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: expiry === option.days }}
                  onPress={() => setExpiry(option.days)}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 7,
                    borderRadius: 20,
                    borderWidth: 1,
                    borderColor: expiry === option.days ? colors.blueDark : colors.line,
                    backgroundColor: expiry === option.days ? colors.blue : colors.card,
                  }}
                >
                  <Text style={[s.small, { color: colors.text, ...fw("600") }]}>
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Button
              primary
              icon={Link2}
              busy={busy === "share"}
              disabled={!!busy}
              style={{ alignSelf: "flex-start" }}
              onPress={() =>
                void run("share", async () => {
                  const share = await api.request<ShareLink>("/api/shares", {
                    threadId,
                    ...(messageId ? { messageId } : {}),
                    expiresInDays: expiry,
                  });
                  setShares((items) => [share, ...(items ?? [])]);
                })
              }
            >
              ساخت پیوند
            </Button>
          </>
        )}
        <ErrorNotice error={loadError} />
        {loadError && (
          <Button small onPress={load}>
            تلاش دوباره
          </Button>
        )}
        {!shares && !loadError && <ActivityIndicator color={colors.blueDark} />}
        {shares && shares.length > 0 && (
          <View>
            {threadId && <Text style={s.heading}>پیوندهای ساخته‌شده</Text>}
            {shares.map((share) => (
              <ShareRow
                key={share.id}
                share={share}
                onRevoked={(id) => setShares((items) => items?.filter((item) => item.id !== id))}
              />
            ))}
          </View>
        )}
        {shares && !shares.length && !threadId && (
          <Text style={s.muted}>
            هنوز پیوند اشتراکی ندارید. از منوی گفت‌وگو یا زیر هر پاسخ، «اشتراک‌گذاری» را بزنید.
          </Text>
        )}
      </View>
    </Sheet>
  );
}

/** A small «اشتراک‌گذاری» action under an assistant answer. Hidden for Rich Threads. */
export function AnswerActions({ thread, messageId }: { thread: string; messageId: string }) {
  const threadId = useShareThreadId(thread);
  const [open, setOpen] = useState(false);
  if (!threadId) return null;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="اشتراک‌گذاری یا دانلود این پاسخ"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          s.row,
          {
            alignSelf: "flex-start",
            gap: 6,
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: 14,
            backgroundColor: pressed ? colors.subtle : "transparent",
          },
        ]}
      >
        <Share2 size={14} color={colors.muted} />
        <Text style={s.small}>اشتراک‌گذاری</Text>
      </Pressable>
      {open && (
        <ShareSheet threadId={threadId} messageId={messageId} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
