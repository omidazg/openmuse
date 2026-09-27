import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { z } from "zod";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import {
  adminDeadlines,
  claimSweepSlot,
  listOverrides,
  type Notify,
  putOverride,
  removeOverride,
  sweepDeadlineReminders,
  userDeadlines,
} from "../apps/server/src/deadlines.ts";
import { AppError } from "../apps/server/src/errors.ts";
import { saveProfile } from "../apps/server/src/profile.ts";
import { jalaliToGregorian } from "../packages/domain/src/iran-holidays.ts";
import {
  EMPTY_PROFILE,
  type UpcomingDeadline,
  type UserProfile,
  upcomingDeadlines,
} from "../packages/domain/src/paths.ts";

// Legal day of the summer VAT return: 15 Aban 1405 = 2026-11-06.
const LEGAL = jalaliToGregorian(1405, 8, 15);
const VAT = `vat-8-${LEGAL}`;
const addDays = (date: string, days: number) =>
  new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);
/** Noon in Tehran (08:30 UTC) of a Gregorian day. */
const at = (date: string) => new Date(`${date}T08:30:00Z`);
const NOW = at(addDays(LEGAL, -20));
const VAT_PROFILE: UserProfile = {
  ...EMPTY_PROFILE,
  paths: ["finance"],
  details: { "finance.vat": ["yes"] },
};

type Row = { id: string; title: string; body: string; createdAt: string };
/** Same contract as AgentService.notify: one record per key. */
const recorder = (db: Store): Notify => {
  return (owner, title, body, _taskId, key) =>
    db.insertIfAbsent<Row>(owner, "notifications", {
      id: key ?? String(Math.random()),
      title,
      body,
      createdAt: new Date().toISOString(),
    });
};
const notifications = (db: Store, owner: string) => db.list<Row>(owner, "notifications");

async function rejects(promise: Promise<unknown>, pattern: RegExp) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof z.ZodError, String(error));
    assert.match(error.issues.map((issue) => issue.message).join("; "), pattern);
    return true;
  });
}

test("deadline overrides are validated and stored under the system owner", async (t) => {
  const db = await createStore();
  t.after(() => db.close());

  await rejects(putOverride(db, { id: "vat-8-2020-01-01", date: "2026-11-21" }, NOW), /شناخته‌شده/);
  await rejects(putOverride(db, { id: VAT, date: "1405/08/30" }, NOW), /نامعتبر/);
  await rejects(putOverride(db, { id: VAT, date: "2026-02-30" }, NOW), /نامعتبر/);
  await rejects(putOverride(db, { id: VAT, date: LEGAL }, NOW), /بعد از مهلت قانونی/);
  await rejects(putOverride(db, { id: VAT, date: addDays(LEGAL, -1) }, NOW), /بعد از مهلت/);
  await rejects(putOverride(db, { id: VAT, date: addDays(LEGAL, 400) }, NOW), /یک سال/);
  await rejects(
    putOverride(db, { id: VAT, date: addDays(LEGAL, 15), note: "ی".repeat(121) }, NOW),
    /۱۲۰/,
  );
  assert.deepEqual(await listOverrides(db), []);

  const saved = await putOverride(
    db,
    { id: VAT, date: addDays(LEGAL, 15), note: "  طبق اطلاعیهٔ سازمان امور مالیاتی  " },
    NOW,
  );
  assert.deepEqual(saved, {
    id: VAT,
    date: "2026-11-21",
    note: "طبق اطلاعیهٔ سازمان امور مالیاتی",
    updatedAt: NOW.toISOString(),
  });
  assert.ok(await db.get("system", "deadline-overrides", VAT));
  // An empty note is dropped; saving again replaces the earlier extension.
  await putOverride(db, { id: VAT, date: addDays(LEGAL, 10), note: " " }, NOW);
  assert.deepEqual(await listOverrides(db), [
    { id: VAT, date: addDays(LEGAL, 10), updatedAt: NOW.toISOString() },
  ]);

  // The admin list covers every rule for ~12 months and shows the extension.
  const { today, occurrences } = await adminDeadlines(db, NOW);
  assert.equal(today, addDays(LEGAL, -20));
  const vat = occurrences.find((item) => item.id === VAT);
  assert.equal(vat?.legalDate, LEGAL);
  assert.equal(vat?.date, addDays(LEGAL, 10));
  assert.equal(vat?.override?.date, addDays(LEGAL, 10));
  for (const rule of ["vat-5", "vat-8", "vat-11", "vat-2", "income-tax", "insurance-list"])
    assert.ok(
      occurrences.some((item) => item.ruleId === rule),
      rule,
    );
  assert.equal(occurrences.filter((item) => item.ruleId === "insurance-list").length, 12);
  assert.ok(occurrences.every((item) => item.date >= today));

  await removeOverride(db, VAT);
  assert.deepEqual(await listOverrides(db), []);
  await assert.rejects(
    removeOverride(db, VAT),
    (error) => error instanceof AppError && error.status === 404,
  );
});

