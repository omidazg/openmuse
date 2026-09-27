/**
 * Deadline extensions (تمدید مهلت) and proactive deadline reminders for «مسیرهای من».
 *
 * Extensions are recorded by an admin without a deploy and stored under the shared system owner
 * (kind "deadline-overrides", one record per occurrence id). The reminder sweep turns deadlines
 * that are three days away or less into notifications, which the bot service forwards to linked
 * Bale/Telegram chats.
 */
import { z } from "zod";
import {
  formatJalali,
  gregorianToJalali,
  jalaliMonthLength,
  jalaliToGregorian,
  TEHRAN_OFFSET_MINUTES,
  tehranDate,
} from "../../../packages/domain/src/iran-holidays.ts";
import {
  DEADLINE_RULES,
  type DeadlineOverride,
  type PathId,
  sanitizeProfile,
  type UpcomingDeadline,
  type UserProfile,
  upcomingDeadlines,
} from "../../../packages/domain/src/paths.ts";
import { SYSTEM_OWNER } from "./bot/links.ts";
import { faDigits } from "./bot/text.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";
import { backgroundFailure } from "./log.ts";
import { readProfile } from "./profile.ts";
import { USERS } from "./users.ts";

export const OVERRIDES_KIND = "deadline-overrides";
const SWEEP_KIND = "deadline-sweep";
const SWEEP_ID = "reminders";
const NOTE_MAX = 120;
/** An extension may move a deadline at most this many days past the legal day. */
const EXTENSION_MAX_DAYS = 366;
/** Reminders start when a deadline is this many days away (0 = today). */
export const REMINDER_DAYS = 3;
const DAY_MS = 86_400_000;

// --- Occurrences --------------------------------------------------------------------------------

export interface DeadlineOccurrence {
  /** `${rule.id}-${legalDate}`, the id overrides refer to. */
  id: string;
  ruleId: string;
  pathId: PathId;
  title: string;
  /** Gregorian YYYY-MM-DD set by the law. */
  legalDate: string;
  /** Effective due day: the extension's date if any, otherwise the legal date. */
  date: string;
  override?: DeadlineOverride;
}

/**
 * Every occurrence of every rule in the current and the next Jalali year (Tehran calendar), the
 * same ones `upcomingDeadlines` can produce, regardless of anyone's profile.
 */
export function deadlineOccurrences(now: Date = new Date()) {
  const { year } = gregorianToJalali(tehranDate(now));
  const found: Omit<DeadlineOccurrence, "date" | "override">[] = [];
  for (const rule of DEADLINE_RULES) {
    const months = rule.months.length ? rule.months : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    for (const jy of [year, year + 1])
      for (const jm of months) {
        const jd = rule.day === "end" ? jalaliMonthLength(jy, jm) : rule.day;
        const legalDate = jalaliToGregorian(jy, jm, jd);
        found.push({
          id: `${rule.id}-${legalDate}`,
          ruleId: rule.id,
          pathId: rule.pathId,
          title: rule.title,
          legalDate,
        });
      }
  }
  return found;
}

// --- Overrides ----------------------------------------------------------------------------------

const isCalendarDay = (value: string) => {
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
};
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

