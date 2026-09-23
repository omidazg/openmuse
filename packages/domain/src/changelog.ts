/**
 * «تازه‌ها» (What's new): a static, newest-first list of user-facing changes. Add new entries at
 * the top with a new unique `id`; the app shows a dot until the person has seen the newest id.
 */
export interface ChangelogEntry {
  /** Stable machine id, never shown. */
  id: string;
  /** Release day, Gregorian `YYYY-MM-DD` (shown in Jalali). */
  date: string;
  title: string;
  detail: string;
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    id: "2026-09-23-iran-calendar",
    date: "2026-09-23",
    title: "تقویم شمسی و تعطیلات",
    detail:
      "دستیار تاریخ امروز را به شمسی و به وقت تهران می‌داند و تعطیلات رسمی و مناسبت‌های پیش رو را می‌شناسد.",
  },
  {
    id: "2026-09-23-word",
    date: "2026-09-23",
    title: "خواندن فایل‌های Word",
    detail: "فایل‌های Word، Excel و CSV را بارگذاری کنید تا دستیار متنشان را بخواند و خلاصه کند.",
  },
  {
    id: "2026-09-23-persian-pdf",
    date: "2026-09-23",
    title: "PDF فارسی",
    detail: "سندهای PDF با متن فارسی، با حروف پیوسته و راست‌به‌چپ درست ساخته می‌شوند.",
  },
  {
    id: "2026-09-23-installable-web",
    date: "2026-09-23",
    title: "نسخهٔ نصب‌شدنی وب",
    detail: "دستیار را از مرورگر روی صفحهٔ اصلی گوشی یا رایانه نصب کنید و مثل یک برنامه باز کنید.",
  },
  {
    id: "2026-09-23-model-picker",
    date: "2026-09-23",
    title: "انتخاب مدل",
    detail:
      "از فهرست بالای جعبهٔ پیام، مدل هوش مصنوعی گفت‌وگو را انتخاب کنید؛ انتخاب شما ذخیره می‌شود.",
  },
  {
    id: "2026-09-23-voice",
    date: "2026-09-23",
    title: "ورودی صوتی",
    detail: "پیامتان را بگویید؛ متن آن در جعبهٔ پیام می‌نشیند تا پیش از ارسال بازبینی کنید.",
  },
  {
    id: "2026-09-23-bale",
    date: "2026-09-23",
    title: "ربات بله",
    detail: "از پیام‌رسان بله هم با دستیار گفت‌وگو کنید؛ اتصال حساب از بخش «برنامه‌ها» انجام می‌شود.",
  },
  {
    id: "2026-09-23-access-key",
    date: "2026-09-23",
    title: "ورود با کلید",
    detail: "هر نفر با کلید دسترسی خودش وارد می‌شود و فضای کار جداگانه‌ای دارد.",
  },
];

/** Id of the newest entry; saved as «seen» when the person opens the list. */
export const LATEST_CHANGELOG_ID = CHANGELOG[0]?.id ?? "";

/** Entries newer than `seenId`. Unknown or missing ids count everything as unseen. */
export function unseenChangelog(
  seenId: string | null | undefined,
  entries: readonly ChangelogEntry[] = CHANGELOG,
): ChangelogEntry[] {
  const index = seenId ? entries.findIndex((entry) => entry.id === seenId) : -1;
  return index < 0 ? [...entries] : entries.slice(0, index);
}
