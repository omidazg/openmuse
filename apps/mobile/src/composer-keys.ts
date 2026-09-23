/**
 * Desktop web keyboard shortcuts. Matching uses `event.code` as well as `event.key`, so the
 * shortcuts keep working with the Persian keyboard layout (where K types «ن» and / types «/» or «.»).
 * No React Native imports, so this runs under the plain Node test runner.
 */

export type ShortcutAction = "threads" | "newChat" | "focusInput" | "help" | "escape";

export type KeyLike = {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
};

/**
 * Which shortcut a keydown means. `typing` is true when focus is in a text field; single-key
 * shortcuts («/», «?») are ignored there so they can still be typed.
 */
export function matchShortcut(event: KeyLike, typing: boolean): ShortcutAction | undefined {
  if (event.isComposing) return undefined;
  const mod = !!(event.ctrlKey || event.metaKey);
  const key = event.key.toLowerCase();
  if (key === "escape") return "escape";
  if (mod && !event.altKey) {
    if (event.shiftKey && (event.code === "KeyO" || key === "o")) return "newChat";
    if (!event.shiftKey && (event.code === "KeyK" || key === "k")) return "threads";
    return undefined;
  }
  if (typing || event.altKey) return undefined;
  if (key === "?" || key === "؟" || (event.code === "Slash" && event.shiftKey)) return "help";
  if (key === "/" || (event.code === "Slash" && !event.shiftKey)) return "focusInput";
  return undefined;
}

/** Enter sends; Shift+Enter (and Enter while an IME is composing) inserts a newline. */
export function isSendKey(event: KeyLike): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing;
}

export function isMacPlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** Rows of the «میان‌برها» sheet; key names stay in Latin script, as printed on keyboards. */
export function shortcutRows(mac: boolean): { keys: string[]; label: string }[] {
  const mod = mac ? "⌘" : "Ctrl";
  return [
    { keys: ["Enter"], label: "ارسال پیام" },
    { keys: ["Shift", "Enter"], label: "رفتن به خط بعد" },
    { keys: [mod, "K"], label: "باز کردن فهرست گفت‌وگوها" },
    { keys: [mod, "Shift", "O"], label: "گفت‌وگوی تازه" },
    { keys: ["/"], label: "رفتن به کادر پیام" },
    { keys: ["Esc"], label: "توقف پاسخ یا بستن پنجره" },
    { keys: ["?"], label: "نمایش همین راهنما" },
  ];
}

type Listener = () => void;
const focusListeners = new Set<Listener>();
/** The active chat composer subscribes; shortcuts outside the chat screen ask it to take focus. */
export function onComposerFocusRequest(listener: Listener): () => void {
  focusListeners.add(listener);
  return () => focusListeners.delete(listener);
}
export function requestComposerFocus(): void {
  for (const listener of focusListeners) listener();
}
