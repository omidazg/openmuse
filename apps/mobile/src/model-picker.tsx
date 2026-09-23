import { Check, ChevronDown, Cpu } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { MuseApi } from "./api";
import { fw } from "./locale";
import { colors, ErrorNotice, Sheet, s } from "./ui";

interface ModelOption {
  id: string;
  label: string;
  default: boolean;
}

/**
 * Compact model picker for the chat composer. The server owns the allowlist (MODELS) and
 * remembers the choice per person; it is hidden when there is nothing to choose from.
 */
export function ModelPicker({ api }: { api: MuseApi }) {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api
      .request<{ models: ModelOption[]; selected: string | null }>("/api/models")
      .then((result) => {
        if (!active) return;
        setModels(result.models);
        setSelected(result.selected);
      })
      // Without the list the composer keeps working with the server default.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api]);
  if (models.length < 2) return null;
  const current = models.find((m) => m.id === selected) ?? models.find((m) => m.default);
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
        accessibilityLabel={`انتخاب مدل، مدل فعلی: ${current?.label ?? "پیش‌فرض"}`}
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
          {current?.label ?? "مدل پیش‌فرض"}
        </Text>
        <ChevronDown size={13} color={colors.muted} />
      </Pressable>
      {open && (
        <Sheet
          title="انتخاب مدل"
          subtitle="مدل انتخاب‌شده برای گفت‌وگوها و کارهای واگذارشدهٔ شما به کار می‌رود."
          onClose={() => setOpen(false)}
        >
          <ErrorNotice error={error} />
          <View style={{ gap: 4 }}>
            {models.map((model) => {
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
