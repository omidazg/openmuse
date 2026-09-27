import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";
import { personalContext, personalInstructions } from "../apps/server/src/engine/personal.ts";
import { readProfile } from "../apps/server/src/profile.ts";
import { responseLength } from "../apps/server/src/response-length.ts";
import { EMPTY_PROFILE, PATHS, type UserProfile } from "../packages/domain/src/paths.ts";
import { DEFAULT_PERSONAL_SETTINGS, PERSONAS } from "../packages/domain/src/personal.ts";

test("«مسیرهای من» profile API validates, persists per owner and shapes answers", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-profile-"));
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
  const { token, owner } = await server.auth.session();
  const other = await server.auth.issue("second-owner");
  const call = (path: string, init: RequestInit = {}, bearer = token) =>
    server.app.request(path, {
      ...init,
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    });
  const put = (body: unknown, bearer = token) =>
    call("/api/agent/profile", { method: "PUT", body: JSON.stringify(body) }, bearer);
  const get = async (bearer = token) =>
    (await (await call("/api/agent/profile", {}, bearer)).json()) as UserProfile;
  const length = async () => (await (await call("/api/models")).json()).length;

  assert.equal((await server.app.request("/api/agent/profile")).status, 401);
  assert.equal(
    (await server.app.request("/api/agent/profile", { method: "PUT", body: "{}" })).status,
    401,
  );
  assert.deepEqual(await get(), EMPTY_PROFILE);
  // No saved length and no path: «معمولی».
  assert.equal(await length(), "normal");

  // Choosing paths records the time; unknown questions and options are dropped.
  const before = Date.now();
  const saved = await put({
    paths: ["konkur", "finance"],
    details: {
      "konkur.group": ["math", "science"],
      "finance.vat": ["yes", "bogus"],
      "legal.topics": ["lease"],
      "made.up": ["x"],
    },
  });
  assert.equal(saved.status, 200);
  const profile = (await saved.json()) as UserProfile;
  assert.deepEqual(profile.paths, ["konkur", "finance"]);
  assert.deepEqual(profile.details, {
    "finance.vat": ["yes"],
    "legal.topics": ["lease"],
    "konkur.group": ["math"],
  });
  assert.equal(profile.reminders, true);
  assert.equal(profile.inviteDismissed, false);
  assert.ok(profile.chosenAt && Date.parse(profile.chosenAt) >= before - 1000);
  assert.ok(profile.updatedAt);
  assert.ok(!("id" in profile));
  assert.deepEqual(await get(), profile);

  // Partial updates keep the rest and do not touch chosenAt.
  await new Promise((resolve) => setTimeout(resolve, 5));
  const dismissed = (await (
    await put({ inviteDismissed: true, reminders: false })
  ).json()) as UserProfile;
  assert.equal(dismissed.inviteDismissed, true);
  assert.equal(dismissed.reminders, false);
  assert.equal(dismissed.chosenAt, profile.chosenAt);
  assert.deepEqual(dismissed.paths, profile.paths);
  assert.deepEqual((await get()).inviteDismissed, true);

  // Answer length: the path default applies while nothing is saved (konkur → «کوتاه»).
  assert.equal(await length(), "short");
  assert.equal(await responseLength(db, owner), "short");
  const explicit = await call("/api/models/length", {
    method: "PUT",
    body: JSON.stringify({ length: "long" }),
  });
  assert.equal(explicit.status, 200);
  assert.equal(await length(), "long");
  assert.equal(await responseLength(db, owner), "long");

  // The chat and task prompts carry the path hint and the Persian answers.
  const context = await personalContext(db, owner, { memoryTools: false });
  assert.match(context.prompt, /USER'S WORK FOCUS/);
  assert.ok(context.prompt.includes(PATHS.find((p) => p.id === "konkur")?.hint ?? "missing"));
  assert.ok(context.prompt.includes("گروه آزمایشی شما؟ ریاضی"));
  assert.ok(!(await personalContext(db, other.owner)).prompt.includes("WORK FOCUS"));

  // Validation errors are 422 with Persian messages; nothing is saved.
  const tooMany = await put({ paths: ["finance", "business", "office", "legal"] });
  assert.equal(tooMany.status, 422);
  assert.match((await tooMany.json()).error, /حداکثر سه مسیر قابل انتخاب است\./);
  const unknown = await put({ paths: ["astrology"] });
  assert.equal(unknown.status, 422);
  assert.match((await unknown.json()).error, /مسیر شناخته‌شده نیست/);
  for (const body of [
    { admin: true },
    { chosenAt: "2020-01-01T00:00:00.000Z" },
    { reminders: "yes" },
    { details: { "finance.vat": "yes" } },
    { details: { "finance.vat": ["x".repeat(65)] } },
    { details: { "finance.vat": Array.from({ length: 11 }, (_, i) => `o${i}`) } },
    { details: Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`q${i}`, ["a"]])) },
  ])
    assert.equal((await put(body)).status, 422, JSON.stringify(body).slice(0, 80));
  assert.deepEqual((await get()).paths, ["konkur", "finance"]);

  // «فعلاً رد شود»: an empty list is a choice too; earlier answers stay for later.
  const skipped = (await (await put({ paths: [] })).json()) as UserProfile;
  assert.deepEqual(skipped.paths, []);
  assert.deepEqual(Object.keys(skipped.details).sort(), [
    "finance.vat",
    "konkur.group",
    "legal.topics",
  ]);
  assert.ok(skipped.chosenAt && skipped.chosenAt >= (profile.chosenAt ?? ""));
  assert.equal(skipped.inviteDismissed, true);
  assert.equal((await personalContext(db, owner)).prompt.includes("WORK FOCUS"), false);

  // Each owner has their own profile.
  assert.deepEqual(await get(other.token), EMPTY_PROFILE);
  await put({ paths: ["developer"] }, other.token);
  assert.deepEqual((await get(other.token)).paths, ["developer"]);
  assert.deepEqual((await get()).paths, []);
  assert.deepEqual((await readProfile(db, "nobody")).paths, []);
  // developer → «مفصل» for that owner only, while nothing is saved.
  assert.equal(await responseLength(db, other.owner), "long");
  assert.equal(await responseLength(db, "nobody"), "normal");
});

