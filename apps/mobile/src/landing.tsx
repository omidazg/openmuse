import {
  CalendarDays,
  Globe2,
  Lightbulb,
  type LucideIcon,
  MessageCircle,
  Target,
  Timer,
} from "lucide-react-native";
import type { ReactNode } from "react";
import { ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { BRAND } from "../../../packages/domain/src/brand";
import { faDigits, fw } from "./locale";
import { colors, Mascot, s } from "./ui";

/** The app logo; same geometry as assets/brand/logo.svg (keep them in sync). */
export function Logo({ size = 64 }: { size?: number }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      accessibilityLabel={`نشان ${BRAND.nameFa}`}
    >
      <Defs>
        <LinearGradient id="dg-tile" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#4AA6F0" />
          <Stop offset="1" stopColor="#1463B8" />
        </LinearGradient>
        <LinearGradient id="dg-spark" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#E3A96E" />
          <Stop offset="1" stopColor="#B8733C" />
        </LinearGradient>
      </Defs>
      <Rect width={1024} height={1024} rx={232} fill="url(#dg-tile)" />
      <Path
        transform="translate(0 30)"
        fill="#FFFFFF"
        d="M412 236h200c110 0 190 86 190 196v38c0 70-34 128-86 162l60 88c6 9-3 20-13 16l-154-46c-2 0-4 0-6 0H412c-105 0-190-85-190-190v-74c0-105 85-190 190-190z"
      />
      <Path
        transform="translate(0 30)"
        fill="url(#dg-spark)"
        d="M512 306C524 400 558 434 652 446C558 458 524 492 512 586C500 492 466 458 372 446C466 434 500 400 512 306Z"
      />
      <Path
        transform="translate(0 30)"
        fill="#3D9BEA"
        d="M672 290C676 318 686 328 714 332C686 336 676 346 672 374C668 346 658 336 630 332C658 328 668 318 672 290Z"
      />
    </Svg>
  );
}

const features: { icon: LucideIcon; title: string; detail: string; tint: keyof typeof colors }[] = [
  {
    icon: MessageCircle,
    title: "گفت‌وگوی فارسی با هوش مصنوعی",
    detail: "سؤال بپرسید، متن بنویسید یا ایده بگیرید؛ به زبان خودتان و با پاسخ‌های روان فارسی.",
    tint: "sky",
  },
  {
    icon: Timer,
    title: "انجام کار در پس‌زمینه",
    detail:
      "کارهای طولانی را بسپارید و سراغ کارتان بروید؛ دستیار ادامه می‌دهد و نتیجه را خبر می‌دهد.",
    tint: "green",
  },
  {
    icon: Globe2,
    title: "مرور وب",
    detail: "صفحه‌های وب را می‌خواند، خلاصه می‌کند و آنچه لازم دارید پیدا می‌کند.",
    tint: "lavender",
  },
  {
    icon: CalendarDays,
    title: "برنامه‌ریزی روزانه",
    detail: "رویدادها و یادآوری‌ها با تاریخ شمسی، یک‌جا؛ تا روزتان مرتب‌تر پیش برود.",
    tint: "orange",
  },
  {
    icon: Target,
    title: "اهداف",
    detail: "هدف‌های بلندمدت را ثبت کنید و قدم‌های بعدی را همراه دستیار بردارید.",
    tint: "sky",
  },
  {
    icon: Lightbulb,
    title: "ایده‌ها و پیگیری‌ها",
    detail: "پیشنهادهای کاربردی متناسب با کارهایتان، و خبر از تغییر صفحه‌هایی که دنبال می‌کنید.",
    tint: "green",
  },
];

const steps = [
  {
    title: "کلید دسترسی را وارد کنید",
    detail: "کلید را از مدیر سرویس بگیرید و فضای کار شخصی خود را باز کنید.",
  },
  {
    title: "درخواستتان را بنویسید",
    detail: "هر کاری دارید به فارسی بگویید؛ از یک سؤال ساده تا یک کار چندمرحله‌ای.",
  },
  {
    title: "نتیجه را بگیرید",
    detail: "پاسخ را همان‌جا ببینید، یا بگذارید کار در پس‌زمینه انجام شود و بعد خبرتان کند.",
  },
];

