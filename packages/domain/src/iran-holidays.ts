/**
 * Iranian (Solar Hijri / Jalali) calendar helpers and the official public holidays
 * of Jalali years 1404–1406.
 *
 * Sources:
 * - 1404 and 1405: the official calendar of the country published by the University of
 *   Tehran Institute of Geophysics Calendar Center (calendar.ut.ac.ir), as mirrored on
 *   bahesab.ir/time/1404 and bahesab.ir/time/1405 and cross-checked with time.ir.
 * - 1406: the official calendar was not yet published when this table was written.
 *   Solar holidays are fixed by law and exact. Lunar (Hijri qamari) holidays are
 *   estimated as the Umm al-Qura date plus one day, which matched 60–70٪ of the
 *   official 1404–1405 lunar holidays (the rest matched Umm al-Qura exactly). These
 *   entries are marked `estimated: true` and can differ by a day from the official
 *   calendar once it is published. Official lunar dates can also move by a day after
 *   the actual moon sighting.
 *
 * No `Intl` calendar support is required (Hermes on Android lacks it), so the Jalali
 * conversion below is arithmetic.
 */

export interface IranOccasion {
  /** Gregorian calendar day in Iran (Asia/Tehran), `YYYY-MM-DD`. */
  date: string;
  /** Jalali date with Latin digits, `YYYY-MM-DD`. */
  jalali: string;
  /** Persian title shown to people. */
  title: string;
  /** Official public holiday (office closure) rather than a notable occasion. */
  holiday: boolean;
  /** Solar (fixed Jalali or computed from the solar calendar) or lunar (Hijri qamari). */
  basis: "solar" | "lunar";
  /** True when the date is not yet confirmed by the official calendar. */
  estimated: boolean;
}

export const JALALI_MONTHS = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
] as const;

/** Persian weekday names indexed by JavaScript `getUTCDay()` (0 = Sunday). */
export const PERSIAN_WEEKDAYS = [
  "یکشنبه",
  "دوشنبه",
  "سه‌شنبه",
  "چهارشنبه",
  "پنجشنبه",
  "جمعه",
  "شنبه",
] as const;

/** Asia/Tehran is UTC+03:30 with no daylight saving time since 1401 (2022). */
export const TEHRAN_OFFSET_MINUTES = 210;

const DAY = 86_400_000;
const div = (a: number, b: number) => Math.trunc(a / b);
const mod = (a: number, b: number) => a - Math.trunc(a / b) * b;
const BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394,
  2456, 3178,
];

/** Leap status and the March day of Nowruz for a Jalali year (Borkowski's 33-year breaks). */
function jalaliYearInfo(jy: number): { leap: boolean; gy: number; march: number } {
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jump = 0;
  for (let i = 1; i < BREAKS.length; i++) {
    const jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap: leap === 0, gy, march };
}

function nowruz(jy: number): number {
  const { gy, march } = jalaliYearInfo(jy);
  return Date.UTC(gy, 2, march);
}

export function isJalaliLeapYear(jy: number): boolean {
  return jalaliYearInfo(jy).leap;
}

export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isJalaliLeapYear(jy) ? 30 : 29;
}

/** Gregorian `YYYY-MM-DD` for a Jalali date. */
export function jalaliToGregorian(jy: number, jm: number, jd: number): string {
  const dayOfYear = jm <= 7 ? (jm - 1) * 31 : 186 + (jm - 7) * 30;
  return new Date(nowruz(jy) + (dayOfYear + jd - 1) * DAY).toISOString().slice(0, 10);
}

/** Jalali parts for a Gregorian `YYYY-MM-DD` calendar day. */
export function gregorianToJalali(date: string): { year: number; month: number; day: number } {
  const time = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(time)) throw new RangeError(`Invalid date: ${date}`);
  const gy = new Date(time).getUTCFullYear();
  let year = gy - 621;
  let start = nowruz(year);
  if (time < start) {
    year -= 1;
    start = nowruz(year);
  }
  const dayOfYear = Math.round((time - start) / DAY);
  if (dayOfYear < 186) return { year, month: div(dayOfYear, 31) + 1, day: mod(dayOfYear, 31) + 1 };
  return {
    year,
    month: 7 + div(dayOfYear - 186, 30),
    day: mod(dayOfYear - 186, 30) + 1,
  };
}

