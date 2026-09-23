import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { persianVoice, pickSpeechMode } from "../apps/mobile/src/speech-mode.ts";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";
import { RateLimiter } from "../apps/server/src/rate-limit.ts";
import { capText, speakableText, TTS_MAX_INPUT_CHARS, TtsService } from "../apps/server/src/tts.ts";

const MP3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);
const env = {
  OPENAI_API_KEY: "fixture-key",
  OPENAI_BASE_URL: "https://gateway.example/openai/v1",
} as NodeJS.ProcessEnv;

function fakeFetch(t: TestContext, reply: () => Response = () => new Response(MP3)) {
  const calls: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body)),
      auth: new Headers(init?.headers).get("authorization"),
    });
    return reply();
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  return calls;
}

test("speech text drops markdown and long answers are cut at a sentence", () => {
  assert.equal(
    speakableText("## خلاصه\n\n- **مورد اول** از [این صفحه](https://a.ir)\n```js\nx()\n```\nپایان"),
    "خلاصه\nمورد اول از این صفحه\nپایان",
  );
  assert.deepEqual(capText("کوتاه.", 100), { text: "کوتاه.", truncated: false });
  const long = `${"جملهٔ اول است. ".repeat(10)}جملهٔ بی‌پایان`;
  const capped = capText(long, 100);
  assert.equal(capped.truncated, true);
  assert.ok(capped.text.length <= 100);
  assert.ok(capped.text.endsWith("."));
});

test("TTS calls the gateway once per text, then serves the cache", async (t) => {
  const calls = fakeFetch(t);
  const tts = new TtsService({ ...env, TTS_VOICE: "nova" });
  const first = await tts.speak("owner", "سلام، **وقت بخیر**.");
  assert.deepEqual(first, { audio: MP3, truncated: false, cached: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://gateway.example/openai/v1/audio/speech");
  assert.equal(calls[0].auth, "Bearer fixture-key");
  assert.equal(calls[0].body.model, "gpt-4o-mini-tts");
  assert.equal(calls[0].body.voice, "nova");
  assert.equal(calls[0].body.input, "سلام، وقت بخیر.");
  assert.equal(calls[0].body.response_format, "mp3");
  assert.match(String(calls[0].body.instructions), /Persian/);

  const again = await tts.speak("someone-else", "سلام، **وقت بخیر**.");
  assert.equal(again.cached, true);
  assert.equal(calls.length, 1);

  // tts-1 has no instructions parameter; the provider prefix is accepted.
  const legacy = new TtsService({ ...env, TTS_MODEL: "openai/tts-1" });
  await legacy.speak("owner", "متن دیگر");
  assert.equal(calls[1].body.model, "tts-1");
  assert.equal(calls[1].body.instructions, undefined);
});

test("TTS rate-limits cache misses per owner and caps text length", async (t) => {
  const calls = fakeFetch(t);
  let now = 0;
  const tts = new TtsService(
    { ...env, TTS_MAX_CHARS: "200" },
    new RateLimiter(2, 60_000, () => now),
  );
  await tts.speak("owner", "یک");
  await tts.speak("owner", "دو");
  await assert.rejects(tts.speak("owner", "سه"), { status: 429 });
  // Cached answers and other owners are not limited.
  assert.equal((await tts.speak("owner", "یک")).cached, true);
  await tts.speak("other", "سه");
  now = 61_000;
  await tts.speak("owner", "چهار");
  assert.equal(calls.length, 4);

  const long = await tts.speak("other", `${"این یک جمله است. ".repeat(40)}`);
  assert.equal(long.truncated, true);
  assert.ok(String(calls.at(-1)?.body.input).length <= 200);

  await assert.rejects(tts.speak("other", "ا".repeat(TTS_MAX_INPUT_CHARS + 1)), { status: 413 });
  await assert.rejects(tts.speak("other", "   "), { status: 400 });
  await assert.rejects(tts.speak("other", 42), { status: 400 });
  await assert.rejects(tts.speak("other", "```\ncode\n```"), { status: 422 });
  assert.equal(calls.length, 5);
});

test("TTS reports gateway failures and disabled servers", async (t) => {
  fakeFetch(t, () => new Response("no", { status: 404 }));
  await assert.rejects(new TtsService(env).speak("owner", "سلام"), {
    status: 502,
    message: /ساخت صدا انجام نشد/,
  });
  const disabled = new TtsService({ ...env, TTS_ENABLED: "false" });
  assert.equal(disabled.enabled, false);
  await assert.rejects(disabled.speak("owner", "سلام"), { status: 503 });
  assert.equal(new TtsService({}).enabled, false);
});

test("POST /api/tts returns MP3 audio and health reports ttsEnabled", async (t) => {
  const previous = { key: process.env.OPENAI_API_KEY, base: process.env.OPENAI_BASE_URL };
  process.env.OPENAI_API_KEY = "fixture-key";
  process.env.OPENAI_BASE_URL = "https://gateway.example/openai/v1";
  const directory = await mkdtemp(join(tmpdir(), "openmuse-tts-"));
  const db = await createStore();
  const config: Config = {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "sample",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: [],
  };
  const server = await createApp(db, config);
  t.after(async () => {
    for (const [name, value] of [
      ["OPENAI_API_KEY", previous.key],
      ["OPENAI_BASE_URL", previous.base],
    ] as const)
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    await server.agent.stop();
    await db.close();
    await rm(directory, { recursive: true, force: true });
  });
  const calls = fakeFetch(t);
  assert.equal((await (await server.app.request("/api/health")).json()).ttsEnabled, true);
  const { token } = await server.auth.session();
  const speak = (body: unknown, auth = true) =>
    server.app.request("/api/tts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  assert.equal((await speak({ text: "سلام" }, false)).status, 401);
  const response = await speak({ text: "سلام" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.equal(response.headers.get("x-tts-truncated"), "false");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), MP3);
  assert.equal((await speak({})).status, 400);
  assert.equal(calls.length, 1);
});

test("the app speaks with server audio, a Persian browser voice, or hides the button", () => {
  const fa = { lang: "fa_IR", name: "Dariush" };
  const en = { lang: "en-US", name: "Samantha" };
  assert.equal(persianVoice([en, fa]), fa);
  assert.equal(persianVoice([en, { lang: "", name: "Microsoft Farsi" }])?.name, "Microsoft Farsi");
  assert.equal(persianVoice([en]), undefined);
  const base = { web: true, ttsEnabled: true, canPlayAudio: true, voices: [en] };
  assert.equal(pickSpeechMode(base), "server");
  assert.equal(pickSpeechMode({ ...base, ttsEnabled: false, voices: [en, fa] }), "browser");
  assert.equal(pickSpeechMode({ ...base, ttsEnabled: false }), null);
  assert.equal(pickSpeechMode({ ...base, web: false }), null);
});
