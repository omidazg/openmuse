/**
 * Per-user model choice from a server-side allowlist.
 *
 * MODELS="anthropic/claude-sonnet-5:کلاد سونت ۵ (قوی),openai/gpt-4.1-mini:جی‌پی‌تی ۴٫۱ مینی"
 * lists the models people may pick; MODEL stays the default. The client only ever sends an id
 * back, and every id is checked against this list before it reaches the BuiltInAgent.
 */
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

export interface ModelOption {
  id: string;
  label: string;
  default: boolean;
}

export interface ModelCatalog {
  models: ModelOption[];
  defaultModel?: string;
  /** Fast model used by "auto" for short messages; auto is offered only when this is set. */
  fastModel?: string;
}

export const AUTO_MODEL = "auto";
const AUTO_LABEL = "خودکار (مدل سریع برای پیام‌های ساده)";
const DEFAULT_LABEL = "مدل پیش‌فرض";
/** Providers the CopilotKit BuiltInAgent resolves from `provider/model` strings. */
const MODEL_ID = /^(openai|anthropic|google)\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SETTINGS_KIND = "conversation-settings";
const SETTINGS_ID = "model";

/** Parses MODELS ("id:label,id:label"); labels are optional and may contain spaces. */
export function parseModels(raw = "", defaultModel?: string): ModelOption[] {
  const seen = new Set<string>();
  const models: ModelOption[] = [];
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    const id = (colon < 0 ? trimmed : trimmed.slice(0, colon)).trim();
    const label = (colon < 0 ? "" : trimmed.slice(colon + 1)).trim() || id;
    if (!MODEL_ID.test(id))
      throw new Error(
        `MODELS entry "${id}" must look like provider/model-id (openai, anthropic or google)`,
      );
    if (seen.has(id)) throw new Error(`MODELS lists "${id}" more than once`);
    seen.add(id);
    models.push({ id, label, default: id === defaultModel });
  }
  const fallback = defaultModel?.trim();
  if (fallback && !seen.has(fallback))
    models.unshift({ id: fallback, label: DEFAULT_LABEL, default: true });
  return models;
}

export function readModelCatalog(env: NodeJS.ProcessEnv = process.env): ModelCatalog {
  const defaultModel = env.MODEL?.trim() || undefined;
  const models = parseModels(env.MODELS, defaultModel);
  const fast = env.MODEL_FAST?.trim();
  const fastModel =
    fast && fast !== defaultModel && models.some((m) => m.id === fast) ? fast : undefined;
  return { models, defaultModel, fastModel };
}

/** The catalog for a config; configs built without MODELS (tests, sample mode) allow MODEL only. */
export function configCatalog(config: { model?: string; models?: ModelCatalog }): ModelCatalog {
  return (
    config.models ?? { models: parseModels("", config.model), defaultModel: config.model?.trim() }
  );
}

/**
 * Options shown in the picker. "auto" appears only when a distinct fast model is allowlisted, and
 * then it comes first and is the default for people who have not picked a model.
 */
export function modelOptions(catalog: ModelCatalog): ModelOption[] {
  return catalog.fastModel
    ? [
        { id: AUTO_MODEL, label: AUTO_LABEL, default: true },
        ...catalog.models.map((m) => ({ ...m, default: false })),
      ]
    : catalog.models;
}

/** What a person gets before choosing: auto when it is offered, otherwise MODEL. */
export function defaultChoice(catalog: ModelCatalog): string | undefined {
  return catalog.fastModel ? AUTO_MODEL : catalog.defaultModel;
}

/** Throws a Persian 422 for anything outside the allowlist. */
export function assertAllowedModel(catalog: ModelCatalog, id: string): string {
  if (modelOptions(catalog).some((m) => m.id === id)) return id;
  throw new AppError("این مدل در فهرست مدل‌های مجاز نیست. یکی از مدل‌های فهرست را انتخاب کنید.", 422);
}

export type AutoTier = "fast" | "main";

export interface AutoSignals {
  /** Files referenced from the chat composer («اسناد پیوست‌شده»). */
  attachments?: boolean;
  /** Earlier turns in this thread called tools (a follow-up such as «بله، انجام بده»). */
  toolHistory?: boolean;
}

/**
 * Work that needs tools, browsing, code or careful reasoning goes to the main model. Stems match
 * at the start of a word («تحلیلی», «ایمیل‌ها»); "~" is an optional space or ZWNJ.
 */
