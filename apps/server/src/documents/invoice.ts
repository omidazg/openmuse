import { randomInt } from "node:crypto";
import { z } from "zod";
import {
  code,
  DocumentError,
  documentStyle,
  escapeHtml,
  faDigits,
  faMoney,
  faNumber,
  faPercent,
  jalaliCompact,
  jalaliDay,
  parseDay,
  parseInput,
  present,
  signBoxes,
  text,
  today,
} from "./format.ts";
import { MAX_PERSIAN_WORDS, numberToPersianWords } from "./num-to-words.ts";

/**
 * Default VAT (مالیات بر ارزش افزوده) rate in percent. Iran's rate is set by law and
 * can change every Jalali year (the annual budget law); 10% applied in recent years.
 * Check it at the start of each year and update this constant.
 */
export const DEFAULT_VAT_PERCENT = 10;

/** Upper bound for one line or the whole invoice, so the total still has Persian words. */
const MAX_TOMAN = 1_000_000_000_000_000 - 1;
const needed = (label: string) => `${label} را وارد کنید.`;

const partySchema = (role: string) =>
  z.object({
    name: z
      .string({ error: needed(`نام ${role}`) })
      .trim()
      .min(1, needed(`نام ${role}`))
      .max(160, `نام ${role} حداکثر ۱۶۰ نویسه است.`),
    phone: z.string().max(40, `شمارهٔ تلفن ${role} حداکثر ۴۰ نویسه است.`).optional(),
    address: z.string().max(400, `نشانی ${role} حداکثر ۴۰۰ نویسه است.`).optional(),
    nationalId: z
      .string()
      .max(30, `شناسه یا کد ملی ${role} حداکثر ۳۰ نویسه است.`)
      .optional()
      .describe("کد ملی (person) or شناسهٔ ملی (company)"),
    economicCode: z.string().max(30, `کد اقتصادی ${role} حداکثر ۳۰ نویسه است.`).optional(),
  });

export const invoiceItemSchema = z.object({
  title: z
    .string({ error: needed("شرح هر ردیف") })
    .trim()
    .min(1, needed("شرح هر ردیف"))
    .max(200, "شرح هر ردیف حداکثر ۲۰۰ نویسه است."),
  quantity: z
    .number({ error: "تعداد هر ردیف باید یک عدد باشد." })
    .positive("تعداد هر ردیف باید بیشتر از صفر باشد.")
    .max(1_000_000, "تعداد هر ردیف حداکثر ۱٬۰۰۰٬۰۰۰ است."),
  unit: z
    .string()
    .max(30, "واحد هر ردیف حداکثر ۳۰ نویسه است.")
    .optional()
    .describe("Unit in Persian, e.g. عدد، کیلوگرم، متر، ساعت"),
  unitPrice: z
    .number({ error: "مبلغ واحد هر ردیف باید یک عدد به تومان باشد." })
    .int("مبلغ واحد را به تومان و بدون اعشار بنویسید.")
    .min(0, "مبلغ واحد نمی‌تواند منفی باشد.")
    .max(MAX_TOMAN, "مبلغ واحد بیش از حد بزرگ است.")
    .describe("Unit price in Toman (not Rial), whole number"),
});

export const invoiceInputSchema = z.object({
  seller: partySchema("فروشنده"),
  buyer: partySchema("خریدار"),
  items: z
    .array(invoiceItemSchema, { error: "دست‌کم یک ردیف کالا یا خدمت وارد کنید." })
    .min(1, "دست‌کم یک ردیف کالا یا خدمت وارد کنید.")
    .max(100, "پیش‌فاکتور حداکثر ۱۰۰ ردیف دارد."),
  discount: z
    .object({
      type: z.enum(["amount", "percent"], {
        error: "نوع تخفیف باید مبلغ (amount) یا درصد (percent) باشد.",
      }),
      value: z
        .number({ error: "مقدار تخفیف باید یک عدد باشد." })
        .min(0, "تخفیف نمی‌تواند منفی باشد."),
    })
    .refine((discount) => discount.type !== "percent" || discount.value <= 100, {
      message: "درصد تخفیف نمی‌تواند بیشتر از ۱۰۰ باشد.",
    })
    .optional()
    .describe("amount = Toman off the subtotal; percent = 0-100"),
  vat: z
    .boolean({ error: "vat باید true یا false باشد." })
    .optional()
    .describe("Add VAT on the discounted subtotal. Default false."),
  vatPercent: z
    .number({ error: "نرخ مالیات بر ارزش افزوده باید یک عدد باشد." })
    .min(0, "نرخ مالیات بر ارزش افزوده نمی‌تواند منفی باشد.")
    .max(30, "نرخ مالیات بر ارزش افزوده بیش از حد بزرگ است.")
    .optional()
    .describe(`VAT rate in percent when it differs from the default ${DEFAULT_VAT_PERCENT}`),
  notes: z.string().max(2000, "توضیحات حداکثر ۲۰۰۰ نویسه است.").optional(),
  number: z
    .string()
    .max(40, "شمارهٔ پیش‌فاکتور حداکثر ۴۰ نویسه است.")
    .optional()
    .describe("Invoice number; generated from the Jalali date when missing"),
  date: z
    .string()
    .max(20, "تاریخ پیش‌فاکتور نامعتبر است.")
    .optional()
    .describe("YYYY-MM-DD, Jalali (1405-07-05) or Gregorian; default today in Tehran"),
  validDays: z
    .number({ error: "مدت اعتبار باید تعداد روز باشد." })
    .int("مدت اعتبار را به روز و بدون اعشار بنویسید.")
    .min(1, "مدت اعتبار دست‌کم یک روز است.")
    .max(365, "مدت اعتبار حداکثر ۳۶۵ روز است.")
    .optional()
    .describe("How many days the quoted prices stay valid"),
});

