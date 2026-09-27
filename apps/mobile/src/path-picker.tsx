import { Check, Coins, LayoutList, Sparkles, UserRound } from "lucide-react-native";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import {
  PATH_MAX,
  PATHS,
  type PathId,
  pathShortcuts,
  selectedPaths,
  suggestedPersonaIds,
} from "../../../packages/domain/src/paths";
import { findPersona } from "../../../packages/domain/src/personal";
import { faDigits, fw } from "./locale";
import { pathIcon, useProfile } from "./profile";
import { Button, Card, colors, ErrorNotice, Sheet, s } from "./ui";

export const SAVE_FAILED = "ذخیره نشد. اتصال را بررسی کنید و دوباره تلاش کنید.";

/** «الف»، «ب» و «ج»: a Persian list joined with «،» and a final «و». */
function faList(items: string[]): string {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join("، ")} و ${items[items.length - 1]}`;
}

/** Selected paths that ask at least one follow-up question. */
export function pathsWithQuestions(paths: PathId[]) {
  return selectedPaths({ paths }).filter((path) => path.questions.length > 0);
}

/** «ادامه (۲ مسیر)»; plain «ادامه» when nothing is selected. */
export function continueLabel(count: number) {
  return count ? `ادامه (${faDigits(count)} مسیر)` : "ادامه";
}

// --- Path cards ---------------------------------------------------------------------------------

/** The seven path cards; at most PATH_MAX can be checked. */
export function PathCards(props: { selected: PathId[]; onChange: (next: PathId[]) => void }) {
  const { selected, onChange } = props;
  const [limitNotice, setLimitNotice] = useState(false);
  const toggle = (id: PathId) => {
    if (selected.includes(id)) {
      setLimitNotice(false);
      onChange(selected.filter((item) => item !== id));
    } else if (selected.length >= PATH_MAX) {
      setLimitNotice(true);
    } else {
      setLimitNotice(false);
      onChange([...selected, id]);
    }
  };
  return (
    <View style={{ gap: 8 }}>
      {PATHS.map((path) => {
        const checked = selected.includes(path.id);
        const Icon = pathIcon(path.icon);
        return (
          <Pressable
            key={path.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
            accessibilityLabel={`${path.name}، ${path.description}`}
            onPress={() => toggle(path.id)}
            style={({ pressed }) => [
              s.row,
              {
                gap: 11,
                paddingVertical: 9,
                paddingHorizontal: 11,
                minHeight: 60,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: checked ? colors.blueDark : colors.line,
                backgroundColor: checked ? colors.sky : colors.card,
              },
              pressed && { opacity: 0.85 },
            ]}
          >
            <View
              style={[
                s.iconBox,
                {
                  width: 40,
                  height: 40,
                  backgroundColor: checked ? colors.card : colors.subtle,
                },
              ]}
            >
              <Icon size={20} strokeWidth={1.8} color={colors.text} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.text, { fontSize: 14.5, lineHeight: 22, ...fw("600") }]}>
                {path.name}
              </Text>
              <Text style={[s.small, { lineHeight: 19 }]}>{path.description}</Text>
            </View>
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                borderWidth: 1.5,
                borderColor: checked ? colors.blueDark : colors.faint,
                backgroundColor: checked ? colors.blueDark : "transparent",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {checked && <Check size={14} strokeWidth={2.4} color={colors.canvas} />}
            </View>
          </Pressable>
        );
      })}
      {limitNotice && (
        <Text accessibilityLiveRegion="polite" style={[s.small, { color: colors.danger }]}>
          حداکثر سه مسیر قابل انتخاب است.
        </Text>
      )}
    </View>
  );
}

// --- Follow-up questions ------------------------------------------------------------------------

function OptionChip({
  label,
  checked,
  multi,
  onPress,
}: {
  label: string;
  checked: boolean;
  multi?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole={multi ? "checkbox" : "radio"}
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: 36,
          paddingHorizontal: 13,
          paddingVertical: 6,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: checked ? colors.blueDark : colors.line,
          backgroundColor: checked ? colors.sky : colors.card,
          justifyContent: "center",
        },
        pressed && { opacity: 0.85 },
      ]}
    >
      <Text
        style={[
          s.text,
          { fontSize: 13.5, lineHeight: 21, ...fw("500") },
          checked && { color: colors.blueDark },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** One card per selected path with questions; single-choice chips replace, multi-choice toggle. */
export function PathQuestions(props: {
  paths: PathId[];
  details: Record<string, string[]>;
  onChange: (next: Record<string, string[]>) => void;
}) {
  const { details, onChange } = props;
  const paths = pathsWithQuestions(props.paths);
  if (!paths.length) return null;
  const choose = (questionId: string, optionId: string, multi?: boolean) => {
    const current = details[questionId] ?? [];
    const has = current.includes(optionId);
    const answers = multi
      ? has
        ? current.filter((id) => id !== optionId)
        : [...current, optionId]
      : has
        ? []
        : [optionId];
    const next = { ...details };
    if (answers.length) next[questionId] = answers;
    else delete next[questionId];
    onChange(next);
  };
  return (
    <View style={{ gap: 12 }}>
      {paths.map((path) => {
        const Icon = pathIcon(path.icon);
        return (
          <Card
            key={path.id}
            style={{ borderWidth: 1, borderColor: colors.line, padding: 16, gap: 12 }}
          >
            <View style={[s.row, { gap: 8 }]}>
              <Icon size={17} strokeWidth={1.8} color={colors.blueDark} />
              <Text style={[s.heading, { fontSize: 15, lineHeight: 24 }]}>{path.shortName}</Text>
            </View>
            {path.questions.map((question) => (
              <View
                key={question.id}
                accessibilityRole={question.multi ? undefined : "radiogroup"}
                accessibilityLabel={question.label}
                style={{ gap: 8 }}
              >
                <Text style={[s.text, { fontSize: 14, lineHeight: 23, ...fw("600") }]}>
                  {question.label}
                </Text>
                <View style={[s.row, { flexWrap: "wrap", gap: 8 }]}>
                  {question.options.map((option) => (
                    <OptionChip
                      key={option.id}
                      label={option.label}
                      multi={question.multi}
                      checked={(details[question.id] ?? []).includes(option.id)}
                      onPress={() => choose(question.id, option.id, question.multi)}
                    />
                  ))}
                </View>
              </View>
            ))}
          </Card>
        );
      })}
    </View>
  );
}

// --- Ready summary ------------------------------------------------------------------------------

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      hitSlop={8}
      style={{
        width: 44,
        height: 26,
        borderRadius: 13,
        padding: 3,
        flexDirection: "row",
        // RTL: start is the right edge, so «on» moves the knob to the left like the mockup.
        justifyContent: value ? "flex-end" : "flex-start",
        backgroundColor: value ? colors.blueDark : colors.faint,
      }}
    >
      <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: colors.card }} />
    </Pressable>
  );
}

function SummaryItem({ icon: Icon, children }: { icon: typeof Sparkles; children: ReactNode }) {
  return (
    <View style={[s.row, { gap: 10, alignItems: "flex-start" }]}>
      <View style={{ paddingTop: 4 }}>
        <Icon size={18} strokeWidth={1.8} color={colors.blueDark} />
      </View>
      <Text style={[s.text, { flex: 1, fontSize: 14.5, lineHeight: 26 }]}>{children}</Text>
    </View>
  );
}

/** What the chosen paths change, plus the tax-deadline reminder switch when finance is chosen. */
export function PathReadySummary(props: { paths: PathId[] }) {
  const { profile, save } = useProfile();
  const [error, setError] = useState<string>();
  const chosen = selectedPaths({ paths: props.paths });
  const quote = (text: string) => `«${text}»`;
  const shortcuts = pathShortcuts({ paths: props.paths }).map((item) => quote(item.label));
  const personas = suggestedPersonaIds({ paths: props.paths })
    .map((id) => findPersona(id)?.name)
    .filter((name): name is string => Boolean(name))
    .map(quote);
  const money = props.paths.some((id) => id === "finance" || id === "business");
  const finance = props.paths.includes("finance");
  const reminders = profile?.reminders ?? true;
  const setReminders = (next: boolean) => {
    setError(undefined);
    save({ reminders: next }).catch(() => setError(SAVE_FAILED));
  };
  return (
    <View style={{ gap: 14 }}>
      <View
        style={[
          s.iconBox,
          { width: 56, height: 56, borderRadius: 18 },
          { backgroundColor: colors.green },
        ]}
      >
        <Check size={26} strokeWidth={2} color={colors.success} />
      </View>
      <View style={{ gap: 10 }}>
        <SummaryItem icon={Sparkles}>
          {`پیشنهادهای شروع گفت‌وگو برای ${faList(chosen.map((path) => path.shortName))}`}
        </SummaryItem>
        {money && <SummaryItem icon={Coins}>مبالغ به تومان و تاریخ‌ها شمسی</SummaryItem>}
        {shortcuts.length > 0 && (
          <SummaryItem icon={LayoutList}>{`میان‌برهای ${faList(shortcuts)} در منو`}</SummaryItem>
        )}
        {personas.length > 0 && (
          <SummaryItem icon={UserRound}>{`پیشنهاد گفت‌وگو با ${faList(personas)}`}</SummaryItem>
        )}
      </View>
      {finance && (
        <View
          style={[
            s.row,
            {
              gap: 12,
              padding: 14,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: colors.line,
              backgroundColor: colors.sky,
            },
          ]}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[s.text, { fontSize: 14.5, lineHeight: 22, ...fw("600") }]}>
              یادآوری مهلت‌های مالیاتی
            </Text>
            <Text style={s.small}>
              مهلت‌های قانونی مالیاتی پیش از موعد در صفحهٔ چت یادآوری می‌شوند.
            </Text>
          </View>
          <Toggle label="یادآوری مهلت‌های مالیاتی" value={reminders} onChange={setReminders} />
        </View>
      )}
      <ErrorNotice error={error} />
    </View>
  );
}

// --- Shared flow state --------------------------------------------------------------------------

/**
 * Step dots; the whole row is one accessible element, e.g. «مرحلهٔ ۲ از ۴». `count` dots, the one
 * at `index` (0-based) is wide.
 */
export function StepDots({ index, count }: { index: number; count: number }) {
  return (
    <View
      accessible
      accessibilityLabel={`مرحلهٔ ${faDigits(index + 1)} از ${faDigits(count)}`}
      style={[s.row, { gap: 6 }]}
    >
      {Array.from({ length: count }, (_, i) => (
        <View
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length decorative dots
          key={i}
          style={{
            width: i === index ? 20 : 7,
            height: 7,
            borderRadius: 4,
            backgroundColor: i === index ? colors.blueDark : colors.line,
          }}
        />
      ))}
    </View>
  );
}

/**
 * Draft paths and answers seeded from the saved profile, and a `commit` that saves a patch and
 * then runs the next step. A failed save keeps the local copy (the profile save is optimistic),
 * shows SAVE_FAILED and offers to continue anyway.
 */
export function usePathDraft() {
  const { profile, save } = useProfile();
  const seeded = useRef(Boolean(profile));
  const [paths, setPathsState] = useState<PathId[]>(profile?.paths ?? []);
  const [details, setDetailsState] = useState<Record<string, string[]>>(profile?.details ?? {});
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ proceed: () => void } | null>(null);
  useEffect(() => {
    if (seeded.current || !profile) return;
    seeded.current = true;
    setPathsState(profile.paths);
    setDetailsState(profile.details);
  }, [profile]);
  const setPaths = useCallback((next: PathId[]) => {
    seeded.current = true;
    setPathsState(next);
  }, []);
  const setDetails = useCallback((next: Record<string, string[]>) => {
    seeded.current = true;
    setDetailsState(next);
  }, []);
  const commit = useCallback(
    async (key: string, patch: Parameters<typeof save>[0], next: () => void) => {
      setBusy(key);
      setFailure(null);
      try {
        await save(patch);
        setBusy(null);
        next();
      } catch {
        setBusy(null);
        setFailure({ proceed: next });
      }
    },
    [save],
  );
  const clearFailure = useCallback(() => setFailure(null), []);
  return { paths, setPaths, details, setDetails, busy, failure, clearFailure, commit };
}

/** SAVE_FAILED with a way to continue without saving; retrying is pressing the step's button again. */
export function SaveFailure({
  failure,
  onDismiss,
}: {
  failure: { proceed: () => void } | null;
  onDismiss: () => void;
}) {
  if (!failure) return null;
  return (
    <View style={{ gap: 4 }}>
      <ErrorNotice error={SAVE_FAILED} />
      <Button
        small
        style={{ alignSelf: "flex-start" }}
        onPress={() => {
          onDismiss();
          failure.proceed();
        }}
      >
        ادامه بدون ذخیره
      </Button>
    </View>
  );
}

/**
 * The Sheet keeps one ScrollView across steps; scroll back to the top when the step changes (web
 * only; a long path list may have been scrolled to its buttons). Put `<View ref={anchor} />` first.
 */
export function useScrollTopOnChange(value: unknown) {
  const anchor = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = anchor.current as unknown as { scrollIntoView?: (options: object) => void };
    node?.scrollIntoView?.({ block: "nearest" });
  }, [value]);
  return anchor;
}

// --- Setup sheet --------------------------------------------------------------------------------

type SetupStep = "paths" | "questions" | "ready";

/**
 * «مسیرهای من» outside onboarding (invitation card, «تغییر» on the chat screen): choose paths →
 * optional questions → what changed. Each «ادامه» saves; closing early keeps what was saved.
 */
export function PathSetupSheet(props: { onClose: () => void }) {
  const { onClose } = props;
  const draft = usePathDraft();
  const [step, setStep] = useState<SetupStep>("paths");
  const anchor = useScrollTopOnChange(step);
  const questions = pathsWithQuestions(draft.paths).length > 0;
  const steps: SetupStep[] = questions ? ["paths", "questions", "ready"] : ["paths", "ready"];
  const afterPaths = () => {
    if (!draft.paths.length) onClose();
    else setStep(questions ? "questions" : "ready");
  };
  const title =
    step === "paths"
      ? "انتخاب مسیر"
      : step === "questions"
        ? "کمی دقیق‌تر"
        : "دستیار برای شما تنظیم شد";
  const subtitle =
    step === "paths"
      ? "بیشتر برای چه کارهایی از دستیار استفاده می‌کنید؟ تا سه مسیر انتخاب کنید."
      : step === "questions"
        ? "همهٔ سؤال‌ها اختیاری‌اند."
        : undefined;
  return (
    <Sheet title={title} subtitle={subtitle} onClose={onClose}>
      <View ref={anchor} />
      <View style={{ gap: 16 }}>
        {step === "paths" && <PathCards selected={draft.paths} onChange={draft.setPaths} />}
        {step === "questions" && (
          <PathQuestions paths={draft.paths} details={draft.details} onChange={draft.setDetails} />
        )}
        {step === "ready" && <PathReadySummary paths={draft.paths} />}
        <SaveFailure failure={draft.failure} onDismiss={draft.clearFailure} />
        <StepDots index={steps.indexOf(step)} count={steps.length} />
        {step === "paths" && (
          <View style={[s.between, { gap: 10 }]}>
            <Button onPress={onClose}>انصراف</Button>
            <Button
              primary
              busy={draft.busy === "paths"}
              onPress={() => void draft.commit("paths", { paths: draft.paths }, afterPaths)}
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
          <Button primary onPress={onClose}>
            شروع گفت‌وگو
          </Button>
        )}
      </View>
    </Sheet>
  );
}
