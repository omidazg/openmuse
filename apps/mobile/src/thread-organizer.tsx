import { Check, MessageCircle, Plus, Search, Tag, X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  type StyleProp,
  Text,
  TextInput,
  type TextStyle,
  View,
} from "react-native";
import { findMatch, normalizeSearch, type TextRange } from "../../../packages/domain/src/search";
import type { MuseApi } from "./api";
import { fw } from "./locale";
import { Button, colors, ErrorNotice, s } from "./ui";

/** Conversation search, pins and labels for the side drawer (local thread backend). */
export type ThreadLabel = { id: string; name: string };
export type SearchHit = {
  thread: { id: string; name: string | null; archived: boolean };
  nameMatch: TextRange | null;
  snippet: { text: string; start: number; end: number; role: string } | null;
};

const asMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Debounced search. The local backend searches titles and message text on the server; other
 * backends only have the loaded thread titles, so those are matched on the device.
 */
export function useThreadSearch(
  api: MuseApi,
  query: string,
  server: boolean,
  loaded: { id: string; name: string | null; archived: boolean }[],
) {
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef(0);
  const active = normalizeSearch(query) !== "";
  useEffect(() => {
    const request = ++latest.current;
    setError("");
    setResults([]);
    if (!active || !server) {
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      void api
        .request<{ results: SearchHit[] }>(
          `/api/threads/search?q=${encodeURIComponent(query.trim())}`,
        )
        .then((payload) => {
          if (latest.current === request) setResults(payload.results);
        })
        .catch((e) => {
          if (latest.current === request) setError(asMessage(e));
        })
        .finally(() => {
          if (latest.current === request) setSearching(false);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [api, query, active, server]);
  if (active && !server)
    return {
      active,
      results: loaded.flatMap((thread) => {
        const nameMatch = thread.name ? findMatch(thread.name, query) : null;
        return nameMatch ? [{ thread, nameMatch, snippet: null }] : [];
      }),
      searching: false,
      error: "",
    };
  return { active, results, searching, error };
}

export function useThreadLabels(api: MuseApi, enabled: boolean) {
  const [labels, setLabels] = useState<ThreadLabel[]>([]);
  const [error, setError] = useState("");
  const refetch = useCallback(() => {
    if (!enabled) return;
    setError("");
    void api
      .request<{ labels: ThreadLabel[] }>("/api/threads/labels")
      .then((payload) => setLabels(payload.labels))
      .catch((e) => setError(asMessage(e)));
  }, [api, enabled]);
  useEffect(refetch, [refetch]);
  const sort = (items: ThreadLabel[]) => items.sort((a, b) => a.name.localeCompare(b.name, "fa"));
  return {
    labels,
    error,
    refetch,
    create: async (name: string) => {
      const label = await api.request<ThreadLabel>("/api/threads/labels", { name });
      setLabels((items) =>
        items.some((item) => item.id === label.id) ? items : sort([...items, label]),
      );
      return label;
    },
    remove: async (id: string) => {
      await api.request(`/api/threads/labels/${encodeURIComponent(id)}`, undefined, "DELETE");
      setLabels((items) => items.filter((item) => item.id !== id));
    },
  };
}

/** Text with one highlighted range; the range indexes into `text`. */
export function Highlighted({
  text,
  range,
  style,
  numberOfLines,
  prefix,
}: {
  text: string;
  range: TextRange | null;
  style: StyleProp<TextStyle>;
  numberOfLines?: number;
  prefix?: string;
}) {
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[style, { textAlign: "auto", writingDirection: "auto" }]}
    >
      {prefix ? <Text style={fw("600")}>{prefix}</Text> : null}
      {range ? (
        <>
          {text.slice(0, range.start)}
          <Text style={{ backgroundColor: colors.orange, color: colors.text, ...fw("700") }}>
            {text.slice(range.start, range.end)}
          </Text>
          {text.slice(range.end)}
        </>
      ) : (
        text
      )}
    </Text>
  );
}

export function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <View style={[s.row, s.input, { gap: 8, paddingVertical: 0 }]}>
      <Search size={17} color={colors.muted} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="جست‌وجو در گفت‌وگوها"
        placeholderTextColor={colors.muted}
        accessibilityLabel="جست‌وجو در گفت‌وگوها"
        returnKeyType="search"
        autoCorrect={false}
        style={[s.text, { flex: 1, minHeight: 43, paddingVertical: 8, textAlign: "auto" }]}
      />
      {value !== "" && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="پاک کردن جست‌وجو"
          hitSlop={8}
          onPress={() => onChange("")}
        >
          <X size={17} color={colors.muted} />
        </Pressable>
      )}
    </View>
  );
}

