import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { CONTRACT_DISCLAIMER, prepareContract } from "../apps/server/src/documents/contracts.ts";
import { DocumentError } from "../apps/server/src/documents/format.ts";
import { templateDocumentTools } from "../apps/server/src/documents/tools.ts";
import { createPdfRenderer, validatePdfRequest } from "../apps/worker/src/pdf.ts";
import type { Artifact } from "../packages/domain/src/index.ts";

const NOW = new Date("2026-09-27T08:00:00Z"); // ۵ مهر ۱۴۰۵ in Tehran

const lease = {
  template: "residential_lease",
  lease: {
    landlord: { name: "مریم احمدی", nationalId: "0012345678" },
    tenant: { name: "سارا رضایی", phone: "09121234567" },
    property: { address: "تهران، سعادت‌آباد، پلاک ۳", area: 85, rooms: 2, parking: true },
    deposit: 500_000_000,
    monthlyRent: 15_000_000,
    paymentDay: 5,
    startDate: "1405-07-01",
    durationMonths: 12,
    extraTerms: ["نگهداری حیوان خانگی با اجازهٔ موجر مجاز است."],
  },
};

/** Visible text: no style block, no tags. */
const visible = (html: string) =>
  html.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<[^>]*>/g, "");

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

test("a residential lease has numbered articles, Jalali dates, amounts in words and the disclaimer", () => {
  const contract = prepareContract(lease, { now: NOW });
  assert.equal(contract.template, "residential_lease");
  assert.equal(contract.title, "اجاره‌نامهٔ مسکونی سارا رضایی");
  const html = contract.html;
  assert.match(html, /<h1 class="doc-title">اجاره‌نامهٔ مسکونی<\/h1>/);
  assert.match(html, /تاریخ تنظیم: ۵ مهر ۱۴۰۵/);
  assert.match(html, /ماده ۱: طرفین قرارداد/);
  assert.match(html, /از تاریخ <strong>۱ مهر ۱۴۰۵<\/strong> تا تاریخ <strong>۱ مهر ۱۴۰۶<\/strong>/);
  assert.match(html, /<strong>۵۰۰٬۰۰۰٬۰۰۰ تومان<\/strong> \(به حروف: پانصد میلیون تومان\)/);
  assert.match(html, /\(به حروف: پانزده میلیون تومان\)/);
  assert.match(html, /<span dir="ltr" class="code">۰۰۱۲۳۴۵۶۷۸<\/span>/);
  assert.match(html, /پارکینگ: دارد/);
  assert.match(html, /شروط دیگر/);
  assert.match(html, /این قرارداد در ۱۰ ماده/);
  assert.match(html, /امضای شاهد دوم/);
  assert(html.includes(`<div class="disclaimer">${CONTRACT_DISCLAIMER}</div>`));
  assert(
    html.includes(`content: "${CONTRACT_DISCLAIMER}"`),
    "disclaimer repeats in the page footer",
  );
  assert.doesNotMatch(visible(html), /[0-9]/, "no Latin digits in visible text");
  assert.doesNotMatch(html, /letter-spacing|uppercase/);
});

