import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import { BotApi, type BotUpdate } from "../apps/server/src/bot/api.ts";
import { type AssistantRequest, assistantReply } from "../apps/server/src/bot/assistant.ts";
import { botsFromEnv } from "../apps/server/src/bot/index.ts";
import { createLinkCode, findLink, LINK_CODE_TTL_MS } from "../apps/server/src/bot/links.ts";
import { BotService, type BotServiceOptions, botText } from "../apps/server/src/bot/service.ts";
import { MESSAGE_LIMIT, splitMessage, toPlainText } from "../apps/server/src/bot/text.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";

const TOKEN = "123456:secret-token";

/** A fake Bot API server: queued updates for getUpdates, recorded sendMessage calls. */
function fakeBotApi() {
  const queue: BotUpdate[][] = [];
  const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = url.split("/").at(-1) ?? "";
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ url, method, body });
    const result =
      method === "getUpdates"
        ? (queue.shift() ?? [])
        : method === "sendMessage"
          ? { message_id: calls.length, chat: { id: body.chat_id, type: "private" } }
          : true;
    return new Response(JSON.stringify({ ok: true, result }), {
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  const sent = (chatId?: number) =>
    calls
      .filter(
        (c) =>
          c.method === "sendMessage" &&
          (chatId === undefined || String(c.body.chat_id) === String(chatId)),
      )
      .map((c) => String(c.body.text));
  return { queue, calls, fetcher, sent };
}

let updateId = 100;
const message = (chatId: number, text?: string, type = "private"): BotUpdate => ({
  update_id: updateId++,
  message: {
    message_id: updateId,
    chat: { id: chatId, type },
    from: { id: chatId, first_name: "Sara" },
    ...(text === undefined ? { voice: {} } : { text }),
  },
});

async function setup(options: Partial<BotServiceOptions> = {}) {
  const db = await createStore();
  const api = fakeBotApi();
  const bot = new BotApi("bale", TOKEN, undefined, api.fetcher);
  const requests: AssistantRequest[] = [];
  const service = new BotService(db, [bot], {
    reply: async (request) => {
      requests.push(request);
      return `پاسخ به: ${request.text}`;
    },
    pollTimeoutSeconds: 0,
    ...options,
  });
  const deliver = async (...updates: BotUpdate[]) => {
    api.queue.push(updates);
    await service.pollOnce(bot);
    await service.idle();
  };
  return { db, api, bot, service, requests, deliver };
}

test("long messages split under the Bot API limit without losing text", () => {
  const paragraph = "این یک جملهٔ آزمایشی برای تقسیم پیام است. ".repeat(60);
  const text = Array.from({ length: 6 }, () => paragraph).join("\n\n");
  const chunks = splitMessage(text);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= MESSAGE_LIMIT);
  assert.equal(chunks.join(" ").replace(/\s+/g, " "), text.trim().replace(/\s+/g, " "));
  // No separators at all: hard cut, but never inside a surrogate pair.
  const emoji = "😀".repeat(3000);
  const hard = splitMessage(emoji, 4001);
  assert.equal(hard.join(""), emoji);
  for (const chunk of hard) assert.ok(!/^[\udc00-\udfff]|[\ud800-\udbff]$/.test(chunk));
  assert.deepEqual(splitMessage("کوتاه"), ["کوتاه"]);
});

test("model Markdown becomes readable plain text", () => {
  assert.equal(
    toPlainText("## عنوان\n**مهم** است\n- مورد `code`\n[سایت](https://example.com)"),
    "عنوان\nمهم است\n• مورد code\nسایت (https://example.com)",
  );
});

test("unlinked chats get Persian guidance and never reach the assistant", async () => {
  const { db, api, requests, deliver } = await setup();
  try {
    await deliver(message(1, "/start"), message(1, "سلام"), message(2, "/link"));
    assert.deepEqual(api.sent(1), [botText.unlinkedHelp, botText.unlinked]);
    assert.deepEqual(api.sent(2), [botText.linkMissingCode]);
    assert.equal(requests.length, 0);
    // Group chats are not linked or answered, except a pointer to the private chat.
    await deliver(message(-5, "سلام", "group"), message(-5, "/start", "group"));
    assert.deepEqual(api.sent(-5), [botText.privateOnly]);
    // getUpdates advanced and persisted the offset.
    const polls = api.calls.filter((c) => c.method === "getUpdates");
    assert.equal(polls.at(-1)?.body.offset, updateId - 2);
    assert.ok(api.calls.every((c) => c.url.startsWith(`https://tapi.bale.ai/bot${TOKEN}/`)));
  } finally {
    await db.close();
  }
});