export type InvoiceInput = z.output<typeof invoiceInputSchema>;

export interface InvoiceTotals {
  lines: { title: string; quantity: number; unit?: string; unitPrice: number; total: number }[];
  subtotal: number;
  discount: number;
  /** Percent shown next to the discount line, when the discount was given as a percent. */
  discountPercent?: number;
  taxable: number;
  vatPercent: number;
  vat: number;
  total: number;
}

/** Rounds to a whole Toman (half up; amounts are never negative). */
const toman = (value: number) => Math.round(value);

/** Line totals, discount, VAT and the payable amount, each rounded to a whole Toman. */
export function invoiceTotals(
  input: Pick<InvoiceInput, "items" | "discount" | "vat" | "vatPercent">,
): InvoiceTotals {
  const lines = input.items.map((item) => ({
    title: item.title.trim(),
    quantity: item.quantity,
    unit: present(item.unit),
    unitPrice: item.unitPrice,
    total: toman(item.quantity * item.unitPrice),
  }));
  const subtotal = lines.reduce((sum, line) => sum + line.total, 0);
  const discount = !input.discount
    ? 0
    : input.discount.type === "percent"
      ? toman((subtotal * input.discount.value) / 100)
      : toman(input.discount.value);
  if (discount > subtotal)
    throw new DocumentError(
      `تخفیف (${faMoney(discount)}) از جمع اقلام (${faMoney(subtotal)}) بیشتر است. مبلغ تخفیف را اصلاح کنید.`,
    );
  const taxable = subtotal - discount;
  const vatPercent = input.vat ? (input.vatPercent ?? DEFAULT_VAT_PERCENT) : 0;
  const vat = toman((taxable * vatPercent) / 100);
  const total = taxable + vat;
  if (total > MAX_PERSIAN_WORDS)
    throw new DocumentError("جمع پیش‌فاکتور بیش از حد بزرگ است. مبالغ را بررسی کنید.");
  return {
    lines,
    subtotal,
    discount,
    ...(input.discount?.type === "percent" ? { discountPercent: input.discount.value } : {}),
    taxable,
    vatPercent,
    vat,
    total,
  };
}

/** A validated invoice ready to render: number, Gregorian date and totals. */
export interface Invoice {
  input: InvoiceInput;
  number: string;
  date: string;
  validUntil?: string;
  totals: InvoiceTotals;
}

/** Validates raw tool input (Persian errors) and computes the invoice. */
export function prepareInvoice(
  raw: unknown,
  options: { now?: Date; random?: () => number } = {},
): Invoice {
  const input = parseInput(invoiceInputSchema, raw);
  const day = present(input.date);
  const date = day ? parseDay(day, "تاریخ پیش‌فاکتور") : today(options.now);
  const totals = invoiceTotals(input);
  const serial = options.random ? options.random() : randomInt(100, 1000);
  const number = present(input.number) ?? `${jalaliCompact(date)}-${serial}`;
  const validUntil = input.validDays
    ? new Date(Date.parse(`${date}T00:00:00Z`) + input.validDays * 86_400_000)
        .toISOString()
        .slice(0, 10)
    : undefined;
  return { input, number, date, ...(validUntil ? { validUntil } : {}), totals };
}

