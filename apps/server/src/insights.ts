/**
 * Anonymous usage counts of «مسیرهای من»: which paths people choose and which starters,
 * shortcuts, deadline cards and assistant suggestions they use, so the path content can be tuned.
 *
 * Only aggregate daily counters are stored (one record per Tehran day under the system owner,
 * kind "insights"): never the person, their address or any free text. Events and ids are
 * allowlisted against the app-defined catalog in packages/domain/src/paths.ts.
 */
import { Hono } from "hono";
import { z } from "zod";
import {
  DEADLINE_RULES,
  PATH_IDS,
  PATHS,
  type PathId,
  sanitizeProfile,
  type UserProfile,
} from "../../../packages/domain/src/paths.ts";
import { SYSTEM_OWNER } from "./bot/links.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";
import { RateLimiter } from "./rate-limit.ts";
import { tehranDay } from "./usage.ts";

export const INSIGHT_EVENTS = [
  "path_selected",
  "path_removed",
  "starter_used",
  "shortcut_used",
  "deadline_action",
  "invite_opened",
  "invite_dismissed",
  "persona_suggestion_used",
] as const;
export type InsightEvent = (typeof INSIGHT_EVENTS)[number];

export const INSIGHTS_KIND = "insights";
/** The invitation card has a single id. */
export const INVITE_ID = "paths";
const DAY_MS = 86_400_000;
const MAX_ATTEMPTS = 10;

/** One Tehran day of counters; `counts` keys are "<event>:<id>". */
export interface InsightDay {
  id: string;
  version: number;
  counts: Record<string, number>;
}

export interface InsightReport {
  days: number;
  /** First and last Tehran day of the period (YYYY-MM-DD). */
  from: string;
  to: string;
  /** Sum of every counted event in the period. */
  total: number;
  /** Per event, ids with their counts, most used first. */
  events: Record<InsightEvent, { id: string; count: number }[]>;
  /** Current choice of paths across stored profiles. */
  paths: {
    /** People with a stored «مسیرهای من» profile. */
    profiles: number;
    /** Of those, people with no path selected. */
    none: number;
    counts: Record<PathId, number>;
  };
}

const personaIds = PATHS.flatMap((path) => [
  path.personaId,
  ...path.shortcuts.map((item) => item.personaId),
]).filter((id): id is string => Boolean(id));

const KNOWN_IDS: Record<InsightEvent, ReadonlySet<string>> = {
  path_selected: new Set(PATH_IDS),
  path_removed: new Set(PATH_IDS),
  starter_used: new Set(PATHS.flatMap((path) => path.starters.map((item) => item.id))),
  shortcut_used: new Set(PATHS.flatMap((path) => path.shortcuts.map((item) => item.id))),
  deadline_action: new Set(DEADLINE_RULES.map((rule) => rule.id)),
  invite_opened: new Set([INVITE_ID]),
  invite_dismissed: new Set([INVITE_ID]),
  persona_suggestion_used: new Set(personaIds),
};

/**
 * The id to count for an event, or undefined when it is not in the catalog. A deadline occurrence
 * (`${rule.id}-YYYY-MM-DD`) counts as its rule so no date is stored.
 */
export function insightId(event: InsightEvent, id: string): string | undefined {
  const known = KNOWN_IDS[event];
  if (known.has(id)) return id;
  if (event === "deadline_action") {
    const match = /^(.+)-(\d{4}-\d{2}-\d{2})$/.exec(id);
    if (match && known.has(match[1]) && !Number.isNaN(Date.parse(match[2]))) return match[1];
  }
  return undefined;
}

