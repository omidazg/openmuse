import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  BankStatementError,
  categorize,
  parseBankAmount,
  parseBankDate,
  parseBankStatement,
  parseDelimited,
  readStatementFile,
} from "../apps/server/src/engine/bank-statement.ts";
import { analyzeSpending } from "../apps/server/src/engine/finance.ts";
import type { Artifact } from "../packages/domain/src/index.ts";

// Synthetic statements shaped like common Iranian bank exports; not exact copies of any bank.
const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "fixtures", "bank", name), "utf8");
const titleRows = fixture("title-rows-debit-credit.csv");
const signedAmount = fixture("signed-amount-semicolon.csv");
const transactionDate = fixture("english-digits-transaction-date.csv");
// 1405/07/05 in Tehran.
const now = new Date("2026-09-27T08:00:00Z");

test("digits, separators and signs are normalized in amounts", () => {
  assert.equal(parseBankAmount("۱٬۲۵۰٬۰۰۰"), 1_250_000);
  assert.equal(parseBankAmount("٣٢٠٬٠٠٠"), 320_000);
  assert.equal(parseBankAmount("1,250,000-"), -1_250_000);
  assert.equal(parseBankAmount("-1,250,000"), -1_250_000);
  assert.equal(parseBankAmount("(900,000)"), -900_000);
  assert.equal(parseBankAmount("1.250.000"), 1_250_000);
  assert.equal(parseBankAmount("۱۲٫۵"), 12.5);
  assert.equal(parseBankAmount("۵۰۰٬۰۰۰ ریال"), 500_000);
  assert.equal(parseBankAmount("-"), undefined);
  assert.equal(parseBankAmount(""), undefined);
  assert.equal(parseBankAmount("شرح"), undefined);
});

test("Jalali dates in several shapes become Gregorian days", () => {
  for (const value of [
    "۱۴۰۵/۰۷/۰۱",
    "١٤٠٥/٠٧/٠١",
    "1405-07-01",
    "05/07/01",
    "01/07/1405",
    "14050701",
    "2026-09-23",
  ])
    assert.equal(parseBankDate(value)?.date, "2026-09-23", value);
  assert.deepEqual(parseBankDate("۱۴۰۵/۰۷/۰۱ ۱۴:۰۵:۱۰"), { date: "2026-09-23", time: "14:05" });
  assert.equal(parseBankDate("1405/13/01"), undefined);
  assert.equal(parseBankDate("1405/07/31"), undefined);
  assert.equal(parseBankDate("2026-02-30"), undefined);
  assert.equal(parseBankDate("مانده"), undefined);
});

test("Persian keyword rules categorize descriptions", () => {
  const cases: [string, string][] = [
    ["خرید کالا فروشگاه افق کوروش", "خرید و فروشگاه"],
    ["اسنپ", "حمل‌ونقل"],
    ["تپسی", "حمل‌ونقل"],
    ["اسنپ فود", "رستوران و کافه"],
    ["خرید اینترنتی دیجی‌کالا", "خرید اینترنتی"],
    ["پرداخت قبض آب", "قبض"],
    ["کتاب آبی", "سایر"],
    ["خرید شارژ همراه اول", "شارژ و اینترنت"],
    ["بسته اینترنت ایرانسل", "شارژ و اینترنت"],
    ["پرداخت قسط وام", "اقساط و وام"],
    ["واریز حقوق مهر", "حقوق"],
    ["انتقال کارت به کارت", "انتقال وجه"],
    ["حواله ساتنا", "انتقال وجه"],
    ["کارمزد انتقال کارت به کارت", "کارمزد بانکی"],
    ["برداشت از خودپرداز", "برداشت نقدی"],
    ["اجاره خانه", "اجاره و مسکن"],
    ["كافه نادري", "رستوران و کافه"],
    ["داروخانه شبانه‌روزی", "درمان و دارو"],
    ["پرداخت به آقای محمدی", "سایر"],
  ];
  for (const [description, category] of cases)
    assert.equal(categorize(description), category, description);
});

test("title rows, separate debit/credit columns and Persian digits", () => {
  const statement = parseBankStatement(titleRows);
  assert.equal(statement.headerRow, 4);
  assert.equal(statement.sourceCurrency, "rial");
  assert.match(statement.currencyNote, /ریالی فرض شد/);
  assert.equal(statement.columns.debit, "بدهکار");
  assert.equal(statement.transactions.length, 10);
  const [shop, salary, snapp, bill, cafe] = statement.transactions;
  assert.deepEqual(
    { ...shop },
    {
      id: "row-6",
      date: "2026-09-19",
      time: "11:42",
      description: "خرید کالا فروشگاه افق کوروش",
      amount: 250_000,
      kind: "expense",
      category: "خرید و فروشگاه",
      balance: 9_750_000,
      reference: "451209",
    },
  );
  assert.equal(salary.amount, -45_000_000);
  assert.equal(salary.kind, "income");
  assert.equal(salary.category, "حقوق");
  assert.equal(snapp.category, "حمل‌ونقل");
  assert.equal(bill.date, "2026-09-24");
  assert.equal(bill.amount, 32_000);
  assert.equal(cafe.description, "کافه نادری");
});

