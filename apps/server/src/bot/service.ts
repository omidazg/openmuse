import type { AgentNotification, AgentTask } from "../../../../packages/domain/src/agent.ts";
import { BRAND } from "../../../../packages/domain/src/brand.ts";
import type { Store } from "../db.ts";
import { backgroundFailure } from "../log.ts";
import { type BotApi, BotApiError, type BotMessage, type BotPlatform } from "./api.ts";
import type { AssistantReply, ChatTurn } from "./assistant.ts";
import {
  type BotLink,
  consumeLinkCode,
  findLink,
  HISTORY_KIND,
  LINKS_KIND,
  linkChat,
  linkId,
  listLinks,
  SYSTEM_OWNER,
  unlinkChat,
} from "./links.ts";
import { splitMessage, toLatinDigits, toPlainText } from "./text.ts";

/**
 * Usage-quota hook. Return a Persian message to refuse the request, or nothing to allow it.
 * The quota check is wired to the shared daily usage limits in startBots (index.ts).
 */
export type QuotaCheck = (owner: string) => Promise<string | undefined | null>;

export interface BotServiceOptions {
  reply: AssistantReply;
  quota?: QuotaCheck;
  /** Long-poll timeout passed to getUpdates. */
  pollTimeoutSeconds?: number;
  notifyIntervalMs?: number;
  /** Per-chat limit on incoming messages. */
  rateLimit?: { messages: number; windowMs: number };
  /** Messages remembered per chat (user + assistant). */
  historyLimit?: number;
  now?: () => number;
}

const platformFa: Record<BotPlatform, string> = { bale: "بله", telegram: "تلگرام" };
const statusFa: Record<AgentTask["status"], string> = {
  queued: "در صف",
  running: "در حال انجام",
  scheduled: "زمان‌بندی‌شده",
  paused: "متوقف‌شده",
  waiting_input: "در انتظار اطلاعات شما",
  waiting_approval: "در انتظار تأیید شما در برنامه",
  succeeded: "انجام‌شده",
  failed: "ناموفق",
  cancelled: "لغوشده",
};

export const botText = {
  unlinkedHelp: [
    `سلام. من ربات «${BRAND.nameFa}» هستم.`,
    "برای گفت‌وگو با دستیارتان، اول این گفت‌وگو را به حسابتان وصل کنید:",
    `۱. در برنامهٔ ${BRAND.nameFa} به «برنامه‌ها» بروید و «بله و تلگرام» را باز کنید.`,
    "۲. «دریافت کد اتصال» را بزنید.",
    "۳. کد را این‌طور برای من بفرستید: /link 123456",
  ].join("\n"),
  linkedHelp: [
    `این گفت‌وگو به حساب شما در ${BRAND.nameFa} وصل است. هر پیامی بفرستید، دستیار پاسخ می‌دهد.`,
    "",
    "فرمان‌ها:",
    "/tasks  کارهای اخیر",
    "/new  شروع گفت‌وگوی تازه",
    "/unlink  قطع اتصال این گفت‌وگو",
    "/help  راهنما",
    "",
    "کار پس‌زمینه هم می‌توانید بخواهید؛ وقتی تمام شد، همین‌جا خبر می‌دهم. تأیید ایمیل، رویداد و کارهای حساس فقط در برنامه انجام می‌شود.",
  ].join("\n"),
  unlinked: `این گفت‌وگو هنوز به حسابی در ${BRAND.nameFa} وصل نیست. در برنامه از «برنامه‌ها» ← «بله و تلگرام» یک کد اتصال بگیرید و آن را این‌طور بفرستید: /link 123456`,
  linkMissingCode: "کد اتصال را بعد از فرمان بفرستید؛ مثلاً: /link 123456",
  linkInvalid:
    "کد اتصال نامعتبر است یا منقضی شده است. در برنامه یک کد تازه بگیرید و دوباره بفرستید.",
  linkTooMany: "تلاش‌های ناموفق زیاد بود. ده دقیقهٔ دیگر دوباره تلاش کنید.",
  linked: (platform: BotPlatform) =>
    `اتصال برقرار شد. از این پس پیام‌هایتان در ${platformFa[platform]} به دستیارتان می‌رسد و نتیجهٔ کارهای پس‌زمینه همین‌جا اعلام می‌شود. برای راهنما /help را بفرستید.`,
  unlinkedDone: "اتصال این گفت‌وگو قطع شد. برای اتصال دوباره، از برنامه یک کد تازه بگیرید.",
  notLinked: "این گفت‌وگو به حسابی وصل نیست.",
  privateOnly: "این ربات فقط در گفت‌وگوی خصوصی کار می‌کند. به خود ربات پیام بدهید.",
  textOnly: "فعلاً فقط پیام متنی پشتیبانی می‌شود. درخواستتان را بنویسید.",
  rateLimited: "پیام‌ها زیاد است. یک دقیقه صبر کنید و دوباره بفرستید.",
  busy: "هنوز در حال پاسخ به پیام‌های قبلی هستم. کمی صبر کنید و دوباره بفرستید.",
  failed: "پاسخ دستیار آماده نشد. کمی بعد دوباره تلاش کنید.",
  empty: "پاسخی از دستیار دریافت نشد. درخواستتان را دوباره بفرستید.",
  reset: "گفت‌وگوی تازه شروع شد. پیام‌های قبلی دیگر در پاسخ‌ها در نظر گرفته نمی‌شوند.",
  noTasks: "هنوز کاری ثبت نشده است. کافی است کاری را از دستیار بخواهید.",
  tooLong: "پیام خیلی طولانی است. آن را کوتاه‌تر کنید یا در چند پیام بفرستید.",
};

