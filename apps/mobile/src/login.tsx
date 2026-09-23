import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { requestOtp, verifyOtp } from "./api";
import { faDigits, faNumber, toLatinDigits } from "./locale";
import { Button, ErrorNotice, Field, s } from "./ui";

const ltr = { writingDirection: "ltr" as const, textAlign: "auto" as const };

/** SMS one-time-code login, shown when the server reports otpEnabled. */
export function PhoneLogin({ onSession }: { onSession: (token: string) => void }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);
  async function attempt(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const send = () =>
    attempt(async () => {
      await requestOtp(toLatinDigits(phone));
      setSent(true);
      setCode("");
      setWait(60);
    });
  const verify = () =>
    attempt(async () => {
      const session = await verifyOtp(toLatinDigits(phone), toLatinDigits(code));
      onSession(session.token);
    });
  return (
    <View>
      <ErrorNotice error={error} />
      <Field
        label="شمارهٔ موبایل"
        value={phone}
        onChangeText={(value) => {
          setPhone(value);
          if (sent) setSent(false);
        }}
        keyboardType="phone-pad"
        autoComplete="tel"
        placeholder="۰۹۱۲۱۲۳۴۵۶۷"
        style={ltr}
      />
      {sent ? (
        <>
          <Field
            label="کد پیامک‌شده"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={6}
            placeholder="۶ رقم"
            style={ltr}
          />
          <Button
            primary
            busy={busy}
            disabled={toLatinDigits(code).trim().length !== 6}
            onPress={() => void verify()}
          >
            ورود
          </Button>
          <Button
            small
            disabled={busy || wait > 0}
            onPress={() => void send()}
            style={{ marginTop: 10, alignSelf: "center" }}
          >
            {wait > 0 ? `ارسال دوبارهٔ کد تا ${faNumber(wait)} ثانیهٔ دیگر` : "ارسال دوبارهٔ کد"}
          </Button>
          <Text style={[s.small, { marginTop: 10 }]}>
            کد به شمارهٔ <Text style={ltr}>{faDigits(toLatinDigits(phone))}</Text> فرستاده شد و ۲
            دقیقه اعتبار دارد.
          </Text>
        </>
      ) : (
        <Button primary busy={busy} disabled={!phone.trim()} onPress={() => void send()}>
          دریافت کد ورود
        </Button>
      )}
    </View>
  );
}