test("analyzeSpending falls back to bank statements and filters this Jalali month", () => {
  const all = analyzeSpending(titleRows);
  assert.equal(all.source, "bank-statement");
  assert.equal(all.currency, "toman");
  assert.equal(all.count, 10);
  assert.equal(all.income, 45_000_000);
  assert.equal(all.spending, 3_971_100);
  assert.equal(all.saved, 45_000_000 - 3_971_100);
  assert.deepEqual(all.incomeCategories, [{ name: "حقوق", amount: 45_000_000 }]);

  const month = analyzeSpending(titleRows, { month: "current", now });
  assert.equal(month.month?.label, "مهر ۱۴۰۵");
  assert.equal(month.count, 8);
  assert.equal(month.income, 0);
  assert.equal(month.spending, 3_721_100);
  assert.deepEqual(month.period, { from: "2026-09-23", to: "2026-09-27" });
  assert.deepEqual(
    month.categories.map((c) => [c.name, c.amount]),
    [
      ["اقساط و وام", 1_500_000],
      ["انتقال وجه", 1_000_000],
      ["خرید اینترنتی", 875_000],
      ["برداشت نقدی", 200_000],
      ["رستوران و کافه", 95_000],
      ["قبض", 32_000],
      ["حمل‌ونقل", 18_500],
      ["کارمزد بانکی", 600],
    ],
  );
  assert.equal(analyzeSpending(titleRows, { month: "previous", now }).count, 2);
  assert.equal(analyzeSpending(titleRows, { month: "۱۴۰۵-۰۶" }).spending, 250_000);
  assert.throws(
    () => analyzeSpending(titleRows, { month: "1405-05" }),
    /تراکنشی برای مرداد ۱۴۰۵ نیست/,
  );
  assert.throws(() => analyzeSpending(titleRows, { month: "next week" }), /ماه درخواستی/);
});

test("one signed amount column with semicolons and trailing minus signs", () => {
  const report = analyzeSpending(signedAmount);
  assert.equal(report.count, 6);
  assert.equal(report.income, 12_000_000);
  assert.equal(report.spending, 125_000 + 85_000 + 50_000 + 90_000 + 240_000);
  const byName = Object.fromEntries(report.categories.map((c) => [c.name, c.amount]));
  assert.deepEqual(byName, {
    "رستوران و کافه": 240_000,
    "خرید و فروشگاه": 125_000,
    "درمان و دارو": 90_000,
    حمل‌ونقل: 85_000,
    "شارژ و اینترنت": 50_000,
  });
  assert.equal(report.transactions[2].category, "انتقال وجه");
  assert.equal(report.transactions[0].time, "10:20");
});

test("English digits, «تاریخ تراکنش», quoted thousands and short Jalali years", () => {
  const statement = parseBankStatement(transactionDate);
  assert.equal(statement.columns.date, "تاریخ تراکنش");
  assert.equal(statement.transactions.length, 5);
  assert.equal(statement.skippedRows, 1);
  assert.match(statement.notes.join(" "), /۱ ردیف/);
  const [rent, interest, food, coffee, other] = statement.transactions;
  assert.equal(rent.date, "2026-09-21");
  assert.equal(rent.amount, 15_000_000);
  assert.equal(rent.category, "اجاره و مسکن");
  assert.equal(interest.amount, -320_000);
  assert.equal(interest.category, "سود سپرده");
  assert.equal(food.category, "رستوران و کافه");
  assert.equal(coffee.category, "رستوران و کافه");
  assert.equal(other.category, "سایر");
});

test("a Toman hint skips conversion; an option overrides the file", () => {
  const text = "مبالغ به تومان\nتاریخ,شرح,برداشت,واریز\n1405/07/01,اسنپ,120000,\n";
  const statement = parseBankStatement(text);
  assert.equal(statement.sourceCurrency, "toman");
  assert.equal(statement.transactions[0].amount, 120_000);
  assert.match(statement.currencyNote, /تبدیلی انجام نشد/);
  assert.equal(parseBankStatement(text, { currency: "rial" }).transactions[0].amount, 12_000);
  const header = "تاریخ,شرح,مبلغ برداشت (تومان),مبلغ واریز (تومان)\n1405/07/01,اسنپ,120000,\n";
  assert.equal(parseBankStatement(header).sourceCurrency, "toman");
});

