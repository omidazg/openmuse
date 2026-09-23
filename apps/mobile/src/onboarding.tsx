import { type LucideIcon, Monitor, ShieldCheck, Sparkles } from "lucide-react-native";
import { useState } from "react";
import { Text, View } from "react-native";
import { BRAND } from "../../../packages/domain/src/brand";
import { faDigits } from "./locale";
import { Button, colors, Sheet, s } from "./ui";

const STEPS: { icon: LucideIcon; title: string; body: string[] }[] = [
  {
    icon: Sparkles,
    title: `${BRAND.nameFa} چه کارهایی می‌کند؟`,
    body: [
      "هر چه در ذهن دارید بنویسید یا بگویید: برنامهٔ روز، نامهٔ اداری، خلاصهٔ یک سند یا جواب یک سؤال.",
      "دستیار تاریخ را به شمسی و به وقت تهران می‌داند و تعطیلات رسمی را می‌شناسد. اگر ایمیل و تقویمتان را وصل کنید، با آن‌ها هم کار می‌کند.",
    ],
  },
  {
    icon: Monitor,
    title: "کارها و مرورگر دستیار",
    body: [
      "کارهای طولانی‌تر را به دستیار بسپارید. او روی رایانهٔ خودش با مرورگر جست‌وجو می‌کند، صفحه‌ها را می‌خواند و نتیجه را برایتان آماده می‌کند.",
      "پیشرفت هر کار در «فعالیت» دیده می‌شود. پیش از فرستادن ایمیل یا تغییر تقویم، دستیار از شما تأیید می‌گیرد.",
    ],
  },
  {
    icon: ShieldCheck,
    title: "حریم خصوصی شما",
    body: [
      "گفت‌وگوها و فایل‌هایتان در فضای کار خودتان ذخیره می‌شود و کاربران دیگر به آن دسترسی ندارند. برای پاسخ‌گویی، پیام‌ها به مدل هوش مصنوعی فرستاده می‌شود.",
      "رمز عبور، شمارهٔ کارت و کدهای یک‌بارمصرف را در گفت‌وگو ننویسید.",
    ],
  },
];

/** Three-step welcome for first-time users; «رد شدن» or the last step marks it done. */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const last = step === STEPS.length - 1;
  return (
    <Sheet title={current.title} subtitle={`به ${BRAND.nameFa} خوش آمدید`} onClose={onDone}>
      <View style={{ gap: 16 }}>
        <View style={[s.iconBox, { width: 56, height: 56, borderRadius: 18 }]}>
          <current.icon size={26} strokeWidth={1.8} color={colors.text} />
        </View>
        {current.body.map((paragraph) => (
          <Text key={paragraph} style={[s.text, { fontSize: 16, lineHeight: 29 }]}>
            {paragraph}
          </Text>
        ))}
        <View
          accessibilityLabel={`مرحلهٔ ${faDigits(step + 1)} از ${faDigits(STEPS.length)}`}
          style={[s.row, { gap: 6, marginTop: 4 }]}
        >
          {STEPS.map((item, index) => (
            <View
              key={item.title}
              style={{
                width: index === step ? 20 : 7,
                height: 7,
                borderRadius: 4,
                backgroundColor: index === step ? colors.blueDark : colors.line,
              }}
            />
          ))}
        </View>
        <View style={[s.between, { marginTop: 8 }]}>
          {last ? <View /> : <Button onPress={onDone}>رد شدن</Button>}
          <Button primary onPress={last ? onDone : () => setStep(step + 1)}>
            {last ? "شروع گفت‌وگو" : "بعدی"}
          </Button>
        </View>
      </View>
    </Sheet>
  );
}
