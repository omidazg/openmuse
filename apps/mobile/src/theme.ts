import { Appearance, Platform } from "react-native";

/**
 * Color tokens for light and dark. On web every token is a CSS variable (defined in
 * `themeCss()`, injected by `applyRtl()`), so the page follows `prefers-color-scheme`
 * live or the manual choice in «نمایش». Native reads the system scheme once at startup.
 */
const light = {
  canvas: "#FCFCFC",
  card: "#FFFFFF",
  text: "#11191C",
  muted: "#697176",
  faint: "#A3A6A8",
  line: "#EEEEF0",
  subtle: "#F0F1F2",
  blue: "#C8E7FF",
  blueDark: "#1473C8",
  sky: "#EDF7FD",
  green: "#E3F3E8",
  lavender: "#F0EEFA",
  orange: "#FDF0DF",
  beige: "#F0F0E7",
  success: "#248258",
  danger: "#AA4A45",
  dangerSoft: "#FBEFED",
  shade: "rgba(35,48,44,0.25)",
};
export type ColorToken = keyof typeof light;

const dark: Record<ColorToken, string> = {
  canvas: "#111416",
  card: "#1A1E21",
  text: "#E8ECEE",
  muted: "#9BA4A9",
  faint: "#6E777C",
  line: "#2C3338",
  subtle: "#22282C",
  blue: "#1E4E75",
  blueDark: "#72B8F2",
  sky: "#172A3A",
  green: "#173024",
  lavender: "#25213A",
  orange: "#33271A",
  beige: "#26261E",
  success: "#62C794",
  danger: "#F08C82",
  dangerSoft: "#3A2020",
  shade: "rgba(0,0,0,0.55)",
};

const cssName = (token: string) => `--c-${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

export type ColorScheme = "light" | "dark";

/** The scheme at startup; web switches live through CSS variables. */
export const scheme: ColorScheme = Appearance.getColorScheme() === "dark" ? "dark" : "light";

export const colors: Record<ColorToken, string> =
  Platform.OS === "web"
    ? (Object.fromEntries(
        Object.keys(light).map((token) => [token, `var(${cssName(token)})`]),
      ) as Record<ColorToken, string>)
    : scheme === "dark"
      ? dark
      : light;

const block = (palette: Record<string, string>) =>
  Object.entries(palette)
    .map(([token, value]) => `${cssName(token)}:${value};`)
    .join("");

/** High-contrast palettes for «حالت ساده»: stronger text, borders and accents. */
const highLight: Record<ColorToken, string> = {
  canvas: "#FFFFFF",
  card: "#F1F3F4",
  text: "#000000",
  muted: "#2E3438",
  faint: "#4F565A",
  line: "#5E666B",
  subtle: "#E2E5E7",
  blue: "#A9D6FF",
  blueDark: "#0B4F8A",
  sky: "#DDEEFB",
  green: "#D3EEDC",
  lavender: "#E4E0F7",
  orange: "#FBE3C4",
  beige: "#E7E7D8",
  success: "#13603F",
  danger: "#8A1F1A",
  dangerSoft: "#FBE3E0",
  shade: "rgba(0,0,0,0.5)",
};

const highDark: Record<ColorToken, string> = {
  canvas: "#000000",
  card: "#15191C",
  text: "#FFFFFF",
  muted: "#D3D9DC",
  faint: "#AAB2B6",
  line: "#8A949A",
  subtle: "#262D31",
  blue: "#1B5A8E",
  blueDark: "#A6D4FF",
  sky: "#10263A",
  green: "#0F3322",
  lavender: "#221D3D",
  orange: "#3A2A14",
  beige: "#2A2A1E",
  success: "#86E4B4",
  danger: "#FFA99F",
  dangerSoft: "#45201D",
  shade: "rgba(0,0,0,0.7)",
};

/** Page background for a resolved scheme, for the browser's theme-color meta tag. */
export function canvasColor(isDark: boolean, highContrast: boolean): string {
  if (highContrast) return (isDark ? highDark : highLight).canvas;
  return (isDark ? dark : light).canvas;
}

/**
 * CSS custom properties for every scheme. `data-theme` on <html> pins light or dark
 * (otherwise `prefers-color-scheme` decides, live); `data-contrast="high"` switches to the
 * high-contrast palettes; `data-simple` drops shadows; `data-motion="reduce"` (or the OS
 * setting) removes transitions. `applyDisplay()` in display.tsx sets the attributes.
 */
export function themeCss(): string {
  const auto = ":not([data-theme=light])";
  const still =
    "transition-duration:0s !important;transition-delay:0s !important;scroll-behavior:auto !important;";
  return `:root{${block(light)}color-scheme:light dark;}
@media (prefers-color-scheme: dark){:root${auto}{${block(dark)}}}
:root[data-theme=dark]{${block(dark)}color-scheme:dark;}
:root[data-theme=light]{color-scheme:light;}
:root[data-contrast=high]{${block(highLight)}}
@media (prefers-color-scheme: dark){:root[data-contrast=high]${auto}{${block(highDark)}}}
:root[data-contrast=high][data-theme=dark]{${block(highDark)}}
:root[data-simple] *{box-shadow:none !important;text-shadow:none !important;}
:root[data-motion=reduce] *,:root[data-motion=reduce] *::before,:root[data-motion=reduce] *::after{${still}}
@media (prefers-reduced-motion: reduce){*,*::before,*::after{${still}}}
html,body{background-color:var(--c-canvas);color:var(--c-text);}`;
}
