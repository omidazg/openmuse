import { z } from "zod";
import { toLatinDigits } from "../../../../packages/domain/src/index.ts";
import {
  gregorianToJalali,
  JALALI_MONTHS,
  tehranDate,
} from "../../../../packages/domain/src/iran-holidays.ts";
import { type BankCurrency, parseBankStatement } from "./bank-statement.ts";

const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
/** Replaces Latin digits in user-visible prose with Persian digits. */
export function faDigits(value: string | number) {
  return String(value).replace(/\d/g, (digit) => persianDigits[Number(digit)]);
}
/** Formats a number for Persian prose: Persian digits, «٬» thousands and «٫» decimals. */
export function faNumber(value: number, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("fa-IR", { maximumFractionDigits }).format(value);
}
/** Formats an ISO date as a Jalali date in Tehran time for user-visible text. */
export function faDate(iso: string | undefined) {
  const value = iso ? new Date(iso) : undefined;
  if (!value || Number.isNaN(value.getTime())) return iso ?? "";
  return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(value);
}

/** Simple CSV (date, description, amount, category): positive expenses, negative income. */
function parseSimpleCsv(csv: string) {
  if (csv.length > 500000)
    throw new Error("فایل CSV تراکنش‌ها بیش از ۵۰۰ کیلوبایت است. فایل کوچک‌تری وارد کنید.");
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i <= csv.length; i++) {
    const c = csv[i];
    if (c === '"') {
      if (quoted && csv[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (!quoted && cell.length)
        throw new Error("یک فیلد داخل گیومه در CSV نامعتبر است. قالب فایل را بررسی کنید.");
      else quoted = !quoted;
    } else if (!quoted && (c === "," || c === "\n" || c === undefined)) {
      row.push(cell.replace(/\r$/, ""));
      cell = "";
      if (c !== ",") {
        if (row.some((v) => v.trim())) rows.push(row);
        row = [];
      }
    } else if (c !== undefined) cell += c;
  }
  if (quoted) throw new Error("یک گیومه در CSV بسته نشده است. قالب فایل را بررسی کنید.");
  const header = rows.shift()?.map((v) => v.trim().toLowerCase());
  if (!header || !["date", "description", "amount", "category"].every((v) => header.includes(v)))
    throw new Error(
      "ستون‌های لازم در CSV پیدا نشد. ستون‌های date، description، amount و category را اضافه کنید.",
    );
  if (!rows.length || rows.length > 5000)
    throw new Error("تعداد تراکنش‌ها مجاز نیست. بین ۱ تا ۵٬۰۰۰ تراکنش وارد کنید.");
  const transactions = rows.map((r, index) => {
    const get = (name: string) => r[header.indexOf(name)]?.trim() ?? "";
    if (r.length !== header.length)
      throw new Error(
        `تعداد ستون‌های ردیف ${faNumber(index + 2)} نادرست است. آن ردیف را اصلاح کنید.`,
      );
    const date = get("date"),
      amount = get("amount");
    if (!z.iso.date().safeParse(date).success || !/^[-+]?\d+(?:\.\d{1,2})?$/.test(amount))
      throw new Error(
        `ردیف ${faNumber(index + 2)} نامعتبر است. تاریخ را به شکل ISO و مبلغ را ساده و با حداکثر دو رقم اعشار بنویسید.`,
      );
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isSafeInteger(cents) || Math.abs(cents) > 1e12)
      throw new Error("مبلغ یک تراکنش خارج از محدوده است. مبلغ‌ها را بررسی کنید.");
    return {
      id: `row-${index + 2}`,
      date,
      description: get("description"),
      amount: cents / 100,
      category: get("category") || "بدون دسته‌بندی",
      cents,
    };
  });
  return transactions;
}

export interface SpendingOptions {
  /** "current" (this Jalali month in Tehran), "previous", "all" or a Jalali month like "1405-07". */
  month?: string;
  /** Overrides the currency detected in a bank statement (default Rial). */
  currency?: BankCurrency;
  /** Clock used for "current" and "previous" (tests). */
  now?: Date;
}

const simpleHeader = ["date", "description", "amount", "category"];