test("linking binds the chat to the owner, keeps history, and unlink stops it", async () => {
  const now = Date.now();
  const { db, api, requests, deliver } = await setup();
  try {
    const { code } = await createLinkCode(db, "user-sara", now);
    assert.match(code, /^\d{6}$/);
    const persian = code.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
    await deliver(message(7, `/link@DastyarBot ${persian}`));
    assert.deepEqual(api.sent(7), [botText.linked("bale")]);
    assert.equal((await findLink(db, "bale", 7))?.owner, "user-sara");
    // The code is single-use.
    await deliver(message(8, `/link ${code}`));
    assert.deepEqual(api.sent(8), [botText.linkInvalid]);

    await deliver(message(7, "برنامهٔ امروزم چیست؟"));
    await deliver(message(7, "و فردا؟"));
    assert.equal(requests.length, 2);
    assert.equal(requests[0].owner, "user-sara");
    assert.equal(requests[0].platform, "bale");
    assert.deepEqual(requests[0].history, []);
    assert.deepEqual(
      requests[1].history.map((t) => [t.role, t.content]),
      [
        ["user", "برنامهٔ امروزم چیست؟"],
        ["assistant", "پاسخ به: برنامهٔ امروزم چیست؟"],
      ],
    );
    assert.ok(api.calls.some((c) => c.method === "sendChatAction" && c.body.action === "typing"));
    assert.equal(api.sent(7).at(-1), "پاسخ به: و فردا؟");

    await deliver(message(7, "/new"), message(7, "دوباره"));
    assert.deepEqual(requests[2].history, []);
    await deliver(message(7));
    assert.equal(api.sent(7).at(-1), botText.textOnly);

    await deliver(message(7, "/unlink"), message(7, "هنوز هستی؟"));
    assert.deepEqual(api.sent(7).slice(-2), [botText.unlinkedDone, botText.unlinked]);
    assert.equal(requests.length, 3);
    assert.equal(await db.get("user-sara", "bot-history", "bale:7"), null);
  } finally {
    await db.close();
  }
});

test("expired codes and repeated guesses are refused", async () => {
  const start = Date.now();
  let clock = start;
  const { db, api, deliver } = await setup({ now: () => clock });
  try {
    const { code } = await createLinkCode(db, "local-user", start);
    clock = start + LINK_CODE_TTL_MS + 1;
    await deliver(message(9, `/link ${code}`));
    assert.deepEqual(api.sent(9), [botText.linkInvalid]);
    for (let i = 0; i < 5; i++) await deliver(message(10, "/link 000000"));
    const { code: fresh } = await createLinkCode(db, "local-user", clock);
    await deliver(message(10, `/link ${fresh}`));
    assert.equal(api.sent(10).at(-1), botText.linkTooMany);
    assert.equal(await findLink(db, "bale", 10), null);
  } finally {
    await db.close();
  }
});

test("long replies are split, floods are rate-limited, quota can refuse", async () => {
  const long = "کلمه ".repeat(2500);
  let quotaBlocked = false;
  const { db, api, requests, deliver } = await setup({
    reply: async (request) => {
      requests.push(request);
      return long;
    },
    rateLimit: { messages: 3, windowMs: 60_000 },
    quota: async () => (quotaBlocked ? "سهمیهٔ امروز شما تمام شده است." : undefined),
  });
  try {
    const { code } = await createLinkCode(db, "local-user");
    await deliver(message(11, `/link ${code}`));
    await deliver(message(11, "یک متن بلند بنویس"));
    const replies = api.sent(11).slice(1);
    assert.ok(replies.length >= 3);
    assert.ok(replies.every((r) => r.length <= MESSAGE_LIMIT));
    assert.equal(replies.join(" ").replace(/\s+/g, " "), long.trim());

    quotaBlocked = true;
    await deliver(message(11, "باز هم"));
    assert.equal(api.sent(11).at(-1), "سهمیهٔ امروز شما تمام شده است.");
    assert.equal(requests.length, 1);

    const before = api.sent(11).length;
    await deliver(message(11, "۱"), message(11, "۲"), message(11, "۳"));
    // Only one notice for the whole flood.
    assert.deepEqual(api.sent(11).slice(before), [botText.rateLimited]);
  } finally {
    await db.close();
  }
});

