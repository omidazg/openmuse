import { Platform, Share } from "react-native";

/**
 * Copies text on web. Phones have no clipboard module in this app, so they open the share
 * sheet (which offers «Copy»). Resolves to true only when the text is on the clipboard.
 */
export async function copyText(text: string): Promise<boolean> {
  if (Platform.OS === "web" && globalThis.navigator?.clipboard) {
    await globalThis.navigator.clipboard.writeText(text);
    return true;
  }
  await Share.share({ message: text });
  return false;
}
