import { Link2, RefreshCw } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Connection } from "../../../packages/domain/src";
import {
  MAILBOX_PRESETS,
  type MailboxPreset,
  type MailSecurity,
} from "../../../packages/domain/src/mailbox";
import { faDigits, fw, toLatinDigits } from "./locale";
import { Button, colors, ErrorNotice, Field, relativeDate, Sheet, s } from "./ui";
import { useWorkspace } from "./workspace";

/** Email addresses, host names and passwords are Latin content inside the RTL form. */
const ltr = { writingDirection: "ltr" as const };

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        paddingHorizontal: 13,
        paddingVertical: 7,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: selected ? colors.blueDark : colors.line,
        backgroundColor: selected ? colors.sky : colors.card,
      }}
    >
      <Text style={[s.small, fw("600"), { color: selected ? colors.blueDark : colors.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function SecurityChoice({
  value,
  onChange,
}: {
  value: MailSecurity;
  onChange: (value: MailSecurity) => void;
}) {
  return (
    <View style={[s.row, { gap: 7, marginBottom: 16 }]}>
      <Choice label="TLS" selected={value === "tls"} onPress={() => onChange("tls")} />
      <Choice
        label="STARTTLS"
        selected={value === "starttls"}
        onPress={() => onChange("starttls")}
      />
    </View>
  );
}

/** Connect a non-Google mailbox (IMAP to read, SMTP to send after approval) from «برنامه‌ها». */
export function MailboxSheet({
  connection,
  onClose,
}: {
  connection?: Connection;
  onClose: () => void;
}) {
  const { api, refresh, notify } = useWorkspace();
  const connected = connection?.status === "connected";
  const [preset, setPreset] = useState<MailboxPreset>(MAILBOX_PRESETS[0]);
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [imapHost, setImapHost] = useState(preset.imap.host);
  const [imapPort, setImapPort] = useState(String(preset.imap.port));
  const [imapSecurity, setImapSecurity] = useState<MailSecurity>(preset.imap.security);
  const [smtpHost, setSmtpHost] = useState(preset.smtp.host);
  const [smtpPort, setSmtpPort] = useState(String(preset.smtp.port));
  const [smtpSecurity, setSmtpSecurity] = useState<MailSecurity>(preset.smtp.security);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function choose(next: MailboxPreset) {
    setPreset(next);
    setImapHost(next.imap.host);
    setImapPort(String(next.imap.port));
    setImapSecurity(next.imap.security);
    setSmtpHost(next.smtp.host);
    setSmtpPort(String(next.smtp.port));
    setSmtpSecurity(next.smtp.security);
    if (next.id === "other") setAdvanced(true);
  }
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const connect = () =>
    run(async () => {
      await api.request("/api/mailbox/connect", {
        preset: preset.id,
        email: email.trim(),
        username: username.trim() || undefined,
        password,
        imapHost: imapHost.trim(),
        imapPort: toLatinDigits(imapPort),
        imapSecurity,
        smtpHost: smtpHost.trim(),
        smtpPort: toLatinDigits(smtpPort),
        smtpSecurity,
      });
      setPassword("");
      await refresh();
      notify("ایمیل متصل شد");
    });
  const sync = () =>
    run(async () => {
      await api.request("/api/mailbox/sync", {});
      await refresh();
      notify("صندوق ورودی به‌روز شد");
    });
  const disconnect = () =>
    run(async () => {
      await api.request("/api/mailbox/disconnect", {});
      await refresh();
      notify("اتصال ایمیل قطع شد");
    });

  return (
    <Sheet
      title="ایمیل با IMAP و SMTP"
      subtitle={connected ? connection?.account : "چاپار، یاهو، Outlook، ایمیل سازمانی و بقیه"}
      onClose={onClose}
    >
      {connected ? (
        <View style={{ gap: 16 }}>
          <Text style={s.muted}>
            ایمیل‌های ۳۰ روز اخیر صندوق ورودی خوانده می‌شوند و هر چند دقیقه به‌روز می‌شوند. ارسال هر
            ایمیل فقط پس از تأیید شما انجام می‌شود.
          </Text>
          <Text style={[s.text, ltr]}>{connection?.account}</Text>
          <Text style={s.small}>
            {connection?.syncedAt
              ? `آخرین همگام‌سازی: ${relativeDate(connection.syncedAt)}`
              : "هنوز همگام‌سازی نشده است"}
          </Text>
          <ErrorNotice error={error || connection?.error} />
          <Button busy={busy} icon={RefreshCw} onPress={() => void sync()}>
            همگام‌سازی ایمیل
          </Button>
          <Button busy={busy} danger onPress={() => void disconnect()}>
            قطع اتصال ایمیل
          </Button>
        </View>
      ) : (
        <View>
          <Text style={[s.muted, { marginBottom: 16 }]}>
            ارائه‌دهندهٔ ایمیل را انتخاب کنید و با «گذرواژهٔ برنامه» وارد شوید. گذرواژه رمزنگاری‌شده روی
            سرور نگه‌داری می‌شود و ارسال هر ایمیل به تأیید شما نیاز دارد.
          </Text>
          <Text style={[s.small, fw("600"), { color: colors.text, marginBottom: 7 }]}>
            ارائه‌دهنده
          </Text>
          <View
            accessibilityRole="radiogroup"
            style={[s.row, { gap: 7, flexWrap: "wrap", marginBottom: 16 }]}
          >
            {MAILBOX_PRESETS.map((item) => (
              <Choice
                key={item.id}
                label={item.name}
                selected={item.id === preset.id}
                onPress={() => choose(item)}
              />
            ))}
          </View>
          <Field
            label="نشانی ایمیل"
            value={email}
            onChangeText={setEmail}
            placeholder="name@example.ir"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            style={ltr}
          />
          <Field
            label="گذرواژهٔ برنامه"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            style={ltr}
          />
          <Text style={[s.small, { marginTop: -8, marginBottom: 16 }]}>{preset.hint}</Text>
          {preset.id !== "other" && (
            <Pressable
              accessibilityRole="button"
              onPress={() => setAdvanced((value) => !value)}
              style={{ marginBottom: 16 }}
            >
              <Text style={[s.small, fw("600"), { color: colors.blueDark }]}>
                {advanced ? "پنهان کردن تنظیمات سرور" : "نمایش تنظیمات سرور"}
              </Text>
            </Pressable>
          )}
          {advanced && (
            <View>
              <Field
                label="نام کاربری (اگر با نشانی ایمیل فرق دارد)"
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
                style={ltr}
              />
              <Field
                label="سرور IMAP (دریافت)"
                value={imapHost}
                onChangeText={setImapHost}
                placeholder="imap.example.ir"
                autoCapitalize="none"
                autoCorrect={false}
                style={ltr}
              />
              <Field
                label="درگاه IMAP"
                value={faDigits(imapPort)}
                onChangeText={(text) => setImapPort(toLatinDigits(text))}
                keyboardType="number-pad"
              />
              <SecurityChoice value={imapSecurity} onChange={setImapSecurity} />
              <Field
                label="سرور SMTP (ارسال)"
                value={smtpHost}
                onChangeText={setSmtpHost}
                placeholder="smtp.example.ir"
                autoCapitalize="none"
                autoCorrect={false}
                style={ltr}
              />
              <Field
                label="درگاه SMTP"
                value={faDigits(smtpPort)}
                onChangeText={(text) => setSmtpPort(toLatinDigits(text))}
                keyboardType="number-pad"
              />
              <SecurityChoice value={smtpSecurity} onChange={setSmtpSecurity} />
            </View>
          )}
          <ErrorNotice error={error} />
          <Button
            busy={busy}
            primary
            icon={Link2}
            disabled={!email.trim() || !password || !imapHost.trim() || !smtpHost.trim()}
            onPress={() => void connect()}
          >
            اتصال ایمیل
          </Button>
        </View>
      )}
    </Sheet>
  );
}