/** Adds one to today's counter of `event:id`; false when concurrent writers kept winning. */
export async function recordInsight(
  db: Store,
  event: InsightEvent,
  id: string,
  now = Date.now(),
): Promise<boolean> {
  const day = tehranDay(now);
  const key = `${event}:${id}`;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const current = await db.get<InsightDay>(SYSTEM_OWNER, INSIGHTS_KIND, day);
    if (!current) {
      const created = await db.insertIfAbsent<InsightDay>(SYSTEM_OWNER, INSIGHTS_KIND, {
        id: day,
        version: 1,
        counts: { [key]: 1 },
      });
      if (created) return true;
      continue;
    }
    const version = Number(current.version) || 0;
    const counts = { ...current.counts, [key]: (Number(current.counts?.[key]) || 0) + 1 };
    // Replaces `counts` only if no one else wrote since this read.
    const swapped = await db.compareAndSwap(
      SYSTEM_OWNER,
      INSIGHTS_KIND,
      day,
      { version },
      { version: version + 1, counts },
    );
    if (swapped) return true;
  }
  return false;
}

/** Event totals for the last `days` Tehran days (today included) and the current path choice. */
export async function insightsReport(
  db: Store,
  days = 30,
  now = Date.now(),
): Promise<InsightReport> {
  const to = tehranDay(now);
  const from = tehranDay(now - (days - 1) * DAY_MS);
  const events = Object.fromEntries(
    INSIGHT_EVENTS.map((event) => [event, new Map<string, number>()]),
  ) as Record<InsightEvent, Map<string, number>>;
  let total = 0;
  for (const record of await db.list<InsightDay>(SYSTEM_OWNER, INSIGHTS_KIND)) {
    if (record.id < from || record.id > to) continue;
    for (const [key, raw] of Object.entries(record.counts ?? {})) {
      const split = key.indexOf(":");
      const event = key.slice(0, split) as InsightEvent;
      const count = Number(raw) || 0;
      if (split < 0 || !events[event] || count <= 0) continue;
      const id = key.slice(split + 1);
      events[event].set(id, (events[event].get(id) ?? 0) + count);
      total += count;
    }
  }
  const counts = Object.fromEntries(PATH_IDS.map((id) => [id, 0])) as Record<PathId, number>;
  let profiles = 0;
  let none = 0;
  for (const { value } of await db.scan<Partial<UserProfile> & { id?: string }>("agent-settings")) {
    if (value.id !== "profile") continue;
    profiles++;
    const { paths } = sanitizeProfile(value);
    if (!paths.length) none++;
    for (const id of paths) counts[id]++;
  }
  return {
    days,
    from,
    to,
    total,
    events: Object.fromEntries(
      INSIGHT_EVENTS.map((event) => [
        event,
        [...events[event]]
          .map(([id, count]) => ({ id, count }))
          .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
      ]),
    ) as InsightReport["events"],
    paths: { profiles, none, counts },
  };
}

export const insightDaysSchema = z.coerce.number().int().min(1).max(365).catch(30);

const eventSchema = z.object({
  event: z.enum(INSIGHT_EVENTS),
  id: z.string().min(1).max(80),
});
const INVALID = "این رویداد شناخته‌شده نیست و ثبت نشد. برنامه را تازه کنید.";

/** POST /api/agent/events: one anonymous count for a signed-in person. */
export function insightRoutes(db: Store) {
  const app = new Hono<{ Variables: { owner: string } }>();
  // Per person (in memory only): a few events a minute, and the same item only a few times an hour.
  const perOwner = new RateLimiter(30, 60 * 1000);
  const perItem = new RateLimiter(3, 60 * 60 * 1000);
  app.post("/", async (c) => {
    const parsed = eventSchema.safeParse(await c.req.json().catch(() => null));
    const id = parsed.success ? insightId(parsed.data.event, parsed.data.id) : undefined;
    if (!parsed.success || !id) throw new AppError(INVALID, 422);
    const owner = c.get("owner");
    if (!perOwner.take(owner) || !perItem.take(`${owner}\n${parsed.data.event}:${id}`))
      throw new AppError("ثبت آمار استفاده بیش از حد بوده است. کمی بعد دوباره تلاش کنید.", 429);
    return c.json({ ok: await recordInsight(db, parsed.data.event, id) });
  });
  return app;
}
