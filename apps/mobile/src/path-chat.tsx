import { Bell, Compass, Pencil } from "lucide-react-native";
import { useCallback, useState, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import { formatJalali } from "../../../packages/domain/src/iran-holidays";
import {
  matchPathTopic,
  type PathShortcut,
  selectedPaths,
  suggestedPersonaIds,
  type UpcomingDeadline,
  type UserProfile,
  upcomingDeadlines,
} from "../../../packages/domain/src/paths";
import { findPersona, type Persona } from "../../../packages/domain/src/personal";
import { friendlyError } from "./api";
import { faNumber, fw } from "./locale";
import { personaIcon } from "./personal";
import { pathIcon } from "./profile";
import { useMuseThread } from "./threads";
import { Button, colors, ErrorNotice, s } from "./ui";
import { useWorkspace } from "./workspace";

// --- Per-device id sets (hidden reminders, closed suggestions) ------------------------------------

type IdStore = { ids: ReadonlySet<string>; listeners: Set<() => void> };
const idStores = new Map<string, IdStore>();
const MAX_STORED_IDS = 100;

function idStore(key: string): IdStore {
  let store = idStores.get(key);
  if (!store) {
    let ids: string[] = [];
    try {
      const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(key) ?? "[]");
      if (Array.isArray(parsed)) ids = parsed.filter((id) => typeof id === "string");
    } catch {}
    store = { ids: new Set(ids), listeners: new Set() };
    idStores.set(key, store);
  }
  return store;
}

/**
 * A small set of ids kept on this device (localStorage on web, memory elsewhere or when storage
 * is blocked), shared by every mounted conversation.
 */
export function useStoredIds(key: string): [ReadonlySet<string>, (id: string) => void] {
  const store = idStore(key);
  const ids = useSyncExternalStore(
    useCallback(
      (listener: () => void) => {
        store.listeners.add(listener);
        return () => {
          store.listeners.delete(listener);
        };
      },
      [store],
    ),
    () => store.ids,
    () => store.ids,
  );
  const add = useCallback(
    (id: string) => {
      if (store.ids.has(id)) return;
      const next = [...store.ids, id].slice(-MAX_STORED_IDS);
      store.ids = new Set(next);
      try {
        globalThis.localStorage?.setItem(key, JSON.stringify(next));
      } catch {}
      for (const listener of store.listeners) listener();
    },
    [key, store],
  );
  return [ids, add];
}

// --- Empty chat -----------------------------------------------------------------------------------

/** «امروز»، «فردا» or «۹ روز مانده». */
export function daysLeftLabel(days: number): string {
  if (days <= 0) return "امروز";
  if (days === 1) return "فردا";
  return `${faNumber(days)} روز مانده`;
}

