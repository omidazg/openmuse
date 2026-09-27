import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { findMatch, normalizeSearch, snippetAround } from "../packages/domain/src/search.ts";

const ZWNJ = String.fromCharCode(0x200c),
  FATHATAN = String.fromCharCode(0x064b);

test("normalization folds Arabic letters, digits, ZWNJ and diacritics", () => {
  assert.equal(normalizeSearch(`مي${ZWNJ}شود`), normalizeSearch("میشود"));
  assert.equal(normalizeSearch(`${ZWNJ}${FATHATAN} `), "");
  assert.equal(normalizeSearch("كتاب"), normalizeSearch("کتاب"));
  assert.equal(normalizeSearch("۱۴۰۳"), "1403");
  assert.equal(normalizeSearch("٢٥"), "25");
  assert.equal(normalizeSearch("مُحَمَّد"), normalizeSearch("محمد"));
  assert.equal(normalizeSearch("  Hello\n\t World "), "hello world");
});

test("matches map back to the original text for highlighting", () => {
  const text = "لطفاً بلیت قطار مشهد را برای ۱۴۰۳/۰۵/۱۰ رزرو کن";
  const match = findMatch(text, "بليت");
  assert.ok(match);
  assert.equal(text.slice(match.start, match.end), "بلیت");
  const date = findMatch(text, "1403/05");
  assert.ok(date);
  assert.equal(text.slice(date.start, date.end), "۱۴۰۳/۰۵");
  const zwnj = findMatch("پیام‌های تازه", "پیامهای");
  assert.ok(zwnj);
  assert.equal("پیام‌های تازه".slice(zwnj.start, zwnj.end), "پیام‌های");
  assert.equal(findMatch(text, "تهران"), null);
  assert.equal(findMatch(text, "   "), null);

  const long = `${"الف ".repeat(40)}قطار ${"ب ".repeat(40)}`;
  const snippet = snippetAround(long, findMatch(long, "قطار") as { start: number; end: number });
  assert.ok(snippet.text.startsWith("…") && snippet.text.endsWith("…"));
  assert.equal(snippet.text.slice(snippet.start, snippet.end), "قطار");
});

