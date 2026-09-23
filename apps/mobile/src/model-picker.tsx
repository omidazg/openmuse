import { Check, ChevronDown, Cpu } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { MuseApi } from "./api";
import { fw } from "./locale";
import { Button, colors, ErrorNotice, Sheet, s } from "./ui";

interface ModelOption {
  id: string;
  label: string;
  default: boolean;
}
type ResponseLength = "short" | "normal" | "long";
const LENGTHS: { id: ResponseLength; label: string }[] = [
  { id: "short", label: "کوتاه" },
  { id: "normal", label: "معمولی" },
  { id: "long", label: "مفصل" },
];

/**
 * Compact model and answer-length picker for the chat composer. The server owns the allowlist
 * (MODELS) and remembers both choices per person; the model list is shown only when there is
 * something to choose from.
 */
export function ModelPicker({ api }: { api: MuseApi }) {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [length, setLength] = useState<ResponseLength | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api
      .request<{ models: ModelOption[]; selected: string | null; length?: ResponseLength }>(
        "/api/models",
      )
      .then((result) => {
        if (!active) return;
        setModels(result.models);
        setSelected(result.selected);
        setLength(result.length ?? "normal");
      })
      // Without the list the composer keeps working with the server default.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api]);
  if (!length) return null;
  const choosable = models.length > 1;
  const current = models.find((m) => m.id === selected) ?? models.find((m) => m.default);
  const lengthLabel = LENGTHS.find((l) => l.id === length)?.label ?? "معمولی";
  async function chooseLength(next: ResponseLength) {
    if (next === length) return;
    setSaving(next);
    setError("");
    try {
      const result = await api.request<{ length: ResponseLength }>(
        "/api/models/length",
        { length: next },
        "PUT",
      );
      setLength(result.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "طول پاسخ ذخیره نشد. دوباره تلاش کنید.");
    } finally {
      setSaving("");
    }
  }
  async function choose(id: string) {
    if (id === selected) return setOpen(false);
    setSaving(id);
    setError("");
    try {
      const result = await api.request<{ selected: string }>(
        "/api/models/selected",
        { model: id },
        "PUT",
      );
      setSelected(result.selected);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "مدل ذخیره نشد. دوباره تلاش کنید.");
    } finally {
      setSaving("");
    }
  }
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          choosable
            ? `انتخاب مدل و طول پاسخ، مدل فعلی: ${current?.label ?? "پیش‌فرض"}، پاسخ ${lengthLabel}`
            : `انتخاب طول پاسخ، اکنون ${lengthLabel}`
        }
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          s.row,
          {
            alignSelf: "flex-start",
            gap: 6,
            maxWidth: "100%",
            paddingHorizontal: 10,
            paddingVertical: 4,
            marginStart: 6,
            marginBottom: 2,
            borderRadius: 14,
            backgroundColor: pressed ? colors.sky : "transparent",
          },
        ]}
      >
        <Cpu size={14} color={colors.muted} />
        <Text
          numberOfLines={1}
          style={{ flexShrink: 1, fontSize: 12, lineHeight: 18, color: colors.muted, ...fw("500") }}
        >
          {choosable
            ? `${current?.label ?? "مدل پیش‌فرض"}${length === "normal" ? "" : `، پاسخ ${lengthLabel}`}`
            : `پاسخ ${lengthLabel}`}
        </Text>
        <ChevronDown size={13} color={colors.muted} />
      </Pressable>
      {open && (
        <Sheet
          title={choosable ? "مدل و طول پاسخ" : "طول پاسخ"}
          subtitle={
            choosable
              ? "مدل انتخاب‌شده برای گفت‌وگوها و کارهای واگذارشدهٔ شما به کار می‌رود. «خودکار» پیام‌های ساده را با مدل سریع و کارهای پیچیده را با مدل قوی پاسخ می‌دهد."
              : "پاسخ‌های دستیار در گفت‌وگو با این اندازه نوشته می‌شوند."
          }
          onClose={() => setOpen(false)}
        >
          <ErrorNotice error={error} />
          <Text style={[s.text, fw("600"), { marginBottom: 8 }]}>طول پاسخ</Text>
          <View style={[s.row, { gap: 8, flexWrap: "wrap", marginBottom: choosable ? 18 : 0 }]}>
            {LENGTHS.map((option) => (
              <Button
                key={option.id}
                small
                primary={option.id === length}
                busy={saving === option.id}
                disabled={Boolean(saving)}
                onPress={() => void chooseLength(option.id)}
              >
                {option.label}
              </Button>
            ))}
          </View>
          {choosable && <Text style={[s.text, fw("600"), { marginBottom: 8 }]}>مدل</Text>}
          <View style={{ gap: 4 }}>
            {(choosable ? models : []).map((model) => {
              const checked = model.id === current?.id;
              return (
                <Pressable
                  key={model.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked, busy: saving === model.id }}
                  disabled={Boolean(saving)}
                  onPress={() => void choose(model.id)}
                  style={({ pressed }) => [
                    s.row,
                    {
                      gap: 12,
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      borderRadius: 16,
                      backgroundColor: checked || pressed ? colors.sky : "transparent",
                    },
                  ]}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[s.text, fw(checked ? "600" : "400")]}>{model.label}</Text>
                    {model.default && <Text style={s.small}>پیش‌فرض سرور</Text>}
                  </View>
                  {checked && <Check size={18} color={colors.blueDark} />}
                </Pressable>
              );
            })}
          </View>
        </Sheet>
      )}
    </>
  );
}