const invoiceStyle = `<style>
.parties { display: flex; gap: 10pt; margin-bottom: 10pt }
.parties .box { flex: 1 }
table.items th, table.items td { vertical-align: middle }
table.items .n { text-align: center; white-space: nowrap }
table.items .m { text-align: end; white-space: nowrap }
table.items th.row { width: 22pt }
table.totals { width: 58%; margin-inline-start: auto; margin-top: 0 }
table.totals th { width: 55%; background: #f1f4f5; font-weight: 400 }
table.totals td { text-align: end; white-space: nowrap }
table.totals tr.grand th, table.totals tr.grand td { font-weight: 700; background: #e7eef0 }
.words { margin: 4pt 0 10pt; font-size: 10.5pt }
.notes { margin-bottom: 8pt }
.notes p { white-space: pre-wrap }
</style>`;

function partyBox(title: string, party: InvoiceInput["seller"]): string {
  const rows = [
    `<p>نام: <strong>${text(party.name)}</strong></p>`,
    present(party.nationalId) ? `<p>شناسه یا کد ملی: ${code(party.nationalId as string)}</p>` : "",
    present(party.economicCode) ? `<p>کد اقتصادی: ${code(party.economicCode as string)}</p>` : "",
    present(party.phone) ? `<p>تلفن: ${code(party.phone as string)}</p>` : "",
    present(party.address) ? `<p>نشانی: ${text(party.address as string)}</p>` : "",
  ];
  return `<div class="box"><h2>${escapeHtml(title)}</h2>${rows.join("")}</div>`;
}

/** Print HTML fragment for a proforma invoice (A4, RTL, Persian digits). */
export function invoiceHtml(invoice: Invoice): string {
  const { input, totals } = invoice;
  const rows = totals.lines
    .map(
      (line, index) =>
        `<tr><td class="n">${faNumber(index + 1)}</td><td>${text(line.title)}</td><td class="n">${faNumber(line.quantity)}${line.unit ? ` ${text(line.unit)}` : ""}</td><td class="m">${faNumber(line.unitPrice, 0)}</td><td class="m">${faNumber(line.total, 0)}</td></tr>`,
    )
    .join("");
  const summary: [string, number, boolean?][] = [["جمع اقلام", totals.subtotal]];
  if (totals.discount)
    summary.push([
      totals.discountPercent !== undefined
        ? `تخفیف (${faPercent(totals.discountPercent)})`
        : "تخفیف",
      totals.discount,
    ]);
  if (totals.discount && totals.vatPercent) summary.push(["مبلغ پس از تخفیف", totals.taxable]);
  if (totals.vatPercent)
    summary.push([`مالیات بر ارزش افزوده (${faPercent(totals.vatPercent)})`, totals.vat]);
  summary.push(["مبلغ قابل پرداخت", totals.total, true]);
  return [
    documentStyle,
    invoiceStyle,
    `<h1 class="doc-title">پیش‌فاکتور</h1>`,
    `<div class="doc-meta"><span>شمارهٔ پیش‌فاکتور: ${code(invoice.number)}</span><span>تاریخ: ${escapeHtml(jalaliDay(invoice.date))}</span></div>`,
    `<div class="parties">${partyBox("فروشنده", input.seller)}${partyBox("خریدار", input.buyer)}</div>`,
    `<table class="items"><thead><tr><th class="row n">ردیف</th><th>شرح کالا یا خدمت</th><th class="n">تعداد</th><th class="m">مبلغ واحد (تومان)</th><th class="m">مبلغ کل (تومان)</th></tr></thead><tbody>${rows}</tbody></table>`,
    `<table class="totals"><tbody>${summary
      .map(
        ([label, value, grand]) =>
          `<tr${grand ? ' class="grand"' : ""}><th>${escapeHtml(label)}</th><td>${faMoney(value)}</td></tr>`,
      )
      .join("")}</tbody></table>`,
    `<p class="words">مبلغ به حروف: <strong>${escapeHtml(numberToPersianWords(totals.total))} تومان</strong></p>`,
    invoice.validUntil
      ? `<p class="words">این پیش‌فاکتور تا ${escapeHtml(jalaliDay(invoice.validUntil))} معتبر است.</p>`
      : "",
    present(input.notes)
      ? `<div class="box notes"><h2>توضیحات</h2><p>${text(input.notes as string)}</p></div>`
      : "",
    signBoxes(["مهر و امضای فروشنده", "مهر و امضای خریدار"]),
  ].join("\n");
}

/** File title such as «پیش‌فاکتور ۱۴۰۵۰۷۰۵-۴۸۲ علی رضایی». */
export function invoiceTitle(invoice: Invoice): string {
  return `پیش‌فاکتور ${faDigits(invoice.number)} ${invoice.input.buyer.name.trim()}`.slice(0, 150);
}
