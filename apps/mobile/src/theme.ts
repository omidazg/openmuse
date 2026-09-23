import { Appearance, Platform } from "react-native";

/**
 * Color tokens for light and dark. On web every token is a CSS variable (defined in
 * `themeCss()`, injected by `applyRtl()`), so the page follows `prefers-color-scheme`
 * live. Native reads the system scheme once at startup.
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

/** CSS custom properties for both schemes, plus native form controls and scrollbars. */
export function themeCss(): string {
  return `:root{${block(light)}color-scheme:light dark;}
@media (prefers-color-scheme: dark){:root{${block(dark)}}}
html,body{background-color:var(--c-canvas);color:var(--c-text);}`;
}
