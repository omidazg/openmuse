import { BellRing, type LucideIcon } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  answerSummary,
  PATH_MAX,
  PATHS,
  type PathDefinition,
  type PathId,
  type PathShortcut,
  type UserProfile,
} from "../../../packages/domain/src/paths";
import { trackPathChange } from "./insights";
import { faNumber, fw } from "./locale";
import { PathQuestions } from "./path-picker";
import { pathIcon, useProfile } from "./profile";
import { Button, Card, colors, ErrorNotice, LinkRow, Sheet, s } from "./ui";
import { useWorkspace } from "./workspace";

const SAVE_ERROR = "ذخیره نشد. اتصال را بررسی کنید و دوباره تلاش کنید.";

/** A labelled on/off switch; the whole row is the control. */
export function SwitchRow({
  label,
  detail,
  icon: Icon,
  checked,
  disabled,
  onPress,
}: {
  label: string;
  detail?: string;
  icon?: LucideIcon;
  checked: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={detail}
      accessibilityState={{ checked, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        { gap: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.line },
        pressed && { opacity: 0.7 },
      ]}
    >
      {Icon && <Icon size={19} color={colors.text} />}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.text, fw("500")]}>{label}</Text>
        {detail && <Text style={s.small}>{detail}</Text>}
      </View>
      <View
        style={{
          width: 46,
          height: 28,
          borderRadius: 14,
          padding: 3,
          flexDirection: "row",
          // Row direction follows RTL, so "on" moves the knob to the end (left) edge.
          justifyContent: checked ? "flex-end" : "flex-start",
          backgroundColor: checked ? colors.blueDark : colors.faint,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#FFFFFF" }} />
      </View>
    </Pressable>
  );
}