test("missing information becomes blank lines instead of invented values", () => {
  const html = prepareContract({ template: "residential_lease" }, { now: NOW }).html;
  // Names, IDs, address, postal code, deed, area, rooms, floor, amenities, dates, amounts…
  assert((html.match(/class="blank /g)?.length ?? 0) >= 15);
  assert.match(html, /مبلغ <span class="blank medium"><\/span> تومان \(به حروف:/);
  assert.match(html, /پارکینگ: <span class="blank short"><\/span>/);
  const rentFree = prepareContract({
    template: "residential_lease",
    lease: { monthlyRent: 0 },
  }).html;
  assert.match(rentFree, /رهن کامل/);
});

test("a temporary employment contract covers wage, insurance and legal minimums", () => {
  const contract = prepareContract(
    {
      template: "temporary_employment",
      employment: {
        employer: { name: "شرکت نمونه" },
        employerRepresentative: "حسین موسوی",
        employee: { name: "رضا کریمی" },
        jobTitle: "کارشناس فروش",
        monthlyWage: 18_000_000,
        allowances: [{ title: "حق مسکن", amount: 900_000 }],
        startDate: "2026-10-01",
        durationMonths: 6,
        weeklyHours: 44,
        probationMonths: 1,
      },
    },
    { now: NOW },
  );
  assert.equal(contract.title, "قرارداد کار موقت رضا کریمی");
  const html = contract.html;
  assert.match(html, /با نمایندگی <strong>حسین موسوی<\/strong>/);
  assert.match(
    html,
    /از تاریخ <strong>۹ مهر ۱۴۰۵<\/strong> تا تاریخ <strong>۹ فروردین ۱۴۰۶<\/strong>/,
  );
  assert.match(html, /هجده میلیون تومان/);
  assert.match(html, /حق مسکن ۹۰۰٬۰۰۰ تومان/);
  assert.match(html, /دورهٔ آزمایشی ۱ ماه/);
  assert.match(html, /تأمین اجتماعی/);
  assert.match(html, /شورای عالی کار/);
  assert.match(html, /مهر و امضای کارفرما/);
  assert(html.includes(CONTRACT_DISCLAIMER));
  assert.doesNotMatch(visible(html), /[0-9]/);
});

test("invalid contract input fails with Persian messages", () => {
  const cases: [unknown, RegExp][] = [
    [{ template: "sale" }, /نوع قرارداد باید اجاره‌نامهٔ مسکونی یا قرارداد کار موقت باشد/],
    [{ template: "residential_lease", lease: { deposit: -1 } }, /ودیعه.*نمی‌تواند منفی باشد/],
    [{ template: "residential_lease", lease: { startDate: "فردا" } }, /تاریخ شروع نامعتبر است/],
    [
      { template: "residential_lease", lease: { startDate: "1405-07-01", endDate: "1405-06-01" } },
      /تاریخ پایان باید بعد از تاریخ شروع باشد/,
    ],
    [
      { template: "temporary_employment", employment: { probationMonths: 6 } },
      /دورهٔ آزمایشی حداکثر سه ماه است/,
    ],
    [{ template: "temporary_employment", employment: { paymentDay: 40 } }, /روز پرداخت/],
    [{}, /[آ-ی]/],
  ];
  for (const [input, message] of cases)
    assert.throws(
      () => prepareContract(input, { now: NOW }),
      (error: Error) => error instanceof DocumentError && message.test(error.message),
      JSON.stringify(input),
    );
  // An end date without a duration still yields the duration in months.
  const derived = prepareContract({
    template: "residential_lease",
    lease: { startDate: "1405-07-01", endDate: "1406-01-01" },
  });
  assert.match(derived.html, /مدت اجاره <strong>۶<\/strong> ماه/);
});

test("create_contract saves through Files.createPdf and relays errors", async () => {
  const names: string[] = [];
  const files = {
    async createPdf(_owner: string, name: string) {
      names.push(name);
      return { id: "file-2", name: `${name}.pdf`, pageCount: 2 } as Artifact;
    },
  };
  const [, contractTool] = templateDocumentTools(files, "owner") as unknown as {
    execute: (args: unknown) => Promise<Record<string, unknown>>;
  }[];
  assert.deepEqual(await contractTool.execute(lease), {
    id: "file-2",
    name: "اجاره‌نامهٔ مسکونی سارا رضایی.pdf",
    pageCount: 2,
    template: "residential_lease",
  });
  assert.match(String((await contractTool.execute({ template: "x" })).error), /نوع قرارداد/);
  assert.equal(names.length, 1);
});

test("the lease renders to a non-empty PDF", { timeout: 90_000 }, async (t) => {
  const contract = prepareContract(lease, { now: NOW });
  const bytes = await renderOrSkip(t, contract.html, contract.title);
  if (!bytes) return;
  assert(bytes.length > 1000);
  const text = Buffer.from(bytes).toString("latin1");
  assert.equal(text.slice(0, 5), "%PDF-");
  assert.match(text, /\/FontName\s*\/[A-Z]{6}\+Vazirmatn/);
});
