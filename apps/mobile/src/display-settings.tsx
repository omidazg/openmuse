import { Focus, SunMoon } from "lucide-react-native";
import { Platform, Pressable, Text, View } from "react-native";
import { useDisplay } from "./display";
import { type TextSize, type ThemeChoice, touchTarget } from "./display-prefs";
import { fw } from "./locale";
import { CheckRow, colors, LinkRow, Sheet, s } from "./ui";
import { useWorkspace } from "./workspace";

const themes: { value: ThemeChoice; label: string }[] = [
  { value: "light", label: "روشن" },
  { value: "dark", label: "تیره" },
  { value: "auto", label: "خودکار (مطابق دستگاه)" },
];
const sizes: { value: TextSize; label: string }[] = [
  { value: "small", label: "کوچک" },
  { value: "normal", label: "معمولی" },
  { value: "large", label: "بزرگ" },
  { value: "xlarge", label: "خیلی بزرگ" },
];

function Choices<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const { prefs } = useDisplay();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ gap: 10 }}>
      <Text style={s.heading}>{label}</Text>
      <View style={[s.row, { flexWrap: "wrap", gap: 8 }]}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ checked: selected }}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => ({
                minHeight: touchTarget(40, prefs),
                paddingHorizontal: 15,
                justifyContent: "center",
                borderRadius: 22,
                borderWidth: 1,
                borderColor: selected ? colors.text : colors.line,
                backgroundColor: selected ? colors.blue : pressed ? colors.subtle : colors.card,
              })}
            >
              <Text style={[s.buttonText, { color: colors.text }, selected && fw("700")]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Toggle({
  label,
  detail,
  checked,
  onPress,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onPress: () => void;
}) {
  return (
    <View>
      <CheckRow label={label} checked={checked} onPress={onPress} />
      <Text style={[s.small, { marginStart: 29 }]}>{detail}</Text>
    </View>
  );
}

/** Drawer entries: open «نمایش» and toggle focus mode. */
export function DisplayMenuRows({ onClose }: { onClose: () => void }) {
  const { open, navigate } = useWorkspace();
  const { prefs, update } = useDisplay();
  return (
    <>
      <LinkRow
        icon={SunMoon}
        title="نمایش"
        detail="پوسته، اندازهٔ متن و حالت ساده"
        onPress={() => {
          onClose();
          open({ type: "display" });
        }}
      />
      <LinkRow
        icon={Focus}
        title={prefs.focus ? "خروج از حالت تمرکز" : "حالت تمرکز"}
        detail="فقط پیام‌ها و کادر نوشتن"
        onPress={() => {
          update({ focus: !prefs.focus });
          navigate("chat");
          onClose();
        }}
      />
    </>
  );
}

/** «نمایش»: theme, text size, simple mode, motion and focus mode, stored on this device. */
export function DisplaySheet() {
  const { close, navigate } = useWorkspace();
  const { prefs, update, osReduceMotion } = useDisplay();
  const web = Platform.OS === "web";
  return (
    <Sheet title="نمایش" subtitle="ظاهر برنامه روی همین دستگاه." onClose={close}>
      <View style={{ gap: 22 }}>
        {web ? (
          <>
            <Choices
              label="پوسته"
              options={themes}
              value={prefs.theme}
              onChange={(theme) => update({ theme })}
            />
            {prefs.simple ? (
              <View style={{ gap: 6 }}>
                <Text style={s.heading}>اندازهٔ متن</Text>
                <Text style={s.muted}>در حالت ساده، متن همیشه در بزرگ‌ترین اندازه است.</Text>
              </View>
            ) : (
              <Choices
                label="اندازهٔ متن"
                options={sizes}
                value={prefs.textSize}
                onChange={(textSize) => update({ textSize })}
              />
            )}
          </>
        ) : (
          <Text style={s.muted}>
            روی گوشی، پوسته و اندازهٔ متن از تنظیمات خود دستگاه پیروی می‌کند.
          </Text>
        )}
        <View style={[s.divider, { marginVertical: 0 }]} />
        <Toggle
          label="حالت ساده برای سالمندان"
          detail="متن درشت‌تر، رنگ‌های پررنگ‌تر، دکمه‌های بزرگ‌تر و جلوه‌های کمتر."
          checked={prefs.simple}
          onPress={() => update({ simple: !prefs.simple })}
        />
        <Toggle
          label="کاهش جلوه‌های حرکتی"
          detail={
            osReduceMotion
              ? "تنظیمات دستگاه شما جلوه‌های حرکتی را کم کرده است و برنامه هم از آن پیروی می‌کند."
              : "پنجره‌ها و منوها بدون لغزش و محوشدن باز می‌شوند."
          }
          checked={prefs.reduceMotion || osReduceMotion}
          onPress={() => update({ reduceMotion: !prefs.reduceMotion })}
        />
        <Toggle
          label="حالت تمرکز"
          detail="در گفت‌وگو فقط پیام‌ها و کادر نوشتن دیده می‌شوند."
          checked={prefs.focus}
          onPress={() => {
            update({ focus: !prefs.focus });
            if (!prefs.focus) {
              navigate("chat");
              close();
            }
          }}
        />
        {web && <Text style={s.small}>تغییرها بلافاصله اعمال و روی همین دستگاه ذخیره می‌شوند.</Text>}
      </View>
    </Sheet>
  );
}