test("task notifications for the owner are forwarded once to linked chats", async () => {
  const { db, api, service, deliver } = await setup();
  try {
    await db.put("user-ali", "notifications", {
      id: "old",
      taskId: "t0",
      title: "کار قدیمی",
      body: "پیش از اتصال",
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      read: false,
    });
    const { code } = await createLinkCode(db, "user-ali");
    await deliver(message(12, `/link ${code}`));
    const later = new Date(Date.now() + 1000).toISOString();
    await db.put("user-ali", "notifications", {
      id: "done",
      taskId: "t1",
      title: "خلاصهٔ گزارش",
      body: "**گزارش** آماده است.",
      createdAt: later,
      read: false,
    });
    await db.put("user-ali", "notifications", {
      id: "general",
      title: "بدون کار",
      body: "این اعلان به کاری مربوط نیست.",
      createdAt: later,
      read: false,
    });
    await db.put("someone-else", "notifications", {
      id: "other",
      taskId: "t9",
      title: "مال دیگری",
      body: "نباید برسد",
      createdAt: later,
      read: false,
    });
    await service.notifyOnce();
    await service.notifyOnce();
    const notices = api.sent(12).slice(1);
    assert.equal(notices.length, 1);
    assert.match(notices[0], /^خلاصهٔ گزارش\n\nگزارش آماده است\./);
    assert.match(notices[0], /«فعالیت»/);
  } finally {
    await db.close();
  }
});

test("the web app issues link codes and the bot reuses the sample assistant", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-bot-"));
  const db: Store = await createStore();
  try {
    const config: Config = {
      mode: "sample",
      port: 8787,
      host: "127.0.0.1",
      publicUrl: "http://localhost:8787",
      dataDir: directory,
      agentBackend: "sample",
      googleRedirectUri: "http://localhost:8787/api/google/callback",
      allowedOrigins: ["http://localhost:8081"],
    };
    const { app, agent } = await createApp(db, config);
    assert.equal((await app.request("/api/bot/link-code", { method: "POST" })).status, 401);
    const session = await app.request("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const headers = { Authorization: `Bearer ${(await session.json()).token}` };
    const issued = await app.request("/api/bot/link-code", { method: "POST", headers });
    assert.equal(issued.status, 201);
    const { code, expiresAt } = await issued.json();
    assert.match(code, /^\d{6}$/);
    assert.ok(Date.parse(expiresAt) > Date.now());

    const api = fakeBotApi();
    const bot = new BotApi("telegram", TOKEN, "https://tg-proxy.example/", api.fetcher);
    const service = new BotService(db, [bot], {
      reply: assistantReply(agent),
      pollTimeoutSeconds: 0,
    });
    api.queue.push([message(21, `/link ${code}`), message(21, "سلام")]);
    await service.pollOnce(bot);
    await service.idle();
    const sent = api.sent(21);
    assert.equal(sent[0], botText.linked("telegram"));
    assert.match(sent[1], /چه کاری/);
    assert.ok(api.calls.every((c) => c.url.startsWith(`https://tg-proxy.example/bot${TOKEN}/`)));

    const links = await (await app.request("/api/bot/links", { headers })).json();
    assert.deepEqual(
      links.map((l: { id: string; platform: string }) => [l.id, l.platform]),
      [["telegram:21", "telegram"]],
    );
    const removed = await app.request("/api/bot/links/telegram%3A21", {
      method: "DELETE",
      headers,
    });
    assert.equal(removed.status, 200);
    assert.equal(await findLink(db, "telegram", 21), null);
    assert.equal(
      (await app.request("/api/bot/links/telegram%3A21", { method: "DELETE", headers })).status,
      404,
    );
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("bots start only for configured tokens and API errors never expose the token", async () => {
  assert.deepEqual(botsFromEnv({}), []);
  assert.deepEqual(
    botsFromEnv({ BALE_BOT_TOKEN: "a", TELEGRAM_BOT_TOKEN: " " }).map((b) => b.platform),
    ["bale"],
  );
  const failing = new BotApi("telegram", TOKEN, undefined, (async () => {
    throw new TypeError(`fetch failed https://api.telegram.org/bot${TOKEN}/getUpdates`);
  }) as typeof fetch);
  await assert.rejects(failing.getUpdates(0, 0), (error: Error) => {
    assert.ok(!error.message.includes("secret-token"));
    return error.name === "BotApiError";
  });
  const denied = new BotApi(
    "bale",
    TOKEN,
    undefined,
    (async () =>
      new Response(JSON.stringify({ ok: false, description: "Unauthorized" }), {
        status: 401,
      })) as typeof fetch,
  );
  await assert.rejects(denied.sendMessage(1, "سلام"), /sendMessage failed \(401\): Unauthorized/);
});
