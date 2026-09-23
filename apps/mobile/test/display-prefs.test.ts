import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PREFS,
  documentAttributes,
  loadPrefs,
  motionDuration,
  motionReduced,
  PREFS_KEY,
  parsePrefs,
  SIMPLE_TOUCH_TARGET,
  savePrefs,
  scaled,
  TEXT_SCALES,
  textScale,
  touchTarget,
} from "../src/display-prefs.ts";

function memoryStore() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

test("missing or malformed stored preferences fall back to defaults", () => {
  assert.deepEqual(parsePrefs(null), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs("not json"), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs("42"), DEFAULT_PREFS);
  assert.deepEqual(
    parsePrefs(JSON.stringify({ theme: "purple", textSize: "huge", simple: "yes", focus: true })),
    { ...DEFAULT_PREFS, focus: true },
  );
});

test("preferences round-trip through storage", () => {
  const store = memoryStore();
  const prefs = { ...DEFAULT_PREFS, theme: "dark" as const, textSize: "large" as const };
  savePrefs(store, prefs);
  assert.ok(store.data.has(PREFS_KEY));
  assert.deepEqual(loadPrefs(store), prefs);
});

test("storage failures never throw", () => {
  const broken = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("quota");
    },
  };
  assert.deepEqual(loadPrefs(broken), DEFAULT_PREFS);
  assert.doesNotThrow(() => savePrefs(broken, DEFAULT_PREFS));
  assert.deepEqual(loadPrefs(undefined), DEFAULT_PREFS);
});

test("text scale follows the chosen size and simple mode forces the largest", () => {
  assert.equal(textScale(DEFAULT_PREFS), 1);
  assert.equal(textScale({ ...DEFAULT_PREFS, textSize: "small" }), TEXT_SCALES.small);
  assert.equal(textScale({ ...DEFAULT_PREFS, textSize: "small", simple: true }), 1.3);
  assert.ok(TEXT_SCALES.small < TEXT_SCALES.normal);
  assert.ok(TEXT_SCALES.large < TEXT_SCALES.xlarge);
  // Font size and line height scale together, so the line-height ratio is preserved.
  assert.equal(scaled(15, 1.3), 20);
  assert.equal(scaled(26, 1.3), 34);
});

test("simple mode raises touch targets to 48", () => {
  assert.equal(touchTarget(38, { simple: false }), 38);
  assert.equal(touchTarget(38, { simple: true }), SIMPLE_TOUCH_TARGET);
  assert.equal(touchTarget(60, { simple: true }), 60);
});

test("motion is reduced by the OS or the manual toggle", () => {
  assert.equal(motionReduced({ reduceMotion: false }, false), false);
  assert.equal(motionReduced({ reduceMotion: true }, false), true);
  assert.equal(motionReduced({ reduceMotion: false }, true), true);
  assert.equal(motionDuration(220, true), 0);
  assert.equal(motionDuration(220, false), 220);
});

test("document attributes drive the theme CSS", () => {
  assert.deepEqual(documentAttributes(DEFAULT_PREFS), {
    "data-theme": null,
    "data-contrast": null,
    "data-simple": null,
    "data-motion": null,
  });
  assert.deepEqual(
    documentAttributes({ ...DEFAULT_PREFS, theme: "dark", simple: true, reduceMotion: true }),
    {
      "data-theme": "dark",
      "data-contrast": "high",
      "data-simple": "true",
      "data-motion": "reduce",
    },
  );
});
