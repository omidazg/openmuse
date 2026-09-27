import { z } from "zod";
import { toLatinDigits } from "../../../../packages/domain/src/index.ts";
import {
  formatJalali,
  gregorianToJalali,
  jalaliMonthLength,
  jalaliToGregorian,
  tehranDate,
} from "../../../../packages/domain/src/iran-holidays.ts";
import { escapeHtml } from "../../../../packages/integrations/src/pdf-html.ts";

export { escapeHtml };

/** A Persian, user-facing problem with a document request (bad totals, dates and so on). */
export class DocumentError extends Error {
  override name = "DocumentError";
}

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
/** Latin digits in visible text become Persian digits. */
export function faDigits(value: string | number): string {
  return String(value).replace(/\d/g, (digit) => PERSIAN_DIGITS[Number(digit)]);
}
/** «۱۲٬۵۰۰» and «۲٫۵»: Persian digits with Persian separators. */
export function faNumber(value: number, maximumFractionDigits = 3): string {
  return new Intl.NumberFormat("fa-IR", { maximumFractionDigits }).format(value);
}
/** «۱۲٬۰۰۰ تومان». */
export function faMoney(toman: number): string {
  return `${faNumber(toman, 0)} تومان`;
}
/** «۱۰٪». */
export function faPercent(value: number): string {
  return `${faNumber(value, 2)}٪`;
}

/**
 * A calendar day typed as `YYYY-MM-DD` (Latin or Persian digits, `-` or `/`), Jalali
 * when the year is before 1700 (e.g. 1405-07-01), otherwise Gregorian. Returns the
 * Gregorian `YYYY-MM-DD` used for storage, or throws a Persian DocumentError.
 */
export function parseDay(value: string, label: string): string {
  const match = /^\s*(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s*$/.exec(toLatinDigits(value));
  const invalid = new DocumentError(
    `${label} نامعتبر است. تاریخ را به شکل ۱۴۰۵/۰۷/۰۱ (شمسی) یا 2026-09-23 (میلادی) بنویسید.`,
  );
  if (!match) throw invalid;
  const [year, month, day] = match.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1) throw invalid;
  if (year < 1700) {
    if (year < 1300 || day > jalaliMonthLength(year, month)) throw invalid;
    return jalaliToGregorian(year, month, day);
  }
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) throw invalid;
  return iso;
}

/** Today's calendar day in Tehran (Gregorian `YYYY-MM-DD`). */
export function today(now = new Date()): string {
  return tehranDate(now);
}

/** «۵ مهر ۱۴۰۵» for a Gregorian `YYYY-MM-DD`. */
export function jalaliDay(date: string): string {
  return formatJalali(date, false);
}

/** The same Jalali day `months` later, clamped to the month's last day. */
export function addJalaliMonths(date: string, months: number): string {
  const { year, month, day } = gregorianToJalali(date);
  const index = month - 1 + months;
  const targetYear = year + Math.floor(index / 12);
  const targetMonth = (((index % 12) + 12) % 12) + 1;
  return jalaliToGregorian(
    targetYear,
    targetMonth,
    Math.min(day, jalaliMonthLength(targetYear, targetMonth)),
  );
}

/** Jalali `YYYYMMDD` (Latin digits) for invoice numbers. */
export function jalaliCompact(date: string): string {
  const { year, month, day } = gregorianToJalali(date);
  return `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}

/** Trimmed text, or undefined when empty or missing. */
export function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Escaped visible text; digits become Persian. */
export function text(value: string): string {
  return escapeHtml(faDigits(value));
}

/**
 * Phone numbers, national IDs and similar codes: Persian digits, kept left-to-right so
 * «۰۲۱-۸۸۱۲۳۴۵۶» and «+۹۸ ۹۱۲…» read in the right order.
 */
export function code(value: string): string {
  return `<span dir="ltr" class="code">${escapeHtml(faDigits(toLatinDigits(value)))}</span>`;
}

/** An empty dotted line to fill in by hand where information is missing. */
export function blank(width: "short" | "medium" | "long" = "medium"): string {
  return `<span class="blank ${width}"></span>`;
}

/** A value, or a blank line when it is missing. */
export function fill(
  value: string | undefined,
  width: "short" | "medium" | "long" = "medium",
): string {
  const content = present(value);
  return content ? `<strong>${text(content)}</strong>` : blank(width);
}

/** Print CSS shared by invoices and contracts (the worker adds Vazirmatn, RTL and A4). */
export const documentStyle = `<style>
.doc-title { text-align: center; font-size: 19pt; margin: 0 0 4pt; line-height: 1.4 }
.doc-meta { display: flex; justify-content: space-between; gap: 12pt; font-size: 10pt; color: #394245; margin-bottom: 10pt; padding-bottom: 6pt; border-bottom: 1pt solid #dde3e6 }
.code { unicode-bidi: isolate; white-space: nowrap }
.blank { display: inline-block; vertical-align: baseline; border-bottom: 0.75pt dotted #6b7478; height: 1.1em }
.blank.short { width: 60pt }
.blank.medium { width: 120pt }
.blank.long { width: 220pt }
.box { border: 0.75pt solid #cfd6d9; border-radius: 4pt; padding: 6pt 9pt }
.box h2 { font-size: 11pt; margin: 0 0 3pt }
.box p { margin: 0; font-size: 10pt; line-height: 1.75 }
.signs { display: flex; gap: 12pt; margin-top: 16pt; break-inside: avoid }
.sign { flex: 1; border: 0.75pt solid #cfd6d9; border-radius: 4pt; height: 78pt; padding: 6pt 9pt; font-size: 10pt; color: #394245 }
.disclaimer { margin-top: 16pt; border: 1pt solid #b45309; background: #fff7ed; border-radius: 4pt; padding: 7pt 10pt; font-size: 10pt; line-height: 1.8; break-inside: avoid }
</style>`;

/** Signature and stamp boxes, one per label. */
export function signBoxes(labels: string[]): string {
  return `<div class="signs">${labels.map((label) => `<div class="sign">${escapeHtml(label)}</div>`).join("")}</div>`;
}

/** Persian messages for every schema issue, including zod's built-in checks. */
const persianLocale = z.locales.fa();

/** Parses tool input with Persian validation messages; throws a DocumentError listing them. */
export function parseInput<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value, { error: persianLocale.localeError });
  if (result.success) return result.data;
  const messages = [...new Set(result.error.issues.map((issue) => issue.message))];
  throw new DocumentError(messages.slice(0, 6).join(" "));
}
