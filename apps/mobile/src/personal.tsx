import {
  BookOpenCheck,
  Brain,
  Calculator,
  GraduationCap,
  Languages,
  type LucideIcon,
  Megaphone,
  Scale,
  Trash2,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import type { AgentMemory } from "../../../packages/domain/src/agent";
import {
  CUSTOM_INSTRUCTION_MAX,
  MEMORY_MAX_ITEMS,
  MEMORY_TEXT_MAX,
  PERSONAS,
  type Persona,
  type PersonaIcon,
} from "../../../packages/domain/src/personal";
import { useAgentWorkspace } from "./agent-workspace";
import { faDateTime, faNumber, fw } from "./locale";
import { Button, Card, CheckRow, colors, ErrorNotice, Field, LinkRow, Sheet, s } from "./ui";
import { useWorkspace } from "./workspace";

const personaIcons: Record<PersonaIcon, LucideIcon> = {
  scale: Scale,
  calculator: Calculator,
  "graduation-cap": GraduationCap,
  megaphone: Megaphone,
  languages: Languages,
  "book-open-check": BookOpenCheck,
};
export function personaIcon(persona: Persona): LucideIcon {
  return personaIcons[persona.icon] ?? Brain;
}

function Counter({ value, max }: { value: string; max: number }) {
  return (
    <Text style={[s.small, { marginTop: -10, marginBottom: 12 }]}>
      {faNumber(value.length)} از {faNumber(max)} نویسه
    </Text>
  );
}

/** «حافظه»: custom instructions, the memory toggle and the saved memory list. */
export function MemorySheet() {
  const { close, notify } = useWorkspace();
  const { data, mutate } = useAgentWorkspace();
  const personal = data?.personal;
  const memories = data?.memories ?? [];
  const [about, setAbout] = useState(personal?.about ?? "");
  const [style, setStyle] = useState(personal?.responseStyle ?? "");
  const [draft, setDraft] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
  const loaded = Boolean(personal);
  // Fill the fields once the first snapshot arrives; later polls never overwrite typing.
  useEffect(() => {
    if (!loaded || !personal) return;
    setAbout(personal.about);
    setStyle(personal.responseStyle);
  }, [loaded]);
  async function run(key: string, action: () => Promise<unknown>, done?: string) {
    setBusy(key);
    setError("");
    try {
      await action();
      if (done) notify(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  }
  const enabled = personal?.memoryEnabled !== false;
  return (
    <Sheet
      title="حافظه"
      subtitle="آنچه دستیار دربارهٔ شما می‌داند و روشی که دوست دارید پاسخ بگیرید."
      onClose={close}
    >
      <View style={{ gap: 16 }}>
        <ErrorNotice error={error} />
        <Card style={{ gap: 4 }}>
          <Text style={s.heading}>دستورهای سفارشی</Text>
          <Text style={[s.muted, { marginBottom: 12 }]}>
            دستیار در همهٔ گفت‌وگوها این‌ها را در نظر می‌گیرد.
          </Text>
          <Field
            label="دربارهٔ شما"
            value={about}
            onChangeText={setAbout}
            maxLength={CUSTOM_INSTRUCTION_MAX}
            multiline
            placeholder="مثلاً: برنامه‌نویس هستم، در شیراز زندگی می‌کنم و دو فرزند دارم."
          />
          <Counter value={about} max={CUSTOM_INSTRUCTION_MAX} />
          <Field
            label="دوست دارید چطور پاسخ دهم؟"
            value={style}
            onChangeText={setStyle}
            maxLength={CUSTOM_INSTRUCTION_MAX}
            multiline
            placeholder="مثلاً: کوتاه و فهرست‌وار، با مثال‌های کاربردی."
          />
          <Counter value={style} max={CUSTOM_INSTRUCTION_MAX} />
          <Button
            primary
            busy={busy === "personal"}
            disabled={!loaded}
            onPress={() =>
              void run(
                "personal",
                () => mutate("/personal", { about: about.trim(), responseStyle: style.trim() }),
                "ذخیره شد",
              )
            }
          >
            ذخیرهٔ دستورها
          </Button>
        </Card>
        <Card style={{ gap: 10 }}>
          <Text style={s.heading}>حافظهٔ بلندمدت</Text>
          <CheckRow
            label="دستیار نکته‌های ماندگار دربارهٔ من را به خاطر بسپارد"
            checked={enabled}
            onPress={() => {
              if (loaded && !busy)
                void run(
                  "toggle",
                  () => mutate("/personal", { memoryEnabled: !enabled }),
                  enabled ? "حافظه خاموش شد" : "حافظه روشن شد",
                );
            }}
          />
          <Text style={s.small}>
            {enabled
              ? "وقتی نکته‌ای ماندگار دربارهٔ خودتان بگویید یا بخواهید چیزی را به خاطر بسپارد، دستیار آن را اینجا ذخیره می‌کند. هر مورد را می‌توانید ویرایش یا حذف کنید."
              : "حافظه خاموش است. دستیار چیز تازه‌ای ذخیره نمی‌کند و موارد ذخیره‌شده را در پاسخ‌ها به کار نمی‌برد."}
          </Text>
          {enabled && (
            <>
              <Field
                label="افزودن نکته به حافظه"
                value={draft}
                onChangeText={setDraft}
                maxLength={MEMORY_TEXT_MAX}
                placeholder="مثلاً: جلسه‌های صبح را ترجیح می‌دهم."
              />
              <Button
                busy={busy === "add"}
                disabled={!draft.trim() || memories.length >= MEMORY_MAX_ITEMS}
                onPress={() =>
                  void run(
                    "add",
                    async () => {
                      await mutate("/memories", {
                        text: draft.trim(),
                        source: "افزوده‌شده توسط شما",
                      });
                      setDraft("");
                    },
                    "به حافظه اضافه شد",
                  )
                }
              >
                افزودن به حافظه
              </Button>
            </>
          )}
          <View style={s.divider} />
          {memories.length ? (
            <>
              <Text style={s.small}>
                {faNumber(memories.length)} مورد از {faNumber(MEMORY_MAX_ITEMS)}
              </Text>
              {memories.map((item) => (
                <MemoryRow key={item.id} memory={item} />
              ))}
            </>
          ) : (
            <Text style={s.muted}>
              هنوز چیزی در حافظه نیست. در گفت‌وگو بگویید «به خاطر بسپار که…» یا نکته‌ای را همین‌جا
              اضافه کنید.
            </Text>
          )}
          {memories.length > 0 &&
            (confirmClear ? (
              <View
                style={{ gap: 8, padding: 12, borderRadius: 14, backgroundColor: colors.canvas }}
              >
                <Text style={[s.text, fw("600")]}>همهٔ حافظه پاک شود؟</Text>
                <Text style={s.small}>
                  {faNumber(memories.length)} مورد برای همیشه حذف می‌شود و بازگرداندنی نیست. دستورهای
                  سفارشی دست نمی‌خورند.
                </Text>
                <View style={[s.row, { gap: 8 }]}>
                  <Button
                    small
                    danger
                    busy={busy === "clear"}
                    onPress={() =>
                      void run(
                        "clear",
                        async () => {
                          await mutate("/memories/clear", {});
                          setConfirmClear(false);
                        },
                        "حافظه پاک شد",
                      )
                    }
                  >
                    پاک کردن
                  </Button>
                  <Button small onPress={() => setConfirmClear(false)}>
                    انصراف
                  </Button>
                </View>
              </View>
            ) : (
              <Button danger icon={Trash2} onPress={() => setConfirmClear(true)}>
                پاک کردن همهٔ حافظه
              </Button>
            ))}
        </Card>
      </View>
    </Sheet>
  );
}

function MemoryRow({ memory }: { memory: AgentMemory }) {
  const { mutate } = useAgentWorkspace();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(memory.text);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function act(forget: boolean) {
    setBusy(true);
    setError("");
    try {
      await mutate(`/memories/${memory.id}${forget ? "/forget" : ""}`, forget ? {} : { text });
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View
      style={{ gap: 8, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.line }}
    >
      {editing ? (
        <Field
          label="ویرایش نکته"
          value={text}
          onChangeText={setText}
          maxLength={MEMORY_TEXT_MAX}
        />
      ) : (
        <Text style={[s.text, { textAlign: "auto", writingDirection: "auto" }]}>{memory.text}</Text>
      )}
      <Text style={s.small}>
        {memory.source} · {faDateTime(memory.updatedAt ?? memory.createdAt)}
      </Text>
      <View style={[s.row, { gap: 8 }]}>
        {editing ? (
          <>
            <Button small busy={busy} disabled={!text.trim()} onPress={() => void act(false)}>
              ذخیره
            </Button>
            <Button
              small
              onPress={() => {
                setText(memory.text);
                setEditing(false);
              }}
            >
              انصراف
            </Button>
          </>
        ) : (
          <>
            <Button small onPress={() => setEditing(true)}>
              ویرایش
            </Button>
            <Button small danger busy={busy} onPress={() => void act(true)}>
              حذف از حافظه
            </Button>
          </>
        )}
      </View>
      <ErrorNotice error={error} />
    </View>
  );
}

/** Ready-made assistants; picking one starts a new conversation pinned to it. */
export function PersonaList({ onPick }: { onPick: (persona: Persona) => void }) {
  return (
    <View>
      {PERSONAS.map((persona) => (
        <LinkRow
          key={persona.id}
          icon={personaIcon(persona)}
          title={persona.name}
          detail={persona.description}
          onPress={() => onPick(persona)}
        />
      ))}
    </View>
  );
}

/** Header of a conversation pinned to a ready-made assistant. */
export function PersonaBanner({ persona }: { persona: Persona }) {
  const Icon = personaIcon(persona);
  return (
    <Card style={{ gap: 8, padding: 16, backgroundColor: colors.subtle }}>
      <View style={[s.row, { gap: 10 }]}>
        <View style={[s.iconBox, { width: 36, height: 36, borderRadius: 11 }]}>
          <Icon size={17} color={colors.text} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.heading}>دستیار آماده: {persona.name}</Text>
          <Text style={s.small}>{persona.description}</Text>
        </View>
      </View>
      {persona.notice && <Text style={[s.small, { color: colors.text }]}>{persona.notice}</Text>}
    </Card>
  );
}
