import { Copy, KeyRound, Plus, RefreshCw, UserPlus, Users } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Platform, Share, Text, View } from "react-native";
import type { MuseApi } from "./api";
import { faDigits, faNumber, fw, toLatinDigits } from "./locale";
import { Button, Card, Chip, colors, Empty, ErrorNotice, Field, Sheet, s } from "./ui";

export type DailyUsage = {
  date: string;
  messages: number;
  tasks: number;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};
export type Limits = { messages: number | null; tasks: number | null };
type Quota = { dailyMessages?: number | null; dailyTasks?: number | null };
export type AdminUser = {
  id: string;
  name: string;
  label?: string;
  phone?: string;
  role: "admin" | "user";
  status: "active" | "disabled";
  source: "env" | "db";
  plan: "free";
  quota?: Quota;
  createdAt: string;
  sessions: number;
  usage: DailyUsage;
  limits: Limits;
};
type Confirm = { id: string; action: "disable" | "rotate" | "sessions" };

const ltr = { writingDirection: "ltr" as const, textAlign: "auto" as const };
const displayName = (user: { name: string; label?: string }) => user.label || user.name;
const limitLabel = (value: number | null) => (value === null ? "نامحدود" : faNumber(value));
/** «۵ از ۲۰۰ پیام», or «۵ پیام» when there is no limit. */
const used = (count: number, limit: number | null, noun: string) =>
  limit === null
    ? `${faNumber(count)} ${noun}`
    : `${faNumber(count)} از ${faNumber(limit)} ${noun}`;

/** Copies on web; on phones opens the share sheet so the key can go to a password manager or chat. */
async function copyText(text: string) {
  if (Platform.OS === "web" && globalThis.navigator?.clipboard) {
    await globalThis.navigator.clipboard.writeText(text);
    return "کپی شد";
  }
  await Share.share({ message: text });
  return "";
}
const quotaInput = (value?: number | null) =>
  value === undefined || value === null ? "" : faDigits(value);
function parseQuota(raw: string): number | null | "invalid" {
  const value = toLatinDigits(raw).trim();
  if (!value) return null;
  return /^\d{1,7}$/.test(value) ? Number(value) : "invalid";
}

function KeyReveal({ title, value, onDone }: { title: string; value: string; onDone: () => void }) {
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");
  return (
    <Card style={{ backgroundColor: colors.orange, gap: 10 }}>
      <Text style={s.heading}>{title}</Text>
      <Text selectable style={[s.text, ltr, { fontSize: 16 }]}>
        {value}
      </Text>
      <Text style={s.small}>
        این کلید فقط همین یک بار نمایش داده می‌شود. آن را در جای امنی نگه دارید و به کاربر بدهید.
      </Text>
      <ErrorNotice error={error} />
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button
          small
          primary
          icon={Copy}
          onPress={() =>
            void copyText(value)
              .then(setCopied)
              .catch(() => setError("کلید کپی نشد. آن را انتخاب و دستی کپی کنید."))
          }
        >
          {copied || "کپی کلید"}
        </Button>
        <Button small onPress={onDone}>
          تمام
        </Button>
      </View>
    </Card>
  );
}

function CreateUser({
  api,
  onCreated,
}: {
  api: MuseApi;
  onCreated: (user: AdminUser, key: string) => void;
}) {
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true);
    setError("");
    try {
      const result = await api.request<{ user: AdminUser; key: string }>("/api/admin/users", {
        name: name.trim(),
        label: label.trim() || undefined,
        phone: toLatinDigits(phone).trim() || undefined,
        role,
      });
      setName("");
      setLabel("");
      setPhone("");
      setRole("user");
      onCreated(result.user, result.key);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card style={{ gap: 4 }}>
      <Text style={[s.heading, { marginBottom: 10 }]}>کاربر تازه</Text>
      <ErrorNotice error={error} />
      <Field
        label="نام کاربری (حروف کوچک انگلیسی)"
        value={name}
        onChangeText={setName}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="ali"
        style={ltr}
      />
      <Field label="نام نمایشی" value={label} onChangeText={setLabel} placeholder="علی رضایی" />
      <Field
        label="شمارهٔ موبایل (اختیاری، برای ورود با پیامک)"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholder="۰۹۱۲۱۲۳۴۵۶۷"
        style={ltr}
      />
      <View style={[s.row, { gap: 8, marginBottom: 14 }]}>
        <Button small primary={role === "user"} onPress={() => setRole("user")}>
          کاربر عادی
        </Button>
        <Button small primary={role === "admin"} onPress={() => setRole("admin")}>
          مدیر
        </Button>
      </View>
      <Button
        primary
        icon={UserPlus}
        busy={busy}
        disabled={!name.trim()}
        onPress={() => void submit()}
      >
        ساخت کاربر
      </Button>
    </Card>
  );
}