/** A quiet text button («بعداً»، «بستن») with its own spoken label. */
function QuietButton({
  label,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 38,
        paddingHorizontal: 14,
        justifyContent: "center",
        borderRadius: 20,
        backgroundColor: pressed ? colors.line : "transparent",
      })}
    >
      <Text style={[s.buttonText, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

const cardBox = {
  width: "100%",
  maxWidth: 420,
  borderRadius: 22,
  padding: 16,
  gap: 8,
} as const;

/** «امور مالی · فروش آنلاین · تغییر» above the greeting; nothing while no path is chosen. */
export function PathTags({
  profile,
  onChange,
}: {
  profile: UserProfile | undefined;
  onChange: () => void;
}) {
  const paths = profile ? selectedPaths(profile) : [];
  if (!paths.length) return null;
  return (
    <View
      style={[
        s.row,
        { width: "100%", maxWidth: 420, gap: 6, flexWrap: "wrap", justifyContent: "center" },
      ]}
    >
      <View
        accessible
        accessibilityLabel={`مسیرهای من: ${paths.map((path) => path.shortName).join("، ")}`}
        style={[s.row, { gap: 6, flexWrap: "wrap", justifyContent: "center", flexShrink: 1 }]}
      >
        {paths.map((path) => {
          const Icon = pathIcon(path.icon);
          return (
            <View key={path.id} style={[s.row, tag, { backgroundColor: colors.sky }]}>
              <Icon size={13} color={colors.blueDark} />
              <Text style={[tagText, { color: colors.blueDark }]}>{path.shortName}</Text>
            </View>
          );
        })}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="تغییر مسیرهای من"
        hitSlop={6}
        onPress={onChange}
        style={({ pressed }) => [
          s.row,
          tag,
          { backgroundColor: pressed ? colors.line : colors.subtle },
        ]}
      >
        <Pencil size={12} color={colors.muted} />
        <Text style={[tagText, { color: colors.muted }]}>تغییر</Text>
      </Pressable>
    </View>
  );
}
const tag = { gap: 5, paddingHorizontal: 11, paddingVertical: 5, borderRadius: 16 } as const;
const tagText = { fontSize: 12, lineHeight: 18, ...fw("600") } as const;

/** The nearest legal deadline of the person's paths. */
function DeadlineCard({
  deadline,
  onAction,
  onLater,
}: {
  deadline: UpcomingDeadline;
  onAction: () => void;
  onLater: () => void;
}) {
  return (
    <View style={[cardBox, { backgroundColor: colors.orange }]}>
      <View style={[s.row, { gap: 9, alignItems: "flex-start" }]}>
        <Bell size={17} color={colors.text} style={{ marginTop: 4 }} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[s.heading, { fontSize: 15, lineHeight: 24 }]}>{deadline.title}</Text>
          <Text style={[s.small, { color: colors.text }]}>
            {formatJalali(deadline.date)} · {daysLeftLabel(deadline.daysLeft)}
          </Text>
          <Text style={[s.small, { fontSize: 11, lineHeight: 18 }]}>
            مهلت قانونی؛ ممکن است تمدید شود.
          </Text>
        </View>
      </View>
      <View style={[s.row, { gap: 6, flexWrap: "wrap" }]}>
        <Button small style={{ backgroundColor: colors.card }} onPress={onAction}>
          {deadline.action}
        </Button>
        <QuietButton label="بعداً" accessibilityLabel="پنهان کردن این یادآوری" onPress={onLater} />
      </View>
    </View>
  );
}

/** Card for people who joined before «مسیرهای من» existed. */
function InviteCard({ onChoose, onClose }: { onChoose: () => void; onClose: () => void }) {
  return (
    <View style={[cardBox, { backgroundColor: colors.sky, gap: 12 }]}>
      <View style={[s.row, { gap: 12, alignItems: "flex-start" }]}>
        <View style={[s.iconBox, { width: 38, height: 38, backgroundColor: colors.card }]}>
          <Compass size={18} color={colors.blueDark} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[s.heading, { fontSize: 15, lineHeight: 24 }]}>
            دستیار را برای کار خودتان تنظیم کنید
          </Text>
          <Text style={s.small}>
            مسیر کاری‌تان را انتخاب کنید تا پیشنهادها و میان‌برها مناسب شما شوند.
          </Text>
        </View>
      </View>
      <View style={[s.row, { gap: 6, flexWrap: "wrap" }]}>
        <Button small primary onPress={onChoose}>
          انتخاب مسیر
        </Button>
        <QuietButton label="بستن" accessibilityLabel="بستن کارت انتخاب مسیر" onPress={onClose} />
      </View>
    </View>
  );
}

const HIDDEN_DEADLINES = "dastyar.hiddenDeadlines";

/**
 * Under the greeting of the empty chat: the invitation for existing people and the nearest
 * deadline reminder of «مسیرهای من». `send` posts a message the same way the starters do.
 */
export function PathWelcome({
  profile,
  invite,
  onSetup,
  onDismissInvite,
  send,
}: {
  profile: UserProfile | undefined;
  /** Show the invitation card (onboarding finished, paths never chosen, card never closed). */
  invite: boolean;
  onSetup: () => void;
  onDismissInvite: () => void;
  send: (prompt: string) => void;
}) {
  const [hidden, hide] = useStoredIds(HIDDEN_DEADLINES);
  const deadline = profile
    ? upcomingDeadlines(profile).find((item) => !hidden.has(item.id))
    : undefined;
  return (
    <>
      {invite && <InviteCard onChoose={onSetup} onClose={onDismissInvite} />}
      {deadline && (
        <DeadlineCard
          deadline={deadline}
          onAction={() => send(deadline.prompt)}
          onLater={() => hide(deadline.id)}
        />
      )}
    </>
  );
}

