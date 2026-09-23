import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_UPLOAD_BYTES,
  percentLabel,
  transferFiles,
  uploadFailure,
  uploadPercent,
  uploadProblem,
} from "../src/composer-files.ts";
import { isSendKey, matchShortcut, shortcutRows } from "../src/composer-keys.ts";

test("supported documents and images pass; other types and oversized files get Persian errors", () => {
  assert.equal(
    uploadProblem({ name: "قرارداد.pdf", size: 2000, type: "application/pdf" }),
    undefined,
  );
  assert.equal(uploadProblem({ name: "report.DOCX", size: 10 }), undefined);
  assert.equal(
    uploadProblem({ name: "data.csv", size: 10, type: "application/vnd.ms-excel" }),
    undefined,
  );
  assert.equal(uploadProblem({ name: "blob", size: 10, type: "application/pdf" }), undefined);
  assert.equal(uploadProblem({ name: "image.png", size: 10, type: "image/png" }), undefined);
  assert.equal(uploadProblem({ name: "receipt.JPG", size: 10 }), undefined);
  assert.match(
    uploadProblem({ name: "notes.txt", size: 10, type: "text/plain" }) ?? "",
    /پشتیبانی نمی‌شود/,
  );
  assert.match(
    uploadProblem({ name: "old.xls", size: 10, type: "application/vnd.ms-excel" }) ?? "",
    /پشتیبانی نمی‌شود/,
  );
  const big = uploadProblem({ name: "big.pdf", size: MAX_UPLOAD_BYTES + 1 });
  assert.match(big ?? "", /۱۰ مگابایت/);
  assert.doesNotMatch(big ?? "", /\d/);
  assert.match(uploadProblem({ name: "empty.pdf", size: 0 }) ?? "", /خالی/);
});

test("progress is a whole percent shown with Persian digits and ٪ after the number", () => {
  assert.equal(uploadPercent(0, 0), undefined);
  assert.equal(uploadPercent(421, 1000), 42);
  assert.equal(uploadPercent(2000, 1000), 100);
  assert.equal(percentLabel(42), "۴۲٪");
  assert.equal(percentLabel(100), "۱۰۰٪");
});

test("upload failures prefer the server's message and never show Latin status digits", () => {
  assert.equal(uploadFailure(422, JSON.stringify({ error: "PDF خراب است" })), "PDF خراب است");
  assert.match(uploadFailure(413, "<html>"), /۱۰ مگابایت/);
  assert.match(uploadFailure(0, ""), /اتصال/);
  assert.match(uploadFailure(502, ""), /۵۰۲/);
});

test("drag and paste data yield files only", () => {
  const file = { name: "a.pdf" } as File;
  assert.deepEqual(transferFiles(null), []);
  assert.deepEqual(transferFiles({ files: [file] }), [file]);
  const items = [
    { kind: "string", getAsFile: () => null },
    { kind: "file", getAsFile: () => file },
  ] as unknown as DataTransferItem[];
  assert.deepEqual(transferFiles({ files: [], items }), [file]);
});

test("shortcuts match by physical key so they work with the Persian layout", () => {
  assert.equal(matchShortcut({ key: "ن", code: "KeyK", ctrlKey: true }, true), "threads");
  assert.equal(matchShortcut({ key: "k", code: "KeyK", metaKey: true }, false), "threads");
  assert.equal(
    matchShortcut({ key: "O", code: "KeyO", ctrlKey: true, shiftKey: true }, true),
    "newChat",
  );
  assert.equal(matchShortcut({ key: "Escape" }, true), "escape");
  assert.equal(matchShortcut({ key: "/", code: "Slash" }, false), "focusInput");
  assert.equal(matchShortcut({ key: "؟", code: "Slash", shiftKey: true }, false), "help");
  // Single keys stay typeable inside a text field.
  assert.equal(matchShortcut({ key: "/", code: "Slash" }, true), undefined);
  assert.equal(matchShortcut({ key: "?", code: "Slash", shiftKey: true }, true), undefined);
  assert.equal(matchShortcut({ key: "a", code: "KeyA" }, false), undefined);
  assert.equal(
    matchShortcut({ key: "k", code: "KeyK", isComposing: true, ctrlKey: true }, false),
    undefined,
  );
});

test("Enter sends, Shift+Enter and IME composition do not", () => {
  assert.equal(isSendKey({ key: "Enter" }), true);
  assert.equal(isSendKey({ key: "Enter", shiftKey: true }), false);
  assert.equal(isSendKey({ key: "Enter", isComposing: true }), false);
  assert.equal(isSendKey({ key: "a" }), false);
});

test("the help sheet names the platform modifier", () => {
  assert.ok(shortcutRows(true).some((row) => row.keys.includes("⌘")));
  assert.ok(shortcutRows(false).some((row) => row.keys.includes("Ctrl")));
});
