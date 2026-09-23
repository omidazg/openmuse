import assert from "node:assert/strict";
import test from "node:test";
import { latexToText, parseInline, parseMarkdown, splitRow } from "../src/markdown.ts";

test("headings, paragraphs, rules and quotes become blocks", () => {
  assert.deepEqual(parseMarkdown("## عنوان\nخط اول\nخط دوم\n\n---\n> نقل **قول**"), [
    { type: "heading", level: 2, text: "عنوان" },
    { type: "paragraph", text: "خط اول\nخط دوم" },
    { type: "rule" },
    { type: "quote", blocks: [{ type: "paragraph", text: "نقل **قول**" }] },
  ]);
});

test("fenced code keeps its content verbatim and an unclosed fence runs to the end", () => {
  assert.deepEqual(parseMarkdown("متن\n```ts\nconst a = 1;\n  # not a heading\n```\nبعد"), [
    { type: "paragraph", text: "متن" },
    { type: "code", lang: "ts", code: "const a = 1;\n  # not a heading" },
    { type: "paragraph", text: "بعد" },
  ]);
  assert.deepEqual(parseMarkdown("```\nstreaming"), [
    { type: "code", lang: "", code: "streaming" },
  ]);
});

test("lists number sequentially, nest by indentation and read task boxes", () => {
  const [list] = parseMarkdown("1. اول\n1. دوم\n   - زیر\n   - [x] انجام شد\n3. سوم\nادامه");
  assert.deepEqual(list, {
    type: "list",
    items: [
      { depth: 0, number: 1, checked: undefined, text: "اول" },
      { depth: 0, number: 2, checked: undefined, text: "دوم" },
      { depth: 1, number: undefined, checked: undefined, text: "زیر" },
      { depth: 1, number: undefined, checked: true, text: "انجام شد" },
      { depth: 0, number: 3, checked: undefined, text: "سوم" },
    ],
  });
});

test("tables split cells, pad short rows and keep pipes inside code", () => {
  assert.deepEqual(splitRow("| a | `x|y` | b\\|c |"), ["a", "`x|y`", "b|c"]);
  assert.deepEqual(parseMarkdown("| نام | قیمت |\n|---|:-:|\n| سکه | ۱۰ |\n| طلا |"), [
    {
      type: "table",
      header: ["نام", "قیمت"],
      center: [false, true],
      rows: [
        ["سکه", "۱۰"],
        ["طلا", ""],
      ],
    },
  ]);
});

test("display math is read from $$ and \\[ blocks", () => {
  assert.deepEqual(parseMarkdown("$$\nx^2\n$$\n\\[a+b\\]"), [
    { type: "math", tex: "x^2" },
    { type: "math", tex: "a+b" },
  ]);
});

test("inline emphasis, code, links and math", () => {
  assert.deepEqual(parseInline("**پر** و *کج* و `code` و [پیوند](https://a.ir) و $x^2$"), [
    { type: "strong", children: [{ type: "text", text: "پر" }] },
    { type: "text", text: " و " },
    { type: "em", children: [{ type: "text", text: "کج" }] },
    { type: "text", text: " و " },
    { type: "code", text: "code" },
    { type: "text", text: " و " },
    { type: "link", url: "https://a.ir", children: [{ type: "text", text: "پیوند" }] },
    { type: "text", text: " و " },
    { type: "math", tex: "x^2" },
  ]);
});

test("unsafe links lose their target, bare URLs link, and prices are not math", () => {
  assert.deepEqual(parseInline("[x](javascript:alert(1))"), [
    { type: "text", text: "x" },
    { type: "text", text: ")" },
  ]);
  assert.deepEqual(parseInline("ببینید https://tgju.org/coin، لطفاً"), [
    { type: "text", text: "ببینید " },
    {
      type: "link",
      url: "https://tgju.org/coin",
      children: [{ type: "text", text: "https://tgju.org/coin" }],
    },
    { type: "text", text: "، لطفاً" },
  ]);
  assert.deepEqual(parseInline("از $5 تا $10"), [{ type: "text", text: "از $5 تا $10" }]);
  assert.deepEqual(parseInline("snake_case_name"), [{ type: "text", text: "snake_case_name" }]);
});

test("LaTeX becomes readable Unicode", () => {
  assert.equal(latexToText("x^2 + y_1 = \\frac{a+b}{c}"), "x² + y₁ = (a+b)/c");
  assert.equal(latexToText("\\sqrt{x+1} \\leq \\alpha \\cdot \\pi"), "√(x+1) ≤ α · π");
  assert.equal(latexToText("\\sum_{i=1}^{n} i"), "∑ᵢ₌₁ⁿ i");
  assert.equal(latexToText("\\mathbb{R}^{n} \\text{ و } e^{i\\pi}"), "ℝⁿ و e^(iπ)");
  assert.equal(latexToText("\\left( \\frac{1}{2} \\right)"), "( 1/2 )");
});
