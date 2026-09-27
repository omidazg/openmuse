import assert from "node:assert/strict";
import test from "node:test";
import { answerSources, isTurnAnswer, type MessageLike } from "../src/answer-sources-data.ts";

const call = (id: string, name: string) => ({
  id,
  type: "function",
  function: { name, arguments: "{}" },
});

const messages: MessageLike[] = [
  { id: "u1", role: "user", content: "قیمت دلار امروز چند است؟" },
  { id: "a1", role: "assistant", content: "", toolCalls: [call("t1", "browse_web")] },
  {
    id: "r1",
    role: "tool",
    toolCallId: "t1",
    content: JSON.stringify({
      sessionId: "s",
      url: "https://www.tgju.org/profile/price_dollar_rl",
      title: "قیمت دلار",
      text: "…",
    }),
  },
  {
    id: "a2",
    role: "assistant",
    content: "",
    toolCalls: [call("t2", "search_files"), call("t3", "watch_page")],
  },
  {
    id: "r2",
    role: "tool",
    toolCallId: "t2",
    content: JSON.stringify({ passages: [{ fileName: "بودجه.xlsx", text: "…" }] }),
  },
  {
    id: "r3",
    role: "tool",
    toolCallId: "t3",
    content: JSON.stringify({ url: "https://example.com/" }),
  },
  { id: "a3", role: "assistant", content: "قیمت دلار طبق tgju.org …" },
  { id: "u2", role: "user", content: "ممنون" },
  { id: "a4", role: "assistant", content: "خواهش می‌کنم." },
];

test("sources of a turn list visited pages and the files it searched", () => {
  assert.equal(isTurnAnswer(messages, 6), true);
  assert.equal(isTurnAnswer(messages, 1), false);
  const sources = answerSources(messages, 6);
  assert.deepEqual(sources.web, [
    {
      url: "https://www.tgju.org/profile/price_dollar_rl",
      title: "قیمت دلار",
      domain: "tgju.org",
    },
  ]);
  assert.deepEqual(sources.files, ["بودجه.xlsx"]);
  // The next turn has no tools and therefore no sources.
  assert.deepEqual(answerSources(messages, 8), { web: [], files: [] });
});

test("failed tools and non-web URLs are never shown as sources", () => {
  const failed: MessageLike[] = [
    { id: "u", role: "user", content: "x" },
    {
      id: "a",
      role: "assistant",
      content: "",
      toolCalls: [call("t1", "browse_web"), call("t2", "web_search")],
    },
    { id: "r1", role: "tool", toolCallId: "t1", content: JSON.stringify({ error: "خطا" }) },
    {
      id: "r2",
      role: "tool",
      toolCallId: "t2",
      content: JSON.stringify({
        results: [
          { url: "javascript:alert(1)", title: "bad" },
          { url: "https://news.example.ir/a", title: "" },
        ],
      }),
    },
    { id: "b", role: "assistant", content: "پاسخ" },
  ];
  assert.deepEqual(answerSources(failed, 4).web, [
    { url: "https://news.example.ir/a", title: "news.example.ir", domain: "news.example.ir" },
  ]);
});