export function SearchResults({
  query,
  search,
  server,
  mainId,
  onOpen,
}: {
  query: string;
  search: ReturnType<typeof useThreadSearch>;
  server: boolean;
  mainId: string;
  onOpen: (id: string) => void;
}) {
  return (
    <View style={{ gap: 4 }}>
      {!server && (
        <Text style={s.small}>
          در این حالت فقط نام گفت‌وگوهای بارگذاری‌شده جست‌وجو می‌شود، نه متن پیام‌ها.
        </Text>
      )}
      {search.searching && <ActivityIndicator color={colors.blueDark} />}
      <ErrorNotice error={search.error} />
      {!search.searching && !search.error && search.results.length === 0 && (
        <Text style={s.muted}>
          گفت‌وگویی با «{query.trim()}» پیدا نشد. واژهٔ دیگری را امتحان کنید یا املای آن را بررسی
          کنید.
        </Text>
      )}
      {search.results.map(({ thread, nameMatch, snippet }) => {
        const title = thread.id === mainId ? "گفت‌وگوی اصلی" : thread.name || "گفت‌وگوی بی‌نام";
        return (
          <Pressable
            key={thread.id}
            accessibilityRole="button"
            accessibilityLabel={`باز کردن گفت‌وگو: ${title}`}
            onPress={() => onOpen(thread.id)}
            style={({ pressed }) => [
              {
                paddingVertical: 10,
                borderBottomWidth: 1,
                borderBottomColor: colors.line,
                gap: 4,
              },
              pressed && { opacity: 0.7 },
            ]}
          >
            <View style={[s.row, { gap: 10 }]}>
              <MessageCircle size={17} color={colors.text} />
              <Highlighted
                text={title}
                range={thread.id === mainId ? null : nameMatch}
                style={[s.text, { flex: 1, ...fw("600") }]}
                numberOfLines={1}
              />
              {thread.archived && <Text style={s.small}>بایگانی‌شده</Text>}
            </View>
            {snippet && (
              <Highlighted
                prefix={snippet.role === "user" ? "شما: " : "دستیار: "}
                text={snippet.text}
                range={snippet}
                style={s.muted}
                numberOfLines={2}
              />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

function LabelChip({
  label,
  selected,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        s.row,
        s.chip,
        { gap: 4, paddingVertical: 5, backgroundColor: selected ? colors.blue : colors.subtle },
      ]}
    >
      {selected && <Check size={12} color={colors.text} />}
      <Text style={[s.chipText, { color: colors.text, fontSize: 12, lineHeight: 18 }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Label filter chips plus a small label manager (create and delete). */
export function LabelBar({
  labels,
  filter,
  onFilter,
}: {
  labels: ReturnType<typeof useThreadLabels>;
  filter: string | null;
  onFilter: (id: string | null) => void;
}) {
  const [managing, setManaging] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<string>();
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const confirmLabel = labels.labels.find((label) => label.id === confirming);
  return (
    <View style={{ gap: 8 }}>
      <View style={[s.row, { gap: 6, flexWrap: "wrap" }]}>
        <Tag size={15} color={colors.muted} />
        {labels.labels.length > 0 && (
          <LabelChip
            label="همه"
            accessibilityLabel="نمایش همهٔ گفت‌وگوها"
            selected={filter === null}
            onPress={() => onFilter(null)}
          />
        )}
        {labels.labels.map((label) => (
          <LabelChip
            key={label.id}
            label={label.name}
            accessibilityLabel={`فقط گفت‌وگوهای با برچسب ${label.name}`}
            selected={filter === label.id}
            onPress={() => onFilter(filter === label.id ? null : label.id)}
          />
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: managing }}
          onPress={() => setManaging(!managing)}
          hitSlop={6}
        >
          <Text style={[s.small, { color: colors.blueDark, ...fw("600") }]}>
            {managing ? "بستن مدیریت برچسب‌ها" : "مدیریت برچسب‌ها"}
          </Text>
        </Pressable>
      </View>
      <ErrorNotice error={labels.error || error} />
      {managing && (
        <View style={[s.card, { padding: 14, gap: 10 }]}>
          <View style={[s.row, { gap: 8 }]}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="نام برچسب تازه، مثلاً «کار»"
              placeholderTextColor={colors.muted}
              accessibilityLabel="نام برچسب تازه"
              maxLength={40}
              style={[s.input, { flex: 1, minHeight: 40, paddingVertical: 7, textAlign: "auto" }]}
            />
            <Button
              small
              icon={Plus}
              busy={busy}
              disabled={!name.trim()}
              onPress={() =>
                void run(async () => {
                  await labels.create(name.trim());
                  setName("");
                })
              }
            >
              افزودن برچسب
            </Button>
          </View>
          {labels.labels.length === 0 && (
            <Text style={s.small}>
              هنوز برچسبی نساخته‌اید. با برچسب‌هایی مثل «کار» یا «خانواده» گفت‌وگوها را دسته‌بندی کنید.
            </Text>
          )}
          {confirmLabel ? (
            <View style={{ gap: 8 }}>
              <Text style={s.text}>برچسب «{confirmLabel.name}» حذف شود؟</Text>
              <Text style={s.small}>
                گفت‌وگوها حذف نمی‌شوند؛ فقط این برچسب از آن‌ها برداشته می‌شود.
              </Text>
              <View style={[s.row, { gap: 8 }]}>
                <Button
                  small
                  danger
                  busy={busy}
                  onPress={() =>
                    void run(async () => {
                      await labels.remove(confirmLabel.id);
                      if (filter === confirmLabel.id) onFilter(null);
                      setConfirming(undefined);
                    })
                  }
                >
                  حذف
                </Button>
                <Button small onPress={() => setConfirming(undefined)}>
                  انصراف
                </Button>
              </View>
            </View>
          ) : (
            labels.labels.map((label) => (
              <View key={label.id} style={s.between}>
                <Text style={[s.text, { flex: 1, textAlign: "auto" }]}>{label.name}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`حذف برچسب ${label.name}`}
                  onPress={() => setConfirming(label.id)}
                  hitSlop={6}
                >
                  <Text style={[s.small, { color: colors.danger }]}>حذف برچسب</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>
      )}
    </View>
  );
}

/** Toggle chips for the labels of one thread. */
export function LabelPicker({
  labels,
  selected,
  disabled,
  onChange,
}: {
  labels: ThreadLabel[];
  selected: string[];
  disabled?: boolean;
  onChange: (labels: string[]) => void;
}) {
  if (!labels.length)
    return (
      <Text style={s.small}>
        هنوز برچسبی ندارید. از «مدیریت برچسب‌ها» در بالای فهرست یک برچسب بسازید.
      </Text>
    );
  return (
    <View style={[s.row, { gap: 6, flexWrap: "wrap" }]}>
      {labels.map((label) => {
        const on = selected.includes(label.id);
        return (
          <LabelChip
            key={label.id}
            label={label.name}
            accessibilityLabel={on ? `برداشتن برچسب ${label.name}` : `افزودن برچسب ${label.name}`}
            selected={on}
            onPress={() => {
              if (disabled) return;
              onChange(on ? selected.filter((id) => id !== label.id) : [...selected, label.id]);
            }}
          />
        );
      })}
    </View>
  );
}
