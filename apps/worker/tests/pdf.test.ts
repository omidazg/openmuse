import assert from "node:assert/strict";
import test from "node:test";
import { createPdfRenderer, validatePdfRequest } from "../src/pdf.ts";

test("real Chromium renders Persian HTML to a PDF with Vazirmatn embedded", {
  timeout: 90_000,
}, async () => {
  const renderer = createPdfRenderer();
  try {
    const bytes = await renderer.render(
      validatePdfRequest({
        html: `<h1>گزارش ماهانه</h1><p>این سند با فونت وزیرمتن و جهت راست به چپ ساخته می‌شود.</p>
<img src="https://example.com/tracker.png" alt=""><script>document.body.textContent = "x"</script>`,
        title: "گزارش ماهانه",
      }),
    );
    const text = Buffer.from(bytes).toString("latin1");
    assert.equal(text.slice(0, 5), "%PDF-");
    assert.match(text, /\/FontName\s*\/[A-Z]{6}\+Vazirmatn/, "Vazirmatn is subset-embedded");
    assert.match(text, /\/Type\s*\/Page\b/);
  } finally {
    await renderer.close();
  }
});