// Live workspace with THREADS_BACKEND=local.
const accessKey = "a-private-test-key-with-enough-characters";
let db: Store, directory: string, token: string;
let created: Awaited<ReturnType<typeof createApp>>;
const request = (path: string, init: RequestInit = {}) =>
  created.app.request(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
const json = async (path: string, init?: RequestInit) => (await request(path, init)).json();
const save = (id: string, messages: { id: string; role: string; content: string }[]) =>
  request(`/api/threads/${id}/messages`, { method: "PUT", body: JSON.stringify({ messages }) });

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "openmuse-thread-search-"));
  db = await createStore({ dataDir: join(directory, "postgres") });
  const config: Config = {
    mode: "live",
    port: 8787,
    host: "0.0.0.0",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "model",
    model: "openai/dummy-model",
    accessKey,
    encryptionKey: randomBytes(32).toString("base64"),
    threadsBackend: "local",
    taskWorkerEnabled: false,
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: ["http://localhost:8081"],
  };
  created = await createApp(db, config);
  const session = await created.app.request("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessKey }),
  });
  token = (await session.json()).token;
});
after(async () => {
  await created.agent.stop();
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

test("search covers names and message text, Persian-aware and owner-scoped", async () => {
  await save("trip", [
    { id: "t1", role: "user", content: "برای سفر مشهد بلیت قطار می‌خواهم" },
    { id: "t2", role: "assistant", content: "بلیت قطار ۱۴۰۳/۰۵/۱۰ پیدا شد" },
  ]);
  await save("bills", [{ id: "b1", role: "user", content: "قبض برق این ماه" }]);
  await request("/api/threads/bills", { method: "PATCH", body: JSON.stringify({ name: "قبض‌ها" }) });
  await db.put("other-user", "threads", {
    id: "secret",
    name: "بلیت محرمانه",
    archived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await db.put("other-user", "thread-messages", {
    id: "secret",
    messages: [{ id: "x", role: "user", content: "بلیت قطار دیگری" }],
  });

  const byMessage = await json(`/api/threads/search?q=${encodeURIComponent("بليت قطار")}`);
  assert.deepEqual(
    byMessage.results.map((r: { thread: { id: string } }) => r.thread.id),
    ["trip"],
  );
  const hit = byMessage.results[0];
  assert.equal(hit.snippet.role, "user");
  assert.equal(hit.snippet.text.slice(hit.snippet.start, hit.snippet.end), "بلیت قطار");

  const byDigits = await json("/api/threads/search?q=1403");
  assert.equal(byDigits.results[0].thread.id, "trip");
  assert.equal(byDigits.results[0].snippet.role, "assistant");

  const byName = await json(`/api/threads/search?q=${encodeURIComponent("قبضها")}`);
  assert.equal(byName.results[0].thread.id, "bills");
  // The highlight spans the ZWNJ in «قبض‌ها».
  assert.deepEqual(byName.results[0].nameMatch, { start: 0, end: 6 });

  assert.deepEqual((await json("/api/threads/search?q=%20")).results, []);
  const other = await json(`/api/threads/search?q=${encodeURIComponent("محرمانه")}`);
  assert.deepEqual(other.results, []);
  assert.equal((await created.app.request("/api/threads/search?q=x")).status, 401);
});

test("pins sort first, survive new messages, and labels filter per owner", async () => {
  await save("a-old", [{ id: "a", role: "user", content: "قدیمی" }]);
  await save("b-new", [{ id: "b", role: "user", content: "تازه" }]);
  const pinned = await json("/api/threads/a-old", {
    method: "PATCH",
    body: JSON.stringify({ pinned: true }),
  });
  assert.equal(pinned.pinned, true);
  let listed = await json("/api/threads");
  assert.equal(listed.threads[0].id, "a-old");

  const work = await request("/api/threads/labels", {
    method: "POST",
    body: JSON.stringify({ name: "كار" }),
  });
  assert.equal(work.status, 201);
  const label = await work.json();
  // Same name after normalization returns the existing label.
  const again = await json("/api/threads/labels", {
    method: "POST",
    body: JSON.stringify({ name: "کار" }),
  });
  assert.equal(again.id, label.id);
  assert.equal(
    (await request("/api/threads/labels", { method: "POST", body: JSON.stringify({ name: " " }) }))
      .status,
    422,
  );

  await request("/api/threads/a-old", {
    method: "PATCH",
    body: JSON.stringify({ labels: [label.id, label.id] }),
  });
  // Saving messages keeps pins and labels.
  await save("a-old", [{ id: "a", role: "user", content: "قدیمی، با پیام تازه" }]);
  listed = await json(`/api/threads?label=${label.id}`);
  assert.deepEqual(
    listed.threads.map((t: { id: string }) => t.id),
    ["a-old"],
  );
  assert.equal(listed.threads[0].pinned, true);
  assert.deepEqual(listed.threads[0].labels, [label.id]);

  // Another owner's labels are invisible and cannot be assigned.
  await db.put("other-user", "thread-labels", {
    id: "foreign",
    name: "خانواده",
    createdAt: new Date().toISOString(),
  });
  const labels = await json("/api/threads/labels");
  assert.deepEqual(
    labels.labels.map((l: { id: string }) => l.id),
    [label.id],
  );
  const foreign = await request("/api/threads/b-new", {
    method: "PATCH",
    body: JSON.stringify({ labels: ["foreign"] }),
  });
  assert.equal(foreign.status, 422);
  assert.equal((await request("/api/threads/labels/foreign", { method: "DELETE" })).status, 404);
  assert.ok(await db.get("other-user", "thread-labels", "foreign"));
  assert.equal(
    (await request("/api/threads/secret", { method: "PATCH", body: '{"pinned":true}' })).status,
    404,
  );

  // Deleting a label removes it from threads.
  assert.equal(
    (await request(`/api/threads/labels/${label.id}`, { method: "DELETE" })).status,
    200,
  );
  listed = await json("/api/threads");
  assert.deepEqual(listed.threads.find((t: { id: string }) => t.id === "a-old").labels, []);
  assert.deepEqual((await json(`/api/threads?label=${label.id}`)).threads, []);
});
