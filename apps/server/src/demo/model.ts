import { randomUUID } from "node:crypto";
import {
  type ChatCompletionRequest,
  type ChatMessage,
  type FixtureResponse,
  getTextContent,
  LLMock,
} from "@copilotkit/aimock";
import { z } from "zod";

export const demoModel = "openai/openmuse-browser-demo";

const pageSchema = z.object({
  sessionId: z.string().min(1),
  url: z.url(),
  title: z.string(),
  text: z.string(),
  truncated: z.boolean(),
});

function targetUrl(prompt: string): string | undefined {
  if (/monterey|aquarium|مونتری|آکواریوم/i.test(prompt))
    return "https://www.montereybayaquarium.org/visit/exhibits";
  if (/copilotkit\.ai|کوپایلوت[\u200c ]?کیت/i.test(prompt)) return "https://copilotkit.ai";
  if (/hacker\s*news|news\.ycombinator\.com|cool stuff|هکر[\u200c ]?نیوز|چیزهای جالب/i.test(prompt))
    return "https://news.ycombinator.com";
  return undefined;
}

function summarizePage(message: ChatMessage): FixtureResponse {
  let value: unknown;
  try {
    value = JSON.parse(getTextContent(message.content) ?? "");
  } catch {
    return {
      content:
        "مرورگر دادهٔ خوانایی از صفحه برنگرداند. نتیجهٔ مرورگر را بررسی کنید و دوباره تلاش کنید.",
    };
  }
  const parsed = pageSchema.safeParse(value);
  if (!parsed.success)
    return {
      content: "مرورگر نتوانست آن صفحه را بخواند. نتیجهٔ مرورگر را بررسی کنید و دوباره تلاش کنید.",
    };
  const page = parsed.data;
  const lines = page.text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  let excerpts: string[];
  let introduction: string;
  if (new URL(page.url).hostname === "news.ycombinator.com") {
    excerpts = lines
      .map(
        (line, index) =>
          /^\d+\.\s+(.+)$/.exec(line)?.[1] ?? (/^\d+\.$/.test(line) ? lines[index + 1] : undefined),
      )
      .filter((line): line is string => Boolean(line))
      .slice(0, 3);
    introduction = "از صفحهٔ اول فعلی Hacker News:";
  } else if (new URL(page.url).hostname.endsWith("montereybayaquarium.org")) {
    excerpts = lines
      .flatMap((line, index) => {
        if (lines[index - 1] !== "EXHIBIT" || !/^(Kelp Forest|Open Sea|Sea Otters)$/i.test(line))
          return [];
        const description = lines[index + 1];
        return [
          description && description !== "Explore exhibit" ? `${line}: ${description}` : line,
        ];
      })
      .slice(0, 3);
    introduction = "نمایشگاه‌ها از راهنمای خود آکواریوم:";
  } else {
    excerpts = lines
      .filter((line) => line.length >= 45 && /agent|copilotkit|ag.ui|framework/i.test(line))
      .slice(0, 3);
    introduction = "از صفحهٔ فعلی CopilotKit:";
  }
  if (!excerpts.length) {
    excerpts = lines.filter((line) => line.length >= 30).slice(0, 3);
    introduction = "بخش‌هایی از صفحه‌ای که همین حالا باز کردم:";
  }
  if (!excerpts.length)
    return {
      content: "صفحه باز شد، اما متن خوانای کافی برای خلاصه کردن نداشت. صفحهٔ دیگری را امتحان کنید.",
    };
  const bullets = excerpts.map(
    (line) => `• ${line.length > 110 ? `${line.slice(0, 110).replace(/\s+\S*$/, "")}…` : line}`,
  );
  return {
    content: `${introduction}\n\n${bullets.join("\n")}\n\nمنبع: ${page.url}${page.truncated ? "\nمرورگر فقط بخشی از متن صفحه را برگرداند." : ""}`,
  };
}

function turnResult(turn: ChatMessage[], name: string, prefix: string) {
  const ids = new Set(
    turn.flatMap((message) =>
      (message.tool_calls ?? [])
        .filter((call) => call.function.name === name)
        .map((call) => call.id),
    ),
  );
  return turn.findLast(
    (message) =>
      message.role === "tool" &&
      message.tool_call_id &&
      (ids.has(message.tool_call_id) || message.tool_call_id.startsWith(prefix)),
  );
}

function parseResult(message: ChatMessage): unknown {
  try {
    return JSON.parse(getTextContent(message.content) ?? "");
  } catch {
    return undefined;
  }
}