test("an override moves the due day but keeps the occurrence id", () => {
  const now = at(addDays(LEGAL, -2));
  const [plain] = upcomingDeadlines(VAT_PROFILE, now);
  assert.equal(plain.id, VAT);
  assert.equal(plain.date, LEGAL);
  assert.equal(plain.extended, undefined);
  assert.equal(plain.daysLeft, 2);

  const moved = upcomingDeadlines(VAT_PROFILE, now, 30, [
    { id: VAT, date: addDays(LEGAL, 15), note: "طبق اطلاعیه" },
  ]).find((item) => item.id === VAT) as UpcomingDeadline;
  assert.equal(moved.date, addDays(LEGAL, 15));
  assert.equal(moved.legalDate, LEGAL);
  assert.deepEqual(moved.extended, { note: "طبق اطلاعیه" });
  assert.equal(moved.daysLeft, 17);
  // Out of the 10-day window once extended past it.
  assert.equal(
    upcomingDeadlines(VAT_PROFILE, now, 10, [{ id: VAT, date: addDays(LEGAL, 15) }]).length,
    0,
  );
  // After the legal day the extended occurrence is still upcoming.
  const later = upcomingDeadlines(VAT_PROFILE, at(addDays(LEGAL, 3)), 30, [
    { id: VAT, date: addDays(LEGAL, 15) },
  ]);
  assert.deepEqual(
    later.map((item) => [item.id, item.daysLeft, item.extended]),
    [[VAT, 12, {}]],
  );
});

test("the reminder sweep notifies once per occurrence and again after an extension", async (t) => {
  const db = await createStore();
  t.after(() => db.close());
  const notify = recorder(db);
  await saveProfile(db, "reza", {
    paths: ["finance"],
    details: { "finance.vat": ["yes"] },
    reminders: true,
  });
  // Unanswered VAT question counts as «نمی‌دانم», so this one is reminded too.
  await saveProfile(db, "sara", { paths: ["finance"] });
  await saveProfile(db, "off", { paths: ["finance"], reminders: false });
  await saveProfile(db, "no-vat", { paths: ["finance"], details: { "finance.vat": ["no"] } });
  await saveProfile(db, "student", { paths: ["university"] });
  await saveProfile(db, "skipped", { paths: [] });

  // Four days ahead: too early.
  assert.equal(await sweepDeadlineReminders(db, notify, at(addDays(LEGAL, -4))), 0);
  assert.deepEqual(await notifications(db, "reza"), []);

  // Three days ahead: one reminder per person with the VAT deadline.
  assert.equal(await sweepDeadlineReminders(db, notify, at(addDays(LEGAL, -3))), 2);
  const [first] = await notifications(db, "reza");
  assert.equal(first.id, `deadline:${VAT}:${LEGAL}`);
  assert.equal(first.title, "مهلت قانونی اظهارنامهٔ ارزش افزودهٔ تابستان");
  assert.equal(
    first.body,
    "مهلت ۳ روز دیگر، ۱۵ آبان ۱۴۰۵، تمام می‌شود. از صفحهٔ گفت‌وگوی دستیار می‌توانید فهرست کارها را آماده کنید.",
  );
  assert.equal((await notifications(db, "sara")).length, 1);
  for (const owner of ["off", "no-vat", "student", "skipped"])
    assert.deepEqual(await notifications(db, owner), [], owner);

  // Later sweeps (same hour, next days) do not repeat it.
  await sweepDeadlineReminders(db, notify, at(addDays(LEGAL, -3)));
  await sweepDeadlineReminders(db, notify, at(addDays(LEGAL, -1)));
  await sweepDeadlineReminders(db, notify, at(LEGAL));
  assert.equal((await notifications(db, "reza")).length, 1);

  // An extension announced on the legal day: nothing until three days before the new day.
  await putOverride(
    db,
    { id: VAT, date: addDays(LEGAL, 15), note: "طبق اطلاعیهٔ سازمان امور مالیاتی" },
    at(LEGAL),
  );
  await sweepDeadlineReminders(db, notify, at(addDays(LEGAL, 1)));
  assert.equal((await notifications(db, "reza")).length, 1);
  await sweepDeadlineReminders(db, notify, at(addDays(LEGAL, 14)));
  await sweepDeadlineReminders(db, notify, at(addDays(LEGAL, 15)));
  const rows = await notifications(db, "reza");
  assert.equal(rows.length, 2);
  const extended = rows.find((row) => row.id === `deadline:${VAT}:${addDays(LEGAL, 15)}`);
  assert.equal(
    extended?.body,
    "مهلت تمدید شد و فردا، ۳۰ آبان ۱۴۰۵، تمام می‌شود. طبق اطلاعیهٔ سازمان امور مالیاتی. از صفحهٔ گفت‌وگوی دستیار می‌توانید فهرست کارها را آماده کنید.",
  );

  // Turning reminders off stops new ones.
  await saveProfile(db, "reza", { reminders: false });
  await removeOverride(db, VAT);
  await putOverride(db, { id: VAT, date: addDays(LEGAL, 20) }, at(LEGAL));
  await sweepDeadlineReminders(db, notify, at(addDays(LEGAL, 20)));
  assert.equal((await notifications(db, "reza")).length, 2);
  // «امروز» for the last day.
  const sara = await notifications(db, "sara");
  assert.ok(sara.some((row) => row.body.startsWith("مهلت تمدید شد و امروز، ")));
});

