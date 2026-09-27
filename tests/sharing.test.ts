import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import { type Config, parseUserKeys } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { findShare, type Share } from "../apps/server/src/sharing.ts";
import { withStaticWeb } from "../apps/server/src/static.ts";
import { BRAND } from "../packages/domain/src/brand.ts";
import { extractDocumentText, readZip } from "../packages/integrations/src/office.ts";

// Live workspace, THREADS_BACKEND=local, two users (admin key + ali), a configured PDF worker.
const adminKey = "admin-key-aaaaaaaaaaaaaaaaaaaaaaaa";
const aliKey = "ali-key-bbbbbbbbbbbbbbbbbbbbbbbbbbbb";
let db: Store, directory: string, created: Awaited<ReturnType<typeof createApp>>;
let admin: string, ali: string;
const THREAD = "5d8f2a8e-1c3b-4f7a-9a3e-2b6c1d0e9f11";

async function login(accessKey: string) {
  const response = await created.app.request("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessKey }),
  });
  assert.equal(response.status, 200);
  return (await response.json()).token as string;
}
const call = (token: string, path: string, method = "GET", body?: unknown) =>
  created.app.request(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "openmuse-sharing-"));
  db = await createStore({ dataDir: join(directory, "postgres") });
  const config: Config = {
    mode: "live",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "model",
    model: "openai/dummy-model",
    accessKey: adminKey,
    userKeys: parseUserKeys(`ali:${aliKey}`),
    encryptionKey: randomBytes(32).toString("base64"),
    threadsBackend: "local",
    taskWorkerEnabled: false,
    workerUrl: "http://127.0.0.1:1",
    workerToken: "test-worker-token-at-least-32-characters",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: ["http://localhost:8081"],
  };
  created = await createApp(db, config);
  admin = await login(adminKey);
  ali = await login(aliKey);
  const saved = await call(admin, `/api/threads/${THREAD}/messages`, "PUT", {
    messages: [
      { id: "u1", role: "user", content: "برنامهٔ سفر مشهد را بنویس" },
      {
        id: "a1",
        role: "assistant",
        content:
          "## برنامهٔ سفر\n- روز **اول**: زیارت\n- روز دوم: بازار رضا\n\nنشانی: https://example.ir",
      },
      { id: "t1", role: "assistant", content: "", toolCalls: [] },
      { id: "u2", role: "user", content: "<script>alert(1)</script> هزینه‌ها؟" },
      {
        id: "a2",
        role: "assistant",
        content: "| مورد | هزینه |\n|---|---|\n| بلیت | ۳٬۰۰۰٬۰۰۰ تومان |",
      },
    ],
  });
  assert.equal(saved.status, 200);
});
after(async () => {
  await created.agent.stop();
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

test("Word export is a real RTL .docx with title, Jalali date and role labels", async () => {
  const response = await call(admin, `/api/threads/${THREAD}/export?format=docx`);
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-type"),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  assert.match(response.headers.get("content-disposition") ?? "", /^attachment; .*\.docx/);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(Buffer.from(bytes.subarray(0, 2)).toString(), "PK");
  const text = extractDocumentText("docx", bytes).text;
  for (const expected of [
    "برنامهٔ سفر مشهد را بنویس",
    "شما",
    BRAND.nameFa,
    "برنامهٔ سفر",
    "زیارت",
    "بلیت",
    "۳٬۰۰۰٬۰۰۰ تومان",
  ])
    assert(text.includes(expected), `docx contains ${expected}`);
  assert.match(
    text,
    /[۰-۹]+ (فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند) [۰-۹]{4}/,
  );
  const zip = readZip(bytes);
  const documentXml = new TextDecoder().decode(zip.read("word/document.xml"));
  const styles = new TextDecoder().decode(zip.read("word/styles.xml"));
  assert(documentXml.includes("<w:bidi/>"), "paragraphs are bidi");
  assert(documentXml.includes("<w:rtl/>"), "Persian runs are RTL");
  assert(documentXml.includes("<w:bidiVisual/>"), "tables are RTL");
  assert(!documentXml.includes("<script>"), "text is XML-escaped");
  assert(styles.includes('w:cs="Vazirmatn"'), "Vazirmatn is the complex-script font");
  // The URL stays a separate LTR run.
  assert.match(documentXml, /<w:r><w:t xml:space="preserve">https:\/\/example\.ir<\/w:t><\/w:r>/);
});

test("PDF export renders the conversation through the Persian PDF worker", async (t) => {
  let sent: { html: string; title: string; direction: string } | undefined;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    sent = JSON.parse(String(init.body));
    return new Response("%PDF-1.7\n%fake\n", { headers: { "Content-Type": "application/pdf" } });
  });
  const response = await call(admin, `/api/threads/${THREAD}/export?format=pdf`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert(sent);
  assert.equal(sent.direction, "rtl");
  assert.equal(sent.title, "برنامهٔ سفر مشهد را بنویس");
  assert(sent.html.includes(`<p class="role">شما</p>`));
  assert(sent.html.includes(`<p class="role">${BRAND.nameFa}</p>`));
  assert(sent.html.includes("&lt;script&gt;"), "user text is escaped");
  assert(!sent.html.includes("<script>"));
  // One assistant answer only.
  const single = await call(admin, `/api/threads/${THREAD}/export?format=pdf&messageId=a2`);
  assert.equal(single.status, 200);
  assert(sent.html.includes("بلیت") && !sent.html.includes("زیارت"));
});

test("exports and shares are owner-scoped", async () => {
  assert.equal((await call(ali, `/api/threads/${THREAD}/export?format=docx`)).status, 404);
  assert.equal(
    (await call(ali, "/api/shares", "POST", { threadId: THREAD })).status,
    404,
    "another user cannot share someone else's thread",
  );
  const share = await (await call(admin, "/api/shares", "POST", { threadId: THREAD })).json();
  assert.deepEqual((await (await call(ali, "/api/shares")).json()).shares, []);
  assert.equal((await call(ali, `/api/shares/${share.id}`, "DELETE")).status, 404);
  assert.equal((await created.app.request(share.path)).status, 200, "still live after that");
  assert.equal(
    (await created.app.request(`/api/threads/${THREAD}/export?format=docx`)).status,
    401,
  );
  assert.equal((await created.app.request("/api/shares")).status, 401);
});

test("share links are unguessable 128-bit tokens and render a public Persian page", async () => {
  const first = await call(admin, "/api/shares", "POST", { threadId: THREAD });
  assert.equal(first.status, 201);
  const share = await first.json();
  const second = await (await call(admin, "/api/shares", "POST", { threadId: THREAD })).json();
  const token = share.path.slice(3);
  assert.match(token, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(Buffer.from(token, "base64url").length, 16);
  assert.notEqual(token, second.path.slice(3));
  // The public index is keyed by a hash, never by the token itself.
  const index = await db.list<{ id: string }>("~public", "share-tokens");
  assert(index.length >= 2 && index.every((entry) => !entry.id.includes(token)));

  const page = await created.app.request(share.path);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert(html.includes('<html lang="fa-IR" dir="rtl">'));
  assert(html.includes("Vazirmatn"));
  assert(html.includes("زیارت") && html.includes("بلیت"));
  assert(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;") && !html.includes("<script>"));
  assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  assert.equal(page.headers.get("x-robots-tag"), "noindex, nofollow");
  assert(!/letter-spacing|uppercase/.test(html));

  for (const guess of [
    randomBytes(16).toString("base64url"),
    `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`,
    token.slice(0, 21),
    `${token}x`,
    "../api/me",
  ]) {
    const missing = await created.app.request(`/s/${encodeURIComponent(guess)}`);
    assert.equal(missing.status, 404, guess);
    assert(!(await missing.text()).includes("زیارت"));
  }
});

test("single-answer shares contain only that answer", async () => {
  const response = await call(admin, "/api/shares", "POST", { threadId: THREAD, messageId: "a1" });
  assert.equal(response.status, 201);
  const share = await response.json();
  assert.equal(share.messageCount, 1);
  const html = await (await created.app.request(share.path)).text();
  assert(html.includes("زیارت"));
  assert(!html.includes("برنامهٔ سفر مشهد را بنویس"), "the question is not shared");
  assert.equal(
    (await call(admin, "/api/shares", "POST", { threadId: THREAD, messageId: "u1" })).status,
    404,
    "only assistant answers can be shared alone",
  );
});

test("revoked and expired shares return 404", async () => {
  const share = await (
    await call(admin, "/api/shares", "POST", { threadId: THREAD, expiresInDays: 7 })
  ).json();
  assert(share.expiresAt);
  assert.equal((await created.app.request(share.path)).status, 200);
  const listed = (await (await call(admin, `/api/shares?threadId=${THREAD}`)).json()).shares;
  assert(listed.some((item: { id: string }) => item.id === share.id));
  assert.equal((await call(admin, `/api/shares/${share.id}`, "DELETE")).status, 200);
  const revoked = await created.app.request(share.path);
  assert.equal(revoked.status, 404);
  assert((await revoked.text()).includes("این پیوند در دسترس نیست"));
  assert.equal((await call(admin, `/api/shares/${share.id}`, "DELETE")).status, 404);

  const expiring = await (
    await call(admin, "/api/shares", "POST", { threadId: THREAD, expiresInDays: 1 })
  ).json();
  const token = expiring.path.slice(3);
  assert(await findShare(db, token));
  assert.equal(await findShare(db, token, Date.now() + 2 * 86_400_000), null);
  const owner = (await db.list<{ owner: string; shareId: string }>("~public", "share-tokens")).find(
    (entry) => entry.shareId === expiring.id,
  )?.owner;
  assert(owner);
  const stored = await db.get<Share>(owner, "shares", expiring.id);
  assert(stored);
  await db.put(owner, "shares", {
    ...stored,
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  assert.equal((await created.app.request(expiring.path)).status, 404);
  const after = (await (await call(admin, "/api/shares")).json()).shares;
  assert.equal(after.find((item: { id: string }) => item.id === expiring.id).expired, true);
  assert.equal(
    (await call(admin, "/api/shares", "POST", { threadId: THREAD, expiresInDays: 0 })).status,
    422,
  );
});

test("the static web wrapper passes share pages through to the API", async () => {
  const dist = await mkdtemp(join(tmpdir(), "openmuse-web-"));
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(dist, "index.html"), "<html>app</html>");
  try {
    let seen = "";
    const fetch = withStaticWeb(async (request: Request) => {
      seen = new URL(request.url).pathname;
      return new Response("api");
    }, dist);
    assert.equal(await (await fetch(new Request("http://x/s/abc"))).text(), "api");
    assert.equal(seen, "/s/abc");
    assert.equal(await (await fetch(new Request("http://x/settings"))).text(), "<html>app</html>");
  } finally {
    await rm(dist, { recursive: true, force: true });
  }
});
