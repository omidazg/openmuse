import assert from "node:assert/strict";
import test from "node:test";
import {
  backoffDelay,
  Connectivity,
  isNetworkError,
  isRetryableStatus,
  NetworkError,
  retryWithBackoff,
} from "../src/network.ts";
import { friendlyError, NETWORK_ERROR } from "../src/session-errors.ts";

test("backoff doubles from the base, is capped and jittered by at most 25%", () => {
  const exact = { random: () => 1 };
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map((attempt) => backoffDelay(attempt, exact)),
    [500, 1000, 2000, 4000, 8000, 8000],
  );
  assert.equal(backoffDelay(2, { random: () => 0 }), 1500);
  assert.equal(backoffDelay(0, { baseMs: 2000, maxMs: 30_000, random: () => 1 }), 2000);
});

test("network failures are retried with backoff, then succeed", async () => {
  const waits: number[] = [];
  let calls = 0;
  const result = await retryWithBackoff(
    async () => {
      calls += 1;
      if (calls < 3) throw new TypeError("Failed to fetch");
      return "ok";
    },
    { random: () => 1, sleep: async (ms) => void waits.push(ms) },
  );
  assert.equal(result, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(waits, [500, 1000]);
});

test("gives up after the retry budget and never retries other errors", async () => {
  let calls = 0;
  await assert.rejects(
    retryWithBackoff(
      async () => {
        calls += 1;
        throw new NetworkError("offline");
      },
      { retries: 2, sleep: async () => {} },
    ),
    NetworkError,
  );
  assert.equal(calls, 3);

  calls = 0;
  await assert.rejects(
    retryWithBackoff(
      async () => {
        calls += 1;
        throw new Error("درخواست انجام نشد (کد ۴۰۰).");
      },
      { sleep: async () => {} },
    ),
    /کد ۴۰۰/,
  );
  assert.equal(calls, 1);
});

test("network errors are recognised and shown in Persian", () => {
  for (const message of [
    "Failed to fetch",
    "TypeError: Load failed",
    "NetworkError when attempting to fetch resource.",
    "Network request failed",
  ])
    assert.equal(isNetworkError(new TypeError(message)), true, message);
  assert.equal(isNetworkError(new Error("HTTP 500: {}")), false);
  assert.equal(friendlyError(new TypeError("Failed to fetch")), NETWORK_ERROR);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(500), false);
  assert.equal(isRetryableStatus(404), false);
});

test("connectivity notifies only on changes", () => {
  const state = new Connectivity();
  let changes = 0;
  const unsubscribe = state.subscribe(() => changes++);
  state.set(true);
  state.set(false);
  state.set(false);
  assert.equal(state.getSnapshot(), false);
  state.set(true);
  unsubscribe();
  state.set(false);
  assert.equal(changes, 2);
});
