import {
  formatJalali,
  getHolidays,
  TEHRAN_OFFSET_MINUTES,
  tehranDate,
} from "../../../packages/domain/src/iran-holidays";

/** One tappable starter on the empty chat screen: a short label and the message it sends. */
export interface StarterSuggestion {
  id: string;
  label: string;
  prompt: string;
}

/** Cheap signals from the already-loaded workspace; everything is optional. */
export interface StarterContext {
  now?: Date;
  files?: readonly { id: string; name: string; createdAt: string; parentId?: string }[];
  events?: readonly { title: string; start: string; allDay: boolean }[];
}

const DAY = 86_400_000;
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

function daysLabel(days: number): string {
  if (days <= 0) return "امروز";
  if (days === 1) return "فردا";
  if (days === 2) return "پس‌فردا";
  return `${String(days).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)])} روز دیگر`;
}

/** Morning 05–11, midday 11–17, evening 17–05 (Asia/Tehran). */
export function tehranPartOfDay(now: Date): "morning" | "midday" | "evening" {
  const hour = new Date(now.getTime() + TEHRAN_OFFSET_MINUTES * 60_000).getUTCHours();
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 17) return "midday";
  return "evening";
}

const GENERAL: StarterSuggestion[] = [
  {
    id: "calendar",
    label: "امروز چندم است و تعطیلی بعدی کی است؟",
    prompt: "امروز به تقویم شمسی چندم است و تعطیلی رسمی بعدی کی است؟",
  },
  {
    id: "prices",
    label: "قیمت امروز دلار، سکه و طلا",
    prompt: "قیمت امروز دلار، سکه و طلای ۱۸ عیار را از tgju.org پیدا کن",
  },
  {
    id: "news",
    label: "خلاصهٔ خبرهای مهم امروز",
    prompt: "خبرهای مهم امروز ایران را از خبرگزاری‌های فارسی خلاصه کن",
  },
  {
    id: "letter",
    label: "نوشتن نامهٔ اداری",
    prompt: "یک نامهٔ اداری رسمی برای درخواست مرخصی بنویس؛ اول نام، سمت و تاریخ‌ها را از من بپرس",
  },
];

/**
 * Four starters for the empty chat, picked from Tehran time of day, the Iranian weekday,
 * holidays and occasions of the coming week, and the person's recent files and events.
 * Pure: the same input always gives the same output.
 */
export function starterSuggestions(context: StarterContext = {}): StarterSuggestion[] {
  const now = context.now ?? new Date();
  const today = tehranDate(now);
  const tomorrow = addDays(today, 1);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const part = tehranPartOfDay(now);
  const picks: StarterSuggestion[] = [];

  // 1. The nearest holiday or occasion of the coming week (holidays win on the same day).
  const occasion = getHolidays(today, addDays(today, 7))[0];
  if (occasion) {
    const days = Math.round((Date.parse(occasion.date) - Date.parse(today)) / DAY);
    const when = daysLabel(days);
    const date = formatJalali(occasion.date);
    picks.push(
      occasion.holiday
        ? {
            id: `occasion-${occasion.date}`,
            label: `برنامه برای تعطیلی ${when}: ${occasion.title}`,
            prompt: `${date} به مناسبت «${occasion.title}» تعطیل رسمی است. برای این تعطیلی یک برنامهٔ ساده پیشنهاد بده و بگو چه کارهایی را بهتر است پیش از آن انجام دهم.`,
          }
        : {
            id: `occasion-${occasion.date}`,
            label: `${when}: ${occasion.title}`,
            prompt: `${date} «${occasion.title}» است. چند پیشنهاد کاربردی برای این مناسبت بده؛ مثلاً پیام تبریک، خرید یا برنامه‌ای که لازم است.`,
          },
    );
  }

  // 2. Recent activity: an event today or tomorrow, then a file added in the last three days.
  const event = (context.events ?? [])
    .filter((item) => {
      const day = item.allDay ? item.start.slice(0, 10) : tehranDate(new Date(item.start));
      return (
        (day === today && (item.allDay || Date.parse(item.start) > now.getTime())) ||
        day === tomorrow
      );
    })
    .sort((a, b) => a.start.localeCompare(b.start))[0];
  if (event) {
    const day = event.allDay ? event.start.slice(0, 10) : tehranDate(new Date(event.start));
    picks.push({
      id: "event",
      label: `آمادگی برای «${event.title}»`,
      prompt: `رویداد «${event.title}» ${day === today ? "امروز" : "فردا"} در تقویم من است. جزئیاتش را از تقویم ببین و برای آمادگی، فهرست کوتاهی از کارهای لازم بنویس.`,
    });
  }
  const file = (context.files ?? [])
    .filter(
      (item) =>
        !item.parentId &&
        now.getTime() - Date.parse(item.createdAt) >= 0 &&
        now.getTime() - Date.parse(item.createdAt) < 3 * DAY,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (file)
    picks.push({
      id: "file",
      label: `خلاصهٔ «${file.name}»`,
      prompt: `سند «${file.name}» (شناسهٔ سند: ${file.id}) را بخوان و نکته‌های اصلی‌اش را کوتاه خلاصه کن.`,
    });

  // 3. Weekday: Thursday and Friday look at the weekend and the week ahead (week starts Saturday).
  if (weekday === 4)
    picks.push({
      id: "weekend",
      label: "برنامهٔ آخر هفته",
      prompt:
        "برای پنجشنبه‌شب و جمعهٔ این هفته یک برنامهٔ ساده بریز؛ تقویمم را ببین و چند پیشنهاد تفریحی و خانوادگی در شهر خودم بده.",
    });
  else if (weekday === 5)
    picks.push({
      id: "week-ahead",
      label: "برنامهٔ هفتهٔ پیش رو",
      prompt:
        "تقویم هفتهٔ پیش رو (از شنبه تا پنجشنبه) را ببین، کارهای مهم را فهرست کن و برای هر روز یک اولویت پیشنهاد بده.",
    });

  // 4. Time of day in Tehran.
  if (part === "morning")
    picks.push(GENERAL[2], {
      id: "today-plan",
      label: "برنامهٔ امروز من",
      prompt: "تقویم امروزم را ببین و برای امروز یک برنامهٔ مرتب با اولویت‌ها پیشنهاد بده.",
    });
  else if (part === "evening")
    picks.push(
      {
        id: "day-summary",
        label: "خلاصهٔ امروز",
        prompt: "کارها، پیام‌ها و رویدادهای امروزم را مرور کن و خلاصهٔ کوتاهی از روز بنویس.",
      },
      {
        id: "tomorrow-plan",
        label: "برنامهٔ فردا",
        prompt:
          "تقویم فردایم را ببین و برای فردا یک برنامهٔ مرتب با یادآوری کارهای مهم پیشنهاد بده.",
      },
    );
  else picks.push(GENERAL[1]);

  // 5. Everyday fallbacks.
  picks.push(...GENERAL);
  const seen = new Set<string>();
  return picks.filter((item) => !seen.has(item.id) && seen.add(item.id)).slice(0, 4);
}
