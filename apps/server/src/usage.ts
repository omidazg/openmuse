import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";
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
});
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
  /** Records one model run and its token usage from an AG-UI RUN_FINISHED `usage` array. */
  async recordModelRun(owner: string, usage?: unknown) {
    const totals = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    if (Array.isArray(usage))
      for (const entry of usage) {
        if (!entry || typeof entry !== "object") continue;
        const record = entry as Record<string, unknown>;
        for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
          const value = record[key];
          if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
            totals[key] += value;
        }
        if (typeof record.totalTokens !== "number")
          totals.totalTokens +=
            (Number(record.inputTokens) || 0) + (Number(record.outputTokens) || 0);
      }
    const date = tehranDay(this.now());
    await this.db.increment(owner, KIND, date, { modelCalls: 1, ...totals }, empty(date));
  }
}
