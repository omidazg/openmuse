import { randomUUID } from "node:crypto";
import type { EmailDraft, Mail } from "../../../packages/domain/src/index.ts";
import { toLatinDigits } from "../../../packages/domain/src/index.ts";
import { mailboxConnectSchema } from "../../../packages/domain/src/mailbox.ts";
import type { MailAttachment } from "../../../packages/integrations/src/google.ts";
import {
  MailboxClient,
  type MailboxDeps,
  MailboxError,
  type MailboxMessage,
  type MailboxSettings,
} from "../../../packages/integrations/src/mailbox.ts";
import { decryptSecret, encryptSecret } from "../../../packages/integrations/src/vault.ts";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";
import { backgroundFailure } from "./log.ts";

/** Stored under kind "credentials", id "imap"; only `secret` holds the password (encrypted). */
interface MailboxCredential {
  id: "imap";
  connectionId: string | null;
  account: string | null;
  imapHost?: string;
  smtpHost?: string;
  secret: string | null;
}
interface SyncState {
  id: "imap-sync";
  connectionId: string;
  lastSyncAt?: string;
  lastError?: string;
}
export interface MailboxStatus {
  connectionId: string;
  account: string;
  imapHost?: string;
  smtpHost?: string;
  lastSyncAt?: string;
  lastError?: string;
}

const MAIL_KIND = "imap-mail";
const CONNECT_WINDOW_MS = 10 * 60000;
const CONNECT_ATTEMPTS = 5;
const SEARCH_STALE_MS = 2 * 60000;
const REFRESH_EVERY_MS = 10 * 60000;

/** Persian-aware folding for local search: Arabic ي/ك, ZWNJ, tatweel and digits. */
export function foldForSearch(text: string): string {
  return toLatinDigits(text)
    .toLowerCase()
    .replace(/ي/g, "ی")
    .replace(/ى/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\u200c|\u200d|\u0640/g, "")
    .replace(/[\u064b-\u065f\u0670]/g, "");
}

export class MailboxService {
  private readonly attempts = new Map<string, number[]>();
  private readonly syncing = new Map<string, Promise<Mail[]>>();
  private refreshing?: Promise<void>;
  constructor(
    private readonly db: Store,
    private readonly config: Config,
    private readonly deps?: MailboxDeps,
    private readonly now: () => number = Date.now,
  ) {}

  private key() {
    if (!this.config.encryptionKey)
      throw new AppError(
        "برای اتصال ایمیل، مدیر سرور باید TOKEN_ENCRYPTION_KEY را پیکربندی کند.",
        503,
      );
    return this.config.encryptionKey;
  }
  private client(settings: MailboxSettings) {
    return new MailboxClient(settings, {
      deps: this.deps,
      allowPrivate: this.config.allowPrivateMailHosts === true,
    });
  }
  private rethrow(error: unknown): never {
    if (error instanceof MailboxError) {
      const wrapped = new AppError(error.message, error.status);
      if (error.outcomeUnknown) Object.assign(wrapped, { outcomeUnknown: true });
      throw wrapped;
    }
    throw error;
  }
  private limit(owner: string) {
    const now = this.now();
    const recent = (this.attempts.get(owner) ?? []).filter((t) => now - t < CONNECT_WINDOW_MS);
    if (recent.length >= CONNECT_ATTEMPTS)
      throw new AppError(
        "تلاش‌های اتصال ایمیل بیش از حد بوده است. ده دقیقهٔ دیگر دوباره تلاش کنید.",
        429,
      );
    recent.push(now);
    this.attempts.set(owner, recent);
  }