function EditUser({
  api,
  user,
  onSaved,
  onCancel,
}: {
  api: MuseApi;
  user: AdminUser;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(user.label ?? "");
  const [phone, setPhone] = useState(user.phone ? faDigits(user.phone) : "");
  const [messages, setMessages] = useState(quotaInput(user.quota?.dailyMessages));
  const [tasks, setTasks] = useState(quotaInput(user.quota?.dailyTasks));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    const dailyMessages = parseQuota(messages);
    const dailyTasks = parseQuota(tasks);
    if (dailyMessages === "invalid" || dailyTasks === "invalid") {
      setError("سقف روزانه باید یک عدد صحیح باشد. برای مقدار پیش‌فرض، خانه را خالی بگذارید.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.request(
        `/api/admin/users/${encodeURIComponent(user.id)}`,
        {
          label: label.trim() || null,
          phone: toLatinDigits(phone).trim() || null,
          quota: { dailyMessages, dailyTasks },
        },
        "PATCH",
      );
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ marginTop: 12 }}>
      <ErrorNotice error={error} />
      <Field label="نام نمایشی" value={label} onChangeText={setLabel} />
      <Field
        label="شمارهٔ موبایل"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholder="۰۹۱۲۱۲۳۴۵۶۷"
        style={ltr}
      />
      <Field
        label="سقف پیام روزانه (خالی: پیش‌فرض، ۰: نامحدود)"
        value={messages}
        onChangeText={setMessages}
        keyboardType="number-pad"
      />
      <Field
        label="سقف کار روزانه (خالی: پیش‌فرض، ۰: نامحدود)"
        value={tasks}
        onChangeText={setTasks}
        keyboardType="number-pad"
      />
      <View style={[s.row, { gap: 8 }]}>
        <Button small primary busy={busy} onPress={() => void save()}>
          ذخیره
        </Button>
        <Button small onPress={onCancel}>
          انصراف
        </Button>
      </View>
    </View>
  );
}

function UserRow({
  api,
  user,
  me,
  reload,
  reveal,
}: {
  api: MuseApi;
  user: AdminUser;
  me?: string;
  reload: () => Promise<void>;
  reveal: (title: string, key: string) => void;
}) {
  const [confirm, setConfirm] = useState<Confirm>();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = user.id === "local-user" || user.id === me;
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      setConfirm(undefined);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const path = `/api/admin/users/${encodeURIComponent(user.id)}`;
  const name = displayName(user);
  const questions: Record<Confirm["action"], { title: string; detail: string; button: string }> = {
    disable: {
      title: `دسترسی «${name}» قطع شود؟`,
      detail: "نشست‌های باز این کاربر بسته می‌شود و تا فعال‌سازی دوباره نمی‌تواند وارد شود.",
      button: "غیرفعال کردن",
    },
    rotate: {
      title: `کلید تازه برای «${name}» ساخته شود؟`,
      detail: "کلید فعلی دیگر کار نمی‌کند و نشست‌های باز بسته می‌شود.",
      button: "ساخت کلید تازه",
    },
    sessions: {
      title: `نشست‌های «${name}» بسته شود؟`,
      detail: "کاربر باید دوباره وارد شود.",
      button: "بستن نشست‌ها",
    },
  };
  return (
    <View
      style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 8 }}
    >
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        <Text style={[s.text, fw("600")]}>{name}</Text>
        {user.label ? <Text style={[s.small, ltr]}>{user.name}</Text> : null}
        <Chip tint={user.role === "admin" ? colors.lavender : undefined}>
          {user.role === "admin" ? "مدیر" : "کاربر"}
        </Chip>
        <Chip tint={user.status === "active" ? colors.green : "#FBEFED"}>
          {user.status === "active" ? "فعال" : "غیرفعال"}
        </Chip>
      </View>
      {user.phone ? <Text style={[s.small, ltr]}>{faDigits(user.phone)}</Text> : null}
      <Text style={s.small}>
        امروز: {used(user.usage.messages, user.limits.messages, "پیام")}،{" "}
        {used(user.usage.tasks, user.limits.tasks, "کار")}، {faNumber(user.usage.totalTokens)} توکن
      </Text>
      <Text style={s.small}>
        {user.sessions ? `${faNumber(user.sessions)} نشست باز` : "بدون نشست باز"}
        {user.source === "env" ? "؛ کلید در تنظیمات سرور تعریف شده است" : ""}
      </Text>
      <ErrorNotice error={error} />
      {confirm ? (
        <View style={{ gap: 8, padding: 12, borderRadius: 14, backgroundColor: colors.canvas }}>
          <Text style={[s.text, fw("600")]}>{questions[confirm.action].title}</Text>
          <Text style={s.small}>{questions[confirm.action].detail}</Text>
          <View style={[s.row, { gap: 8 }]}>
            <Button
              small
              danger={confirm.action !== "rotate"}
              busy={busy}
              onPress={() =>
                void run(async () => {
                  if (confirm.action === "disable")
                    await api.request(path, { status: "disabled" }, "PATCH");
                  else if (confirm.action === "sessions")
                    await api.request(`${path}/sessions`, undefined, "DELETE");
                  else {
                    const result = await api.request<{ key: string }>(`${path}/rotate-key`, {});
                    reveal(`کلید تازهٔ «${name}»`, result.key);
                  }
                })
              }
            >
              {questions[confirm.action].button}
            </Button>
            <Button small onPress={() => setConfirm(undefined)}>
              انصراف
            </Button>
          </View>
        </View>
      ) : editing ? (
        <EditUser
          api={api}
          user={user}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void reload();
          }}
        />
      ) : (
        <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
          <Button small onPress={() => setEditing(true)}>
            ویرایش
          </Button>
          {user.status === "disabled" ? (
            <Button
              small
              primary
              busy={busy}
              onPress={() => void run(() => api.request(path, { status: "active" }, "PATCH"))}
            >
              فعال کردن
            </Button>
          ) : (
            !locked && (
              <Button small danger onPress={() => setConfirm({ id: user.id, action: "disable" })}>
                غیرفعال کردن
              </Button>
            )
          )}
          {user.source === "db" && (
            <Button
              small
              icon={KeyRound}
              onPress={() => setConfirm({ id: user.id, action: "rotate" })}
            >
              کلید تازه
            </Button>
          )}
          {user.sessions > 0 && user.id !== me && (
            <Button small onPress={() => setConfirm({ id: user.id, action: "sessions" })}>
              بستن نشست‌ها
            </Button>
          )}
        </View>
      )}
    </View>
  );
}