const COMPLEX_STEMS = [
  // analysis, reasoning and long-form writing
  "تحلیل",
  "بررسی",
  "مقایسه",
  "مقاله",
  "گزارش",
  "خلاصه",
  "ترجمه",
  "نامه",
  "پایان~نامه",
  "رزومه",
  "انشا",
  "پروپوزال",
  "استدلال",
  "اثبات",
  "محاسبه",
  "حساب~کن",
  "حل~کن",
  "ریاضی",
  "معادله",
  "برنامه~ریزی",
  "برنامه~نویسی",
  "پایتون",
  "جاوا",
  "اسکریپت",
  "باگ",
  "دیباگ",
  // tools and workspace
  "ایمیل",
  "تقویم",
  "جلسه",
  "رویداد",
  "یادآوری",
  "فایل",
  "پی~دی~اف",
  "اکسل",
  "جست~وجو",
  "جستجو",
  "سایت",
  "وب~سایت",
  "لینک",
  "قیمت",
  "پیگیری",
  "زیر~نظر",
  "واگذار",
  "مرورگر",
  // English words people type
  "analy",
  "essay",
  "article",
  "report",
  "summar",
  "translat",
  "compar",
  "debug",
  "python",
  "javascript",
  "email",
  "calendar",
  "excel",
  "search",
  "brows",
  "website",
];
/** Short words that are also prefixes of everyday words («کد» / «کدام»), matched whole. */
const COMPLEX_WORDS = ["کد", "کدها", "سند", "اسناد", "هدف", "وب", "code", "sql", "pdf"];
const LETTER = String.raw`[\p{L}\p{M}\p{N}]`;
const variants = (words: string[]) => words.map((w) => w.replaceAll("~", String.raw`[\s\u200c]?`));
const COMPLEX = new RegExp(
  `(?<!${LETTER})(?:${variants(COMPLEX_STEMS).join("|")})|(?<!${LETTER})(?:${variants(COMPLEX_WORDS).join("|")})(?!${LETTER})`,
  "iu",
);
const CODE = /```|[{};]\s*$|=>|\b(function|class|def|import|const|return|select)\s|<\/?[a-z]+>/im;
const URL_PATTERN = /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|ir|org|net|io)\b/i;
const ATTACHMENT = /اسناد پیوست[\u200c ]?شده|شناسهٔ سند/;

/**
 * The cheap «خودکار» router: short everyday chit-chat and quick questions go to the fast model;
 * anything long, multi-line, with links, files, code, tool needs or analysis keywords goes to the
 * main model. Pure and deterministic so it can be tested without a model.
 */
export function autoTier(text: string, signals: AutoSignals = {}): AutoTier {
  const value = text.trim();
  if (!value) return "fast";
  if (signals.attachments || signals.toolHistory) return "main";
  if (value.length > 200) return "main";
  if (/\n/.test(value)) return "main";
  if (ATTACHMENT.test(value) || URL_PATTERN.test(value) || CODE.test(value)) return "main";
  if (COMPLEX.test(value)) return "main";
  return "fast";
}

/** Kept for callers that only need a yes/no: true when auto would pick the fast model. */
export function isSimpleMessage(text: string): boolean {
  return text.trim().length > 0 && autoTier(text) === "fast";
}

export async function selectedModel(
  db: Store,
  catalog: ModelCatalog,
  owner: string,
): Promise<string | undefined> {
  const saved = await db.get<{ model?: string }>(owner, SETTINGS_KIND, SETTINGS_ID);
  // A model later removed from MODELS silently falls back to the default.
  return saved?.model && modelOptions(catalog).some((m) => m.id === saved.model)
    ? saved.model
    : undefined;
}

export async function saveSelectedModel(
  db: Store,
  catalog: ModelCatalog,
  owner: string,
  id: string,
): Promise<string> {
  const model = assertAllowedModel(catalog, id);
  await db.put(owner, SETTINGS_KIND, {
    id: SETTINGS_ID,
    model,
    updatedAt: new Date().toISOString(),
  });
  return model;
}

/**
 * The concrete provider/model id for one run. `message` is the latest user text for chat turns;
 * omit it for delegated tasks, which always use a concrete (non-auto) model.
 */
export async function resolveModel(
  db: Store,
  catalog: ModelCatalog,
  owner: string,
  message?: string,
  signals?: AutoSignals,
): Promise<string | undefined> {
  const chosen = (await selectedModel(db, catalog, owner)) ?? defaultChoice(catalog);
  if (chosen === AUTO_MODEL)
    return message !== undefined &&
      catalog.fastModel &&
      message.trim() &&
      autoTier(message, signals) === "fast"
      ? catalog.fastModel
      : catalog.defaultModel;
  return chosen ?? catalog.defaultModel;
}