test("only one process claims each hourly sweep slot", async (t) => {
  const db = await createStore();
  t.after(() => db.close());
  assert.equal(await claimSweepSlot(db, "2026-11-03T08"), true);
  assert.equal(await claimSweepSlot(db, "2026-11-03T08"), false);
  assert.equal(await claimSweepSlot(db, "2026-11-03T07"), false);
  const [a, b] = await Promise.all([
    claimSweepSlot(db, "2026-11-03T09"),
    claimSweepSlot(db, "2026-11-03T09"),
  ]);
  assert.equal(Number(a) + Number(b), 1);
});

test("deadline APIs: admin-only overrides and the signed-in person's deadlines", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-deadlines-"));
  const db = await createStore();
  const config: Config = {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "sample",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: ["http://localhost:8081"],
  };
  const server = await createApp(db, config);
  t.after(async () => {
    await server.agent.stop();
    await db.close();
    await rm(directory, { recursive: true, force: true });
  });
  const admin = await server.auth.session();
  const user = await server.auth.issue("second-owner");
  const call = (path: string, bearer: string, method = "GET", body?: unknown) =>
    server.app.request(path, {
      method,
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  assert.equal((await call("/api/admin/deadlines", user.token)).status, 403);
  const listed = await call("/api/admin/deadlines", admin.token);
  assert.equal(listed.status, 200);
  const { occurrences } = (await listed.json()) as { occurrences: { id: string }[] };
  assert.ok(occurrences.length > 12);

  // Extend the nearest insurance-list occurrence (the end of the current Jalali month).
  const target = occurrences.find((item) => item.id.startsWith("insurance-list-")) as {
    id: string;
    legalDate: string;
  };
  const path = `/api/admin/deadlines/${target.id}`;
  assert.equal(
    (await call(path, user.token, "PUT", { date: addDays(target.legalDate, 5) })).status,
    403,
  );
  const invalid = await call(path, admin.token, "PUT", { date: target.legalDate });
  assert.equal(invalid.status, 422);
  assert.match((await invalid.json()).error, /بعد از مهلت قانونی/);
  const saved = await call(path, admin.token, "PUT", {
    date: addDays(target.legalDate, 5),
    note: "طبق اطلاعیه",
  });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).date, addDays(target.legalDate, 5));

  // The signed-in person sees it once their profile asks for insurance deadlines.
  await saveProfile(db, "second-owner", {
    paths: ["finance"],
    details: { "finance.employees": ["yes"], "finance.vat": ["no"] },
  });
  const mine = await call("/api/agent/deadlines", user.token);
  assert.equal(mine.status, 200);
  const deadlines = (await mine.json()) as UpcomingDeadline[];
  const expected = await userDeadlines(db, "second-owner");
  assert.deepEqual(deadlines, expected);
  const extended = deadlines.find((item) => item.id === target.id);
  if (extended) {
    assert.equal(extended.date, addDays(target.legalDate, 5));
    assert.deepEqual(extended.extended, { note: "طبق اطلاعیه" });
  }

  assert.equal((await call(path, admin.token, "DELETE")).status, 200);
  assert.equal((await call(path, admin.token, "DELETE")).status, 404);
  assert.equal((await call("/api/agent/deadlines", admin.token)).status, 200);
});
