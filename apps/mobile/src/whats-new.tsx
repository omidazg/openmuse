import { Sparkles } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { CHANGELOG, unseenChangelog } from "../../../packages/domain/src/changelog";
import { formatJalali } from "../../../packages/domain/src/iran-holidays";
import { faNumber, fw } from "./locale";
import { colors, Sheet, s } from "./ui";

/** Small unread dot, drawn at the start edge of a row or over an icon. */
export function NewDot({ style }: { style?: object }) {
  return (
    <View
      pointerEvents="none"
      style={[{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.blueDark }, style]}
    />
  );
}

/** Drawer row for «تازه‌ها» with a dot while there are unseen entries. */
export function WhatsNewRow({ unseen, onPress }: { unseen: number; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={unseen ? `تازه‌ها، ${faNumber(unseen)} مورد دیده‌نشده` : "تازه‌ها"}
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        { paddingVertical: 13, gap: 14, borderRadius: 10 },
        pressed && { backgroundColor: colors.canvas },
      ]}
    >
      <View style={s.iconBox}>
        <Sparkles size={19} color={colors.text} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[s.text, fw("500")]}>تازه‌ها</Text>
        <Text style={s.small}>
          {unseen ? `${faNumber(unseen)} قابلیت تازه` : "قابلیت‌های تازهٔ دستیار"}
        </Text>
      </View>
      {unseen > 0 && <NewDot />}
    </Pressable>
  );
}

/** Static changelog, newest first; entries newer than `seenId` are marked «تازه». */
export function WhatsNewSheet({ seenId, onClose }: { seenId: string | null; onClose: () => void }) {
  const unseen = new Set(unseenChangelog(seenId).map((entry) => entry.id));
  return (
    <Sheet title="تازه‌ها" subtitle="قابلیت‌هایی که به‌تازگی اضافه شده‌اند" onClose={onClose}>
      <View style={{ gap: 4 }}>
        {CHANGELOG.map((entry, index) => (
          <View
            key={entry.id}
            style={{
              paddingVertical: 14,
              gap: 4,
              borderTopWidth: index ? 1 : 0,
              borderTopColor: colors.line,
            }}
          >
            <View style={[s.row, { gap: 8 }]}>
              <Text style={[s.heading, { flexShrink: 1 }]}>{entry.title}</Text>
              {unseen.has(entry.id) && (
                <View style={[s.chip, { backgroundColor: colors.sky }]}>
                  <Text style={[s.chipText, { color: colors.blueDark }]}>تازه</Text>
                </View>
              )}
            </View>
            <Text style={s.muted}>{entry.detail}</Text>
            <Text style={s.small}>{formatJalali(entry.date, false)}</Text>
          </View>
        ))}
      </View>
    </Sheet>
  );
}