/** Admin input for one extension; `id` must be an occurrence of the current or next Jalali year. */
export function overrideSchema(now: Date = new Date()) {
  const known = new Map(deadlineOccurrences(now).map((item) => [item.id, item]));
  return z
    .object({
      id: z
        .string({ error: "شناسهٔ مهلت لازم است." })
        .max(64, { error: "شناسهٔ مهلت نامعتبر است." })
        .refine((id) => known.has(id), {
          error: "این مهلت شناخته‌شده نیست. فهرست مهلت‌ها را تازه کنید.",
        }),
      date: z
        .string({ error: "تاریخ تمدید لازم است." })
        .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "تاریخ تمدید نامعتبر است." })
        .refine(isCalendarDay, { error: "تاریخ تمدید نامعتبر است." }),
      note: z
        .string({ error: "یادداشت باید متن باشد." })
        .trim()
        .max(NOTE_MAX, { error: "یادداشت حداکثر ۱۲۰ نویسه است." })
        .optional()
        .transform((value) => value || undefined),
    })
    .superRefine((value, ctx) => {
      const occurrence = known.get(value.id);
      if (!occurrence || !isCalendarDay(value.date)) return;
      const days = daysBetween(occurrence.legalDate, value.date);
      if (days <= 0)
        ctx.addIssue({
          code: "custom",
          path: ["date"],
          message: "تاریخ تمدید باید بعد از مهلت قانونی باشد.",
        });
      else if (days > EXTENSION_MAX_DAYS)
        ctx.addIssue({
          code: "custom",
          path: ["date"],
          message: "تاریخ تمدید حداکثر یک سال بعد از مهلت قانونی است.",
        });
    });
}

export async function listOverrides(db: Store): Promise<DeadlineOverride[]> {
  return (await db.list<DeadlineOverride>(SYSTEM_OWNER, OVERRIDES_KIND)).map((item) => ({
    id: item.id,
    date: item.date,
    ...(item.note ? { note: item.note } : {}),
    ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}),
  }));
}

/** Validates and saves one extension (replacing any earlier one of the same occurrence). */
export async function putOverride(
  db: Store,
  input: unknown,
  now: Date = new Date(),
): Promise<DeadlineOverride> {
  const body = overrideSchema(now).parse(input);
  return db.put<DeadlineOverride>(SYSTEM_OWNER, OVERRIDES_KIND, {
    id: body.id,
    date: body.date,
    ...(body.note ? { note: body.note } : {}),
    updatedAt: now.toISOString(),
  });
}

export async function removeOverride(db: Store, id: string): Promise<void> {
  if (!(await db.take(SYSTEM_OWNER, OVERRIDES_KIND, id)))
    throw new AppError("این تمدید پیدا نشد. فهرست مهلت‌ها را تازه کنید.", 404);
}

/**
 * Admin list: occurrences whose legal day is within the next ~12 months, or whose extended day
 * is still ahead, nearest legal day first.
 */
export async function adminDeadlines(db: Store, now: Date = new Date()) {
  const today = tehranDate(now);
  const overrides = new Map((await listOverrides(db)).map((item) => [item.id, item]));
  const occurrences: DeadlineOccurrence[] = deadlineOccurrences(now)
    .map((item) => {
      const override = overrides.get(item.id);
      return { ...item, date: override?.date ?? item.legalDate, ...(override ? { override } : {}) };
    })
    .filter(
      (item) =>
        item.date >= today && (daysBetween(today, item.legalDate) <= 365 || Boolean(item.override)),
    )
    .sort((a, b) => a.legalDate.localeCompare(b.legalDate) || a.id.localeCompare(b.id));
  return { today, occurrences };
}

/** The signed-in person's deadlines for the chat card, with extensions applied. */
export async function userDeadlines(
  db: Store,
  owner: string,
  now: Date = new Date(),
): Promise<UpcomingDeadline[]> {
  const [profile, overrides] = await Promise.all([readProfile(db, owner), listOverrides(db)]);
  return upcomingDeadlines(profile, now, 10, overrides);
}

// --- Reminder sweep -----------------------------------------------------------------------------

export type Notify = (
  owner: string,
  title: string,
  body: string,
  taskId?: string,
  key?: string,
) => Promise<unknown>;

/** «مهلت ۳ روز دیگر، ۱۵ آبان ۱۴۰۵، تمام می‌شود.» plus the extension note and the next step. */
export function reminderBody(deadline: UpcomingDeadline): string {
  const when =
    deadline.daysLeft <= 0
      ? "امروز"
      : deadline.daysLeft === 1
        ? "فردا"
        : `${faDigits(deadline.daysLeft)} روز دیگر`;
  const day = formatJalali(deadline.date, false);
  const lead = deadline.extended
    ? `مهلت تمدید شد و ${when}، ${day}، تمام می‌شود.`
    : `مهلت ${when}، ${day}، تمام می‌شود.`;
  const raw = deadline.extended?.note?.trim();
  const note = raw ? ` ${/[.؟!]$/.test(raw) ? raw : `${raw}.`}` : "";
  return `${lead}${note} از صفحهٔ گفت‌وگوی دستیار می‌توانید فهرست کارها را آماده کنید.`;
}