/** «میان‌برهای شما»: two-column grid of the selected paths' shortcuts at the top of the menu. */
export function PathShortcutGrid({
  shortcuts,
  onPick,
}: {
  shortcuts: PathShortcut[];
  onPick: (shortcut: PathShortcut) => void;
}) {
  if (!shortcuts.length) return null;
  return (
    <View style={{ gap: 8 }}>
      <Text style={s.label}>میان‌برهای شما</Text>
      <View style={[s.row, { flexWrap: "wrap", gap: 8 }]}>
        {shortcuts.map((item) => {
          const Icon = pathIcon(item.icon);
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={
                item.personaId
                  ? `گفت‌وگوی تازه با دستیار آماده: ${item.label}`
                  : `گفت‌وگوی تازه: ${item.label}`
              }
              onPress={() => onPick(item)}
              style={({ pressed }) => [
                s.row,
                {
                  flexBasis: "46%",
                  flexGrow: 1,
                  gap: 8,
                  minHeight: 48,
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: colors.blue,
                  backgroundColor: colors.sky,
                },
                pressed && { opacity: 0.75 },
              ]}
            >
              <Icon size={18} color={colors.blueDark} />
              <Text style={[s.text, fw("500"), { flex: 1, fontSize: 14, lineHeight: 21 }]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Chosen answers of a path, for the «جزئیات …» row. */
function detailSummary(path: PathDefinition, details: UserProfile["details"]) {
  const labels = answerSummary({ details }, path.id);
  return labels.length ? labels.join("، ") : "هنوز پاسخی ثبت نشده";
}

/**
 * «مسیرهای من» in «شخصی‌سازی»: one switch per path (at most PATH_MAX on), the follow-up answers
 * of the selected paths and the tax deadline reminders. Every change is saved right away.
 */
export function PathSettings() {
  const { profile, save } = useProfile();
  const { api } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [limit, setLimit] = useState(false);
  const [editing, setEditing] = useState<PathId>();
  const paths = profile?.paths ?? [];
  const selected = PATHS.filter((path) => paths.includes(path.id));

  async function apply(patch: Parameters<typeof save>[0]) {
    setBusy(true);
    setError("");
    try {
      await save(patch);
      if (patch.paths && profile) trackPathChange(api, profile.paths, patch.paths);
    } catch {
      // save() already restored the previous profile.
      setError(SAVE_ERROR);
    } finally {
      setBusy(false);
    }
  }
  function toggle(id: PathId) {
    if (!profile || busy) return;
    const on = profile.paths.includes(id);
    if (!on && profile.paths.length >= PATH_MAX) {
      setLimit(true);
      return;
    }
    setLimit(false);
    void apply({
      paths: on ? profile.paths.filter((item) => item !== id) : [...profile.paths, id],
    });
  }

  return (
    <Card style={{ gap: 4 }}>
      <View style={s.between}>
        <Text style={s.heading}>مسیرهای من</Text>
        <Text style={s.small}>
          {faNumber(paths.length)} از {faNumber(PATH_MAX)}
        </Text>
      </View>
      <Text style={[s.small, { marginBottom: 6 }]}>
        مسیرها پیشنهادهای شروع، میان‌برهای منو و پیش‌فرض پاسخ‌ها را تنظیم می‌کنند؛ هیچ امکانی پنهان
        نمی‌شود.
      </Text>
      {!profile && <Text style={s.small}>در حال بارگذاری مسیرها…</Text>}
      {PATHS.map((path) => (
        <SwitchRow
          key={path.id}
          icon={pathIcon(path.icon)}
          label={path.name}
          checked={paths.includes(path.id)}
          disabled={!profile || busy}
          onPress={() => toggle(path.id)}
        />
      ))}
      {limit && paths.length >= PATH_MAX && (
        <View
          accessibilityLiveRegion="polite"
          style={{ padding: 12, borderRadius: 14, backgroundColor: colors.orange, marginTop: 8 }}
        >
          <Text style={[s.small, { color: colors.text }]}>
            حداکثر سه مسیر قابل انتخاب است. برای افزودن، یکی را خاموش کنید.
          </Text>
        </View>
      )}
      <ErrorNotice error={error} />
      {profile && selected.some((path) => path.questions.length) && (
        <View style={{ marginTop: 8 }}>
          {selected
            .filter((path) => path.questions.length)
            .map((path) => (
              <LinkRow
                key={path.id}
                icon={pathIcon(path.icon)}
                title={`جزئیات ${path.shortName}`}
                detail={detailSummary(path, profile.details)}
                onPress={() => setEditing(path.id)}
              />
            ))}
        </View>
      )}
      {profile && paths.includes("finance") && (
        <SwitchRow
          icon={BellRing}
          label="یادآوری مهلت‌های مالیاتی"
          detail="مهلت‌های قانونی پیش از موعد در صفحهٔ چت یادآوری می‌شوند"
          checked={profile.reminders}
          disabled={busy}
          onPress={() => void apply({ reminders: !profile.reminders })}
        />
      )}
      {editing && profile && (
        <PathDetailsSheet
          path={selected.find((path) => path.id === editing)}
          onClose={() => setEditing(undefined)}
        />
      )}
    </Card>
  );
}

/** Nested sheet with a path's optional follow-up questions. */
function PathDetailsSheet({
  path,
  onClose,
}: {
  path: PathDefinition | undefined;
  onClose: () => void;
}) {
  const { profile, save } = useProfile();
  const { notify } = useWorkspace();
  const [draft, setDraft] = useState<Record<string, string[]>>(() => profile?.details ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!path) return null;
  async function submit() {
    if (!profile) return;
    setBusy(true);
    setError("");
    try {
      await save({ details: draft });
      notify("ذخیره شد");
      onClose();
    } catch {
      setError(SAVE_ERROR);
      setBusy(false);
    }
  }
  return (
    <Sheet
      title={`جزئیات ${path.shortName}`}
      subtitle="پاسخ‌ها اختیاری است و دقت پاسخ‌ها و یادآوری‌ها را بیشتر می‌کند."
      onClose={onClose}
    >
      <View style={{ gap: 16 }}>
        <PathQuestions paths={[path.id]} details={draft} onChange={setDraft} />
        <ErrorNotice error={error} />
        <Button primary busy={busy} disabled={!profile} onPress={() => void submit()}>
          ذخیره
        </Button>
      </View>
    </Sheet>
  );
}
