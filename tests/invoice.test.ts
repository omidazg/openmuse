import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { DocumentError } from "../apps/server/src/documents/format.ts";
import {
  DEFAULT_VAT_PERCENT,
  invoiceHtml,
  invoiceTotals,
  prepareInvoice,
} from "../apps/server/src/documents/invoice.ts";
import { numberToPersianWords } from "../apps/server/src/documents/num-to-words.ts";
import { templateDocumentTools } from "../apps/server/src/documents/tools.ts";
import { AppError } from "../apps/server/src/errors.ts";
import { createPdfRenderer, validatePdfRequest } from "../apps/worker/src/pdf.ts";
import type { Artifact } from "../packages/domain/src/index.ts";

const NOW = new Date("2026-09-27T08:00:00Z"); // ۵ مهر ۱۴۰۵ in Tehran

const sample = {
  seller: {
    name: "فروشگاه نارنج",
    phone: "021-88123456",
    address: "تهران، خیابان ولیعصر",
    economicCode: "411111111111",
  },
  buyer: { name: "علی <رضایی>", phone: "۰۹۱۲۱۲۳۴۵۶۷" },
  items: [
    { title: "کیف چرمی", quantity: 2, unitPrice: 1_250_000 },
    { title: "زعفران", quantity: 2.5, unit: "مثقال", unitPrice: 333_333 },
  ],
};

/** Renders with the worker's real Chromium; skips when the browser or fonts are missing. */
async function renderOrSkip(t: TestContext, html: string, title: string) {
  const renderer = createPdfRenderer();
  try {
    return await renderer.render(validatePdfRequest({ html, title }));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    t.skip(`Chromium or Vazirmatn is not available here: ${reason}`);
    return undefined;
  } finally {
    await renderer.close();
  }
}

test("numbers are written in Persian words up to trillions", () => {
  assert.equal(numberToPersianWords(0), "صفر");
  assert.equal(numberToPersianWords(1), "یک");
  assert.equal(numberToPersianWords(12), "دوازده");
  assert.equal(numberToPersianWords(1000), "یک هزار");
  assert.equal(numberToPersianWords(1_250_000), "یک میلیون و دویست و پنجاه هزار");
  assert.equal(numberToPersianWords(12_000_000_000), "دوازده میلیارد");
  assert.equal(numberToPersianWords(105), "صد و پنج");
  assert.equal(
    numberToPersianWords(3_984_933),
    "سه میلیون و نهصد و هشتاد و چهار هزار و نهصد و سی و سه",
  );
  assert.equal(numberToPersianWords(2_000_000_000_017), "دو تریلیون و هفده");
  assert.equal(numberToPersianWords(-40), "منفی چهل");
  assert.throws(() => numberToPersianWords(1.5), RangeError);
  assert.throws(() => numberToPersianWords(1e15), /بیش از حد بزرگ/);
});

test("invoice totals apply discount, VAT and whole-Toman rounding", () => {
  const items = sample.items;
  const plain = invoiceTotals({ items });
  assert.equal(plain.lines[1].total, 833_333, "2.5 × 333,333 rounds half up");
  assert.equal(plain.subtotal, 3_333_333);
  assert.equal(plain.vat, 0);
  assert.equal(plain.total, 3_333_333);

  const percent = invoiceTotals({ items, discount: { type: "percent", value: 5 }, vat: true });
  assert.equal(percent.discount, 166_667); // 166,666.65
  assert.equal(percent.taxable, 3_166_666);
  assert.equal(percent.vatPercent, DEFAULT_VAT_PERCENT);
  assert.equal(percent.vat, 316_667); // 316,666.6
  assert.equal(percent.total, 3_483_333);

  const amount = invoiceTotals({
    items,
    discount: { type: "amount", value: 333_333 },
    vat: true,
    vatPercent: 9,
  });
  assert.equal(amount.taxable, 3_000_000);
  assert.equal(amount.vat, 270_000);
  assert.equal(amount.total, 3_270_000);

  assert.throws(
    () => invoiceTotals({ items, discount: { type: "amount", value: 5_000_000 } }),
    (error: Error) => error instanceof DocumentError && /تخفیف.*بیشتر است/.test(error.message),
  );
});

test("invalid invoice input fails with Persian messages", () => {
  const cases: [unknown, RegExp][] = [
    [{ ...sample, items: [] }, /دست‌کم یک ردیف/],
    [{ ...sample, seller: { name: " " } }, /نام فروشنده را وارد کنید/],
    [{ ...sample, buyer: {} }, /نام خریدار را وارد کنید/],
    [
      { ...sample, items: [{ title: "کیف", quantity: 0, unitPrice: 10 }] },
      /تعداد هر ردیف باید بیشتر از صفر/,
    ],
    [{ ...sample, items: [{ title: "کیف", quantity: 1, unitPrice: 10.5 }] }, /بدون اعشار/],
    [
      { ...sample, items: [{ title: "کیف", quantity: 1, unitPrice: "۱۰" }] },
      /مبلغ واحد هر ردیف باید یک عدد/,
    ],
    [{ ...sample, discount: { type: "percent", value: 120 } }, /بیشتر از ۱۰۰/],
    [{ ...sample, date: "1405-13-01" }, /تاریخ پیش‌فاکتور نامعتبر است/],
    [{ ...sample, extra: 1, vat: "yes" }, /vat باید true یا false باشد/],
  ];
  for (const [input, message] of cases)
    assert.throws(
      () => prepareInvoice(input, { now: NOW }),
      (error: Error) => {
        assert(error instanceof DocumentError, `DocumentError for ${JSON.stringify(input)}`);
        assert.match(error.message, message);
        return true;
      },
    );
  // zod's built-in messages (here a missing object) are Persian too.
  assert.throws(() => prepareInvoice({ items: sample.items }), /[آ-ی]/);
});