/** Iran's calendar day (`YYYY-MM-DD`, Gregorian) for an instant. */
export function tehranDate(value: Date = new Date()): string {
  return new Date(value.getTime() + TEHRAN_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

function faDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

/** «شنبه ۲ فروردین ۱۴۰۵» for a Gregorian calendar day. */
export function formatJalali(date: string, withWeekday = true): string {
  const { year, month, day } = gregorianToJalali(date);
  const weekday = PERSIAN_WEEKDAYS[new Date(`${date.slice(0, 10)}T00:00:00Z`).getUTCDay()];
  const text = `${faDigits(day)} ${JALALI_MONTHS[month - 1]} ${faDigits(year)}`;
  return withWeekday ? `${weekday} ${text}` : text;
}

const pad = (value: number) => String(value).padStart(2, "0");

// Occasion titles. Digits inside titles are Persian because they are shown as-is.
const T = {
  nowruzStart: "آغاز نوروز",
  nowruz: "عید نوروز",
  republic: "روز جمهوری اسلامی ایران",
  nature: "روز طبیعت (سیزده‌به‌در)",
  khomeini: "رحلت امام خمینی",
  khordad15: "قیام ۱۵ خرداد",
  revolution: "پیروزی انقلاب اسلامی ایران",
  oil: "روز ملی شدن صنعت نفت ایران",
  fitr: "عید سعید فطر",
  fitr2: "تعطیل به مناسبت عید سعید فطر",
  sadiq: "شهادت امام جعفر صادق (ع)",
  adha: "عید سعید قربان",
  ghadir: "عید سعید غدیر خم",
  tasua: "تاسوعای حسینی",
  ashura: "عاشورای حسینی",
  arbaeen: "اربعین حسینی",
  rehlat: "رحلت حضرت رسول اکرم (ص) و شهادت امام حسن مجتبی (ع)",
  reza: "شهادت امام رضا (ع)",
  askari: "شهادت امام حسن عسکری (ع)",
  mawlid: "میلاد حضرت رسول اکرم (ص) و امام جعفر صادق (ع)",
  fatima: "شهادت حضرت فاطمه زهرا (س)",
  ali: "ولادت امام علی (ع) و روز پدر",
  mabath: "مبعث حضرت رسول اکرم (ص)",
  mahdi: "ولادت حضرت قائم (عج)",
  aliMartyr: "شهادت حضرت علی (ع)",
  mother: "ولادت حضرت فاطمه زهرا (س) و روز مادر",
  ramadan: "آغاز ماه رمضان",
  teacher: "روز معلم",
  ferdowsi: "روز بزرگداشت فردوسی و پاسداشت زبان فارسی",
  school: "آغاز سال تحصیلی",
  student: "روز دانشجو",
  yalda: "شب یلدا",
  suri: "چهارشنبه‌سوری",
} as const;

type Entry = readonly [month: number, day: number, title: string];

/** Fixed solar holidays, identical every year. */
const SOLAR_HOLIDAYS: Entry[] = [
  [1, 1, T.nowruzStart],
  [1, 2, T.nowruz],
  [1, 3, T.nowruz],
  [1, 4, T.nowruz],
  [1, 12, T.republic],
  [1, 13, T.nature],
  [3, 14, T.khomeini],
  [3, 15, T.khordad15],
  [11, 22, T.revolution],
  [12, 29, T.oil],
];

/** Fixed solar occasions that are not public holidays. */
const SOLAR_OCCASIONS: Entry[] = [
  [2, 12, T.teacher],
  [2, 25, T.ferdowsi],
  [7, 1, T.school],
  [9, 16, T.student],
  [9, 30, T.yalda],
];

/** Lunar holidays per Jalali year. 1404 and 1405 are official; 1406 is estimated. */
const LUNAR_HOLIDAYS: Record<number, { estimated: boolean; entries: Entry[] }> = {
  1404: {
    estimated: false,
    entries: [
      [1, 2, T.aliMartyr],
      [1, 11, T.fitr],
      [1, 12, T.fitr2],
      [2, 4, T.sadiq],
      [3, 16, T.adha],
      [3, 24, T.ghadir],
      [4, 14, T.tasua],
      [4, 15, T.ashura],
      [5, 23, T.arbaeen],
      [5, 31, T.rehlat],
      [6, 2, T.reza],
      [6, 10, T.askari],
      [6, 19, T.mawlid],
      [9, 3, T.fatima],
      [10, 13, T.ali],
      [10, 27, T.mabath],
      [11, 15, T.mahdi],
      [12, 20, T.aliMartyr],
    ],
  },
  1405: {
    estimated: false,
    entries: [
      [1, 1, T.fitr],
      [1, 2, T.fitr2],
      [1, 25, T.sadiq],
      [3, 6, T.adha],
      [3, 14, T.ghadir],
      [4, 3, T.tasua],
      [4, 4, T.ashura],
      [5, 13, T.arbaeen],
      [5, 21, T.rehlat],
      [5, 22, T.reza],
      [5, 30, T.askari],
      [6, 8, T.mawlid],
      [8, 22, T.fatima],
      [10, 2, T.ali],
      [10, 16, T.mabath],
      [11, 4, T.mahdi],
      [12, 9, T.aliMartyr],
      [12, 19, T.fitr],
      [12, 20, T.fitr2],
    ],
  },
  1406: {
    estimated: true,
    entries: [
      [1, 14, T.sadiq],
      [2, 27, T.adha],
      [3, 4, T.ghadir],
      [3, 25, T.tasua],
      [3, 26, T.ashura],
      [5, 3, T.arbaeen],
      [5, 11, T.rehlat],
      [5, 12, T.reza],
      [5, 20, T.askari],
      [5, 29, T.mawlid],
      [8, 12, T.fatima],
      [9, 21, T.ali],
      [10, 5, T.mabath],
      [10, 23, T.mahdi],
      [11, 29, T.aliMartyr],
      [12, 8, T.fitr],
      [12, 9, T.fitr2],
    ],
  },
};

export const IRAN_HOLIDAY_YEARS = [1404, 1405, 1406] as const;

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

function occasion(
  jy: number,
  [month, day, title]: Entry,
  holiday: boolean,
  basis: IranOccasion["basis"],
  estimated: boolean,
): IranOccasion {
  return {
    date: jalaliToGregorian(jy, month, day),
    jalali: `${jy}-${pad(month)}-${pad(day)}`,
    title,
    holiday,
    basis,
    estimated,
  };
}

function fromGregorian(
  date: string,
  title: string,
  holiday: boolean,
  basis: IranOccasion["basis"],
  estimated: boolean,
): IranOccasion {
  const j = gregorianToJalali(date);
  return {
    date,
    jalali: `${j.year}-${pad(j.month)}-${pad(j.day)}`,
    title,
    holiday,
    basis,
    estimated,
  };
}

function yearOccasions(jy: number): IranOccasion[] {
  const lunar = LUNAR_HOLIDAYS[jy];
  if (!lunar) return [];
  const list: IranOccasion[] = [
    ...SOLAR_HOLIDAYS.map((entry) => occasion(jy, entry, true, "solar", false)),
    ...SOLAR_OCCASIONS.map((entry) => occasion(jy, entry, false, "solar", false)),
    ...lunar.entries.map((entry) => occasion(jy, entry, true, "lunar", lunar.estimated)),
  ];
  // Lunar occasions derived from an official holiday in the same Hijri month.
  const fatima = list.find((item) => item.title === T.fatima && item.jalali.startsWith(`${jy}-`));
  if (fatima)
    list.push(fromGregorian(addDays(fatima.date, 17), T.mother, false, "lunar", fatima.estimated));
  const lastAliMartyr = list
    .filter((item) => item.title === T.aliMartyr && item.jalali.startsWith(`${jy}-`))
    .at(-1);
  if (lastAliMartyr)
    list.push(
      fromGregorian(
        addDays(lastAliMartyr.date, -20),
        T.ramadan,
        false,
        "lunar",
        lastAliMartyr.estimated,
      ),
    );
  // Chaharshanbe Suri is the evening of the last Tuesday of the year.
  let suri = jalaliToGregorian(jy, 12, jalaliMonthLength(jy, 12));
  while (new Date(`${suri}T00:00:00Z`).getUTCDay() !== 2) suri = addDays(suri, -1);
  list.push(fromGregorian(suri, T.suri, false, "solar", false));
  return list;
}

const ALL: IranOccasion[] = IRAN_HOLIDAY_YEARS.flatMap(yearOccasions).sort(
  (a, b) => a.date.localeCompare(b.date) || Number(b.holiday) - Number(a.holiday),
);

function dayKey(value: string | Date): string {
  return typeof value === "string" ? value.slice(0, 10) : tehranDate(value);
}

/**
 * Official holidays and notable occasions between `from` and `to` (inclusive).
 * Strings are Gregorian `YYYY-MM-DD` calendar days in Iran; a `Date` is read in
 * Asia/Tehran. Pass `{ holidaysOnly: true }` to omit non-holiday occasions.
 * Only Jalali years 1404–1406 are covered.
 */
export function getHolidays(
  from: string | Date,
  to: string | Date,
  options: { holidaysOnly?: boolean } = {},
): IranOccasion[] {
  const start = dayKey(from);
  const end = dayKey(to);
  return ALL.filter(
    (item) => item.date >= start && item.date <= end && (!options.holidaysOnly || item.holiday),
  );
}

/** Occasions keyed by Gregorian day for quick calendar rendering. */
export function holidaysByDate(
  from: string | Date,
  to: string | Date,
): Map<string, IranOccasion[]> {
  const map = new Map<string, IranOccasion[]>();
  for (const item of getHolidays(from, to))
    map.set(item.date, [...(map.get(item.date) ?? []), item]);
  return map;
}

/** Friday is the weekly day off in Iran. */
export function isIranWeekend(date: string): boolean {
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).getUTCDay() === 5;
}

/**
 * Compact, model-facing description of "now" in Iran: Jalali date, weekday, Tehran
 * time and the holidays of the coming weeks. Values are data for the agent prompt.
 */
export function iranCalendarContext(now: Date = new Date(), days = 45) {
  const today = tehranDate(now);
  const j = gregorianToJalali(today);
  const local = new Date(now.getTime() + TEHRAN_OFFSET_MINUTES * 60_000);
  const time = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
  const end = addDays(today, days);
  return {
    timeZone: "Asia/Tehran (UTC+03:30, no DST)",
    nowIso: now.toISOString(),
    gregorianDate: today,
    jalaliDate: `${j.year}-${pad(j.month)}-${pad(j.day)}`,
    jalaliText: formatJalali(today),
    weekday: PERSIAN_WEEKDAYS[new Date(`${today}T00:00:00Z`).getUTCDay()],
    tehranTime: time,
    todayIsHoliday:
      isIranWeekend(today) || getHolidays(today, today, { holidaysOnly: true }).length > 0,
    weekStartsOn: "شنبه (Saturday); Friday is the weekly day off",
    upcoming: [
      ...new Set([
        ...getHolidays(today, end),
        ...getHolidays(today, addDays(today, 400), { holidaysOnly: true }).slice(0, 3),
      ]),
    ].map((item) => ({
      date: item.date,
      jalali: formatJalali(item.date),
      title: item.title,
      holiday: item.holiday,
      ...(item.estimated ? { estimated: true } : {}),
    })),
    coverage: "Iranian holiday data covers Jalali years 1404–1406 only.",
  };
}
