import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";

// Live workspace with THREADS_BACKEND=local: no CopilotKit Intelligence key and no Google OAuth.
const accessKey = "a-private-test-key-with-enough-characters";
let db: Store, directory: string, token: string, config: Config;
let created: Awaited<ReturnType<typeof createApp>>;
const headers = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
const request = (path: string, init: RequestInit = {}) =>
  created.app.request(path, { ...init, headers: { ...headers(), ...init.headers } });
const message = (id: string, role: "user" | "assistant", content: string) => ({
  id,
  role,
  content,
});

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "openmuse-local-threads-"));
  db = await createStore({ dataDir: join(directory, "postgres") });
  config = {
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
  assert.equal(session.status, 200);
  token = (await session.json()).token;
});
after(async () => {
  await created.agent.stop();
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

test("live workspace reports local threads and Google as unconfigured", async () => {
  const workspace = await (await request("/api/workspace")).json();
  assert.equal(workspace.mode, "live");
  assert.equal(workspace.runtime.richThreads, false);
  assert.equal(workspace.runtime.localThreads, true);
  const google = workspace.connections.find((c: { id: string }) => c.id === "google");
  assert.equal(google.status, "unconfigured");
  assert.equal((await request("/api/health")).status, 200);
  const connect = await request("/api/google/connect", {
    method: "POST",
    body: JSON.stringify({ capability: "read" }),
  });
  assert.equal(connect.status, 503);
});

test("thread routes require the live session", async () => {
  const response = await created.app.request("/api/threads");
  assert.equal(response.status, 401);
});

test("main thread is stable and never contacts CopilotKit Intelligence", async (t) => {
  const calls = t.mock.method(CopilotKitIntelligence.prototype, "getOrCreateThread", async () => {
    throw new Error("Intelligence must not be used with THREADS_BACKEND=local");
  });
  const first = await (await request("/api/main-thread")).json();
  const again = await (await request("/api/main-thread")).json();
  assert.equal(first.threadId, again.threadId);
  assert.equal(first.existing, true);
  assert.equal(calls.mock.callCount(), 0);
  const empty = await (await request(`/api/threads/${first.threadId}/messages`)).json();
  assert.deepEqual(empty.messages, []);
});

test("messages persist per thread, replay after restart, and support rename/archive/restore", async () => {
  const main = (await (await request("/api/main-thread")).json()).threadId as string;
  const side = "side-chat-1";
  const mainMessages = [message("m1", "user", "Plan my week"), message("m2", "assistant", "OK")];
  const sideMessages = [
    message("s1", "user", "Summarise the quarterly budget spreadsheet for me please"),
    {
      id: "s2",
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "call-1",
          type: "function",
          function: { name: "readFile", arguments: '{"taskId":"t-1"}' },
        },
      ],
    },
    { id: "s3", role: "tool", toolCallId: "call-1", content: '{"ok":true}' },
  ];
  for (const [id, messages] of [
    [main, mainMessages],
    [side, sideMessages],
  ] as const) {
    const saved = await request(`/api/threads/${id}/messages`, {
      method: "PUT",
      body: JSON.stringify({ messages }),
    });
    assert.equal(saved.status, 200);
  }
  const invalid = await request(`/api/threads/${side}/messages`, {
    method: "PUT",
    body: JSON.stringify({ messages: [{ id: "x", role: "nobody" }] }),
  });
  assert.equal(invalid.status, 422);
  assert.equal((await request("/api/threads/bad%20id/messages")).status, 422);

  const listed = await (await request("/api/threads?includeArchived=true")).json();
  assert.deepEqual(listed.threads.map((t: { id: string }) => t.id).sort(), [main, side].sort());
  const sideThread = listed.threads.find((t: { id: string }) => t.id === side);
  assert.equal(sideThread.name, "Summarise the quarterly budget spreadsheet for me please");
  assert.equal(sideThread.archived, false);

  const renamed = await request(`/api/threads/${side}`, {
    method: "PATCH",
    body: JSON.stringify({ name: "بودجه" }),
  });
  assert.equal((await renamed.json()).name, "بودجه");
  await request(`/api/threads/${side}`, {
    method: "PATCH",
    body: JSON.stringify({ archived: true }),
  });
  const active = await (await request("/api/threads")).json();
  assert.deepEqual(
    active.threads.map((t: { id: string }) => t.id),
    [main],
  );
  const restored = await (
    await request(`/api/threads/${side}`, {
      method: "PATCH",
      body: JSON.stringify({ archived: false }),
    })
  ).json();
  assert.equal(restored.archived, false);
  assert.equal(restored.name, "بودجه");
  assert.equal(
    (
      await request("/api/threads/missing-thread", {
        method: "PATCH",
        body: JSON.stringify({ name: "x" }),
      })
    ).status,
    404,
  );

  // Pagination
  const firstPage = await (await request("/api/threads?limit=1")).json();
  assert.equal(firstPage.threads.length, 1);
  assert.equal(firstPage.nextCursor, "1");
  const secondPage = await (await request("/api/threads?limit=1&cursor=1")).json();
  assert.equal(secondPage.threads.length, 1);
  assert.equal(secondPage.nextCursor, null);

  // Restart: a new app over a reopened database replays the same history for the same owner.
  await created.agent.stop();
  await db.close();
  db = await createStore({ dataDir: join(directory, "postgres") });
  created = await createApp(db, config);
  const session = await created.app.request("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessKey }),
  });
  token = (await session.json()).token;
  assert.equal((await (await request("/api/main-thread")).json()).threadId, main);
  assert.deepEqual(
    (await (await request(`/api/threads/${main}/messages`)).json()).messages,
    mainMessages,
  );
  assert.deepEqual(
    (await (await request(`/api/threads/${side}/messages`)).json()).messages,
    sideMessages,
  );
});

test("threads are scoped to the owner", async () => {
  await db.put("other-user", "threads", {
    id: "private",
    name: "Private",
    archived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await db.put("other-user", "thread-messages", {
    id: "private",
    messages: [message("p1", "user", "secret")],
  });
  const listed = await (await request("/api/threads?includeArchived=true")).json();
  assert.ok(!listed.threads.some((t: { id: string }) => t.id === "private"));
  assert.deepEqual((await (await request("/api/threads/private/messages")).json()).messages, []);
  assert.equal(
    (
      await request("/api/threads/private", {
        method: "PATCH",
        body: JSON.stringify({ archived: true }),
      })
    ).status,
    404,
  );
});

test("sample workspaces keep the single local conversation and no thread routes", async () => {
  const sampleDb = await createStore();
  const sample = await createApp(sampleDb, {
    ...config,
    mode: "sample",
    host: "127.0.0.1",
    agentBackend: "sample",
    threadsBackend: undefined,
  });
  try {
    const session = await sample.app.request("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const sampleToken = (await session.json()).token;
    const auth = { Authorization: `Bearer ${sampleToken}` };
    const workspace = await (await sample.app.request("/api/workspace", { headers: auth })).json();
    assert.equal(workspace.runtime.richThreads, false);
    assert.equal(workspace.runtime.localThreads, false);
    assert.equal((await sample.app.request("/api/threads", { headers: auth })).status, 404);
    const main = await (await sample.app.request("/api/main-thread", { headers: auth })).json();
    assert.equal(main.existing, false);
  } finally {
    await sample.agent.stop();
    await sampleDb.close();
  }
});
