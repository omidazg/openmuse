import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  buildEnvelope,
  errorReportingEnabled,
  parseDsn,
  reportError,
  scrub,
} from "../apps/server/src/errors-report.ts";

const originalFetch = globalThis.fetch;
const originalDsn = process.env.SENTRY_DSN;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalDsn === undefined) delete process.env.SENTRY_DSN;
  else process.env.SENTRY_DSN = originalDsn;
});

test("parses Sentry and GlitchTip DSNs into envelope endpoints", () => {
  assert.deepEqual(parseDsn("https://abc123@o1.ingest.sentry.io/42"), {
    dsn: "https://abc123@o1.ingest.sentry.io/42",
    publicKey: "abc123",
    envelopeUrl: "https://o1.ingest.sentry.io/api/42/envelope/",
  });
  assert.equal(
    parseDsn("https://key@glitchtip.example.ir:8443/tracking/7")?.envelopeUrl,
    "https://glitchtip.example.ir:8443/tracking/api/7/envelope/",
  );
  assert.equal(parseDsn(""), undefined);
  assert.equal(parseDsn("not a url"), undefined);
  assert.equal(parseDsn("https://host.example/1"), undefined);
});

test("scrubs tokens, keys and credentials from messages", () => {
  const text = scrub(
    '401 Authorization: Bearer abc.def-ghi api_key=sk-1234567890abcdef token="xyz" postgresql://openmuse:pw@postgres:5432/openmuse',
  );
  assert.doesNotMatch(text, /abc\.def-ghi|sk-1234567890abcdef|xyz|:pw@/);
  assert.match(text, /\[Filtered\]/);
  assert.equal(scrub("plain failure"), "plain failure");
});

test("envelope carries type, scrubbed message, frames and route but no request data", () => {
  const dsn = parseDsn("https://k@errors.example/3");
  assert.ok(dsn);
  const error = new TypeError("upstream said Bearer secret-token-value");
  const lines = buildEnvelope(
    error,
    { component: "api", method: "POST", route: "/api/files/:id?x=1" },
    dsn,
  ).split("\n");
  assert.equal(lines.length, 3);
  assert.equal(JSON.parse(lines[1] ?? "{}").type, "event");
  const event = JSON.parse(lines[2] ?? "{}");
  const exception = event.exception.values[0];
  assert.equal(exception.type, "TypeError");
  assert.doesNotMatch(exception.value, /secret-token-value/);
  assert.ok(exception.stacktrace.frames.length > 0);
  assert.deepEqual(event.tags, { component: "api", method: "POST", route: "/api/files/:id" });
  assert.equal(event.request, undefined);
});

test("reportError is a no-op without SENTRY_DSN and posts an envelope with one", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  delete process.env.SENTRY_DSN;
  assert.equal(errorReportingEnabled(), false);
  await reportError(new Error("ignored"));
  assert.equal(calls.length, 0);

  process.env.SENTRY_DSN = "https://pub@errors.example/9";
  await reportError(new Error("boom"), { component: "worker" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://errors.example/api/9/envelope/");
  const headers = new Headers(calls[0]?.init?.headers);
  assert.match(headers.get("x-sentry-auth") ?? "", /sentry_key=pub/);
});
