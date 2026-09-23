/**
 * Model prices for cost tracking, in US dollars per one million tokens.
 *
 * MODEL_PRICES='{"anthropic/claude-sonnet-5":{"input":3,"output":15}}' overrides or extends the
 * defaults below. Gateway prices (Metis) can differ from the provider list prices, so operators
 * should set what they are actually billed. Costs are stored as whole micro-dollars (1e-6 USD)
 * because usage counters are integers.
 */
export interface ModelPrice {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
}
export type PriceTable = Record<string, ModelPrice>;

export const DEFAULT_MODEL_PRICES: PriceTable = {
  "anthropic/claude-sonnet-5": { input: 3, output: 15 },
  "openai/gpt-4.1": { input: 2, output: 8 },
  "openai/gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "google/gemini-2.5-flash": { input: 0.3, output: 2.5 },
};

const price = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

/** Defaults merged with MODEL_PRICES; throws an English startup error for malformed JSON. */
export function parseModelPrices(raw = ""): PriceTable {
  const table: PriceTable = { ...DEFAULT_MODEL_PRICES };
  if (!raw.trim()) return table;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('MODEL_PRICES must be JSON like {"openai/gpt-4.1":{"input":2,"output":8}}');
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("MODEL_PRICES must be a JSON object keyed by provider/model id");
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    const entry = value as Record<string, unknown> | null;
    const input = price(entry?.input);
    const output = price(entry?.output);
    if (input === undefined || output === undefined)
      throw new Error(`MODEL_PRICES entry "${id}" needs non-negative numbers input and output`);
    table[id] = { input, output };
  }
  return table;
}

/**
 * Finds a price by full id ("openai/gpt-4.1") or by the bare model id the AI SDK reports in
 * usage ("gpt-4.1"), then falls back to `fallbackId` (the model the run was started with).
 */
export function priceFor(table: PriceTable, model?: string, fallbackId?: string) {
  for (const id of [model, fallbackId]) {
    if (!id) continue;
    if (table[id]) return table[id];
    const bare = id.includes("/") ? id.slice(id.indexOf("/") + 1) : id;
    const match = Object.entries(table).find(([key]) => key.slice(key.indexOf("/") + 1) === bare);
    if (match) return match[1];
  }
  return undefined;
}

/** Cost of one run in whole micro-dollars (rounded up so tiny runs are never free). */
export function costMicroUsd(
  table: PriceTable,
  tokens: { inputTokens: number; outputTokens: number },
  model?: string,
  fallbackId?: string,
): number {
  const rate = priceFor(table, model, fallbackId);
  if (!rate) return 0;
  const micro = tokens.inputTokens * rate.input + tokens.outputTokens * rate.output;
  return micro > 0 ? Math.ceil(micro) : 0;
}

/** Rough token estimate when the gateway reports no usage (Persian text ≈ 3 characters/token). */
export function estimateTokens(text: string): number {
  return text ? Math.ceil(text.length / 3) : 0;
}
