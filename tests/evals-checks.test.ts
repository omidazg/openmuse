import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { type EvalCase, runChecks } from "./evals/checks.ts";

test("the Persian eval set is well formed", async () => {
  const cases = JSON.parse(
    await readFile(new URL("./evals/persian.json", import.meta.url), "utf8"),
  ) as EvalCase[];
  assert.ok(cases.length >= 25);
  assert.equal(new Set(cases.map((item) => item.id)).size, cases.length);
  for (const item of cases) {
    assert.ok(item.prompt.trim() && item.category.trim(), item.id);
    assert.ok(Object.keys(item.checks).length, item.id);
    if (item.checks.regex) new RegExp(item.checks.regex, "u");
    if (item.checks.notRegex) new RegExp(item.checks.notRegex, "u");
  }
  const categories = new Set(cases.map((item) => item.category));
  for (const category of [
    "نام",
    "تقویم",
    "ریاضی",
    "نامهٔ رسمی",
    "املا و نیم‌فاصله",
    "رد درخواست ناامن",
  ])
    assert.ok(categories.has(category), category);
});

test("eval checks catch the house-style mistakes", () => {
  assert.deepEqual(runChecks("من دستیار جی‌پی‌تی هستم.", { includesAll: ["دستیار جی‌پی‌تی"] }), []);
  assert.equal(runChecks("", { persianScript: true }).length, 1);
  assert.equal(runChecks("حاصل 144 است", { persianDigits: true }).length, 1);
  assert.deepEqual(runChecks("حاصل ۱۴۴ است؛ `x = 144`", { persianDigits: true }), []);
  assert.equal(runChecks("این کار می شود", { zwnjVerbs: true }).length, 1);
  assert.deepEqual(runChecks("این کار می‌شود", { zwnjVerbs: true }), []);
  assert.equal(runChecks("این نامه می‌باشد", { formalRegister: true }).length, 1);
  assert.equal(runChecks("بله میشه انجامش داد", { formalRegister: true }).length, 1);
  assert.equal(runChecks("متن — با خط تیره", { noEmDash: true }).length, 1);
  assert.equal(runChecks("ميز", { noArabicLetters: true }).length, 1);
  assert.deepEqual(runChecks("متأسفم، در این کار کمک نمی‌کنم.", { refusal: true }), []);
  assert.equal(runChecks("بله، مراحل این است", { refusal: true }).length, 1);
  assert.deepEqual(runChecks("I can help you write and plan.", { latinScript: true }), []);
  assert.equal(runChecks("۲۰۰ هزار تومان", { regex: "۴۵۰" }).length, 1);
  assert.equal(runChecks("خیلی بلند", { maxChars: 3 }).length, 1);
});
