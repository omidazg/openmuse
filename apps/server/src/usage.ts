import {
  gregorianToJalali,
  jalaliToGregorian,
} from "../../../packages/domain/src/iran-holidays.ts";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";
import { costMicroUsd, DEFAULT_MODEL_PRICES } from "./pricing.ts";
import type { Users } from "./users.ts";

export const QUOTA_EXCEEDED = "سقف استفادهٔ امروز شما تمام شده است. فردا دوباره تلاش کنید.";
const KIND = "usage";

export interface DailyUsage {
  id: string;
  date: string;
  /** Chat turns sent to the assistant. */
  messages: number;
  /** New delegated tasks. */
  tasks: number;
  /** Model runs (chat turns and task runs that reached a model). */
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Model cost in micro-dollars (1e-6 USD) from the MODEL_PRICES table. */
  costMicroUsd: number;
  /** Runs whose tokens were estimated because the gateway reported no usage. */
  estimatedRuns: number;
}
/** Summed usage over a period (today, this Jalali month, or all time). */
export type UsageTotals = Omit<DailyUsage, "id" | "date">;
export interface UsageSummary {
  today: UsageTotals;
  /** Since the first day of the current Jalali month (Tehran time). */
  month: UsageTotals;
  total: UsageTotals;
}
export type Metric = "messages" | "tasks";
/** null means unlimited. */
export interface Limits {
  messages: number | null;
  tasks: number | null;
}

/** Calendar day in Asia/Tehran (+03:30, no DST), e.g. "2026-09-23". Quotas reset at Tehran midnight. */
export function tehranDay(now = Date.now()) {
  return new Date(now + 3.5 * 3600000).toISOString().slice(0, 10);
}
const empty = (date: string): DailyUsage => ({
  id: date,
  date,
  messages: 0,
  tasks: 0,
  modelCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  costMicroUsd: 0,
  estimatedRuns: 0,
});
const TOTAL_KEYS = [
  "messages",
  "tasks",
  "modelCalls",
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "costMicroUsd",
  "estimatedRuns",
] as const;
function sum(days: DailyUsage[]): UsageTotals {
  const totals = Object.fromEntries(TOTAL_KEYS.map((key) => [key, 0])) as UsageTotals;
  for (const day of days) for (const key of TOTAL_KEYS) totals[key] += Number(day[key]) || 0;
  return totals;
}
/** Gregorian day (YYYY-MM-DD) on which the Jalali month containing `day` starts. */
export function jalaliMonthStart(day: string) {
  const { year, month } = gregorianToJalali(day);
  return jalaliToGregorian(year, month, 1);
}
const limit = (value: number | null | undefined, fallback: number) => {
  const chosen = value ?? fallback;
  return chosen > 0 ? chosen : null;
};

/** Per-owner daily counters and quota checks. */
export class Usage {
  constructor(
    private readonly db: Store,
    private readonly config: Config,
    private readonly users: Users,
    private readonly now = () => Date.now(),
  ) {}
  async today(owner: string): Promise<DailyUsage> {
    const date = tehranDay(this.now());
    return { ...empty(date), ...(await this.db.get<DailyUsage>(owner, KIND, date)) };
  }
  async history(owner: string, days = 30): Promise<DailyUsage[]> {
    const since = tehranDay(this.now() - (days - 1) * 86400000);
    return (await this.db.list<DailyUsage>(owner, KIND))
      .filter((day) => day.date >= since)
      .map((day) => ({ ...empty(day.date), ...day }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }
  async limits(owner: string): Promise<Limits> {
    if (await this.users.isAdmin(owner)) return { messages: null, tasks: null };
    const quota = (await this.users.get(owner))?.quota;
    return {
      messages: limit(quota?.dailyMessages, this.config.dailyMessageLimit ?? 200),
      tasks: limit(quota?.dailyTasks, this.config.dailyTaskLimit ?? 30),
    };
  }
  /** Counts one unit of `metric`, or throws a Persian 429 when today's limit is already used. */
  async consume(owner: string, metric: Metric) {
    const max = (await this.limits(owner))[metric];
    const date = tehranDay(this.now());
    const day = await this.db.increment<DailyUsage>(
      owner,
      KIND,
      date,
      { [metric]: 1 },
      empty(date),
    );
    if (max !== null && day[metric] > max) {
      await this.db.increment(owner, KIND, date, { [metric]: -1 });
      throw new AppError(QUOTA_EXCEEDED, 429);
    }
    return day;
  }
  /** Today, this Jalali month and all-time totals for one owner. */
  async summary(owner: string): Promise<UsageSummary> {
    const today = tehranDay(this.now());
    const monthStart = jalaliMonthStart(today);
    const days = (await this.db.list<DailyUsage>(owner, KIND)).map((day) => ({
      ...empty(day.date),
      ...day,
    }));
    return {
      today: sum(days.filter((day) => day.date === today)),
      month: sum(days.filter((day) => day.date >= monthStart)),
      total: sum(days),
    };
  }
  /**
   * Records one model run from an AG-UI RUN_FINISHED `usage` array: tokens and their cost. `model`
   * is the provider/model id the run started with (used when usage names no known model).
   * `estimate` is used only when the gateway reported no tokens at all.
   */
  async recordModelRun(
    owner: string,
    usage?: unknown,
    options: { model?: string; estimate?: { inputTokens: number; outputTokens: number } } = {},
  ) {
    const prices = this.config.modelPrices ?? DEFAULT_MODEL_PRICES;
    const totals = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costMicroUsd: 0 };
    if (Array.isArray(usage))
      for (const entry of usage) {
        if (!entry || typeof entry !== "object") continue;
        const record = entry as Record<string, unknown>;
        const tokens = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
        for (const key of Object.keys(tokens) as (keyof typeof tokens)[]) {
          const value = record[key];
          if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
            tokens[key] = value;
        }
        if (typeof record.totalTokens !== "number")
          tokens.totalTokens = tokens.inputTokens + tokens.outputTokens;
        totals.inputTokens += tokens.inputTokens;
        totals.outputTokens += tokens.outputTokens;
        totals.totalTokens += tokens.totalTokens;
        totals.costMicroUsd += costMicroUsd(
          prices,
          tokens,
          typeof record.model === "string" ? record.model : undefined,
          options.model,
        );
      }
    let estimatedRuns = 0;
    if (!totals.totalTokens && options.estimate) {
      const { inputTokens, outputTokens } = options.estimate;
      totals.inputTokens = inputTokens;
      totals.outputTokens = outputTokens;
      totals.totalTokens = inputTokens + outputTokens;
      totals.costMicroUsd = costMicroUsd(prices, options.estimate, options.model);
      estimatedRuns = totals.totalTokens ? 1 : 0;
    }
    const date = tehranDay(this.now());
    await this.db.increment(
      owner,
      KIND,
      date,
      { modelCalls: 1, ...totals, estimatedRuns },
      empty(date),
    );
  }
}