test("invoice HTML is Persian, escaped, dated in Jalali and totals in words", () => {
  const invoice = prepareInvoice(
    {
      ...sample,
      discount: { type: "percent", value: 5 },
      vat: true,
      notes: "ارسال با پست",
      validDays: 7,
    },
    { now: NOW, random: () => 291 },
  );
  assert.equal(invoice.number, "14050705-291");
  assert.equal(invoice.date, "2026-09-27");
  const html = invoiceHtml(invoice);
  assert.match(html, /<h1 class="doc-title">پیش‌فاکتور<\/h1>/);
  assert.match(html, /تاریخ: ۵ مهر ۱۴۰۵/);
  assert.match(html, /۱۴۰۵۰۷۰۵-۲۹۱/);
  assert.match(html, /علی &lt;رضایی&gt;/);
  assert.match(html, /<span dir="ltr" class="code">۰۲۱-۸۸۱۲۳۴۵۶<\/span>/);
  assert.match(html, /<span dir="ltr" class="code">۰۹۱۲۱۲۳۴۵۶۷<\/span>/);
  assert.match(html, /۲٫۵ مثقال/);
  assert.match(html, /تخفیف \(۵٪\)/);
  assert.match(html, /مالیات بر ارزش افزوده \(۱۰٪\)/);
  assert.match(html, /۳٬۴۸۳٬۳۳۳ تومان/);
  assert.match(
    html,
    /مبلغ به حروف: <strong>سه میلیون و چهارصد و هشتاد و سه هزار و سیصد و سی و سه تومان<\/strong>/,
  );
  assert.match(html, /تا ۱۲ مهر ۱۴۰۵ معتبر است/);
  assert.match(html, /مهر و امضای فروشنده/);
  assert.match(html, /مهر و امضای خریدار/);
  const visible = html.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<[^>]*>/g, "");
  assert.doesNotMatch(visible, /[0-9]/, "no Latin digits in visible text");
  // Explicit Jalali or Gregorian dates and numbers are kept.
  assert.equal(prepareInvoice({ ...sample, date: "۱۴۰۵/۰۱/۰۱" }).date, "2026-03-21");
  assert.equal(prepareInvoice({ ...sample, date: "2026-03-21", number: "A-7" }).number, "A-7");
});

test("create_invoice saves through Files.createPdf and reports Persian errors", async () => {
  const created: { name: string; html: string; source: string }[] = [];
  const files = {
    async createPdf(_owner: string, name: string, html: string, source: string) {
      created.push({ name, html, source });
      return { id: "file-1", name: `${name}.pdf`, pageCount: 1 } as Artifact;
    },
  };
  const [invoiceTool] = templateDocumentTools(files, "owner") as unknown as {
    execute: (args: unknown) => Promise<Record<string, unknown>>;
  }[];
  const result = await invoiceTool.execute({ ...sample, vat: true });
  assert.equal(result.id, "file-1");
  assert.match(String(result.name), /^پیش‌فاکتور [۰-۹]{8}-[۰-۹]{3} علی <رضایی>\.pdf$/);
  assert.deepEqual(result.totals, {
    subtotal: 3_333_333,
    discount: 0,
    vatPercent: 10,
    vat: 333_333,
    total: 3_666_666,
  });
  assert.equal(created[0].source, "ساخته‌شده توسط دستیار");
  assert.match(created[0].html, /مبلغ قابل پرداخت/);
  assert.match(
    String((await invoiceTool.execute({ ...sample, items: [] })).error),
    /دست‌کم یک ردیف/,
  );
  files.createPdf = async () => {
    throw new AppError("ساخت PDF فارسی به سرویس مرورگر نیاز دارد.", 503);
  };
  assert.match(String((await invoiceTool.execute(sample)).error), /سرویس مرورگر/);
});

test("the invoice renders to a non-empty A4 PDF", { timeout: 90_000 }, async (t) => {
  const invoice = prepareInvoice({ ...sample, vat: true }, { now: NOW });
  const bytes = await renderOrSkip(t, invoiceHtml(invoice), "پیش‌فاکتور");
  if (!bytes) return;
  assert(bytes.length > 1000);
  const text = Buffer.from(bytes).toString("latin1");
  assert.equal(text.slice(0, 5), "%PDF-");
  assert.match(text, /\/FontName\s*\/[A-Z]{6}\+Vazirmatn/);
});
