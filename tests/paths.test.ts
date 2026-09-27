import assert from "node:assert/strict";
import test from "node:test";
import {
  answerSummary,
  EMPTY_PROFILE,
  matchPathTopic,
  PATH_MAX,
  PATHS,
  pathDefaultLength,
  pathPrompt,
  pathShortcuts,
  pathStarters,
  sanitizeProfile,
  suggestedPersonaIds,
  type UserProfile,
  upcomingDeadlines,
} from "../packages/domain/src/paths.ts";

const profile = (patch: Partial<UserProfile>): UserProfile => ({ ...EMPTY_PROFILE, ...patch });
/** A moment on the given Tehran calendar day (midday, +03:30). */
const tehran = (day: string) => new Date(`${day}T12:00:00+03:30`);

test("path definitions have unique ids, questions and starters", () => {
  const ids = (list: { id: string }[]) => new Set(list.map((item) => item.id)).size === list.length;
  assert.ok(ids([...PATHS]));
  assert.ok(ids(PATHS.flatMap((path) => path.questions)));
  assert.ok(ids(PATHS.flatMap((path) => path.starters)));
  for (const path of PATHS)
    for (const question of path.questions) assert.ok(question.id.startsWith(`${path.id}.`));
});

test("sanitizeProfile keeps known paths, at most three, and known answers of any path", () => {
  const clean = sanitizeProfile({
    paths: ["finance", "bogus", "finance", "legal", "office", "developer"] as never,
    details: {
      "finance.scope": ["personal", "business"],
      "finance.vat": ["maybe"],
      "legal.topics": ["lease", "family", "lease", "x"],
      "developer.stack": ["python"],
      "unknown.question": ["a"],
    },
  });
  assert.deepEqual(clean.paths, ["finance", "legal", "office"]);
  assert.equal(clean.paths.length, PATH_MAX);
  assert.deepEqual(clean.details, {
    // Single-choice questions keep one answer; multi-choice keep all known, deduplicated.
    // Answers of a path that is off (developer) are kept for when it is switched on again.
    "finance.scope": ["personal"],
    "legal.topics": ["lease", "family"],
    "developer.stack": ["python"],
  });
  assert.equal(clean.reminders, true);
  assert.equal(clean.inviteDismissed, false);
  assert.equal(clean.chosenAt, null);
  assert.ok(!("updatedAt" in clean));
  assert.deepEqual(sanitizeProfile(null), EMPTY_PROFILE);
  assert.deepEqual(sanitizeProfile({ reminders: false, chosenAt: 5 as never }), {
    ...EMPTY_PROFILE,
    reminders: false,
  });
});

test("pathStarters takes one starter per path in turn", () => {
  const two = profile({ paths: ["finance", "business"] });
  assert.deepEqual(
    pathStarters(two).map((s) => s.id),
    ["finance-spending", "business-caption"],
  );
  assert.deepEqual(
    pathStarters(two, 3).map((s) => s.id),
    ["finance-spending", "business-caption", "finance-vat"],
  );
  assert.equal(pathStarters(profile({ paths: ["konkur"] }), 5).length, 2);
  assert.deepEqual(pathStarters(EMPTY_PROFILE), []);
});

test("pathShortcuts deduplicates labels and assistants", () => {
  const two = profile({ paths: ["finance", "business"] });
  // Both paths offer «پیش‌فاکتور»; only the first one stays.
  assert.deepEqual(
    pathShortcuts(two, 10).map((s) => s.id),
    [
      "finance-spending",
      "business-plan",
      "finance-invoice",
      "finance-accountant",
      "business-marketer",
    ],
  );
  assert.equal(pathShortcuts(two, 10).filter((s) => s.label === "پیش‌فاکتور").length, 1);
  assert.equal(pathShortcuts(two).length, 4);
  assert.deepEqual(suggestedPersonaIds(two), ["accountant", "marketer"]);
});

test("matchPathTopic picks the selected path with the most keyword hits", () => {
  const both = profile({ paths: ["finance", "legal"] });
  assert.equal(matchPathTopic(both, "برای قرارداد اجاره شکایت کنم؟")?.id, "legal");
  assert.equal(matchPathTopic(both, "ارزش افزوده و مالیات این فاکتور")?.id, "finance");
  assert.equal(matchPathTopic(both, "دستور پخت قورمه‌سبزی"), undefined);
  // Unselected paths and paths without a ready-made assistant never match.
  assert.equal(matchPathTopic(profile({ paths: ["developer"] }), "مالیات"), undefined);
  assert.equal(matchPathTopic(profile({ paths: ["office"] }), "نامه اداری و بخشنامه"), undefined);
});