/**
 * Public landing shown before sign-in: hero, features and how it works, with the
 * sign-in card (passed as children) beside the hero on wide screens and under it on phones.
 */
export function Landing({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const gutter = width < 480 ? 16 : 24;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingTop: wide ? 56 : 28,
          paddingBottom: 40,
          alignItems: "center",
        }}
      >
        <View style={{ width: "100%", maxWidth: 1080, gap: wide ? 64 : 40 }}>
          <View
            style={{
              flexDirection: wide ? "row" : "column",
              alignItems: wide ? "center" : "stretch",
              gap: wide ? 56 : 28,
            }}
          >
            <View style={{ flex: wide ? 1 : undefined, gap: 18 }}>
              <View style={[s.row, { gap: 14 }]}>
                <Logo size={wide ? 72 : 60} />
                <View style={{ flexShrink: 1 }}>
                  <Text
                    accessibilityRole="header"
                    style={{
                      color: colors.text,
                      fontSize: wide ? 40 : 30,
                      lineHeight: wide ? 56 : 44,
                      ...fw("800"),
                    }}
                  >
                    {BRAND.nameFa}
                  </Text>
                  <Text style={[s.label, { color: colors.blueDark, fontSize: 13, lineHeight: 20 }]}>
                    دستیار هوش مصنوعی فارسی
                  </Text>
                </View>
              </View>
              <Text
                style={{
                  color: colors.text,
                  fontSize: wide ? 24 : 20,
                  lineHeight: wide ? 40 : 34,
                  ...fw("600"),
                }}
              >
                {BRAND.tagline}.
              </Text>
              <Text style={[s.muted, { fontSize: 16, lineHeight: 29, maxWidth: 560 }]}>
                گفت‌وگو کنید، کار بسپارید و روزتان را برنامه‌ریزی کنید. {BRAND.nameFa} به فارسی
                می‌فهمد، به فارسی پاسخ می‌دهد و کارهای طولانی را حتی وقتی برنامه بسته است ادامه می‌دهد.
              </Text>
            </View>
            <View
              nativeID="login"
              style={{
                width: "100%",
                maxWidth: wide ? 420 : undefined,
                alignSelf: "center",
                alignItems: "center",
                gap: 14,
              }}
            >
              {children}
            </View>
          </View>

          <View style={{ gap: 18 }}>
            <Text accessibilityRole="header" style={s.title}>
              چه کارهایی از دستیار برمی‌آید؟
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
              {features.map((item) => (
                <View
                  key={item.title}
                  style={[
                    s.card,
                    {
                      flexGrow: 1,
                      flexBasis: wide ? 300 : 260,
                      borderWidth: 1,
                      borderColor: colors.line,
                      gap: 10,
                    },
                  ]}
                >
                  <View style={[s.iconBox, { backgroundColor: colors[item.tint] }]}>
                    <item.icon size={20} strokeWidth={1.8} color={colors.blueDark} />
                  </View>
                  <Text style={s.heading}>{item.title}</Text>
                  <Text style={s.muted}>{item.detail}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={{ gap: 18 }}>
            <View style={[s.row, { gap: 10 }]}>
              <Mascot size={44} />
              <Text accessibilityRole="header" style={s.title}>
                چطور کار می‌کند؟
              </Text>
            </View>
            <View style={{ flexDirection: wide ? "row" : "column", gap: 14 }}>
              {steps.map((step, index) => (
                <View key={step.title} style={[s.row, { flex: wide ? 1 : undefined, gap: 14 }]}>
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      backgroundColor: colors.blue,
                      alignItems: "center",
                      justifyContent: "center",
                      alignSelf: "flex-start",
                    }}
                  >
                    <Text
                      style={{ color: colors.text, fontSize: 16, lineHeight: 24, ...fw("700") }}
                    >
                      {faDigits(index + 1)}
                    </Text>
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={s.heading}>{step.title}</Text>
                    <Text style={s.muted}>{step.detail}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>

          <View style={{ borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 18 }}>
            <Text style={[s.small, { textAlign: "center" }]}>
              {BRAND.nameFa} بر پایهٔ پروژهٔ متن‌باز OpenMuse از CopilotKit ساخته شده است.
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