/** Admin-only: people, their keys and today's usage. */
export function AdminSheet({
  api,
  me,
  onClose,
}: {
  api: MuseApi;
  me?: string;
  onClose: () => void;
}) {
  const [users, setUsers] = useState<AdminUser[]>();
  const [defaults, setDefaults] = useState<{ messages: number; tasks: number }>();
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ title: string; key: string }>();
  const load = useCallback(async () => {
    try {
      const result = await api.request<{
        users: AdminUser[];
        defaults: { messages: number; tasks: number };
      }>("/api/admin/users");
      setUsers(result.users);
      setDefaults(result.defaults);
      setError("");
    } catch (e) {
      setError(`فهرست کاربران بارگذاری نشد. ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <Sheet title="مدیریت کاربران" subtitle="کاربران، کلیدهای دسترسی و مصرف امروز" onClose={onClose}>
      <View style={{ gap: 14 }}>
        {secret && (
          <KeyReveal title={secret.title} value={secret.key} onDone={() => setSecret(undefined)} />
        )}
        <ErrorNotice error={error} />
        {creating ? (
          <CreateUser
            api={api}
            onCreated={(user, key) => {
              setCreating(false);
              setSecret({ title: `کلید دسترسی «${displayName(user)}»`, key });
              void load();
            }}
          />
        ) : (
          <View style={[s.row, { gap: 8 }]}>
            <Button primary icon={Plus} onPress={() => setCreating(true)}>
              کاربر تازه
            </Button>
            <Button icon={RefreshCw} onPress={() => void load()}>
              به‌روزرسانی
            </Button>
          </View>
        )}
        {defaults && (
          <Text style={s.small}>
            سقف پیش‌فرض هر کاربر در روز: {limitLabel(defaults.messages || null)} پیام و{" "}
            {limitLabel(defaults.tasks || null)} کار. مدیرها سقف ندارند.
          </Text>
        )}
        {!users && !error && <ActivityIndicator color={colors.blueDark} />}
        {users?.length === 0 && (
          <Empty
            icon={Users}
            title="هنوز کاربری ندارید"
            detail="با «کاربر تازه» برای هر نفر یک کلید دسترسی جداگانه بسازید."
          />
        )}
        {users?.map((user) => (
          <UserRow
            key={user.id}
            api={api}
            user={user}
            me={me}
            reload={load}
            reveal={(title, key) => setSecret({ title, key })}
          />
        ))}
      </View>
    </Sheet>
  );
}
