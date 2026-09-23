import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";

test("onboarding and «تازه‌ها» preferences persist per owner", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-preferences-"));
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
  const { token } = await server.auth.session();
  const request = (path: string, init: RequestInit = {}) =>
    server.app.request(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });

  assert.equal((await server.app.request("/api/preferences")).status, 401);
  assert.deepEqual(await (await request("/api/preferences")).json(), {
    onboardingDone: false,
    changelogSeen: null,
  });

  const patch = await request("/api/preferences", {
    method: "PATCH",
    body: JSON.stringify({ onboardingDone: true }),
  });
  assert.equal(patch.status, 200);
  await request("/api/preferences", {
    method: "PATCH",
    body: JSON.stringify({ changelogSeen: "2026-09-23-iran-calendar" }),
  });
  assert.deepEqual(await (await request("/api/preferences")).json(), {
    onboardingDone: true,
    changelogSeen: "2026-09-23-iran-calendar",
  });
  // Other people keep their own state.
  assert.equal(
    (await db.get("someone-else", "conversation-settings", "app-preferences")) ?? null,
    null,
  );

  for (const body of [{ onboardingDone: "yes" }, { changelogSeen: "<script>" }, { admin: true }])
    assert.equal(
      (await request("/api/preferences", { method: "PATCH", body: JSON.stringify(body) })).status,
      422,
      JSON.stringify(body),
    );
});