test("personalInstructions puts the path hint after the persona and before user data", () => {
  const profile: UserProfile = {
    ...EMPTY_PROFILE,
    paths: ["legal"],
    details: { "legal.topics": ["lease", "labor"] },
  };
  const prompt = personalInstructions({
    settings: { memoryEnabled: true, about: "اهل تبریز هستم", responseStyle: "" },
    memories: [],
    persona: PERSONAS.find((p) => p.id === "lawyer"),
    profile,
  });
  const focus = prompt.indexOf("USER'S WORK FOCUS");
  assert.ok(focus > prompt.indexOf("ACTIVE ASSISTANT"));
  assert.ok(focus < prompt.indexOf("LONG-TERM MEMORY"));
  assert.ok(focus < prompt.indexOf("USER-PROVIDED PERSONAL CONTEXT"));
  assert.ok(prompt.includes("اجاره و ملک، کار و بیمه"));

  const without = personalInstructions({
    settings: DEFAULT_PERSONAL_SETTINGS,
    memories: [],
    memoryTools: false,
  });
  assert.equal(without, "");
  assert.equal(
    personalInstructions({
      settings: DEFAULT_PERSONAL_SETTINGS,
      memories: [],
      memoryTools: false,
      profile: EMPTY_PROFILE,
    }),
    "",
  );
  // Path hints alone still produce context for delegated tasks.
  assert.match(
    personalInstructions({
      settings: DEFAULT_PERSONAL_SETTINGS,
      memories: [],
      memoryTools: false,
      profile,
    }),
    /^ USER'S WORK FOCUS/,
  );
});
