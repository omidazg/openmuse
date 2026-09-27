import { ArrowUpLeft, Check, ChevronLeft, type LucideIcon, X } from "lucide-react-native";
import { type ReactNode, useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BRAND } from "../../../packages/domain/src/brand";
import { useDisplay } from "./display";
import { motionDuration, touchTarget } from "./display-prefs";
import { FONT, faDate, faNumber, fw } from "./locale";
import { colors } from "./theme";

export { colors };
export const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  text: { fontFamily: FONT, color: colors.text, fontSize: 15, lineHeight: 26 },
  muted: { fontFamily: FONT, color: colors.muted, fontSize: 14, lineHeight: 24 },
  small: { fontFamily: FONT, color: colors.muted, fontSize: 12, lineHeight: 20 },
  label: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    ...fw("700"),
  },
  title: { color: colors.text, fontSize: 23, lineHeight: 38, ...fw("600") },
  heading: { color: colors.text, fontSize: 16, lineHeight: 27, ...fw("600") },
  card: {
    backgroundColor: colors.card,
    borderRadius: 23,
    borderWidth: 0,
    borderColor: colors.line,
    padding: 20,
  },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 18 },
  input: {
    fontFamily: FONT,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 19,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 16,
    lineHeight: 26,
    backgroundColor: colors.card,
    minHeight: 45,
  },
  field: { gap: 7, marginBottom: 16 },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 17,
    minHeight: 42,
    paddingVertical: 10,
    borderRadius: 24,
  },
  primary: { backgroundColor: colors.blue },
  secondary: { backgroundColor: colors.subtle },
  buttonText: { fontSize: 14, lineHeight: 21, ...fw("600") },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    alignSelf: "flex-start",
    backgroundColor: colors.canvas,
  },
  chipText: { fontSize: 11, lineHeight: 17, ...fw("600"), color: colors.muted },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 13,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.sky,
  },
  error: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: colors.dangerSoft,
    marginVertical: 10,
    gap: 4,
  },
  modalShade: {
    flex: 1,
    backgroundColor: colors.shade,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  sheet: {
    backgroundColor: colors.canvas,
    borderRadius: 26,
    width: "100%",
    maxWidth: 790,
    maxHeight: "94%",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.line,
  },
});
export function Button({
  children,
  onPress,
  icon: Icon,
  primary,
  disabled,
  busy,
  small,
  danger,
  style,
}: {
  children: ReactNode;
  onPress: () => void;
  icon?: LucideIcon;
  primary?: boolean;
  disabled?: boolean;
  busy?: boolean;
  small?: boolean;
  danger?: boolean;
  style?: ViewStyle;
}) {
  const color = danger ? colors.danger : colors.text;
  const { prefs, reduceMotion } = useDisplay();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        primary ? s.primary : s.secondary,
        small && { minHeight: 38, paddingVertical: 7, paddingHorizontal: 13 },
        prefs.simple && { minHeight: touchTarget(small ? 38 : 42, prefs) },
        (disabled || busy) && { opacity: 0.5 },
        pressed && !reduceMotion && { transform: [{ scale: 0.98 }] },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={color} size="small" />
      ) : Icon ? (
        <Icon size={15} color={color} />
      ) : null}
      <Text style={[s.buttonText, { color }]}>{children}</Text>
    </Pressable>
  );
}
export function IconButton({
  icon: Icon,
  label,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
}) {
  const size = touchTarget(44, useDisplay().prefs);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: size / 2,
          backgroundColor: pressed ? colors.line : colors.card,
        },
      ]}
    >
      <Icon size={20} strokeWidth={1.8} color={colors.text} />
    </Pressable>
  );
}
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}
export function Chip({ children, tint }: { children: ReactNode; tint?: string }) {
  return (
    <View style={[s.chip, tint ? { backgroundColor: tint } : null]}>
      <Text style={s.chipText}>{children}</Text>
    </View>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={s.field}>
      <Text style={[s.small, { ...fw("600"), color: colors.text }]}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        accessibilityLabel={label}
        {...props}
        style={[
          s.input,
          props.multiline && { minHeight: 120, textAlignVertical: "top" },
          props.style,
        ]}
      />
    </View>
  );
}
export function Empty({
  icon: Icon,
  title,
  detail,
  children,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
  children?: ReactNode;
}) {
  return (
    <View style={{ alignItems: "center", padding: 40, gap: 13 }}>
      <View style={[s.iconBox, { width: 55, height: 55, borderRadius: 18 }]}>
        <Icon size={24} color={colors.blueDark} />
      </View>
      <Text style={s.heading}>{title}</Text>
      <Text style={[s.muted, { textAlign: "center", maxWidth: 360 }]}>{detail}</Text>
      {children}
    </View>
  );
}
export function ErrorNotice({ error }: { error?: string }) {
  return error ? (
    <View accessibilityRole="alert" style={s.error}>
      <Text style={[s.text, { color: colors.danger }]}>{error}</Text>
    </View>
  ) : null;
}
export function Sheet({
  title,
  subtitle,
  children,
  onClose,
  wide,
  drawer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  /** Full-height side drawer that slides in from the start (right, in RTL) edge. */
  drawer?: boolean;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { reduceMotion } = useDisplay();
  const compact = width < 600;
  if (drawer)
    return (
      <Drawer title={title} subtitle={subtitle} onClose={onClose}>
        {children}
      </Drawer>
    );
  return (
    <Modal
      transparent
      animationType={reduceMotion ? "none" : compact ? "slide" : "fade"}
      visible
      onRequestClose={onClose}
    >
      <View style={[s.modalShade, compact && { padding: 0, justifyContent: "flex-end" }]}>
        <View
          accessibilityViewIsModal
          style={[
            s.sheet,
            wide && { maxWidth: 1050 },
            compact && {
              borderBottomStartRadius: 0,
              borderBottomEndRadius: 0,
              paddingBottom: Math.max(insets.bottom, 12),
              maxHeight: "94%",
            },
          ]}
        >
          {compact && (
            <View
              style={{
                alignSelf: "center",
                width: 34,
                height: 4,
                borderRadius: 3,
                backgroundColor: colors.faint,
                marginTop: 10,
              }}
            />
          )}
          <View
            style={[
              s.between,
              { padding: compact ? 20 : 24, borderBottomWidth: 1, borderBottomColor: colors.line },
            ]}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.title}>{title}</Text>
              {subtitle && <Text style={s.muted}>{subtitle}</Text>}
            </View>
            <IconButton icon={X} label="بستن" onPress={onClose} />
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: compact ? 20 : 24 }}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
function Drawer({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { reduceMotion, scale } = useDisplay();
  // On web the text scale is a CSS zoom, so the window is `width / scale` CSS pixels wide.
  const visible = Platform.OS === "web" ? width / scale : width;
  const panelWidth = Math.min(380, Math.round(visible * 0.88));
  // The app is always RTL, so the start edge is the physical right; transforms are not mirrored.
  const offset = useRef(new Animated.Value(reduceMotion ? 0 : panelWidth)).current;
  useEffect(() => {
    Animated.timing(offset, {
      toValue: 0,
      duration: motionDuration(220, reduceMotion),
      useNativeDriver: Platform.OS !== "web",
    }).start();
  }, [offset]);
  return (
    <Modal
      transparent
      animationType={reduceMotion ? "none" : "fade"}
      visible
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, flexDirection: "row" }}>
        <Animated.View
          accessibilityViewIsModal
          style={{
            width: panelWidth,
            height: "100%",
            backgroundColor: colors.canvas,
            borderTopEndRadius: 26,
            borderBottomEndRadius: 26,
            paddingTop: insets.top,
            paddingBottom: Math.max(insets.bottom, 12),
            overflow: "hidden",
            transform: [{ translateX: offset }],
          }}
        >
          <View
            style={[
              s.between,
              { padding: 20, borderBottomWidth: 1, borderBottomColor: colors.line },
            ]}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.title}>{title}</Text>
              {subtitle && <Text style={s.muted}>{subtitle}</Text>}
            </View>
            <IconButton icon={X} label="بستن" onPress={onClose} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20 }}>
            {children}
          </ScrollView>
        </Animated.View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="بستن"
          onPress={onClose}
          style={{ flex: 1, backgroundColor: colors.shade }}
        />
      </View>
    </Modal>
  );
}
export function CheckRow({
  label,
  checked,
  onPress,
}: {
  label: string;
  checked: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={onPress}
      style={[s.row, { gap: 10, paddingVertical: 9 }]}
    >
      <View
        style={{
          width: 19,
          height: 19,
          borderRadius: 5,
          borderWidth: 1,
          borderColor: checked ? colors.text : colors.line,
          backgroundColor: checked ? colors.text : colors.card,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked && <Check size={13} color={colors.canvas} />}
      </View>
      <Text style={[s.text, { flex: 1 }]}>{label}</Text>
    </Pressable>
  );
}
export function SectionHeading({
  title,
  action,
  onPress,
}: {
  title: string;
  action?: string;
  onPress?: () => void;
}) {
  return (
    <View style={[s.between, { marginBottom: 19 }]}>
      <Text style={s.heading}>{title}</Text>
      {action && onPress && (
        <Pressable accessibilityRole="button" onPress={onPress} style={[s.row, { gap: 5 }]}>
          <Text style={[s.small, { color: colors.text }]}>{action}</Text>
          <ArrowUpLeft size={13} color={colors.muted} />
        </Pressable>
      )}
    </View>
  );
}
export function LinkRow({
  title,
  detail,
  onPress,
  icon: Icon,
  tint,
}: {
  title: string;
  detail?: string;
  onPress: () => void;
  icon: LucideIcon;
  tint?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        { paddingVertical: 13, gap: 14, borderRadius: 10 },
        pressed && { backgroundColor: colors.canvas },
      ]}
    >
      <View style={[s.iconBox, { backgroundColor: tint || colors.sky }]}>
        <Icon size={19} color={colors.text} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[s.text, { ...fw("500") }]}>{title}</Text>
        {detail && <Text style={s.small}>{detail}</Text>}
      </View>
      <ChevronLeft size={15} color={colors.muted} />
    </Pressable>
  );
}
/** The brand mascot (BRAND.mascotNameEn), shared by every assistant surface. */
export function Mascot({
  size = 42,
  variant = "sky",
}: {
  size?: number;
  variant?: "sky" | "sand" | "lilac";
}) {
  const palette = {
    sky: colors.sky,
    sand: colors.orange,
    lilac: colors.lavender,
  }[variant];
  return (
    <View
      accessibilityLabel={`${BRAND.mascotName}، نماد ${BRAND.nameFa}`}
      style={{ width: size, height: size }}
    >
      <View
        style={{
          position: "absolute",
          top: size * 0.15,
          start: size * 0.12,
          width: size * 0.76,
          height: size * 0.76,
          borderRadius: size,
          backgroundColor: palette,
        }}
      />
      <Image
        source={require("../assets/capybara.png")}
        resizeMode="contain"
        style={{ width: size, height: size }}
        accessible={false}
      />
    </View>
  );
}
/** Jalali date for display, e.g. «۲۹ شهریور». */
export function dateLabel(value: string, options?: Intl.DateTimeFormatOptions) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : faDate(date, options || { month: "long", day: "numeric" });
}
/** 24-hour time with Persian digits, e.g. «۱۴:۳۰». */
export function timeLabel(value: string, timeZone?: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : faDate(date, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone });
}
/** Persian relative time: «همین حالا»، «۲ ساعت پیش»، «دیروز», then a Jalali date. */
export function relativeDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "همین حالا";
  if (diff < 3600_000) return `${faNumber(Math.floor(diff / 60_000))} دقیقه پیش`;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (date.getTime() >= today.getTime()) return `${faNumber(Math.floor(diff / 3600_000))} ساعت پیش`;
  if (date.getTime() >= today.getTime() - 86400_000) return "دیروز";
  return dateLabel(value);
}

export function resultSummary(value: string) {
  return /^Saved to (?:sample|local) sent mail(?: · .+)?$/.test(value)
    ? "پاسخ در پوشهٔ ارسال‌شدهٔ محلی ذخیره شد."
    : value;
}
