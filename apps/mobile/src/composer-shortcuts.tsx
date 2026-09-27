import { useEffect, useRef } from "react";
import { Platform, Text, View } from "react-native";
import { isMacPlatform, matchShortcut, type ShortcutAction, shortcutRows } from "./composer-keys";
import { fw } from "./locale";
import { colors, Sheet, s } from "./ui";

/** Desktop web with a mouse/trackpad, where a physical keyboard is expected. */
export function hasPhysicalKeyboard(): boolean {
  if (Platform.OS !== "web" || typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(any-hover: hover) and (any-pointer: fine)").matches;
}

function isMac(): boolean {
  return (
    typeof navigator !== "undefined" && isMacPlatform(navigator.platform || navigator.userAgent)
  );
}

function isTyping(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node?.tagName) return false;
  return node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.isContentEditable;
}

/** True while a sheet, drawer or dialog is open; Escape then belongs to it. */
export function modalOpen(): boolean {
  return typeof document !== "undefined" && !!document.querySelector('[aria-modal="true"]');
}

/**
 * Web keyboard shortcuts. `handler` returns true when it handled the action, which prevents the
 * browser default (for example Ctrl+K focusing the address bar).
 */
export function useWebShortcuts(enabled: boolean, handler: (action: ShortcutAction) => boolean) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (Platform.OS !== "web" || !enabled || typeof window === "undefined") return;
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const action = matchShortcut(event, isTyping(event.target));
      if (action && handlerRef.current(action)) event.preventDefault();
    };
    // Capture phase: react-native-web's TextInput stops keydown from bubbling past the field.
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [enabled]);
}

function Key({ label }: { label: string }) {
  return (
    <View
      style={{
        minWidth: 30,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 8,
        borderWidth: 1,
        borderBottomWidth: 2,
        borderColor: colors.line,
        backgroundColor: colors.subtle,
        alignItems: "center",
      }}
    >
      <Text
        style={{
          fontSize: 13,
          lineHeight: 20,
          color: colors.text,
          writingDirection: "ltr",
          ...fw("500"),
        }}
      >
        {label}
      </Text>
    </View>
  );
}

/** «میان‌برها»: the keyboard shortcuts available on desktop web. */
export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="میان‌برها" subtitle="میان‌برهای صفحه‌کلید در نسخهٔ وب" onClose={onClose}>
      <View style={{ gap: 4 }}>
        {shortcutRows(isMac()).map((row) => (
          <View
            key={row.label}
            style={[
              s.between,
              { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
            ]}
          >
            <Text style={[s.text, { flex: 1 }]}>{row.label}</Text>
            {/* Key combinations read left to right, as printed on the keyboard. */}
            <View style={{ flexDirection: "row", gap: 5, direction: "ltr" }}>
              {row.keys.map((key) => (
                <Key key={key} label={key} />
              ))}
            </View>
          </View>
        ))}
        <Text style={[s.small, { marginTop: 8 }]}>
          میان‌برهای تک‌کلیدی مثل «/» و «?» وقتی در کادر متنی می‌نویسید کار نمی‌کنند.
        </Text>
      </View>
    </Sheet>
  );
}