  async status(owner: string): Promise<MailboxStatus | null> {
    const stored = await this.db.get<MailboxCredential>(owner, "credentials", "imap");
    if (!stored?.secret || !stored.connectionId || !stored.account) return null;
    const sync = await this.db.get<SyncState>(owner, "settings", "imap-sync");
    const current = sync?.connectionId === stored.connectionId ? sync : undefined;
    return {
      connectionId: stored.connectionId,
      account: stored.account,
      imapHost: stored.imapHost,
      smtpHost: stored.smtpHost,
      lastSyncAt: current?.lastSyncAt,
      lastError: current?.lastError,
    };
  }
  private async settings(owner: string, expectedConnectionId?: string) {
    const stored = await this.db.get<MailboxCredential>(owner, "credentials", "imap");
    if (!stored?.secret || !stored.connectionId)
      throw new AppError("ایمیل متصل نیست. در «برنامه‌ها» صندوق ایمیل را وصل کنید.", 409);
    if (expectedConnectionId && stored.connectionId !== expectedConnectionId)
      throw new AppError("حساب ایمیل تغییر کرده است. اقدام تازه‌ای آماده کنید.", 409);
    const settings = JSON.parse(decryptSecret(stored.secret, this.key())) as MailboxSettings;
    return { settings, connectionId: stored.connectionId };
  }

  /** Validate by logging in to IMAP and SMTP, then store the credentials encrypted. */
  async connect(owner: string, raw: unknown): Promise<MailboxStatus> {
    const key = this.key();
    this.limit(owner);
    const input = mailboxConnectSchema.parse(
      raw && typeof raw === "object"
        ? Object.fromEntries(
            Object.entries(raw).map(([k, v]) => [
              k,
              typeof v === "string" && k.endsWith("Port") ? toLatinDigits(v) : v,
            ]),
          )
        : raw,
    );
    const settings: MailboxSettings = {
      email: input.email,
      username: input.username?.trim() || input.email,
      password: input.password,
      imapHost: input.imapHost,
      imapPort: input.imapPort,
      imapSecurity: input.imapSecurity,
      smtpHost: input.smtpHost,
      smtpPort: input.smtpPort,
      smtpSecurity: input.smtpSecurity,
    };
    try {
      await this.client(settings).verify();
    } catch (error) {
      this.rethrow(error);
    }
    const connectionId = randomUUID();
    await this.clearMail(owner);
    await this.db.put<MailboxCredential>(owner, "credentials", {
      id: "imap",
      connectionId,
      account: input.email,
      imapHost: input.imapHost,
      smtpHost: input.smtpHost,
      secret: encryptSecret(JSON.stringify(settings), key),
    });
    await this.db.put<SyncState>(owner, "settings", { id: "imap-sync", connectionId });
    await this.sync(owner).catch(() => undefined);
    return (await this.status(owner)) as MailboxStatus;
  }

  async disconnect(owner: string) {
    await this.db.remove(owner, "credentials", "imap");
    await this.db.remove(owner, "settings", "imap-sync");
    await this.clearMail(owner);
  }
  private async clearMail(owner: string) {
    for (const message of await this.db.list<{ id: string }>(owner, MAIL_KIND))
      await this.db.remove(owner, MAIL_KIND, message.id);
  }

  /** Fetch the recent window and mirror it locally; concurrent calls share one IMAP session. */
  sync(owner: string): Promise<Mail[]> {
    const active = this.syncing.get(owner);
    if (active) return active;
    const task = this.runSync(owner).finally(() => this.syncing.delete(owner));
    this.syncing.set(owner, task);
    return task;
  }
  private async runSync(owner: string): Promise<Mail[]> {
    const { settings, connectionId } = await this.settings(owner);
    let messages: MailboxMessage[];
    try {
      messages = await this.client(settings).sync(connectionId);
    } catch (error) {
      await this.db.put<SyncState>(owner, "settings", {
        id: "imap-sync",
        connectionId,
        lastSyncAt: (await this.db.get<SyncState>(owner, "settings", "imap-sync"))?.lastSyncAt,
        lastError:
          error instanceof MailboxError
            ? error.message
            : "همگام‌سازی ایمیل ناموفق بود. کمی بعد دوباره تلاش کنید.",
      });
      this.rethrow(error);
    }
    // Credentials may have changed while the session ran; never store stale mail.
    const current = await this.db.get<MailboxCredential>(owner, "credentials", "imap");
    if (current?.connectionId !== connectionId) return [];
    const keep = new Set(messages.map((m) => m.id));
    for (const old of await this.db.list<{ id: string }>(owner, MAIL_KIND))
      if (!keep.has(old.id)) await this.db.remove(owner, MAIL_KIND, old.id);
    for (const message of messages) await this.db.put(owner, MAIL_KIND, message);
    await this.db.put<SyncState>(owner, "settings", {
      id: "imap-sync",
      connectionId,
      lastSyncAt: new Date(this.now()).toISOString(),
    });
    return messages;
  }
  private async stale(owner: string, maxAgeMs: number) {
    const status = await this.status(owner);
    return !status?.lastSyncAt || this.now() - Date.parse(status.lastSyncAt) > maxAgeMs;
  }