const MAX_INPUT = 8000;
const MAX_PENDING_PER_CHAT = 3;
const LINK_ATTEMPTS = 5;
const LINK_WINDOW_MS = 10 * 60 * 1000;

export class BotService {
  private readonly bots: BotApi[];
  private readonly offsets = new Map<BotPlatform, number>();
  private readonly chains = new Map<string, { tail: Promise<void>; pending: number }>();
  private readonly hits = new Map<string, number[]>();
  private readonly linkFailures = new Map<string, number[]>();
  private readonly running = new Set<Promise<void>>();
  private abort = new AbortController();
  private loops: Promise<void>[] = [];
  private notifier?: ReturnType<typeof setInterval>;
  private notifying = false;
  private stopped = true;
  private readonly now: () => number;

  constructor(
    private readonly db: Store,
    bots: BotApi[],
    private readonly options: BotServiceOptions,
  ) {
    this.bots = bots;
    this.now = options.now ?? Date.now;
  }

  get platforms() {
    return this.bots.map((bot) => bot.platform);
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.abort = new AbortController();
    this.loops = this.bots.map((bot) => this.loop(bot));
    this.notifier = setInterval(() => {
      void this.notifyOnce().catch((error) => backgroundFailure("bot notifications", error));
    }, this.options.notifyIntervalMs ?? 60_000);
  }

  async stop() {
    this.stopped = true;
    this.abort.abort();
    if (this.notifier) clearInterval(this.notifier);
    this.notifier = undefined;
    await Promise.allSettled(this.loops);
    await this.idle();
  }

  /** Resolves when every accepted update has been answered. */
  async idle() {
    while (this.running.size) await Promise.allSettled([...this.running]);
  }

  private async loop(bot: BotApi) {
    let delay = 1000;
    while (!this.stopped) {
      try {
        await this.pollOnce(bot);
        delay = 1000;
      } catch (error) {
        if (this.stopped) break;
        const retryAfter = error instanceof BotApiError ? error.retryAfter : undefined;
        // 409: another process polls the same token (e.g. both api and worker have it set).
        backgroundFailure(`${bot.platform} bot polling`, error);
        await this.sleep(retryAfter ? retryAfter * 1000 : delay);
        delay = Math.min(delay * 2, 60_000);
      }
    }
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.abort.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }

  /** One getUpdates round. Handling continues in the background; see idle(). */
  async pollOnce(bot: BotApi) {
    let offset = this.offsets.get(bot.platform);
    if (offset === undefined) {
      const saved = await this.db.get<{ offset: number }>(SYSTEM_OWNER, "bot-state", bot.platform);
      offset = saved?.offset ?? 0;
    }
    const updates = await bot.getUpdates(
      offset,
      this.options.pollTimeoutSeconds ?? 25,
      this.abort.signal,
    );
    for (const update of updates) {
      offset = Math.max(offset, update.update_id + 1);
      if (update.message) this.dispatch(bot, update.message);
    }
    this.offsets.set(bot.platform, offset);
    if (updates.length) await this.db.put(SYSTEM_OWNER, "bot-state", { id: bot.platform, offset });
  }

