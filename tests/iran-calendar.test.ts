import assert from "node:assert/strict";
import test from "node:test";
import {
  formatJalali,
  getHolidays,
  gregorianToJalali,
  holidaysByDate,
  IRAN_HOLIDAY_YEARS,
  iranCalendarContext,
  isIranWeekend,
  jalaliToGregorian,
  tehranDate,
} from "../packages/domain/src/iran-holidays.ts";

const toLatin = (text: string) => text.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));

test("Jalali conversion matches Intl's Persian calendar for every day of 2024-2028", () => {
  const format = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", {
    timeZone: "UTC",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  for (let time = Date.UTC(2024, 0, 1); time < Date.UTC(2029, 0, 1); time += 86_400_000) {
    const date = new Date(time).toISOString().slice(0, 10);
    const parts = Object.fromEntries(
      format.formatToParts(new Date(time)).map((part) => [part.type, part.value]),
    );
    const expected = {
      year: Number.parseInt(parts.year, 10),
      month: +parts.month,
      day: +parts.day,
    };
    assert.deepEqual(gregorianToJalali(date), expected, date);
    assert.equal(jalaliToGregorian(expected.year, expected.month, expected.day), date);
  }
});

test("known official holidays resolve to the right Gregorian days", () => {
  const days = getHolidays("2025-03-21", "2025-03-24", { holidaysOnly: true });
  // 1404/1/2 is also the martyrdom of Imam Ali, a lunar holiday on the same day.
  assert(days.some((item) => item.jalali === "1404-01-02" && item.basis === "lunar"));
  const nowruz = days.filter((item) => item.basis === "solar");
  assert.equal(nowruz.length, 4);
  assert.deepEqual(
    nowruz.map((item) => item.jalali),
    ["1404-01-01", "1404-01-02", "1404-01-03", "1404-01-04"],
  );
  assert(nowruz.every((item) => item.basis === "solar" && !item.estimated));
  const ashura = getHolidays("2025-07-06", "2025-07-06");
  assert.equal(ashura.length, 1);
  assert.equal(ashura[0].basis, "lunar");
  assert.equal(ashura[0].holiday, true);
  assert.match(ashura[0].title, /عاشورا/);
  assert.equal(jalaliToGregorian(1405, 1, 1), "2026-03-21");
  assert.equal(jalaliToGregorian(1406, 1, 1), "2027-03-21");
});

test("1406 lunar dates are estimated and solar ones are not", () => {
  const year1406 = getHolidays(jalaliToGregorian(1406, 1, 1), jalaliToGregorian(1406, 12, 29));
  const lunar = year1406.filter((item) => item.basis === "lunar");
  assert(lunar.length > 10);
  assert(lunar.every((item) => item.estimated));
  assert(year1406.filter((item) => item.basis === "solar").every((item) => !item.estimated));
  const year1405 = getHolidays(jalaliToGregorian(1405, 1, 1), jalaliToGregorian(1405, 12, 29));
  assert(year1405.filter((item) => item.holiday).every((item) => !item.estimated));
  assert.deepEqual([...IRAN_HOLIDAY_YEARS], [1404, 1405, 1406]);
});

test("holidaysOnly drops non-holiday occasions and results stay sorted", () => {
  const all = getHolidays("2025-03-21", "2026-03-20");
  const holidays = getHolidays("2025-03-21", "2026-03-20", { holidaysOnly: true });
  assert(holidays.length < all.length);
  assert(holidays.every((item) => item.holiday));
  assert(all.some((item) => /یلدا/.test(item.title) && !item.holiday));
  const dates = all.map((item) => item.date);
  assert.deepEqual(dates, [...dates].sort());
  const byDate = holidaysByDate("2025-03-21", "2025-03-21");
  assert.equal(byDate.get("2025-03-21")?.[0]?.holiday, true);
  assert.deepEqual(getHolidays("2030-01-01", "2030-12-31"), []);
});

test("Friday is the weekend and Tehran dates use UTC+03:30", () => {
  assert.equal(isIranWeekend("2025-03-21"), true);
  assert.equal(isIranWeekend("2025-03-22"), false);
  assert.equal(tehranDate(new Date("2026-03-20T20:29:00Z")), "2026-03-20");
  assert.equal(tehranDate(new Date("2026-03-20T20:30:00Z")), "2026-03-21");
  assert.match(toLatin(formatJalali("2026-03-21")), /1405/);
});

test("agent context carries today's Jalali date, weekday and upcoming holidays", () => {
  const context = iranCalendarContext(new Date("2026-03-20T21:00:00Z"));
  assert.equal(context.gregorianDate, "2026-03-21");
  assert.equal(context.jalaliDate, "1405-01-01");
  assert.equal(context.weekday, "شنبه");
  assert.equal(context.tehranTime, "00:30");
  assert.equal(context.todayIsHoliday, true);
  assert(context.upcoming.length >= 3);
  assert.equal(context.upcoming[0].date, "2026-03-21");
  assert.equal(
    new Set(context.upcoming.map((item) => `${item.date}${item.title}`)).size,
    context.upcoming.length,
  );
});
