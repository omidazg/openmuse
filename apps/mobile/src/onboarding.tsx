import { type LucideIcon, Monitor, ShieldCheck, Sparkles } from "lucide-react-native";
import { useState } from "react";
import { Text, View } from "react-native";
import { BRAND } from "../../../packages/domain/src/brand";
import {
  continueLabel,
  PathCards,
  PathQuestions,
  PathReadySummary,
  pathsWithQuestions,
  SaveFailure,
  StepDots,
  usePathDraft,
  useScrollTopOnChange,
} from "./path-picker";
import { Button, colors, Sheet, s } from "./ui";

const WELCOME: { icon: LucideIcon; text: string }[] = [
  {
    icon: Sparkles,
    text: "هر چه در ذهن دارید بنویسید یا بگویید: برنامهٔ روز، نامهٔ اداری، خلاصهٔ یک سند یا جواب یک سؤال. دستیار تاریخ را به شمسی و به وقت تهران می‌داند و تعطیلات رسمی را می‌شناسد.",
  },
  {
    icon: Monitor,
    text: "کارهای طولانی‌تر را روی رایانهٔ خودش انجام می‌دهد و پیش از فرستادن ایمیل یا تغییر تقویم از شما تأیید می‌گیرد.",
  },
  {
    icon: ShieldCheck,
    text: "گفت‌وگوها و فایل‌هایتان در فضای کار خودتان ذخیره می‌شود. رمز عبور، شمارهٔ کارت و کدهای یک‌بارمصرف را در گفت‌وگو ننویسید.",
  },
];

const STEPS = ["welcome", "paths", "questions", "ready"] as const;
type Step = (typeof STEPS)[number];

/**
 * First-run flow: a short welcome, «مسیرهای من» (up to three paths), optional follow-up
 * questions and a summary of what changed. Paths and answers are saved at each «ادامه»;
 * «رد شدن» on the welcome, the close button or the last step call `onDone`.
 */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>("welcome");
  const draft = usePathDraft();
  const anchor = useScrollTopOnChange(step);
  const hasQuestions = pathsWithQuestions(draft.paths).length > 0;
  const skipPaths = () => void draft.commit("skip", { paths: [] }, onDone);
  const title =
    step === "welcome"
      ? `${BRAND.nameFa} چه کارهایی می‌کند؟`
      : step === "paths"
        ? "بیشتر برای چه کارهایی از دستیار استفاده می‌کنید؟"
        : step === "questions"
          ? "کمی دقیق‌تر"
          : "دستیار برای شما تنظیم شد";
  const subtitle =
    step === "welcome"
      ? `به ${BRAND.nameFa} خوش آمدید`
      : step === "paths"
        ? "تا سه مسیر انتخاب کنید؛ بعداً از «شخصی‌سازی» قابل تغییر است."
        : step === "questions"
          ? "همهٔ سؤال‌ها اختیاری‌اند."
          : undefined;
  return (
    <Sheet title={title} subtitle={subtitle} onClose={onDone}>
      <View ref={anchor} />
      <View style={{ gap: 16 }}>
        {step === "welcome" && (
          <>
            <View style={[s.iconBox, { width: 56, height: 56, borderRadius: 18 }]}>
              <Sparkles size={26} strokeWidth={1.8} color={colors.text} />
            </View>
            {WELCOME.map((item, index) => (
              <View key={item.text} style={[s.row, { gap: 10, alignItems: "flex-start" }]}>
                {index > 0 && (
                  <View style={{ paddingTop: 5 }}>
                    <item.icon size={18} strokeWidth={1.8} color={colors.muted} />
                  </View>
                )}
                <Text style={[s.text, { flex: 1, fontSize: 16, lineHeight: 29 }]}>{item.text}</Text>
              </View>
            ))}
          </>
        )}
        {step === "paths" && <PathCards selected={draft.paths} onChange={draft.setPaths} />}
        {step === "questions" && (
          <PathQuestions paths={draft.paths} details={draft.details} onChange={draft.setDetails} />
        )}
        {step === "ready" && <PathReadySummary paths={draft.paths} />}
        <SaveFailure failure={draft.failure} onDismiss={draft.clearFailure} />
        <StepDots index={STEPS.indexOf(step)} count={STEPS.length} />
        {step === "welcome" && (
          <View style={[s.between, { gap: 10 }]}>
            <Button onPress={onDone}>رد شدن</Button>
            <Button primary onPress={() => setStep("paths")}>
              بعدی
            </Button>
          </View>
        )}
        {step === "paths" && (
          <View style={[s.between, { gap: 10 }]}>
            <Button busy={draft.busy === "skip"} onPress={skipPaths}>
              فعلاً رد شود
            </Button>
            <Button
              primary
              busy={draft.busy === "paths"}
              onPress={
                draft.paths.length
                  ? () =>
                      void draft.commit("paths", { paths: draft.paths }, () =>
                        setStep(hasQuestions ? "questions" : "ready"),
                      )
                  : skipPaths
              }
            >
              {continueLabel(draft.paths.length)}
            </Button>
          </View>
        )}
        {step === "questions" && (
          <View style={[s.between, { gap: 10 }]}>
            <Button
              onPress={() => {
                draft.clearFailure();
                setStep("ready");
              }}
            >
              رد شدن
            </Button>
            <Button
              primary
              busy={draft.busy === "details"}
              onPress={() =>
                void draft.commit("details", { details: draft.details }, () => setStep("ready"))
              }
            >
              ادامه
            </Button>
          </View>
        )}
        {step === "ready" && (
          <Button primary onPress={onDone}>
            شروع گفت‌وگو
          </Button>
        )}
      </View>
    </Sheet>
  );
}
