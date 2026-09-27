import assert from "node:assert/strict";
import { test } from "node:test";
import {
  friendlyError,
  onUnauthorized,
  QUOTA_EXCEEDED,
  SESSION_EXPIRED,
} from "../src/session-errors.ts";

test("quota and server errors from CopilotKit show the Persian message", () => {
  const quota = "سقف استفادهٔ امروز شما تمام شده است. فردا دوباره تلاش کنید.";
  assert.equal(friendlyError(new Error(`HTTP 429: ${JSON.stringify({ error: quota })}`)), quota);
  const withPayload = Object.assign(new Error("HTTP 429: {}"), {
    status: 429,
    payload: { error: quota },
  });
  assert.equal(friendlyError(withPayload), quota);
  assert.equal(friendlyError(new Error("HTTP 429: not json")), QUOTA_EXCEEDED);
  assert.equal(friendlyError(new Error("اتصال برقرار نشد.")), "اتصال برقرار نشد.");
});

test("401 ends the session once and returns to login with a Persian message", () => {
  const seen: string[] = [];
  onUnauthorized((message) => seen.push(message));
  try {
    assert.equal(friendlyError(new Error("HTTP 401: {}")), SESSION_EXPIRED);
    const disabled = "حساب شما غیرفعال شده است. با مدیر سرویس تماس بگیرید.";
    assert.equal(friendlyError(new Error(`HTTP 401: {"error":"${disabled}"}`)), disabled);
    assert.deepEqual(seen, [SESSION_EXPIRED, disabled]);
  } finally {
    onUnauthorized(undefined);
  }
});