  async list(owner: string): Promise<MailboxMessage[]> {
    const status = await this.status(owner);
    if (!status) return [];
    return (await this.db.list<MailboxMessage>(owner, MAIL_KIND))
      .filter((m) => m.connectionId === status.connectionId)
      .sort((a, b) => b.date.localeCompare(a.date));
  }
  async search(owner: string, query: string): Promise<Mail[]> {
    if (await this.stale(owner, SEARCH_STALE_MS)) {
      try {
        await this.sync(owner);
      } catch (error) {
        // Fall back to the last synced copy; only fail when there is nothing to search.
        if (!(await this.list(owner)).length) throw error;
      }
    }
    const words = foldForSearch(query).trim().split(/\s+/).filter(Boolean);
    return (await this.list(owner)).filter(
      (m) =>
        m.folder !== "Sent" &&
        words.every((word) =>
          foldForSearch(`${m.sender} ${m.from} ${m.subject} ${m.body}`).includes(word),
        ),
    );
  }
  async thread(owner: string, threadId: string): Promise<MailboxMessage[]> {
    let messages = (await this.list(owner)).filter((m) => m.threadId === threadId);
    if (!messages.length && (await this.stale(owner, SEARCH_STALE_MS))) {
      await this.sync(owner).catch(() => undefined);
      messages = (await this.list(owner)).filter((m) => m.threadId === threadId);
    }
    return messages.sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Called only by the approval executor after the user approved this exact draft. */
  async send(
    owner: string,
    connectionId: string,
    draft: EmailDraft,
    attachments: MailAttachment[],
  ): Promise<string> {
    const { settings } = await this.settings(owner, connectionId);
    let reply: { messageId?: string; references: string[] } | undefined;
    if (draft.replyToMessageId) {
      const source = await this.db.get<MailboxMessage>(owner, MAIL_KIND, draft.replyToMessageId);
      if (!source || source.connectionId !== connectionId)
        throw new AppError("ایمیلِ مورد پاسخ پیدا نشد. صندوق ورودی را تازه کنید.", 404);
      if (draft.threadId && source.threadId !== draft.threadId)
        throw new AppError("رشتهٔ پاسخ با ایمیل مبدأ یکی نیست.", 422);
      reply = { messageId: source.messageId, references: source.references };
    }
    try {
      const result = await this.client(settings).send(draft, attachments, reply);
      return result.savedToSent
        ? `پیام با SMTP ارسال شد و در پوشهٔ ارسال‌شده ذخیره شد · ${result.messageId}`
        : `پیام با SMTP ارسال شد · ${result.messageId}`;
    } catch (error) {
      this.rethrow(error);
    }
  }

  /** Periodic refresh from the task worker; one pass at a time, failures stay per owner. */
  refreshDue(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      for (const { owner, value } of await this.db.scan<MailboxCredential>("credentials")) {
        if (value.id !== "imap" || !value.secret) continue;
        if (!(await this.stale(owner, REFRESH_EVERY_MS))) continue;
        await this.sync(owner).catch((error) => backgroundFailure("mailbox refresh", error));
      }
    })().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }
  async stop() {
    await this.refreshing?.catch(() => undefined);
    await Promise.allSettled(this.syncing.values());
  }
}
