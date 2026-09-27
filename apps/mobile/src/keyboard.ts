import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

/**
 * Height of the on-screen keyboard above the navigation bar, Android only (0 elsewhere).
 * Android apps are edge-to-edge, so the window no longer shrinks for the keyboard
 * (adjustResize has no effect); add this as bottom padding under a bottom-inset-aware layout
 * so the composer and sheet fields stay above the keyboard. iOS uses KeyboardAvoidingView.
 */
export function useKeyboardInset(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const show = Keyboard.addListener("keyboardDidShow", (event) =>
      setHeight(Math.max(0, event.endCoordinates.height)),
    );
    const hide = Keyboard.addListener("keyboardDidHide", () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}
