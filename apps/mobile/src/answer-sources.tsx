import { FileText, Globe2 } from "lucide-react-native";
import { Linking, Pressable, Text, View } from "react-native";
import { answerSources, isTurnAnswer, type MessageLike } from "./answer-sources-data";
import { fw } from "./locale";
import { colors, s } from "./ui";

/**
 * Compact «منابع» list under an assistant answer: the web pages it used (title, domain and
 * the LTR address, opened in a new tab) and the user's files it drew on.
 */
export function AnswerSources({
  messages,
  message,
}: {
  messages: readonly MessageLike[];
  message: MessageLike;
}) {
  const index = messages.indexOf(message);
  if (index < 0 || !isTurnAnswer(messages as MessageLike[], index)) return null;
  const { web, files } = answerSources(messages as MessageLike[], index);
  if (!web.length && !files.length) return null;
  return (
    <View
      accessibilityLabel="منابع پاسخ"
      style={{
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.card,
      }}
    >
      {!!files.length && (
        <>
          <Text style={[s.small, { color: colors.text, ...fw("500") }]}>
            این پاسخ بر پایهٔ فایل‌های شما است
          </Text>
          {files.map((name) => (
            <View key={name} style={[s.row, { gap: 7 }]}>
              <FileText size={14} color={colors.blueDark} />
              <Text
                numberOfLines={1}
                style={[s.small, { flexShrink: 1, textAlign: "auto", writingDirection: "auto" }]}
              >
                {name}
              </Text>
            </View>
          ))}
        </>
      )}
      {!!web.length && (
        <>
          <Text style={[s.small, { color: colors.text, ...fw("500") }]}>منابع</Text>
          {web.map((source) => (
            <Pressable
              key={source.url}
              accessibilityRole="link"
              accessibilityLabel={`باز کردن منبع: ${source.title}`}
              onPress={() => void Linking.openURL(source.url).catch(() => undefined)}
              style={({ pressed }) => [
                s.row,
                { gap: 8, paddingVertical: 3, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Globe2 size={14} color={colors.blueDark} />
              <View style={{ flex: 1, minWidth: 0, alignItems: "flex-start" }}>
                <Text
                  numberOfLines={1}
                  style={{
                    fontSize: 13,
                    lineHeight: 20,
                    maxWidth: "100%",
                    color: colors.blueDark,
                    ...fw("500"),
                    textAlign: "auto",
                    writingDirection: "auto",
                  }}
                >
                  {source.title}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[s.small, { maxWidth: "100%", writingDirection: "ltr" }]}
                >
                  {source.domain}
                </Text>
              </View>
            </Pressable>
          ))}
        </>
      )}
    </View>
  );
}
