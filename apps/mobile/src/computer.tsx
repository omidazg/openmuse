import {
  FileText,
  FolderOpen,
  Globe2,
  Monitor,
  Plus,
  RefreshCw,
  Terminal,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { AppState, Image, Pressable, Text, View } from "react-native";
import type { BrowserSession } from "../../../packages/domain/src";
import { browserAddress } from "./browser-address";
import { useComputerDraft } from "./computer-drafts";
import { LinuxWorkspace } from "./computer-workspace";
import { faNumber, fw } from "./locale";
import { Button, Card, colors, ErrorNotice, Field, LinkRow, Sheet, s } from "./ui";
import { useWorkspace } from "./workspace";

const tabLabels = { Browser: "مرورگر", Terminal: "ترمینال", Files: "فایل‌ها" } as const;
export function ComputerEntry() {
  const { workspace, open } = useWorkspace();
  const available = workspace.connections.some(
    (c) => c.id === "browser" && c.status === "connected",
  );
  const active = workspace.browsers.filter((b) => b.status === "active").length;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="باز کردن رایانهٔ دستیار"
      onPress={() => open({ type: "computer" })}
      style={[
        s.row,
        {
          alignSelf: "center",
          gap: 6,
          paddingHorizontal: 12,
          paddingVertical: 7,
          borderRadius: 20,
          backgroundColor: "#F1F3F4",
        },
      ]}
    >
      <Monitor size={13} color={colors.muted} />
      <Text style={{ fontSize: 12, lineHeight: 18, color: colors.muted, ...fw("400") }}>
        رایانه
        {active ? " · در دست گرفتن کنترل" : available ? " · آماده" : " · آفلاین"}
      </Text>
      <View
        style={{
          width: 5,
          height: 5,
          borderRadius: 3,
          backgroundColor: available ? "#57AD85" : "#ACB0B5",
        }}
      />
    </Pressable>
  );
}
export function BrowserThreadCard({ browser }: { browser: BrowserSession }) {
  const { open } = useWorkspace();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [browser.previewUrl, browser.updatedAt]);
  return (
    <Card
      style={{ padding: 13, backgroundColor: "#EEEEF0", gap: 12, maxWidth: 440, width: "100%" }}
    >
      <View style={[s.row, { gap: 10 }]}>
        <View style={[s.iconBox, { width: 36, height: 36, borderRadius: 9 }]}>
          <Globe2 size={21} color={colors.blueDark} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.text, { ...fw("600") }]}>مرورگر</Text>
          <Text numberOfLines={1} style={s.small}>
            {browser.status === "closed"
              ? "نشست ذخیره شد"
              : browser.status === "error"
                ? "نیاز به بررسی دارد"
                : browser.title}
          </Text>
        </View>
      </View>
      {browser.previewUrl && browser.status === "active" && !failed ? (
        <Image
          accessibilityLabel={`پیش‌نمایش مرورگر: ${browser.title}`}
          source={{ uri: browser.previewUrl }}
          style={{ width: "100%", aspectRatio: 1.6, borderRadius: 11, backgroundColor: "#FFF" }}
          resizeMode="contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <View
          style={{
            padding: 24,
            borderRadius: 12,
            backgroundColor: "#FFF",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Globe2 size={30} color={colors.muted} />
          <Text
            numberOfLines={2}
            style={[s.muted, { textAlign: "center" }, !failed && { writingDirection: "ltr" }]}
          >
            {failed
              ? "پیش‌نمایش در دسترس نیست. برای اتصال دوباره، مرورگر را باز کنید."
              : browser.url}
          </Text>
        </View>
      )}
      <Button onPress={() => open({ type: "browser", browser })}>
        {browser.status === "closed"
          ? "باز کردن دوبارهٔ مرورگر"
          : browser.status === "error"
            ? "اتصال دوبارهٔ مرورگر"
            : "در دست گرفتن کنترل"}
      </Button>
    </Card>
  );
}
export function ComputerSheet() {
  const { workspace, api, refresh, close, open, navigate } = useWorkspace();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useComputerDraft("tab");
  const available = workspace.connections.some(
    (c) => c.id === "browser" && c.status === "connected",
  );
  useEffect(() => {
    let active = true;
    const timer = setInterval(() => {
      if (AppState.currentState !== "active") return;
      void refresh().catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    }, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [refresh]);
  async function create() {
    if (busy || !url.trim()) return;
    setBusy(true);
    setError("");
    try {
      const browser = await api.request<BrowserSession>("/api/browsers", {
        url: browserAddress(url),
      });
      await refresh();
      open({ type: "browser", browser });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title="رایانهٔ دستیار"
      subtitle="دستیارتان اینجا کار می‌کند. هر وقت لازم بود، وارد عمل شوید."
      onClose={close}
    >
      <View style={{ gap: 20 }}>
        {tab === "Browser" && (
          <View
            style={[s.row, { gap: 12, padding: 18, borderRadius: 20, backgroundColor: colors.sky }]}
          >
            <Monitor size={28} color={colors.blueDark} />
            <View style={{ flex: 1 }}>
              <Text style={s.heading}>{available ? "مرورگر متصل است" : "مرورگر آفلاین است"}</Text>
              <Text style={s.muted}>
                {available
                  ? "مرورگر و اسناد دستیارتان، یک‌جا."
                  : "برای اتصال این رایانه، سرویس مرورگر را راه‌اندازی کنید."}
              </Text>
            </View>
          </View>
        )}
        <View style={[s.row, { gap: 8 }]}>
          {(["Browser", "Terminal", "Files"] as const).map((item) => (
            <Button
              key={item}
              primary={tab === item}
              icon={item === "Browser" ? Globe2 : item === "Terminal" ? Terminal : FolderOpen}
              onPress={() => setTab(item)}
            >
              {tabLabels[item]}
            </Button>
          ))}
        </View>
        <View style={{ display: tab === "Browser" ? "none" : "flex" }}>
          <LinuxWorkspace tab={tab === "Files" ? "Files" : "Terminal"} />
        </View>
        <ErrorNotice error={error} />
        {tab === "Browser" ? (
          <>
            <View>
              <Field
                label="نشانی وب‌سایت"
                value={url}
                onChangeText={setUrl}
                placeholder="https://example.com"
                autoCapitalize="none"
                keyboardType="url"
                style={{ writingDirection: "ltr", textAlign: "left" }}
                onSubmitEditing={() => void create()}
              />
              <Button
                primary
                icon={Plus}
                busy={busy}
                disabled={!available || !url.trim()}
                onPress={() => void create()}
              >
                باز کردن نشست مرورگر
              </Button>
            </View>
            {[...workspace.browsers]
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
              .map((browser) => (
                <BrowserThreadCard key={browser.id} browser={browser} />
              ))}
            {!workspace.browsers.length && (
              <Text style={s.muted}>
                صفحه‌ای را اینجا باز کنید یا از دستیارتان بخواهید دربارهٔ چیزی جست‌وجو کند. نشست‌های
                مرور او اینجا نمایش داده می‌شوند.
              </Text>
            )}
            <Text style={s.small}>
              هر نشست مرور، ورودها و دانلودهای خودش را نگه می‌دارد. یکی را باز کنید تا کنترل را در
              دست بگیرید، سپس به گفت‌وگویتان برگردید.
            </Text>
          </>
        ) : tab === "Files" ? (
          <>
            <Text style={s.heading}>اسناد</Text>
            <Text style={s.small}>
              فایل‌های PDF ذخیره‌شده از ایمیل، دانلودهای مرورگر و فایل‌هایی که بارگذاری کرده‌اید.
            </Text>
            {workspace.files.map((file) => (
              <LinkRow
                key={file.id}
                icon={FileText}
                title={file.name}
                detail={`${faNumber(file.pageCount)} صفحه · PDF`}
                onPress={() => open({ type: "file", file })}
              />
            ))}
            <Button
              icon={Plus}
              onPress={() => {
                close();
                navigate("files");
              }}
            >
              افزودن سند
            </Button>
          </>
        ) : null}
        <Button
          small
          icon={RefreshCw}
          onPress={() =>
            void refresh()
              .then(() => setError(""))
              .catch((e) => setError(e instanceof Error ? e.message : String(e)))
          }
        >
          تازه‌سازی رایانه
        </Button>
      </View>
    </Sheet>
  );
}
