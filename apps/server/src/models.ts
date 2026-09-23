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
const AUTO_LABEL = "خودکار (سریع برای پیام‌های کوتاه)";
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
 * The catalog narrowed to one plan's models (e.g. a free plan limited to cheaper models).
 * The default moves to the first allowed model when the global default is not in the plan.
 */
export function restrictCatalog(catalog: ModelCatalog, allowed?: string[]): ModelCatalog {
  if (!allowed?.length) return catalog;
  const set = new Set(allowed);
  const models = catalog.models.filter((m) => set.has(m.id));
  if (!models.length) return catalog;
  const defaultModel =
    catalog.defaultModel && set.has(catalog.defaultModel) ? catalog.defaultModel : models[0].id;
  const fastModel =
    catalog.fastModel && set.has(catalog.fastModel) && catalog.fastModel !== defaultModel
      ? catalog.fastModel
      : undefined;
  return {
    models: models.map((m) => ({ ...m, default: m.id === defaultModel })),
    defaultModel,
    fastModel,
  };
}

/** Options shown in the picker; "auto" appears only when a distinct fast model is allowlisted. */
export function modelOptions(catalog: ModelCatalog): ModelOption[] {
  return catalog.fastModel
    ? [...catalog.models, { id: AUTO_MODEL, label: AUTO_LABEL, default: false }]
    : catalog.models;
}

/** Throws a Persian 422 for anything outside the allowlist. */
export function assertAllowedModel(catalog: ModelCatalog, id: string): string {
  if (modelOptions(catalog).some((m) => m.id === id)) return id;
  throw new AppError("این مدل در فهرست مدل‌های مجاز نیست. یکی از مدل‌های فهرست را انتخاب کنید.", 422);
}

/**
 * Short single-line messages without links go to the fast model; everything else, and every
 * delegated task, uses the strong default.
 */
export function isSimpleMessage(text: string): boolean {
  const value = text.trim();
  return (
    value.length > 0 && value.length <= 160 && !/\n/.test(value) && !/https?:\/\//i.test(value)
  );
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
): Promise<string | undefined> {
  const chosen = await selectedModel(db, catalog, owner);
  if (chosen === AUTO_MODEL)
    return message !== undefined && catalog.fastModel && isSimpleMessage(message)
      ? catalog.fastModel
      : catalog.defaultModel;
  return chosen ?? catalog.defaultModel;
}
