import { type Artifact, toLatinDigits } from "../../../../packages/domain/src/index.ts";
import {
  jalaliMonthLength,
  jalaliToGregorian,
} from "../../../../packages/domain/src/iran-holidays.ts";
import { DOCUMENT_TYPES } from "../../../../packages/integrations/src/office.ts";

/**
 * Tolerant parser for statements exported from Iranian banks (CSV text, or the text that
 * `extractDocumentText` produces for Excel files: «## name» sheet headings followed by
 * tab-separated rows). Header names, digits, date formats and layouts are recognized
 * heuristically; no bank's exact export format is assumed.
 */

export type BankCurrency = "rial" | "toman";
export type BankColumn =
  | "date"
  | "time"
  | "description"
  | "debit"
  | "credit"
  | "amount"
  | "balance"
  | "reference"
  | "type";

export interface BankTransaction {
  id: string;
  /** Gregorian `YYYY-MM-DD`. */
  date: string;
  /** `HH:MM` when the export has a time. */
  time?: string;
  description: string;
  /** Toman. Expenses are positive and income negative, like `analyzeSpending`. */
  amount: number;
  kind: "expense" | "income";
  category: string;
  /** Toman. */
  balance?: number;
  reference?: string;
}

export interface BankStatement {
  transactions: BankTransaction[];
  /** Currency of the amounts in the file; results are always in Toman. */
  sourceCurrency: BankCurrency;
  currencyNote: string;
  /** Persian notes about assumptions made while reading the file. */
  notes: string[];
  /** Original header text for each recognized column. */
  columns: Partial<Record<BankColumn, string>>;
  /** 1-based row of the header within its sheet or file. */
  headerRow: number;
  sheet?: string;
  skippedRows: number;
}

export interface BankStatementOptions {
  /** Overrides the currency detected from the file (default Rial). */
  currency?: BankCurrency;
}

export class BankStatementError extends Error {
  readonly status = 422;
  constructor(message: string) {
    super(message);
    this.name = "BankStatementError";
  }
}

const MAX_CHARS = 2_000_000;
const MAX_TRANSACTIONS = 5000;
const HEADER_SEARCH_ROWS = 20;

const fa = (value: number) => new Intl.NumberFormat("fa-IR").format(value);

const INVISIBLE = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff\u0640]/g;

/** Latin digits, Persian ی/ک, no bidi marks or tatweel, trimmed. */
function clean(value: string | undefined): string {
  return toLatinDigits(value ?? "")
    .replace(INVISIBLE, "")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\u00a0/g, " ")
    .trim();
}

