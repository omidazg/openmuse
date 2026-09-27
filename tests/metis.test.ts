import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyMetisProvider,
  METIS_DEFAULT_MODEL,
  metisEndpoints,
} from "../apps/server/src/metis.ts";

const fakeKey = "metis-test-key-never-sent";

test("without METIS_API_KEY provider variables are left untouched", () => {
  const env: NodeJS.ProcessEnv = { OPENAI_API_KEY: "direct", OPENAI_BASE_URL: "https://gw/v1" };
  assert.equal(applyMetisProvider(env), false);
  assert.deepEqual(env, { OPENAI_API_KEY: "direct", OPENAI_BASE_URL: "https://gw/v1" });
  assert.equal(applyMetisProvider({ METIS_API_KEY: "  " }), false);
});

test("METIS_API_KEY routes OpenAI, Anthropic and Gemini through Metis", () => {
  const env: NodeJS.ProcessEnv = {
    METIS_API_KEY: fakeKey,
    MODEL: "anthropic/claude-sonnet-5",
    OPENAI_API_KEY: "blocked-direct-key",
  };
  assert.equal(applyMetisProvider(env), true);
  assert.equal(env.OPENAI_API_KEY, fakeKey);
  assert.equal(env.OPENAI_BASE_URL, "https://api.metisai.ir/openai/v1");
  assert.equal(env.ANTHROPIC_API_KEY, fakeKey);
  assert.equal(env.ANTHROPIC_BASE_URL, "https://api.metisai.ir/anthropic/v1");
  assert.equal(env.GOOGLE_API_KEY, fakeKey);
  assert.equal(env.GOOGLE_GENERATIVE_AI_BASE_URL, "https://api.metisai.ir/v1beta");
  assert.equal(env.MODEL, "anthropic/claude-sonnet-5");
});

test("Metis supplies a default MODEL only when none is configured", () => {
  const env: NodeJS.ProcessEnv = { METIS_API_KEY: fakeKey };
  applyMetisProvider(env);
  assert.equal(env.MODEL, METIS_DEFAULT_MODEL);
  assert.match(METIS_DEFAULT_MODEL, /^openai\//);
});

test("METIS_BASE_URL accepts a host root or a provider URL", () => {
  const expected = {
    openai: "https://metis.example/openai/v1",
    anthropic: "https://metis.example/anthropic/v1",
    google: "https://metis.example/v1beta",
  };
  for (const base of [
    "https://metis.example",
    "https://metis.example/",
    "https://metis.example/openai/v1",
    "https://metis.example/anthropic/v1/",
    "https://metis.example/v1beta",
  ])
    assert.deepEqual(metisEndpoints(base), expected);
  const env: NodeJS.ProcessEnv = {
    METIS_API_KEY: fakeKey,
    METIS_BASE_URL: "https://metis.example",
  };
  applyMetisProvider(env);
  assert.equal(env.OPENAI_BASE_URL, expected.openai);
});

test("the agent reports a model as configured when only METIS_API_KEY is set", async () => {
  const saved = { ...process.env };
  try {
    for (const name of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "MODEL"])
      delete process.env[name];
    process.env.METIS_API_KEY = fakeKey;
    applyMetisProvider();
    const { agentConfigured } = await import("../apps/server/src/agent.ts");
    assert.equal(
      agentConfigured({
        mode: "sample",
        port: 8787,
        host: "127.0.0.1",
        publicUrl: "http://localhost:8787",
        dataDir: ".openmuse",
        agentBackend: "model",
        model: process.env.MODEL,
        googleRedirectUri: "http://localhost:8787/api/google/callback",
        allowedOrigins: [],
      }),
      true,
    );
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
    Object.assign(process.env, saved);
  }
});