/** Jalali year and month selected by a month option, or undefined for the whole file. */
export function resolveJalaliMonth(month: string | undefined, now = new Date()) {
  const value = toLatinDigits(month ?? "")
    .trim()
    .toLowerCase();
  if (!value || value === "all") return undefined;
  const today = gregorianToJalali(tehranDate(now));
  if (value === "current") return { year: today.year, month: today.month };
  if (value === "previous")
    return today.month === 1
      ? { year: today.year - 1, month: 12 }
      : { year: today.year, month: today.month - 1 };
  const match = /^(1[34]\d{2})\s*[-/]\s*(\d{1,2})$/.exec(value);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12)
    throw new Error(
      "ماه درخواستی نامعتبر است. ماه را به شکل ۱۴۰۵-۰۷ بنویسید یا «این ماه» را انتخاب کنید.",
    );
  return { year: Number(match[1]), month: Number(match[2]) };
}

/**
 * Spending summary of imported transactions. Accepts the simple CSV format (date,
 * description, amount, category) or, as a fallback, a statement exported from an Iranian
 * bank (CSV text, Excel text from `extractDocumentText`, or rows of cells). Expenses are
 * positive and income negative. Bank statement amounts are reported in Toman.
 */
export function analyzeSpending(input: string | string[][], options: SpendingOptions = {}) {
  const firstLine =
    typeof input === "string"
      ? (input
          .replace(/^\ufeff/, "")
          .split(/\r?\n/)
          .find((line) => line.trim()) ?? "")
      : "";
  const simple = firstLine.split(",").map((v) => v.trim().replace(/^"|"$/g, "").toLowerCase());
  const isSimple =
    typeof input === "string" && simpleHeader.every((column) => simple.includes(column));
  const statement = isSimple ? undefined : parseBankStatement(input, options);
  let transactions: (ReturnType<typeof parseSimpleCsv>[number] & { time?: string })[] = isSimple
    ? parseSimpleCsv(input as string)
    : (statement?.transactions ?? []).map((t) => ({
        id: t.id,
        date: t.date,
        ...(t.time ? { time: t.time } : {}),
        description: t.description,
        amount: t.amount,
        category: t.category,
        cents: Math.round(t.amount * 100),
      }));
  const selected = resolveJalaliMonth(options.month, options.now);
  const month = selected && {
    ...selected,
    label: `${JALALI_MONTHS[selected.month - 1]} ${faDigits(selected.year)}`,
  };
  if (month) {
    const all = transactions;
    transactions = all.filter((t) => {
      const jalali = gregorianToJalali(t.date);
      return jalali.year === month.year && jalali.month === month.month;
    });
    if (!transactions.length) {
      const dates = all.map((t) => t.date).sort();
      throw new Error(
        `در این فایل تراکنشی برای ${month.label} نیست. تراکنش‌های فایل از ${faDate(dates[0])} تا ${faDate(dates.at(-1))} است؛ ماه دیگری انتخاب کنید یا صورت‌حساب این ماه را بارگذاری کنید.`,
      );
    }
  }
  const expenses = transactions.filter((t) => t.cents > 0).reduce((n, t) => n + t.cents, 0),
    income = transactions.filter((t) => t.cents < 0).reduce((n, t) => n - t.cents, 0);
  const group = (sign: 1 | -1) => {
    const grouped = new Map<string, number>();
    for (const t of transactions)
      if (t.cents * sign > 0)
        grouped.set(t.category, (grouped.get(t.category) ?? 0) + t.cents * sign);
    return [...grouped]
      .map(([name, cents]) => ({ name, amount: cents / 100 }))
      .sort((a, b) => b.amount - a.amount);
  };
  const dates = transactions.map((t) => t.date).sort();
  return {
    income: income / 100,
    spending: expenses / 100,
    saved: (income - expenses) / 100,
    count: transactions.length,
    categories: group(1),
    transactions: transactions.map(({ cents, ...t }) => t),
    period: { from: dates[0], to: dates.at(-1) },
    amountConvention: statement
      ? "هزینه‌ها مثبت و درآمدها منفی هستند. همهٔ مبلغ‌ها به تومان‌اند."
      : "هزینه‌ها مثبت و درآمدها منفی هستند. مقادیر به واحد پول فایل اصلی‌اند و تبدیل ارزی انجام نمی‌شود.",
    source: statement ? ("bank-statement" as const) : ("simple-csv" as const),
    incomeCategories: group(-1),
    ...(month ? { month } : {}),
    ...(statement
      ? {
          currency: "toman" as const,
          currencyNote: statement.currencyNote,
          notes: statement.notes,
          skippedRows: statement.skippedRows,
        }
      : {}),
  };
}