/** «گفت‌وگو با حسابدار»: new conversations with the assistants the person's paths suggest. */
export function PersonaChips({ profile }: { profile: UserProfile | undefined }) {
  const { enabled, start } = useMuseThread();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
  const personas = (profile ? suggestedPersonaIds(profile) : [])
    .map(findPersona)
    .filter((persona): persona is Persona => Boolean(persona))
    .slice(0, 2);
  // Without separate conversations a pinned assistant could not be shown or kept.
  if (!enabled || !personas.length) return null;
  return (
    <View style={{ width: "100%", maxWidth: 420, gap: 8, alignItems: "center" }}>
      <View style={[s.row, { gap: 8, flexWrap: "wrap", justifyContent: "center" }]}>
        {personas.map((persona) => (
          <Button
            key={persona.id}
            small
            icon={personaIcon(persona)}
            busy={busy === persona.id}
            disabled={!!busy}
            style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line }}
            onPress={() => {
              setBusy(persona.id);
              setError("");
              start(persona.id)
                .catch((e) => setError(friendlyError(e)))
                .finally(() => setBusy(undefined));
            }}
          >
            {`گفت‌وگو با ${persona.name}`}
          </Button>
        ))}
      </View>
      <ErrorNotice error={error} />
    </View>
  );
}

// --- Inside a conversation ------------------------------------------------------------------------

const CLOSED_PERSONA_HINTS = "dastyar.closedPersonaHints";

/**
 * «ادامه با حسابدار؟» under the last answer when the conversation turned to one of the person's
 * paths and has no ready-made assistant yet. Never switches by itself.
 */
export function PersonaSuggestion({
  threadId,
  profile,
  text,
  pin,
  onPrompt,
}: {
  threadId: string;
  profile: UserProfile | undefined;
  /** The last few messages the person wrote. */
  text: string;
  /** Pins the assistant to this conversation; rejects with a Persian message. */
  pin: (personaId: string) => Promise<void>;
  /** Sends (or, for a prompt that expects pasted text, prefills) a shortcut prompt. */
  onPrompt: (prompt: string) => void;
}) {
  const { notify } = useWorkspace();
  const [closed, close] = useStoredIds(CLOSED_PERSONA_HINTS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!profile || closed.has(threadId)) return null;
  const path = matchPathTopic(profile, text);
  const persona = findPersona(path?.personaId);
  if (!path || !persona) return null;
  const Icon = personaIcon(persona);
  const shortcuts = path.shortcuts
    .filter((item): item is PathShortcut & { prompt: string } => !!item.prompt)
    .slice(0, 2);
  return (
    <View style={{ gap: 10 }}>
      {shortcuts.length > 0 && (
        <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
          {shortcuts.map((item) => (
            <Button
              key={item.id}
              small
              icon={pathIcon(item.icon)}
              style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line }}
              onPress={() => onPrompt(item.prompt)}
            >
              {item.label}
            </Button>
          ))}
        </View>
      )}
      <View style={[cardBox, { maxWidth: 480, backgroundColor: colors.lavender, gap: 12 }]}>
        <View style={[s.row, { gap: 12, alignItems: "flex-start" }]}>
          <View style={[s.iconBox, { width: 38, height: 38, backgroundColor: colors.card }]}>
            <Icon size={18} color={colors.text} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[s.heading, { fontSize: 15, lineHeight: 24 }]}>
              {`ادامه با ${persona.name}؟`}
            </Text>
            <Text style={s.small}>پاسخ‌های دقیق‌تر در همین گفت‌وگو</Text>
          </View>
        </View>
        <ErrorNotice error={error} />
        <View style={[s.row, { gap: 6, flexWrap: "wrap" }]}>
          <Button
            small
            primary
            busy={busy}
            onPress={() => {
              setBusy(true);
              setError("");
              pin(persona.id)
                .then(() => notify(`${persona.name} به این گفت‌وگو اضافه شد`))
                .catch((e) => setError(friendlyError(e)))
                .finally(() => setBusy(false));
            }}
          >
            {`ادامه با ${persona.name}`}
          </Button>
          <QuietButton
            label="بستن"
            accessibilityLabel={`بستن پیشنهاد ادامه با ${persona.name}`}
            onPress={() => close(threadId)}
          />
        </View>
      </View>
    </View>
  );
}
