import { Link2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { BRAND } from "../../../packages/domain/src/brand";
import { faDate } from "./locale";
import { Button, colors, ErrorNotice, s } from "./ui";
import { useWorkspace } from "./workspace";

type Platform = "bale" | "telegram";
interface LinkedChat {
  id: string;
  platform: Platform;
  name?: string;
  linkedAt: string;
}
const platformName: Record<Platform, string> = { bale: "بله", telegram: "تلگرام" };

/** «اتصال به بله/تلگرام»: one-time link code for the messenger bot and the linked chats. */
export function MessengerLinkPanel() {
  const { api, notify } = useWorkspace();
  const [code, setCode] = useState<string>();
  const [links, setLinks] = useState<LinkedChat[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    setLinks(await api.request<LinkedChat[]>("/api/bot/links"));
  }
  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const getCode = () =>
    run(async () => {
      const result = await api.request<{ code: string; expiresAt: string }>(
        "/api/bot/link-code",
        {},
      );
      setCode(result.code);
    });
  const unlink = (link: LinkedChat) =>
    run(async () => {
      await api.request(`/api/bot/links/${encodeURIComponent(link.id)}`, undefined, "DELETE");
      await load();
      notify(`اتصال ${platformName[link.platform]} قطع شد.`);
    });
  return (
    <View style={{ gap: 16 }}>
      <Text style={s.muted}>
        در بله یا تلگرام با دستیارتان گفت‌وگو کنید و نتیجهٔ کارهای پس‌زمینه را همان‌جا بگیرید. ربات
        {` ${BRAND.nameFa} `}را در پیام‌رسان باز کنید، کد اتصال بگیرید و آن را برای ربات بفرستید.
      </Text>
      <Button busy={busy} primary icon={Link2} onPress={() => void getCode()}>
        دریافت کد اتصال
      </Button>
      {code && (
        <View style={{ gap: 8, padding: 16, borderRadius: 18, backgroundColor: colors.sky }}>
          <Text style={s.text}>این کد را برای ربات بفرستید:</Text>
          <Text
            selectable
            accessibilityLabel={`فرمان اتصال با کد ${code}`}
            style={[
              s.heading,
              { fontSize: 22, lineHeight: 34, writingDirection: "ltr", textAlign: "center" },
            ]}
          >
            /link {code}
          </Text>
          <Text style={s.small}>این کد ده دقیقه معتبر است و فقط یک بار کار می‌کند.</Text>
        </View>
      )}
      <ErrorNotice error={error} />
      <View style={{ gap: 8 }}>
        <Text style={s.label}>گفت‌وگوهای متصل</Text>
        {links.length ? (
          links.map((link) => (
            <View
              key={link.id}
              style={[
                s.between,
                { gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.line },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.text}>
                  {platformName[link.platform]}
                  {link.name ? ` · ${link.name}` : ""}
                </Text>
                <Text style={s.small}>متصل از {faDate(link.linkedAt)}</Text>
              </View>
              <Button small danger busy={busy} onPress={() => void unlink(link)}>
                {`قطع اتصال ${platformName[link.platform]}`}
              </Button>
            </View>
          ))
        ) : (
          <Text style={s.muted}>
            هنوز گفت‌وگویی متصل نشده است. کد اتصال بگیرید و آن را برای ربات بفرستید.
          </Text>
        )}
      </View>
      <Text style={s.small}>
        اگر ربات پاسخ نمی‌دهد، مدیر سرور باید توکن ربات بله یا تلگرام را روی سرور تنظیم کند.
      </Text>
    </View>
  );
}
