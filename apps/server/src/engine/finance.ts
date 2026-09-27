import { z } from "zod";

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

/** CSV amounts use positive expenses and negative income. No currency conversion is inferred. */
export function analyzeSpending(csv: string) {
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
  const expenses = transactions.filter((t) => t.cents > 0).reduce((n, t) => n + t.cents, 0),
    income = -transactions.filter((t) => t.cents < 0).reduce((n, t) => n + t.cents, 0);
  const grouped = new Map<string, number>();
  for (const t of transactions)
    if (t.cents > 0) grouped.set(t.category, (grouped.get(t.category) ?? 0) + t.cents);
  const categories = [...grouped]
    .map(([name, cents]) => ({ name, amount: cents / 100 }))
    .sort((a, b) => b.amount - a.amount);
  return {
    income: income / 100,
    spending: expenses / 100,
    saved: (income - expenses) / 100,
    count: transactions.length,
    categories,
    transactions: transactions.map(({ cents, ...t }) => t),
    period: {
      from: transactions.map((t) => t.date).sort()[0],
      to: transactions
        .map((t) => t.date)
        .sort()
        .at(-1),
    },
    amountConvention:
      "هزینه‌ها مثبت و درآمدها منفی هستند. مقادیر به واحد پول فایل اصلی‌اند و تبدیل ارزی انجام نمی‌شود.",
  };
}
