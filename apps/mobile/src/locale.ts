import {
  Vazirmatn_300Light,
  Vazirmatn_400Regular,
  Vazirmatn_500Medium,
  Vazirmatn_600SemiBold,
  Vazirmatn_700Bold,
  Vazirmatn_800ExtraBold,
} from "@expo-google-fonts/vazirmatn";
import { useFonts } from "expo-font";
import { I18nManager, Platform, type TextStyle } from "react-native";
import { themeCss } from "./theme";

/** Display locale for user-facing dates and numbers. Machine formats keep "en-US". */
export const LOCALE = "fa-IR";

const faces = {
  "300": "Vazirmatn_300Light",
  "400": "Vazirmatn_400Regular",
  "500": "Vazirmatn_500Medium",
  "600": "Vazirmatn_600SemiBold",
  "700": "Vazirmatn_700Bold",
  "800": "Vazirmatn_800ExtraBold",
} as const;
type Weight = keyof typeof faces;

export const FONT = faces["400"];

/**
 * Vazirmatn weight. Each weight is its own family, so this replaces `fontWeight`
 * (a custom family plus fontWeight would be faux-bolded on web and ignored on Android).
 */
export function fw(weight: Weight | "normal" | "bold" = "400"): Pick<TextStyle, "fontFamily"> {
  const key = weight === "normal" ? "400" : weight === "bold" ? "700" : weight;
  return { fontFamily: faces[key] };
}

/** Load Vazirmatn before first paint; resolves to true on error so the app still renders. */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({
    [faces["300"]]: Vazirmatn_300Light,
    [faces["400"]]: Vazirmatn_400Regular,
    [faces["500"]]: Vazirmatn_500Medium,
    [faces["600"]]: Vazirmatn_600SemiBold,
    [faces["700"]]: Vazirmatn_700Bold,
    [faces["800"]]: Vazirmatn_800ExtraBold,
  });
  return loaded || !!error;
}

/** Persian digits for display: 1234 → ۱٬۲۳۴. */
export function faNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(LOCALE, options).format(value);
}

/** Replace ASCII digits inside a display string with Persian digits. */
export function faDigits(text: string | number): string {
  return String(text).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

/** Normalize Persian (۰–۹) and Arabic-Indic (٠–٩) digits typed by the user to ASCII before validation. */
export function toLatinDigits(text: string): string {
  return text
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** Jalali (Solar Hijri) date for display, e.g. «۲۹ شهریور ۱۴۰۵». */
export function faDate(
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions = { dateStyle: "long" },
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(`${LOCALE}-u-ca-persian`, options).format(date);
}

/** Jalali date and 24-hour time: «۲۹ شهریور ۱۴۰۵، ساعت ۱۴:۳۰». */
export function faDateTime(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  const time = new Intl.DateTimeFormat(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${faDate(date)}، ساعت ${time}`;
}

/** Money in Toman, unit after the number: «۱۲٬۴۵۰٬۰۰۰ تومان». Real foreign amounts use their own unit name after the number. */
export function faMoney(amount: number, unit = "تومان"): string {
  return `${faNumber(amount)} ${unit}`;
}

/** Right-to-left layout and (on web) the light/dark color variables for the whole app. Called once from index.js. */
export function applyRtl(): void {
  if (Platform.OS === "web") {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.dir = "rtl";
    root.lang = "fa";
    if (!document.getElementById("openmuse-fa")) {
      const style = document.createElement("style");
      style.id = "openmuse-fa";
      // Beats react-native-web's atomic font classes, but inline styles (e.g. monospace) still win.
      style.textContent = `html body, html body :where(div, span, input, textarea, button, a) {
  font-family: ${FONT}, Vazirmatn, Tahoma, sans-serif;
}
${themeCss()}`;
      document.head.appendChild(style);
    }
    return;
  }
  I18nManager.allowRTL(true);
  if (!I18nManager.isRTL) I18nManager.forceRTL(true);
}