/** Idempotency key: an extension (new effective day) produces one fresh reminder. */
export const reminderKey = (deadline: UpcomingDeadline) =>
  `deadline:${deadline.id}:${deadline.date}`;

/**
 * One notification per deadline occurrence within REMINDER_DAYS for every person whose profile has
 * reminders on. Safe to repeat and to run in several processes: `notify` dedupes by key.
 * Returns how many reminders were due (created now or earlier).
 */
export async function sweepDeadlineReminders(
  db: Store,
  notify: Notify,
  now: Date = new Date(),
): Promise<number> {
  const overrides = await listOverrides(db);
  // Disabled accounts get nothing, not even through a still-linked Bale chat.
  const disabled = new Set(
    (await db.list<{ id: string; status?: string }>(SYSTEM_OWNER, USERS))
      .filter((user) => user.status === "disabled")
      .map((user) => user.id),
  );
  let due = 0;
  for (const { owner, value } of await db.scan<Partial<UserProfile> & { id: string }>(
    "agent-settings",
  )) {
    if (value.id !== "profile" || owner === SYSTEM_OWNER || disabled.has(owner)) continue;
    const profile = sanitizeProfile(value);
    if (!profile.reminders || !profile.paths.length) continue;
    for (const deadline of upcomingDeadlines(profile, now, REMINDER_DAYS + 1, overrides)) {
      due++;
      await notify(owner, deadline.title, reminderBody(deadline), undefined, reminderKey(deadline));
    }
  }
  return due;
}

/** Tehran hour (0–23) of an instant. */
const tehranHour = (now: Date) =>
  Math.floor(((now.getTime() / 60_000 + TEHRAN_OFFSET_MINUTES) % 1440) / 60);

/**
 * Claims the sweep for one hourly slot; exactly one process wins each slot, so several API or
 * worker processes cost one small query each per tick.
 */
export async function claimSweepSlot(db: Store, slot: string): Promise<boolean> {
  if (await db.insertIfAbsent(SYSTEM_OWNER, SWEEP_KIND, { id: SWEEP_ID, slot })) return true;
  const current = await db.get<{ slot?: string }>(SYSTEM_OWNER, SWEEP_KIND, SWEEP_ID);
  if (!current?.slot || current.slot >= slot) return false;
  return Boolean(
    await db.compareAndSwap(SYSTEM_OWNER, SWEEP_KIND, SWEEP_ID, { slot: current.slot }, { slot }),
  );
}

/**
 * Runs the sweep at most once per hour across all processes, only between 08:00 and 21:59 Tehran
 * time so messages never arrive at night. Returns a stop function that waits for a running sweep.
 */
export function startDeadlineSweep(
  db: Store,
  notify: Notify,
  options: { tickMs?: number; now?: () => Date } = {},
): () => Promise<void> {
  let running: Promise<void> | undefined;
  const tick = () => {
    if (running) return;
    const now = options.now?.() ?? new Date();
    const hour = tehranHour(now);
    if (hour < 8 || hour > 21) return;
    running = (async () => {
      if (await claimSweepSlot(db, now.toISOString().slice(0, 13)))
        await sweepDeadlineReminders(db, notify, now);
    })()
      .catch((error) => backgroundFailure("deadline reminders", error))
      .finally(() => {
        running = undefined;
      });
  };
  tick();
  const timer = setInterval(tick, options.tickMs ?? 10 * 60_000);
  timer.unref?.();
  return async () => {
    clearInterval(timer);
    await running;
  };
}
