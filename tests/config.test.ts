import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import {
  assertApiDeploymentConfig,
  type Config,
  readConfig,
  threadsBackend,
} from "../apps/server/src/config.ts";

const sampleConfig: Config = {
  mode: "sample",
  port: 8787,
  host: "127.0.0.1",
  publicUrl: "http://localhost:8787",
  dataDir: ".openmuse",
  agentBackend: "sample",
  googleRedirectUri: "http://localhost:8787/api/google/callback",
  allowedOrigins: ["http://localhost:8081"],
};

function liveConfig(intelligenceApiKey?: string, backend?: Config["threadsBackend"]): Config {
  return {
    ...sampleConfig,
    mode: "live",
    agentBackend: "model",
    intelligenceApiKey,
    threadsBackend: backend,
  };
}

const missingKeyMessage =
  "THREADS_BACKEND=intelligence requires CPK_INTELLIGENCE_API_KEY for durable Rich Threads. " +
  "Run `npx copilotkit@latest login` and `npx copilotkit@latest project select`, " +
  "then set the generated server-only key, or set THREADS_BACKEND=local to keep threads " +
  "in OpenMuse's own database. " +
  "See https://docs.copilotkit.ai/intelligence/connect-your-runtime";

const ENV_KEYS = [
  "WORKSPACE_MODE",
  "AGENT_BACKEND",
  "HOST",
  "OPENMUSE_ACCESS_KEY",
  "TOKEN_ENCRYPTION_KEY",
  "CPK_INTELLIGENCE_API_KEY",
  "THREADS_BACKEND",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
];

/** Runs readConfig + the API startup assertion against an isolated environment. */
function startWith(env: Record<string, string>) {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, env);
  try {
    const config = readConfig();
    assertApiDeploymentConfig(config);
    return config;
  } finally {
    for (const key of ENV_KEYS)
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
  }
}

const liveEnv = {
  WORKSPACE_MODE: "live",
  AGENT_BACKEND: "model",
  HOST: "0.0.0.0",
  OPENMUSE_ACCESS_KEY: "a-private-test-key-with-enough-characters",
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};

test("explicit Intelligence threads reject a missing or blank key", () => {
  for (const key of [undefined, "", " \t\n"]) {
    assert.throws(() => assertApiDeploymentConfig(liveConfig(key, "intelligence")), {
      name: "Error",
      message: missingKeyMessage,
    });
  }
});

test("live API configuration accepts a non-empty Intelligence key", () => {
  assert.doesNotThrow(() => assertApiDeploymentConfig(liveConfig("test-project-key-never-sent")));
  assert.equal(threadsBackend(liveConfig("test-project-key-never-sent")), "intelligence");
});

test("live API configuration without a key defaults to self-hosted local threads", () => {
  for (const key of [undefined, "", " \t\n"]) {
    assert.equal(threadsBackend(liveConfig(key)), "local");
    assert.doesNotThrow(() => assertApiDeploymentConfig(liveConfig(key)));
  }
  assert.equal(threadsBackend(liveConfig("a-key", "local")), "local");
});

test("sample API configuration remains key-free", () => {
  assert.doesNotThrow(() => assertApiDeploymentConfig(sampleConfig));
});

test("config matrix: live + local starts without CopilotKit or Google configuration", () => {
  const config = startWith({ ...liveEnv, THREADS_BACKEND: "local" });
  assert.equal(config.mode, "live");
  assert.equal(threadsBackend(config), "local");
  assert.equal(config.googleClientId, undefined);
  assert.equal(threadsBackend(startWith(liveEnv)), "local");
});

test("config matrix: live + intelligence without a key fails at startup", () => {
  assert.throws(() => startWith({ ...liveEnv, THREADS_BACKEND: "intelligence" }), {
    message: missingKeyMessage,
  });
  const config = startWith({
    ...liveEnv,
    THREADS_BACKEND: "intelligence",
    CPK_INTELLIGENCE_API_KEY: "test-project-key-never-sent",
  });
  assert.equal(threadsBackend(config), "intelligence");
  assert.throws(() => startWith({ ...liveEnv, THREADS_BACKEND: "cloud" }), /THREADS_BACKEND/);
});

test("config matrix: local threads keep every other live security requirement", () => {
  assert.throws(
    () => startWith({ ...liveEnv, THREADS_BACKEND: "local", OPENMUSE_ACCESS_KEY: "short" }),
    /OPENMUSE_ACCESS_KEY/,
  );
  const { TOKEN_ENCRYPTION_KEY: _unused, ...withoutEncryption } = liveEnv;
  assert.throws(
    () => startWith({ ...withoutEncryption, THREADS_BACKEND: "local" }),
    /TOKEN_ENCRYPTION_KEY/,
  );
  assert.throws(
    () => startWith({ ...liveEnv, THREADS_BACKEND: "local", AGENT_BACKEND: "sample" }),
    /sample agent/,
  );
});

test("config matrix: sample mode is unchanged", () => {
  const config = startWith({});
  assert.equal(config.mode, "sample");
  assert.equal(threadsBackend(config), "local");
  assert.throws(() => startWith({ HOST: "0.0.0.0" }), /loopback/);
});

test("CopilotKit telemetry is disabled before the runtime loads", () => {
  // The runtime's telemetry client reads the opt-out once, at import time; app.ts must load
  // config.ts (which sets COPILOTKIT_TELEMETRY_DISABLED/DO_NOT_TRACK) before the runtime.
  const script = `
    await import("./apps/server/src/app.ts");
    const { createRequire } = await import("node:module");
    const { dirname, join } = await import("node:path");
    const { pathToFileURL } = await import("node:url");
    const { realpathSync } = await import("node:fs");
    const pkg = createRequire(import.meta.url).resolve("@copilotkit/runtime/package.json");
    const client = join(dirname(realpathSync(pkg)), "dist/v2/runtime/telemetry/telemetry-client.mjs");
    const telemetry = (await import(pathToFileURL(client).href)).default;
    console.log(JSON.stringify({ disabled: telemetry.telemetryDisabled }));
  `;
  const env = { ...process.env };
  delete env.COPILOTKIT_TELEMETRY_DISABLED;
  delete env.DO_NOT_TRACK;
  const output = execFileSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    { env, encoding: "utf8" },
  );
  assert.deepEqual(JSON.parse(output.trim().split("\n").at(-1) ?? "{}"), { disabled: true });
});