function demoMailResponse(request: ChatCompletionRequest, turn: ChatMessage[]): FixtureResponse {
  const read = turnResult(turn, "read_mail_thread", "call_openmuse_demo_mail_read_");
  if (read) {
    const parsed = z
      .object({
        messages: z.array(z.object({ sender: z.string(), subject: z.string(), body: z.string() })),
      })
      .safeParse(parseResult(read));
    const message = parsed.success ? parsed.data.messages.at(-1) : undefined;
    if (!message)
      return {
        content:
          "نتوانستم ایمیل اردوی مدرسه را بخوانم. نتیجهٔ ایمیل را بررسی کنید و دوباره تلاش کنید.",
      };
    const paragraphs = message.body
      .split(/\n\s*\n/)
      .map((text) => text.trim())
      .filter((text) => text.length > 40 && !/local workspace|فضای کاری محلی/i.test(text))
      .slice(0, 2);
    if (!paragraphs.length)
      return {
        content:
          "ایمیل پیدا شد، اما جزئیات خوانایی دربارهٔ اردو نداشت. متن کامل را در «نامه‌ها» ببینید.",
      };
    return {
      content: `از طرف ${message.sender}:\n«${message.subject}»\n\n${paragraphs.join("\n\n")}\n\nدر قدم بعد می‌توانم دربارهٔ آکواریوم جست‌وجو کنم.`,
    };
  }
  const search = turnResult(turn, "search_mail", "call_openmuse_demo_mail_search_");
  if (search) {
    const parsed = z
      .object({ matches: z.array(z.object({ threadId: z.string(), subject: z.string() })) })
      .safeParse(parseResult(search));
    if (!parsed.success)
      return {
        content:
          "نتوانستم صندوق ورودی‌تان را بررسی کنم. اتصال ایمیل را بررسی کنید و دوباره تلاش کنید.",
      };
    const match = parsed.data.matches[0];
    if (!match) return { content: "در صندوق ایمیل متصل، ایمیلی دربارهٔ اردوی مدرسه پیدا نکردم." };
    if (!request.tools?.some((tool) => tool.function.name === "read_mail_thread"))
      return {
        content: "خواندن ایمیل در دسترس نیست. برای خواندن پیام پیداشده «نامه‌ها» را باز کنید.",
      };
    return {
      content: "یادآوری مدرسه را پیدا کردم. جزئیاتش را می‌خوانم.",
      toolCalls: [
        {
          id: `call_openmuse_demo_mail_read_${randomUUID()}`,
          name: "read_mail_thread",
          arguments: JSON.stringify({ threadId: match.threadId }),
        },
      ],
    };
  }
  if (!request.tools?.some((tool) => tool.function.name === "search_mail"))
    return {
      content: "جست‌وجوی ایمیل در دسترس نیست. پیش از بررسی ایمیل، صندوق ایمیل را متصل کنید.",
    };
  return {
    content: "صندوق ورودی‌تان را برای ایمیل اردوی مدرسه بررسی می‌کنم.",
    toolCalls: [
      {
        id: `call_openmuse_demo_mail_search_${randomUUID()}`,
        name: "search_mail",
        arguments: JSON.stringify({ query: "آکواریوم" }),
      },
    ],
  };
}

/** Script only the model: the app executes real mailbox reads and browser tools. */
export function demoResponse(request: ChatCompletionRequest): FixtureResponse {
  const userIndex = request.messages.findLastIndex((message) => message.role === "user");
  const user = request.messages[userIndex];
  const prompt = user ? (getTextContent(user.content) ?? "") : "";
  const turn = request.messages.slice(userIndex + 1);
  if (/email|inbox|ایمیل|صندوق|(^|\s)نامه/i.test(prompt)) return demoMailResponse(request, turn);
  const url = targetUrl(prompt);
  if (!url)
    return {
      content:
        "این‌ها را امتحان کنید: «در Hacker News بگرد و چیزهای جالب پیدا کن»، «سایت copilotkit.ai را خلاصه کن»، «ایمیل‌هایم را برای اردوی مدرسه بررسی کن» یا «دربارهٔ آکواریوم خلیج مونتری تحقیق کن».",
    };

  // Only the latest turn can satisfy this request; older browser reads cannot suppress a new visit.
  const calls = new Set(
    turn.flatMap((message) =>
      (message.tool_calls ?? [])
        .filter((call) => call.function.name === "browse_web")
        .map((call) => call.id),
    ),
  );
  const result = turn.findLast(
    (message) =>
      message.role === "tool" &&
      message.tool_call_id &&
      (calls.has(message.tool_call_id) ||
        message.tool_call_id.startsWith("call_openmuse_demo_browse_")),
  );
  if (result) return summarizePage(result);
  if (!request.tools?.some((tool) => tool.function.name === "browse_web"))
    return {
      content: "ابزار browse_web در دسترس نیست. API را با پشتیبانی مرورگر اجرا کنید.",
    };
  return {
    content: url.includes("ycombinator")
      ? "Hacker News را باز می‌کنم و صفحهٔ اولش را می‌خوانم."
      : url.includes("montereybayaquarium")
        ? "نمایشگاه‌ها را در وب‌سایت خود آکواریوم بررسی می‌کنم."
        : "CopilotKit را باز می‌کنم و صفحه را می‌خوانم.",
    toolCalls: [
      {
        id: `call_openmuse_demo_browse_${randomUUID()}`,
        name: "browse_web",
        arguments: JSON.stringify({ url }),
      },
    ],
  };
}

export function createDemoModel(
  options: { port?: number; latency?: number; firstByteDelay?: number } = {},
) {
  const latency = options.latency ?? 80;
  const firstByteDelay = options.firstByteDelay ?? options.latency ?? 1500;
  if (![latency, firstByteDelay].every((value) => Number.isFinite(value) && value >= 0))
    throw new Error("Demo model delays must be finite nonnegative milliseconds");
  return new LLMock({
    host: "127.0.0.1",
    port: options.port ?? 0,
    latency,
    chunkSize: 14,
    strict: true,
    logLevel: "silent",
    journalMaxEntries: 100,
  }).on({ model: "openmuse-browser-demo" }, demoResponse, {
    streamingProfile: { ttft: firstByteDelay },
  });
}