test("pathPrompt lists hints and Persian answers; empty without paths", () => {
  const prompt = pathPrompt(
    profile({ paths: ["finance", "developer"], details: { "finance.scope": ["business"] } }),
  );
  assert.match(prompt, /USER'S WORK FOCUS/);
  assert.ok(prompt.includes(PATHS[0].hint));
  assert.ok(prompt.includes("«امور مالی و حسابداری»"));
  assert.ok(prompt.includes("بیشتر برای کدام؟ کسب‌وکار"));
  assert.ok(prompt.includes("«برنامه‌نویسی و فنی»"));
  assert.equal(pathPrompt(EMPTY_PROFILE), "");
});

test("pathDefaultLength follows the first path that has one", () => {
  assert.equal(pathDefaultLength(profile({ paths: ["finance", "konkur", "developer"] })), "short");
  assert.equal(pathDefaultLength(profile({ paths: ["developer", "konkur"] })), "long");
  assert.equal(pathDefaultLength(profile({ paths: ["finance"] })), undefined);
  assert.equal(pathDefaultLength(EMPTY_PROFILE), undefined);
});

test("upcomingDeadlines finds the VAT, income-tax and payroll deadlines", () => {
  const vat = profile({ paths: ["finance"], details: { "finance.vat": ["yes"] } });
  // 6 Aban 1405: the summer VAT return is due 15 Aban 1405.
  const [summer, ...rest] = upcomingDeadlines(vat, tehran("2026-10-28"));
  assert.equal(rest.length, 0);
  assert.equal(summer.id, "vat-8-2026-11-06");
  assert.equal(summer.date, "2026-11-06");
  assert.equal(summer.daysLeft, 9);
  assert.equal(summer.pathId, "finance");
  assert.match(summer.title, /تابستان/);
  // The deadline day itself is included; the day after is not.
  assert.equal(upcomingDeadlines(vat, tehran("2026-11-06"))[0]?.daysLeft, 0);
  assert.deepEqual(upcomingDeadlines(vat, tehran("2026-11-07")), []);
  // Outside the window nothing shows; a larger window finds it.
  assert.deepEqual(upcomingDeadlines(vat, tehran("2026-10-10")), []);
  assert.equal(upcomingDeadlines(vat, tehran("2026-10-10"), 30)[0]?.date, "2026-11-06");
  // Reminders off, «نیستم» or path not selected: nothing.
  assert.deepEqual(upcomingDeadlines({ ...vat, reminders: false }, tehran("2026-10-28")), []);
  assert.deepEqual(
    upcomingDeadlines({ ...vat, details: { "finance.vat": ["no"] } }, tehran("2026-10-28")),
    [],
  );
  assert.deepEqual(upcomingDeadlines({ ...vat, paths: ["business"] }, tehran("2026-10-28")), []);
  // A skipped VAT question counts as «نمی‌دانم», so the reminder still shows.
  assert.equal(
    upcomingDeadlines({ ...vat, details: {} }, tehran("2026-10-28"))[0]?.date,
    "2026-11-06",
  );

  // Businesses file the income-tax return by the end of Khordad (31 Khordad 1405).
  const business = profile({ paths: ["finance"], details: { "finance.scope": ["business"] } });
  assert.deepEqual(
    upcomingDeadlines(business, tehran("2026-06-15")).map(({ id, daysLeft }) => ({ id, daysLeft })),
    [{ id: "income-tax-2026-06-21", daysLeft: 6 }],
  );
  assert.deepEqual(
    upcomingDeadlines(
      { ...business, details: { "finance.scope": ["personal"] } },
      tehran("2026-06-15"),
    ),
    [],
  );

  // Employers get the payroll list every month on its last day (30 Mehr 1405).
  const employer = profile({ paths: ["finance"], details: { "finance.employees": ["yes"] } });
  assert.deepEqual(
    upcomingDeadlines(employer, tehran("2026-10-18")).map(({ id, daysLeft }) => ({
      id,
      daysLeft,
    })),
    [{ id: "insurance-list-2026-10-22", daysLeft: 4 }],
  );
  // Esfand 1405 (29 days) rolls into the next Jalali year's months.
  assert.equal(upcomingDeadlines(employer, tehran("2027-03-15"))[0]?.date, "2027-03-20");
});

test("answerSummary reads the chosen answers as phrases that stand alone", () => {
  const details = {
    "finance.scope": ["business"],
    "finance.vat": ["yes"],
    "finance.employees": ["no"],
    "legal.topics": ["lease"],
  };
  assert.deepEqual(answerSummary({ details }, "finance"), [
    "کسب‌وکار",
    "مشمول ارزش افزوده",
    "بدون کارمند بیمه‌شده",
  ]);
  assert.deepEqual(answerSummary({ details }, "legal"), ["اجاره و ملک"]);
  assert.deepEqual(answerSummary({ details: {} }, "finance"), []);
});