test("Excel text and pre-split rows are accepted", () => {
  const excel =
    "## خلاصه\nگزارش حساب\n\n## گردش\nبانک نمونه\nتاریخ\tشرح\tبدهکار\tبستانکار\tمانده\n2026-09-24\tخرید اینترنتی دیجی کالا\t4500000\t\t10000000\n2026-09-25 10:30\tواریز حقوق\t\t300000000\t310000000";
  const statement = parseBankStatement(excel);
  assert.equal(statement.sheet, "گردش");
  assert.equal(statement.headerRow, 2);
  assert.deepEqual(
    statement.transactions.map((t) => [t.date, t.time, t.amount, t.category]),
    [
      ["2026-09-24", undefined, 450_000, "خرید اینترنتی"],
      ["2026-09-25", "10:30", -30_000_000, "حقوق"],
    ],
  );
  const rows = [
    ["Date", "Description", "Debit", "Credit"],
    ["1405/07/02", "Snapp", "300000", ""],
  ];
  const fromRows = analyzeSpending(rows);
  assert.equal(fromRows.spending, 30_000);
  assert.equal(fromRows.categories[0].name, "حمل‌ونقل");
});

test("a single unsigned amount column uses the type column or description", () => {
  const typed = parseBankStatement(
    "تاریخ,شرح,نوع تراکنش,مبلغ\n1405/07/01,انتقال,برداشت,50000\n1405/07/02,انتقال,واریز,70000\n",
  );
  assert.deepEqual(
    typed.transactions.map((t) => t.kind),
    ["expense", "income"],
  );
  const guessed = parseBankStatement(
    "تاریخ,شرح,مبلغ\n1405/07/01,خرید,50000\n1405/07/02,واریز حقوق,90000\n",
  );
  assert.deepEqual(
    guessed.transactions.map((t) => t.amount),
    [5000, -9000],
  );
  assert.match(guessed.notes.join(" "), /از روی شرح/);
});

test("delimiter detection handles tabs, semicolons and quoted commas", () => {
  assert.deepEqual(parseDelimited('a;b;c\n"1,5";2;3'), [
    ["a", "b", "c"],
    ["1,5", "2", "3"],
  ]);
  assert.deepEqual(parseDelimited("a\tb\n1\t2"), [
    ["a", "b"],
    ["1", "2"],
  ]);
});

test("clear Persian errors when columns or rows cannot be recognized", () => {
  assert.throws(
    () => parseBankStatement("نام,مقدار\nعلی,۱۲"),
    (error: unknown) =>
      error instanceof BankStatementError &&
      /سطر عنوان ستون‌ها در ۲۰ سطر اول/.test(error.message) &&
      /«تاریخ»/.test(error.message) &&
      /«بدهکار»/.test(error.message),
  );
  assert.throws(
    () => parseBankStatement("تاریخ,شرح\n1405/07/01,خرید"),
    /ستون تاریخ پیدا شد ولی ستون مبلغ پیدا نشد/,
  );
  assert.throws(() => parseBankStatement("شرح,بدهکار\nخرید,100"), /ستون «تاریخ» پیدا نشد/);
  assert.throws(
    () => parseBankStatement("تاریخ,شرح,بدهکار\nنامعتبر,خرید,100"),
    /هیچ ردیف تراکنش معتبری/,
  );
  assert.throws(() => analyzeSpending(""), /خالی است/);
});

test("the simple CSV format stays strict", () => {
  const report = analyzeSpending(
    "date,description,amount,category\n2026-09-01,Salary,-1000,Income\n2026-09-02,Lunch,20.20,Food",
  );
  assert.equal(report.source, "simple-csv");
  assert.equal(report.spending, 20.2);
  assert.equal(report.currency, undefined);
  assert.throws(() =>
    analyzeSpending("date,description,amount,category\n2026-02-31,Purchase,10,Food"),
  );
});

test("uploaded statements are read from CSV/Excel files and PDFs get a clear error", async () => {
  const file = (mimeType: string, name: string) =>
    ({ id: "f1", name, mimeType }) as unknown as Artifact;
  const files = (artifact: Artifact) => ({
    get: async () => artifact,
    plainText: async () => titleRows,
  });
  const csv = file("text/csv", "گردش.csv");
  const read = await readStatementFile(files(csv), "owner", "f1");
  assert.equal(analyzeSpending(read.text).count, 10);
  await assert.rejects(
    readStatementFile(files(file("application/pdf", "صورت‌حساب.pdf")), "owner", "f1"),
    /یک PDF است/,
  );
  await assert.rejects(
    readStatementFile(
      files(
        file(
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "نامه.docx",
        ),
      ),
      "owner",
      "f1",
    ),
    /صورت‌حساب بانکی نیست/,
  );
});