  /** Messages of one chat are answered in order; different chats run concurrently. */
  private dispatch(bot: BotApi, message: BotMessage) {
    const key = linkId(bot.platform, message.chat.id);
    const chain = this.chains.get(key) ?? { tail: Promise.resolve(), pending: 0 };
    if (chain.pending >= MAX_PENDING_PER_CHAT) {
      this.track(this.send(bot, message.chat.id, botText.busy));
      return;
    }
    chain.pending++;
    chain.tail = chain.tail
      .then(() => this.handle(bot, message))
      .catch((error) => backgroundFailure(`${bot.platform} bot message`, error))
      .finally(() => {
        chain.pending--;
        if (!chain.pending && this.chains.get(key) === chain) this.chains.delete(key);
      });
    this.chains.set(key, chain);
    this.track(chain.tail);
  }

  private track(promise: Promise<unknown>) {
    const tracked = promise.then(
      () => undefined,
      () => undefined,
    );
    this.running.add(tracked);
    void tracked.finally(() => this.running.delete(tracked));
  }

  private allow(map: Map<string, number[]>, key: string, limit: number, windowMs: number) {
    const now = this.now();
    const recent = (map.get(key) ?? []).filter((at) => now - at < windowMs);
    const allowed = recent.length < limit;
    if (allowed) recent.push(now);
    map.set(key, recent);
    return allowed;
  }

  async handle(bot: BotApi, message: BotMessage) {
    const chatId = message.chat.id;
    const key = linkId(bot.platform, chatId);
    const text = message.text?.trim() ?? "";
    const command = /^\/([a-z_]+)(?:@\S+)?(?:\s+([\s\S]*))?$/i.exec(text);
    const name = command?.[1]?.toLowerCase();
    const arg = command?.[2]?.trim() ?? "";
    if (message.chat.type !== "private") {
      if (name === "start" || name === "link" || name === "help")
        await this.send(bot, chatId, botText.privateOnly);
      return;
    }
    const limit = this.options.rateLimit ?? { messages: 8, windowMs: 60_000 };
    if (!this.allow(this.hits, key, limit.messages, limit.windowMs)) {
      // Tell the person once per window instead of answering every flood message.
      if (this.allow(this.hits, `${key}:notice`, 1, limit.windowMs))
        await this.send(bot, chatId, botText.rateLimited);
      return;
    }
    if (name === "link" || (name === "start" && arg)) {
      await this.link(bot, message, toLatinDigits(arg).replace(/\s+/g, ""));
      return;
    }
    const link = await findLink(this.db, bot.platform, chatId);
    if (name === "start" || name === "help") {
      await this.send(bot, chatId, link ? botText.linkedHelp : botText.unlinkedHelp);
      return;
    }
    if (name === "unlink") {
      await this.send(
        bot,
        chatId,
        (await unlinkChat(this.db, key)) ? botText.unlinkedDone : botText.notLinked,
      );
      return;
    }
    if (!link) {
      await this.send(bot, chatId, botText.unlinked);
      return;
    }
    if (name === "new") {
      await this.db.remove(link.owner, HISTORY_KIND, key);
      await this.send(bot, chatId, botText.reset);
      return;
    }
    if (name === "tasks") {
      await this.send(bot, chatId, await this.tasks(link.owner));
      return;
    }
    if (!text) {
      await this.send(bot, chatId, botText.textOnly);
      return;
    }
    if (text.length > MAX_INPUT) {
      await this.send(bot, chatId, botText.tooLong);
      return;
    }
    const refusal = await this.options.quota?.(link.owner);
    if (refusal) {
      await this.send(bot, chatId, refusal);
      return;
    }
    await this.converse(bot, link, text);
  }

  private async link(bot: BotApi, message: BotMessage, code: string) {
    const chatId = message.chat.id;
    if (!code) {
      await this.send(bot, chatId, botText.linkMissingCode);
      return;
    }
    const key = linkId(bot.platform, chatId);
    const failures = (this.linkFailures.get(key) ?? []).filter(
      (at) => this.now() - at < LINK_WINDOW_MS,
    );
    if (failures.length >= LINK_ATTEMPTS) {
      await this.send(bot, chatId, botText.linkTooMany);
      return;
    }
    const owner = await consumeLinkCode(this.db, code, this.now());
    if (!owner) {
      this.linkFailures.set(key, [...failures, this.now()]);
      await this.send(bot, chatId, botText.linkInvalid);
      return;
    }
    this.linkFailures.delete(key);
    const name = message.from?.username ?? message.from?.first_name;
    await linkChat(this.db, bot.platform, chatId, owner, name, this.now());
    await this.send(bot, chatId, botText.linked(bot.platform));
  }

