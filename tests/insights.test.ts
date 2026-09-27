import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import { SYSTEM_OWNER } from "../apps/server/src/bot/links.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";
import {
  INSIGHTS_KIND,
  type InsightDay,
  type InsightReport,
  insightId,
  insightsReport,
  recordInsight,
} from "../apps/server/src/insights.ts";
import { tehranDay } from "../apps/server/src/usage.ts";
import { DEADLINE_RULES, PATHS } from "../packages/domain/src/paths.ts";

const starter = PATHS[0].starters[0].id;
const shortcut = PATHS[0].shortcuts[0].id;
const rule = DEADLINE_RULES[0].id;

test("insight ids are allowlisted per event; deadline occurrences count as their rule", () => {
  assert.equal(insightId("path_selected", "finance"), "finance");
  assert.equal(insightId("path_selected", "astrology"), undefined);
  assert.equal(insightId("starter_used", starter), starter);
  assert.equal(insightId("starter_used", "finance"), undefined);
  assert.equal(insightId("shortcut_used", shortcut), shortcut);
  assert.equal(insightId("deadline_action", rule), rule);
  assert.equal(insightId("deadline_action", `${rule}-2026-11-06`), rule);
  assert.equal(insightId("deadline_action", "unknown-2026-11-06"), undefined);
  assert.equal(insightId("deadline_action", `${rule}-2026-99-99`), undefined);
  assert.equal(insightId("invite_opened", "paths"), "paths");
  assert.equal(insightId("invite_dismissed", "other"), undefined);
  assert.equal(insightId("persona_suggestion_used", "accountant"), "accountant");
  assert.equal(insightId("persona_suggestion_used", "nobody"), undefined);
});

test("concurrent counts are not lost and old days fall outside the period", async (t) => {
  const db = await createStore();
  t.after(() => db.close());
  const now = Date.parse("2026-09-27T12:00:00Z");
  const results = await Promise.all(
    Array.from({ length: 8 }, () => recordInsight(db, "starter_used", starter, now)),
  );
  assert.ok(results.every(Boolean));
  await recordInsight(db, "starter_used", starter, now - 40 * 86_400_000);
  const day = await db.get<InsightDay>(SYSTEM_OWNER, INSIGHTS_KIND, tehranDay(now));
  assert.equal(day?.counts[`starter_used:${starter}`], 8);
  const report = await insightsReport(db, 30, now);
  assert.deepEqual(report.events.starter_used, [{ id: starter, count: 8 }]);
  assert.equal(report.total, 8);
  assert.equal((await insightsReport(db, 90, now)).total, 9);
});

test("events API counts anonymously and the admin report shows totals and path choice", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-insights-"));
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
  // The sample session is the admin; the others are ordinary people.
  const admin = await server.auth.session();
  const first = await server.auth.issue("insights-first");
  const second = await server.auth.issue("insights-second");
  const call = (path: string, token: string, init: RequestInit = {}) =>
    server.app.request(path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
  const send = (token: string, body: unknown) =>
    call("/api/agent/events", token, { method: "POST", body: JSON.stringify(body) });

  assert.equal(
    (
      await server.app.request("/api/agent/events", {
        method: "POST",
        body: JSON.stringify({ event: "starter_used", id: starter }),
      })
    ).status,
    401,
  );
  for (const body of [
    { event: "page_view", id: "home" },
    { event: "starter_used", id: "not-a-starter" },
    { event: "starter_used", id: "رایگان" },
    { event: "path_selected" },
    "nonsense",
  ]) {
    const response = await send(first.token, body);
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /ثبت نشد/);
  }

  for (const token of [first.token, second.token]) {
    assert.equal((await send(token, { event: "starter_used", id: starter })).status, 200);
    assert.equal((await send(token, { event: "path_selected", id: "finance" })).status, 200);
  }
  assert.equal(
    (await send(first.token, { event: "deadline_action", id: `${rule}-2026-11-06` })).status,
    200,
  );
  assert.equal((await send(first.token, { event: "shortcut_used", id: shortcut })).status, 200);
  // One person cannot inflate one item: the same event and id counts a few times an hour at most.
  const repeats = [];
  for (let i = 0; i < 4; i++)
    repeats.push((await send(second.token, { event: "invite_opened", id: "paths" })).status);
  assert.deepEqual(repeats, [200, 200, 200, 429]);

  const stored = await db.list<InsightDay>(SYSTEM_OWNER, INSIGHTS_KIND);
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0].counts, {
    [`starter_used:${starter}`]: 2,
    "path_selected:finance": 2,
    [`deadline_action:${rule}`]: 1,
    [`shortcut_used:${shortcut}`]: 1,
    "invite_opened:paths": 3,
  });
  const raw = JSON.stringify(stored);
  for (const secret of ["insights-first", "insights-second", "local-user", "2026-11-06"])
    assert.ok(!raw.includes(secret), `stored counters must not include ${secret}`);

  // Current path choice comes from stored profiles: two with paths, one who skipped.
  const profile = (token: string, paths: string[]) =>
    call("/api/agent/profile", token, { method: "PUT", body: JSON.stringify({ paths }) });
  assert.equal((await profile(first.token, ["finance", "legal"])).status, 200);
  assert.equal((await profile(second.token, ["finance"])).status, 200);
  assert.equal((await profile(admin.token, [])).status, 200);

  assert.equal((await call("/api/admin/insights", first.token)).status, 403);
  const response = await call("/api/admin/insights?days=7", admin.token);
  assert.equal(response.status, 200);
  const report = (await response.json()) as InsightReport;
  assert.equal(report.days, 7);
  assert.equal(report.total, 9);
  assert.deepEqual(report.events.starter_used, [{ id: starter, count: 2 }]);
  assert.deepEqual(report.events.deadline_action, [{ id: rule, count: 1 }]);
  assert.deepEqual(report.events.invite_opened, [{ id: "paths", count: 3 }]);
  assert.deepEqual(report.events.path_removed, []);
  assert.equal(report.paths.profiles, 3);
  assert.equal(report.paths.none, 1);
  assert.equal(report.paths.counts.finance, 2);
  assert.equal(report.paths.counts.legal, 1);
  assert.equal(report.paths.counts.konkur, 0);
  assert.equal(
    ((await (await call("/api/admin/insights", admin.token)).json()) as InsightReport).days,
    30,
  );
});
