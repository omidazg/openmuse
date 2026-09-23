import assert from "node:assert/strict";
import test from "node:test";
import {
  CHANGELOG,
  LATEST_CHANGELOG_ID,
  unseenChangelog,
} from "../../../packages/domain/src/changelog.ts";
import { starterSuggestions, tehranPartOfDay } from "../src/starter-suggestions.ts";

const ids = (now: string, context = {}) =>
  starterSuggestions({ now: new Date(now), ...context }).map((item) => item.id);

test("time of day is read in Tehran (+03:30)", () => {
  assert.equal(tehranPartOfDay(new Date("2026-10-07T01:29:00Z")), "evening"); // 04:59
  assert.equal(tehranPartOfDay(new Date("2026-10-07T01:30:00Z")), "morning"); // 05:00
  assert.equal(tehranPartOfDay(new Date("2026-10-07T07:30:00Z")), "midday"); // 11:00
  assert.equal(tehranPartOfDay(new Date("2026-10-07T13:30:00Z")), "evening"); // 17:00
});

test("morning and evening starters on a plain weekday", () => {
  // Wednesday 1405-07-15, no holiday or occasion in the coming week.
  assert.deepEqual(ids("2026-10-07T04:30:00Z"), ["news", "today-plan", "calendar", "prices"]);
  assert.deepEqual(ids("2026-10-07T16:30:00Z"), [
    "day-summary",
    "tomorrow-plan",
    "calendar",
    "prices",
  ]);
  assert.deepEqual(ids("2026-10-07T09:30:00Z"), ["prices", "calendar", "news", "letter"]);
});

test("Thursday looks at the weekend and Friday at the week ahead", () => {
  assert.deepEqual(ids("2026-10-08T09:30:00Z"), ["weekend", "prices", "calendar", "news"]);
  assert.deepEqual(ids("2026-10-09T04:30:00Z"), ["week-ahead", "news", "today-plan", "calendar"]);
  // Thursday evening in Tehran is still Thursday even though UTC is the same day.
  assert.equal(ids("2026-10-08T19:00:00Z")[0], "weekend");
});

test("an upcoming holiday or occasion comes first", () => {
  // 1405-07-01, first day of school (a notable occasion, not a holiday).
  const school = starterSuggestions({ now: new Date("2026-09-23T04:30:00Z") });
  assert.equal(school[0].label, "امروز: آغاز سال تحصیلی");
  assert.match(school[0].prompt, /۱ مهر ۱۴۰۵/);
  // Two days before the official holiday of 1405-08-22.
  const holiday = starterSuggestions({ now: new Date("2026-11-11T16:30:00Z") });
  assert.equal(holiday[0].id, "occasion-2026-11-13");
  assert.equal(holiday[0].label, "برنامه برای تعطیلی پس‌فردا: شهادت حضرت فاطمه زهرا (س)");
  assert.match(holiday[0].prompt, /تعطیل رسمی است/);
});

test("recent files and near events are suggested, older or derived ones are not", () => {
  const now = "2026-10-07T04:30:00Z";
  const files = [
    { id: "old", name: "قرارداد.pdf", createdAt: "2026-09-30T08:00:00Z" },
    { id: "filled", name: "فرم.pdf", createdAt: "2026-10-07T03:00:00Z", parentId: "f1" },
    { id: "f1", name: "صورت‌حساب.docx", createdAt: "2026-10-06T08:00:00Z" },
  ];
  const events = [
    { title: "جلسهٔ دیروز", start: "2026-10-06T06:30:00Z", allDay: false },
    { title: "جلسهٔ تیم", start: "2026-10-08T06:30:00Z", allDay: false },
  ];
  const result = starterSuggestions({ now: new Date(now), files, events });
  assert.deepEqual(
    result.map((item) => item.id),
    ["event", "file", "news", "today-plan"],
  );
  assert.equal(result[0].label, "آمادگی برای «جلسهٔ تیم»");
  assert.match(result[0].prompt, /فردا/);
  assert.equal(result[1].label, "خلاصهٔ «صورت‌حساب.docx»");
  assert.match(result[1].prompt, /شناسهٔ سند: f1/);
});

test("always four unique starters", () => {
  for (let hour = 0; hour < 24 * 14; hour += 5) {
    const list = ids(new Date(Date.UTC(2026, 2, 15) + hour * 3_600_000).toISOString());
    assert.equal(list.length, 4);
    assert.equal(new Set(list).size, 4);
  }
});

test("changelog: unseen entries are those newer than the saved id", () => {
  assert.equal(new Set(CHANGELOG.map((entry) => entry.id)).size, CHANGELOG.length);
  assert.equal(unseenChangelog(null).length, CHANGELOG.length);
  assert.equal(unseenChangelog("removed-entry").length, CHANGELOG.length);
  assert.deepEqual(unseenChangelog(LATEST_CHANGELOG_ID), []);
  assert.deepEqual(
    unseenChangelog(CHANGELOG[2].id).map((entry) => entry.id),
    [CHANGELOG[0].id, CHANGELOG[1].id],
  );
});
