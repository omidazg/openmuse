/**
 * Per-device display preferences (theme, text size, simple mode, motion, focus mode).
 * Pure logic with no React Native imports so it can be unit-tested under Node.
 */

export type ThemeChoice = "auto" | "light" | "dark";
export type TextSize = "small" | "normal" | "large" | "xlarge";

export type DisplayPrefs = {
  theme: ThemeChoice;
  textSize: TextSize;
  /** «حالت ساده برای سالمندان»: largest text, high contrast, bigger touch targets, no shadows. */
  simple: boolean;
  /** Manual «کاهش جلوه‌های حرکتی»; the OS setting is honored separately. */
  reduceMotion: boolean;
  /** «حالت تمرکز»: chat shows only messages and the composer. */
  focus: boolean;
};

export const DEFAULT_PREFS: DisplayPrefs = {
  theme: "auto",
  textSize: "normal",
  simple: false,
  reduceMotion: false,
  focus: false,
};

export const TEXT_SCALES: Record<TextSize, number> = {
  small: 0.9,
  normal: 1,
  large: 1.15,
  xlarge: 1.3,
};

/** Minimum touch target in simple mode (dp / CSS px before scaling). */
export const SIMPLE_TOUCH_TARGET = 48;

export const PREFS_KEY = "dastyar.display";

const themes: readonly ThemeChoice[] = ["auto", "light", "dark"];
const sizes = Object.keys(TEXT_SCALES) as TextSize[];

/** Read stored JSON defensively: unknown or malformed fields fall back to defaults. */
export function parsePrefs(raw: string | null | undefined): DisplayPrefs {
  if (!raw) return { ...DEFAULT_PREFS };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_PREFS };
  }
  if (!value || typeof value !== "object") return { ...DEFAULT_PREFS };
  const v = value as Record<string, unknown>;
  const bool = (key: keyof DisplayPrefs) =>
    typeof v[key] === "boolean" ? (v[key] as boolean) : (DEFAULT_PREFS[key] as boolean);
  return {
    theme: themes.includes(v.theme as ThemeChoice) ? (v.theme as ThemeChoice) : DEFAULT_PREFS.theme,
    textSize: sizes.includes(v.textSize as TextSize)
      ? (v.textSize as TextSize)
      : DEFAULT_PREFS.textSize,
    simple: bool("simple"),
    reduceMotion: bool("reduceMotion"),
    focus: bool("focus"),
  };
}

type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

export function loadPrefs(store: KeyValueStore | undefined): DisplayPrefs {
  try {
    return parsePrefs(store?.getItem(PREFS_KEY));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(store: KeyValueStore | undefined, prefs: DisplayPrefs): void {
  try {
    store?.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

/** Text scale factor; simple mode always uses at least the largest size. */
export function textScale(prefs: DisplayPrefs): number {
  const scale = TEXT_SCALES[prefs.textSize];
  return prefs.simple ? Math.max(scale, TEXT_SCALES.xlarge) : scale;
}

/** Scale a font size or line height, rounded to whole pixels. */
export function scaled(size: number, scale: number): number {
  return Math.round(size * scale);
}

/** A touch target size that respects simple mode's 48dp minimum. */
export function touchTarget(size: number, prefs: Pick<DisplayPrefs, "simple">): number {
  return prefs.simple ? Math.max(size, SIMPLE_TOUCH_TARGET) : size;
}

/** Motion is reduced when either the OS or the manual toggle asks for it. */
export function motionReduced(prefs: Pick<DisplayPrefs, "reduceMotion">, os: boolean): boolean {
  return prefs.reduceMotion || os;
}

/** Animation duration: zero when motion is reduced. */
export function motionDuration(ms: number, reduced: boolean): number {
  return reduced ? 0 : ms;
}

/** Attributes set on <html> (web); the theme CSS in theme.ts keys off these. */
export function documentAttributes(prefs: DisplayPrefs): Record<string, string | null> {
  return {
    "data-theme": prefs.theme === "auto" ? null : prefs.theme,
    "data-contrast": prefs.simple ? "high" : null,
    "data-simple": prefs.simple ? "true" : null,
    "data-motion": prefs.reduceMotion ? "reduce" : null,
  };
}
