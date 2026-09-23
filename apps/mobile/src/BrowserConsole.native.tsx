import { useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import { ErrorNotice } from "./ui";
export default function BrowserConsole({ url }: { url: string }) {
  const [error, setError] = useState("");
  return (
    <View>
      <ErrorNotice error={error} />
      <WebView
        source={{ uri: url }}
        onError={() =>
          setError("کنسول مرورگر باز نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.")
        }
        style={{ height: 520, borderRadius: 12 }}
      />
    </View>
  );
}