/** Lower-case words separated by single spaces (ZWNJ and punctuation become spaces). */
function words(value: string | undefined): string {
  return clean(value)
    .toLowerCase()
    .replace(/[\u200c\s_\-.:()[\]«»"'/\\*#]+/g, " ")
    .trim();
}

const HEADER_RULES: [BankColumn, RegExp][] = [
  ["balance", /مانده|موجودی|\bbalance\b/],
  ["date", /^تاریخ|^(?:transaction |posting |value )?date\b/],
  ["time", /^(?:ساعت|زمان)|^time\b/],
  ["debit", /بدهکار|برداشت|\bdebit\b|withdraw/],
  ["credit", /بستانکار|واریز|\bcredit\b|deposit/],
  [
    "description",
    /^(?:شرح|توضیح|بابت|عنوان|جزئیات)|description|narration|details|particulars|^memo/,
  ],
  ["reference", /سند|پیگیری|مرجع|ارجاع|شماره تراکنش|کد تراکنش|\bref(?:erence)?\b|tracking/],
  ["type", /^نوع|\btype\b/],
  ["amount", /مبلغ|amount|^value$/],
];

type ColumnMap = Partial<Record<BankColumn, number>>;

function mapHeader(row: string[]): ColumnMap {
  const map: ColumnMap = {};
  row.forEach((cell, index) => {
    const key = words(cell);
    // Header cells are short labels; skip title text such as «از تاریخ ۱۴۰۵/۰۶/۰۱».
    if (!key || key.length > 40 || /\d{3,}/.test(key)) return;
    for (const [role, pattern] of HEADER_RULES)
      if (pattern.test(key)) {
        if (map[role] === undefined) map[role] = index;
        return;
      }
  });
  return map;
}

const hasAmountColumn = (map: ColumnMap) =>
  map.amount !== undefined || map.debit !== undefined || map.credit !== undefined;

/** Split delimited text into rows; the delimiter is detected among tab, semicolon and comma. */
export function parseDelimited(text: string): string[][] {
  const source = text.replace(/^\ufeff/, "");
  const sample = source.split(/\r?\n/).slice(0, 40);
  let delimiter = ",";
  let best = -1;
  for (const candidate of ["\t", ";", ","]) {
    const counts = sample
      .map((line) => countOutsideQuotes(line, candidate))
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
    const score = counts.length ? counts[Math.floor(counts.length / 2)] * counts.length : 0;
    if (score > best) {
      best = score;
      delimiter = candidate;
    }
  }
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i <= source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else if (c !== undefined) cell += c;
      else row.push(cell);
    } else if (c === '"' && !cell.trim()) {
      cell = "";
      quoted = true;
    } else if (c === delimiter) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r" || c === undefined) {
      if (c === "\r" && source[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}

function countOutsideQuotes(line: string, delimiter: string) {
  let count = 0;
  let quoted = false;
  for (const c of line) {
    if (c === '"') quoted = !quoted;
    else if (c === delimiter && !quoted) count++;
  }
  return count;
}

/** Tables in the input: one per Excel sheet («## name» headings), else one CSV table. */
export function splitTables(text: string): { name?: string; rows: string[][] }[] {
  const source = text.replace(/^\ufeff/, "");
  if (!/^## /.test(source)) return [{ rows: parseDelimited(source) }];
  return source
    .split(/^## /m)
    .filter(Boolean)
    .map((section) => {
      const newline = section.indexOf("\n");
      const name = (newline < 0 ? section : section.slice(0, newline)).trim();
      const body = newline < 0 ? "" : section.slice(newline + 1);
      return {
        name,
        rows: body
          .split(/\r?\n/)
          .filter((line) => line.trim() && line.trim() !== "(برگهٔ خالی)")
          .map((line) => line.split("\t")),
      };
    });
}

/**
 * Parse an amount such as «۱٬۲۵۰٬۰۰۰», "1,250,000-", "(1,250,000)" or "-1250000 ریال".
 * Returns undefined for blank or placeholder cells.
 */
export function parseBankAmount(raw: string | undefined): number | undefined {
  let s = clean(raw)
    .toLowerCase()
    .replace(/ریال|تومان|irr|rials?|rls?\.?|toman/g, "")
    .replace(/[\s\u200c]/g, "");
  if (!s || /^[-–—−]+$/.test(s)) return undefined;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/^[-–−]/.test(s)) {
    negative = !negative;
    s = s.slice(1);
  } else if (/[-–−]$/.test(s)) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  s = s
    .replace(/^\+/, "")
    .replace(/[٬،,'’]/g, "")
    .replace(/٫/g, ".");
  if (/^\d{1,3}(?:\.\d{3}){2,}$/.test(s)) s = s.replace(/\./g, "");
  if (!/^\d+(?:\.\d+)?$/.test(s)) return undefined;
  const value = Number(s);
  return negative ? -value : value;
}

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * Parse a Jalali (۱۴۰۵/۰۷/۰۱، 1405-07-01، 05/07/01، 01/07/1405، 14050701) or Gregorian
 * date, optionally with a time. Returns the Gregorian `YYYY-MM-DD` day.
 */
export function parseBankDate(
  raw: string | undefined,
): { date: string; time?: string } | undefined {
  const s = clean(raw);
  if (!s) return undefined;
  const clock = /(?<!\d)(\d{1,2}):(\d{2})(?::\d{2})?(?!\d)/.exec(s);
  const rest = clock ? s.replace(clock[0], " ") : s;
  let year: string;
  let month: string;
  let day: string;
  const parts = /(?<!\d)(\d{1,4})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,4})(?!\d)/.exec(rest);
  if (parts) {
    const [, a, b, c] = parts;
    if (a.length === 4 || (a.length === 2 && c.length <= 2)) [year, month, day] = [a, b, c];
    else if (c.length === 4) [day, month, year] = [a, b, c];
    else return undefined;
  } else {
    const compact = /(?<!\d)(1[34]\d{2}|20\d{2})(\d{2})(\d{2})(?!\d)/.exec(rest);
    if (!compact) return undefined;
    [, year, month, day] = compact;
  }
  let y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (year.length === 2) y += y < 60 ? 1400 : 1300;
  else if (year.length !== 4) return undefined;
  if (m < 1 || m > 12 || d < 1) return undefined;
  let date: string;
  if (y >= 1300 && y < 1500) {
    if (d > jalaliMonthLength(y, m)) return undefined;
    date = jalaliToGregorian(y, m, d);
  } else if (y >= 1900 && y <= 2100) {
    date = `${y}-${pad(m)}-${pad(d)}`;
    if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return undefined;
  } else return undefined;
  const hours = clock ? Number(clock[1]) : Number.NaN;
  const time = clock && hours < 24 ? `${pad(hours)}:${clock[2]}` : undefined;
  return time ? { date, time } : { date };
}

const W = (pattern: string) => `(?<![\\p{L}])(?:${pattern})(?![\\p{L}])`;

/** Persian keyword rules in priority order; the first match names the category. */
const CATEGORY_RULES: { name: string; pattern: RegExp }[] = [
  {
    name: "کارمزد بانکی",
    pattern: /کارمزد|هزینه (?:ی )?(?:خدمات|پیامک)|حق اشتراک پیامک|\bfee\b/u,
  },
  { name: "حقوق", pattern: /حقوق|دستمزد|مزایا|salary|payroll/u },
  { name: "اقساط و وام", pattern: new RegExp(`اقساط|قسط|تسهیلات|${W("وام")}|loan`, "u") },
  { name: "اجاره و مسکن", pattern: /اجاره|رهن|شارژ ساختمان|\brent\b/u },
  {
    name: "قبض",
    pattern: new RegExp(
      `قبض|قبوض|آبفا|${W("آب")}|${W("برق")}|${W("گاز")}|مخابرات|${W("تلفن")}|\\bbill`,
      "u",
    ),
  },
  {
    name: "شارژ و اینترنت",
    pattern: /شارژ|بسته (?:ی )?اینترنت|اینترنت(?!ی)|ایرانسل|همراه اول|رایتل|top ?up/u,
  },
  {
    name: "رستوران و کافه",
    pattern: /رستوران|کافه|کافی ?شاپ|فست ?فود|اسنپ ?فود|snapp ?food|پیتزا|restaurant|cafe/u,
  },
  {
    name: "حمل‌ونقل",
    pattern:
      /اسنپ(?! ?(?:فود|مارکت|شاپ))|snapp(?! ?(?:food|market|shop))|تپسی|tapsi|تاکسی|مترو|اتوبوس|بلیت|بلیط|بنزین|سوخت|جایگاه|پارکینگ|عوارض|حمل ?و ?نقل/u,
  },
  {
    name: "درمان و دارو",
    pattern: /داروخانه|دارو|بیمارستان|درمانگاه|کلینیک|پزشک|دندان|آزمایشگاه|pharmacy/u,
  },
  {
    name: "خرید اینترنتی",
    pattern: new RegExp(
      `دیجی ?کالا|digikala|خرید اینترنتی|پرداخت اینترنتی|${W("ترب")}|باسلام|اینترنتی`,
      "u",
    ),
  },
  {
    name: "خرید و فروشگاه",
    pattern:
      /فروشگاه|سوپر ?مارکت|هایپر|اسنپ ?مارکت|افق کوروش|خرید|پایانه فروش|کارتخوان|\bpos\b|purchase/u,
  },
  { name: "برداشت نقدی", pattern: /خودپرداز|برداشت نقدی|عابر ?بانک|\batm\b/u },
  {
    name: "انتقال وجه",
    pattern: new RegExp(`کارت به کارت|انتقال|${W("پایا")}|ساتنا|حواله|${W("شبا")}|transfer`, "u"),
  },
  { name: "سود سپرده", pattern: /سود (?:سپرده|حساب|بانکی)|interest/u },
];

export const OTHER_CATEGORY = "سایر";

/** Category for a bank transaction description; unknown descriptions are «سایر». */
export function categorize(description: string): string {
  const text = words(description);
  return CATEGORY_RULES.find((rule) => rule.pattern.test(text))?.name ?? OTHER_CATEGORY;
}

const INCOME_HINT = /واریز|حقوق|دستمزد|سود|بستانکار|دریافت|deposit|credit|salary/;
const DEBIT_TYPE = /بدهکار|برداشت|خرید|پرداخت|debit|withdraw/;
const CREDIT_TYPE = /بستانکار|واریز|دریافت|credit|deposit/;
const OPENING_ROW = /مانده (?:از قبل|ابتدای دوره|اول دوره|اولیه)|opening balance|جمع کل|^جمع/;

const REQUIRED_COLUMNS =
  "ستون «تاریخ» و ستون مبلغ (یا دو ستون «بدهکار» و «بستانکار»، یا یک ستون «مبلغ»)؛ ستون «شرح» هم برای دسته‌بندی به کار می‌رود";

/** Parse a bank statement from CSV/Excel text or from rows already split into cells. */
export function parseBankStatement(
  input: string | string[][],
  options: BankStatementOptions = {},
): BankStatement {
  if (typeof input === "string" && input.length > MAX_CHARS)
    throw new BankStatementError(
      "فایل صورت‌حساب بزرگ‌تر از حد مجاز است. بازهٔ کوتاه‌تری (مثلاً یک ماه) را از بانک بگیرید و دوباره بارگذاری کنید.",
    );
  const tables = typeof input === "string" ? splitTables(input) : [{ rows: input }];
  if (!tables.some((table) => table.rows.length))
    throw new BankStatementError("فایل صورت‌حساب خالی است. فایل دیگری بارگذاری کنید.");
  let partial: ColumnMap | undefined;
  for (const table of tables) {
    const rows = table.rows.map((row) => row.map((cell) => String(cell ?? "")));
    for (let index = 0; index < Math.min(rows.length, HEADER_SEARCH_ROWS); index++) {
      const map = mapHeader(rows[index]);
      if (map.date !== undefined && hasAmountColumn(map))
        return readRows(rows, index, map, table.name, options);
      if (map.date !== undefined || hasAmountColumn(map)) partial ??= map;
    }
  }
  if (partial?.date !== undefined)
    throw new BankStatementError(
      `ستون تاریخ پیدا شد ولی ستون مبلغ پیدا نشد. صورت‌حساب باید ${REQUIRED_COLUMNS}. نام ستون مبلغ را بررسی کنید.`,
    );
  if (partial)
    throw new BankStatementError(
      `ستون مبلغ پیدا شد ولی ستون «تاریخ» پیدا نشد. صورت‌حساب باید ${REQUIRED_COLUMNS}. نام ستون تاریخ را بررسی کنید.`,
    );
  throw new BankStatementError(
    `سطر عنوان ستون‌ها در ${fa(HEADER_SEARCH_ROWS)} سطر اول فایل پیدا نشد. صورت‌حساب باید ${REQUIRED_COLUMNS}. خروجی Excel یا CSV صورت‌حساب را از بانک بگیرید یا نام ستون‌ها را اصلاح کنید.`,
  );
}

function readRows(
  rows: string[][],
  headerIndex: number,
  map: ColumnMap,
  sheet: string | undefined,
  options: BankStatementOptions,
): BankStatement {
  const header = rows[headerIndex];
  const columns: Partial<Record<BankColumn, string>> = {};
  for (const [role, index] of Object.entries(map) as [BankColumn, number][])
    columns[role] = clean(header[index]);
  const headerHint = currencyHint(header.join(" "));
  const titleHint = currencyHint(
    rows
      .slice(0, headerIndex)
      .map((row) => row.join(" "))
      .join(" "),
  );
  const sourceCurrency = options.currency ?? headerHint ?? titleHint ?? "rial";
  const divisor = sourceCurrency === "rial" ? 10 : 1;
  const notes: string[] = [];
  const separate = map.debit !== undefined || map.credit !== undefined;
  const cell = (row: string[], role: BankColumn) =>
    map[role] === undefined ? "" : (row[map[role] as number] ?? "");
  const body = rows.slice(headerIndex + 1);
  const signed = !separate && body.some((row) => (parseBankAmount(cell(row, "amount")) ?? 0) < 0);
  if (!separate && !signed && map.type === undefined)
    notes.push(
      "فایل ستون جداگانه‌ای برای واریز و برداشت نداشت؛ واریزی بودن هر تراکنش از روی شرح آن تشخیص داده شد.",
    );
  const transactions: BankTransaction[] = [];
  let skippedRows = 0;
  body.forEach((row, offset) => {
    const rowNumber = headerIndex + offset + 2;
    const description = clean(cell(row, "description")).replace(/\s+/g, " ");
    const parsedDate = parseBankDate(cell(row, "date"));
    let value: number | undefined;
    if (separate) {
      const debit = parseBankAmount(cell(row, "debit"));
      const credit = parseBankAmount(cell(row, "credit"));
      if (debit !== undefined || credit !== undefined)
        value = Math.abs(credit ?? 0) - Math.abs(debit ?? 0);
    } else {
      const amount = parseBankAmount(cell(row, "amount"));
      if (amount !== undefined) {
        const type = words(cell(row, "type"));
        if (map.type !== undefined && CREDIT_TYPE.test(type)) value = Math.abs(amount);
        else if (map.type !== undefined && DEBIT_TYPE.test(type)) value = -Math.abs(amount);
        else if (signed) value = amount;
        else value = INCOME_HINT.test(words(description)) ? amount : -amount;
      }
    }
    if (OPENING_ROW.test(words(description)) || OPENING_ROW.test(words(row.join(" ")))) return;
    if (!parsedDate || value === undefined || value === 0) {
      if (value) skippedRows++;
      return;
    }
    if (transactions.length >= MAX_TRANSACTIONS)
      throw new BankStatementError(
        `صورت‌حساب بیش از ${fa(MAX_TRANSACTIONS)} تراکنش دارد. بازهٔ کوتاه‌تری را از بانک بگیرید و دوباره بارگذاری کنید.`,
      );
    const toman = Math.round((Math.abs(value) / divisor) * 100) / 100;
    const kind = value < 0 ? "expense" : "income";
    const balance = parseBankAmount(cell(row, "balance"));
    const reference = clean(cell(row, "reference"));
    const clock = /(?<!\d)(\d{1,2}):(\d{2})/.exec(clean(cell(row, "time")));
    const time =
      parsedDate.time ??
      (clock && Number(clock[1]) < 24 ? `${pad(Number(clock[1]))}:${clock[2]}` : undefined);
    transactions.push({
      id: `row-${rowNumber}`,
      date: parsedDate.date,
      ...(time ? { time } : {}),
      description,
      amount: kind === "expense" ? toman : -toman,
      kind,
      category: categorize(description),
      ...(balance !== undefined ? { balance: Math.round((balance / divisor) * 100) / 100 } : {}),
      ...(reference ? { reference } : {}),
    });
  });
  if (!transactions.length)
    throw new BankStatementError(
      "ستون‌های صورت‌حساب پیدا شد ولی هیچ ردیف تراکنش معتبری زیر آن‌ها نبود. تاریخ‌ها (مثل ۱۴۰۵/۰۷/۰۱) و مبلغ‌ها را بررسی کنید.",
    );
  if (skippedRows)
    notes.push(`${fa(skippedRows)} ردیف به‌دلیل تاریخ نامعتبر خوانده نشد و در محاسبه نیامد.`);
  return {
    transactions,
    sourceCurrency,
    currencyNote:
      sourceCurrency === "rial"
        ? "مبلغ‌های فایل ریالی فرض شد و برای گزارش بر ۱۰ تقسیم و به تومان تبدیل شد."
        : "مبلغ‌های فایل به تومان بود و تبدیلی انجام نشد.",
    notes,
    columns,
    headerRow: headerIndex + 1,
    ...(sheet ? { sheet } : {}),
    skippedRows,
  };
}

function currencyHint(text: string): BankCurrency | undefined {
  const value = words(text);
  if (/تومان|toman/.test(value)) return "toman";
  if (/ریال|rial|\birr\b/.test(value)) return "rial";
  return undefined;
}

interface StatementFiles {
  get(owner: string, id: string): Promise<Artifact>;
  plainText(owner: string, file: Artifact): Promise<string>;
}

/** Extracted text of an uploaded CSV or Excel statement, with Persian errors for other files. */
export async function readStatementFile(files: StatementFiles, owner: string, fileId: string) {
  const file = await files.get(owner, fileId);
  if (file.mimeType === DOCUMENT_TYPES.pdf.mimeType)
    throw new BankStatementError(
      `«${file.name}» یک PDF است و صورت‌حساب PDF خوانده نمی‌شود. خروجی Excel یا CSV صورت‌حساب را از اینترنت‌بانک بگیرید و بارگذاری کنید.`,
    );
  if (
    file.mimeType !== DOCUMENT_TYPES.csv.mimeType &&
    file.mimeType !== DOCUMENT_TYPES.xlsx.mimeType
  )
    throw new BankStatementError(
      `«${file.name}» صورت‌حساب بانکی نیست. فایل CSV یا Excel ‏(xlsx) صورت‌حساب را انتخاب کنید.`,
    );
  const text = await files.plainText(owner, file);
  if (!text.trim())
    throw new BankStatementError(
      `متنی از «${file.name}» خوانده نشد. فایل را دوباره از بانک بگیرید و بارگذاری کنید.`,
    );
  return { file, text };
}