  private async tasks(owner: string) {
    const tasks = (await this.db.list<AgentTask>(owner, "tasks"))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 8);
    if (!tasks.length) return botText.noTasks;
    return [
      "کارهای اخیر:",
      ...tasks.map((task) => `• ${task.title} (${statusFa[task.status] ?? task.status})`),
      "",
      "جزئیات هر کار در «فعالیت» برنامه است.",
    ].join("\n");
  }

  private async converse(bot: BotApi, link: BotLink, text: string) {
    const chatId = link.chatId;
    const stored = await this.db.get<{ id: string; turns: ChatTurn[] }>(
      link.owner,
      HISTORY_KIND,
      link.id,
    );
    const history = stored?.turns ?? [];
    const typing = () => void bot.sendTyping(chatId).catch(() => undefined);
    typing();
    const keepTyping = setInterval(typing, 4500);
    let answer: string;
    try {
      answer = toPlainText(
        await this.options.reply({
          owner: link.owner,
          platform: link.platform,
          threadId: `bot-${link.id}`,
          history,
          text,
        }),
      );
    } catch (error) {
      backgroundFailure(`${bot.platform} bot reply`, error);
      await this.send(bot, chatId, botText.failed);
      return;
    } finally {
      clearInterval(keepTyping);
    }
    if (!answer) {
      await this.send(bot, chatId, botText.empty);
      return;
    }
    const at = new Date(this.now()).toISOString();
    // Re-read so an /unlink or /new that happened meanwhile is not undone.
    if (await findLink(this.db, link.platform, link.chatId)) {
      const limit = this.options.historyLimit ?? 40;
      await this.db.put(link.owner, HISTORY_KIND, {
        id: link.id,
        turns: [
          ...history,
          { role: "user" as const, content: text, at },
          { role: "assistant" as const, content: answer, at },
        ].slice(-limit),
      });
    }
    await this.send(bot, chatId, answer);
  }

  async send(bot: BotApi, chatId: number | string, text: string) {
    for (const chunk of splitMessage(text)) {
      try {
        await bot.sendMessage(chatId, chunk);
      } catch (error) {
        if (error instanceof BotApiError && error.retryAfter && error.retryAfter <= 30) {
          await this.sleep(error.retryAfter * 1000);
          await bot.sendMessage(chatId, chunk);
        } else throw error;
      }
    }
  }

  /**
   * Forward task notifications (finished, failed, needs input or approval) to linked chats.
   * Polling the store works whether tasks run in this process or in another worker.
   */
  async notifyOnce() {
    if (this.notifying) return;
    this.notifying = true;
    try {
      const byOwner = new Map<string, BotLink[]>();
      for (const link of await listLinks(this.db))
        if (this.bots.some((bot) => bot.platform === link.platform))
          byOwner.set(link.owner, [...(byOwner.get(link.owner) ?? []), link]);
      for (const [owner, links] of byOwner) {
        const notifications = (await this.db.list<AgentNotification>(owner, "notifications"))
          .filter((n) => n.taskId)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        for (const link of links) {
          const fresh = notifications.filter((n) => n.createdAt > link.notifiedAt).slice(0, 5);
          if (!fresh.length) continue;
          const bot = this.bots.find((b) => b.platform === link.platform);
          if (!bot) continue;
          const last = fresh.at(-1)?.createdAt ?? link.notifiedAt;
          // Advance first so a failing chat cannot cause repeated deliveries.
          const current = await this.db.get<BotLink>(SYSTEM_OWNER, LINKS_KIND, link.id);
          if (!current || current.owner !== owner) continue;
          await this.db.put(SYSTEM_OWNER, LINKS_KIND, { ...current, notifiedAt: last });
          for (const n of fresh)
            await this.send(bot, link.chatId, notificationText(n)).catch((error) =>
              backgroundFailure(`${bot.platform} bot notification`, error),
            );
        }
      }
    } finally {
      this.notifying = false;
    }
  }
}

export function notificationText(notification: AgentNotification) {
  const body =
    notification.body.length > 1500 ? `${notification.body.slice(0, 1500)}…` : notification.body;
  return toPlainText(
    `${notification.title}\n\n${body}\n\nجزئیات در «فعالیت» برنامهٔ ${BRAND.nameFa}.`,
  );
}
