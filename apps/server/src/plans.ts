/**
 * Subscription plans. PLANS (JSON array) replaces the built-in list; "free" is always present
 * and is what everyone falls back to when a paid period ends.
 *
 * PLANS='[{"id":"free","name":"رایگان","price":0,"models":["openai/gpt-4.1-mini"]},
 *         {"id":"pro","name":"حرفه‌ای","price":199000,"days":30,"dailyMessages":1000,"dailyTasks":100}]'
 */
import { z } from "zod";

export interface Plan {
  id: string;
  /** Persian display name. */
  name: string;
  /** Price in Toman for one period; 0 for the free plan. */
  price: number;
  /** Length of one paid period in days. */
  days: number;
  /** Daily chat turns; null = server default (DAILY_MESSAGE_LIMIT), 0 = unlimited. */
  dailyMessages: number | null;
  /** Daily new tasks; null = server default (DAILY_TASK_LIMIT), 0 = unlimited. */
  dailyTasks: number | null;
  /** Allowlisted model ids this plan may use; omitted = every model in MODELS. */
  models?: string[];
  /** Short Persian description shown on the plan card. */
  description?: string;
}

export const FREE_PLAN_ID = "free";

export const DEFAULT_PLANS: Plan[] = [
  {
    id: FREE_PLAN_ID,
    name: "رایگان",
    price: 0,
    days: 0,
    dailyMessages: null,
    dailyTasks: null,
    description: "برای آشنایی با دستیار و کارهای روزمرهٔ سبک.",
  },
  {
    id: "pro",
    name: "حرفه‌ای",
    price: 199000,
    days: 30,
    dailyMessages: 1000,
    dailyTasks: 100,
    description: "سقف بالاتر پیام و کار روزانه و دسترسی به همهٔ مدل‌ها.",
  },
];

const count = z.number().int().min(0).max(1_000_000).nullable().optional();
const planSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9_-]{1,32}$/, "PLANS: plan id must be a-z, 0-9, _ or - (max 32 characters)"),
  name: z.string().trim().min(1).max(60),
  price: z.number().int().min(0).max(1_000_000_000),
  days: z.number().int().min(1).max(3660).optional(),
  dailyMessages: count,
  dailyTasks: count,
  models: z.array(z.string().min(1).max(200)).min(1).optional(),
  description: z.string().trim().max(200).optional(),
});

/** Parses and validates PLANS; empty means the built-in plans. */
export function parsePlans(raw?: string): Plan[] {
  const text = raw?.trim();
  if (!text) return DEFAULT_PLANS;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("PLANS must be a JSON array of plans");
  }
  const parsed = z.array(planSchema).min(1).safeParse(json);
  if (!parsed.success)
    throw new Error(`PLANS is invalid: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  const plans: Plan[] = parsed.data.map((plan) => ({
    ...plan,
    days: plan.id === FREE_PLAN_ID ? 0 : (plan.days ?? 30),
    dailyMessages: plan.dailyMessages ?? null,
    dailyTasks: plan.dailyTasks ?? null,
  }));
  if (new Set(plans.map((p) => p.id)).size !== plans.length)
    throw new Error("PLANS ids must be unique");
  const free = plans.find((p) => p.id === FREE_PLAN_ID);
  if (free && free.price !== 0) throw new Error('PLANS: the "free" plan must have price 0');
  for (const plan of plans)
    if (plan.id !== FREE_PLAN_ID && plan.price < 1000)
      throw new Error(`PLANS: paid plan "${plan.id}" must cost at least 1000 Toman`);
  return free ? plans : [DEFAULT_PLANS[0], ...plans];
}

/** Rejects plan model lists that name models outside the MODELS allowlist. */
export function assertPlanModels(plans: Plan[], allowed: string[]) {
  const known = new Set(allowed);
  for (const plan of plans)
    for (const model of plan.models ?? [])
      if (!known.has(model))
        throw new Error(`PLANS: plan "${plan.id}" lists "${model}", which is not in MODELS`);
}

export function configPlans(config: { plans?: Plan[] }): Plan[] {
  return config.plans ?? DEFAULT_PLANS;
}

export function freePlan(plans: Plan[]): Plan {
  return plans.find((p) => p.id === FREE_PLAN_ID) ?? DEFAULT_PLANS[0];
}

export interface Subscription {
  plan: Plan;
  /** ISO end of the paid period; null on the free plan. */
  currentPeriodEnd: string | null;
}

/** The plan in force now: a paid plan until its period ends, then free. */
export function activeSubscription(
  plans: Plan[],
  user: { plan?: string; currentPeriodEnd?: string } | null | undefined,
  now = Date.now(),
): Subscription {
  const free = { plan: freePlan(plans), currentPeriodEnd: null };
  if (!user?.plan || user.plan === FREE_PLAN_ID || !user.currentPeriodEnd) return free;
  const end = Date.parse(user.currentPeriodEnd);
  if (!Number.isFinite(end) || end <= now) return free;
  const plan = plans.find((p) => p.id === user.plan);
  return plan ? { plan, currentPeriodEnd: user.currentPeriodEnd } : free;
}
