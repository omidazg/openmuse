import { createHash, randomUUID } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { ImapFlow, type ImapFlowOptions } from "imapflow";
import { type AddressObject, type ParsedMail, simpleParser } from "mailparser";
import { createTransport } from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import type { EmailDraft, Mail } from "../../domain/src/index.ts";
import type { MailSecurity } from "../../domain/src/mailbox.ts";
import { htmlToPlainText, type MailAttachment } from "./google.ts";

/** Decrypted mailbox credentials. Never log or return this object. */
export interface MailboxSettings {
  email: string;
  username: string;
  password: string;
  imapHost: string;
  imapPort: number;
  imapSecurity: MailSecurity;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: MailSecurity;
}

/** A synced message: the shared Mail model plus what SMTP replies need. */
export interface MailboxMessage extends Mail {
  connectionId: string;
  messageId?: string;
  references: string[];
  folder: "INBOX" | "Sent";
}

export class MailboxError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 | 422 | 429 | 502 | 503 = 502,
    /** Set when an SMTP submission may have been delivered despite the error. */
    readonly outcomeUnknown = false,
  ) {
    super(message);
    this.name = "MailboxError";
  }
}

export const CONNECT_FAILED =
  "اتصال به سرور ایمیل برقرار نشد. نشانی سرور، درگاه و گذرواژهٔ برنامه را بررسی کنید.";
const PRIVATE_HOST =
  "این نشانی به شبکهٔ داخلی یا همین سرور اشاره می‌کند و مجاز نیست. نشانی عمومی سرور ایمیل را وارد کنید.";
const HOST_NOT_FOUND = "نشانی سرور ایمیل پیدا نشد. نام میزبان را بررسی کنید.";
const SYNC_FAILED = "خواندن صندوق ورودی ناموفق بود. کمی بعد دوباره تلاش کنید.";

/* ---------- SSRF guard ---------- */

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const)
  blocked.addSubnet(network, prefix, "ipv6");

/** An IPv4 address hidden inside IPv6 (mapped, compatible or NAT64), if any. */
function embeddedIpv4(address: string): string | undefined {
  const lower = address.toLowerCase();
  const dotted = lower.match(/^(?:::ffff:|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  const hex = lower.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return undefined;
  const high = Number.parseInt(hex[1], 16),
    low = Number.parseInt(hex[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family !== 6) return true;
  const v4 = embeddedIpv4(address);
  if (v4) return blocked.check(v4, "ipv4");
  return blocked.check(address, "ipv6");
}

export type Lookup = (host: string) => Promise<{ address: string; family: number }[]>;
const defaultLookup: Lookup = (host) => dnsLookup(host, { all: true, verbatim: true });

/**
 * Resolve once and pin: callers connect to the returned IP (with the hostname kept for TLS/SNI),
 * so a second DNS answer cannot redirect the connection to an internal address.
 */
export async function resolveMailHost(
  host: string,
  options: { allowPrivate?: boolean; lookup?: Lookup } = {},
): Promise<{ address: string; servername?: string }> {
  const name = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!name || name.length > 253 || /[\s/\\@?#]/.test(name))
    throw new MailboxError(HOST_NOT_FOUND, 422);
  let addresses: { address: string }[];
  if (isIP(name)) addresses = [{ address: name }];
  else {
    try {
      addresses = await withTimeout((options.lookup ?? defaultLookup)(name), 10000);
    } catch {
      throw new MailboxError(HOST_NOT_FOUND, 422);
    }
  }
  if (!addresses.length) throw new MailboxError(HOST_NOT_FOUND, 422);
  if (!options.allowPrivate && addresses.some(({ address }) => isPrivateAddress(address)))
    throw new MailboxError(PRIVATE_HOST, 422);
  return { address: addresses[0].address, servername: isIP(name) ? undefined : name };
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        onTimeout?.();
        reject(new MailboxError(CONNECT_FAILED, 502));
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/* ---------- Injected protocol clients ---------- */

export interface FetchedMessage {
  uid: number;
  flags?: Set<string>;
  internalDate?: Date | string;
  source?: Buffer;
}
/** The subset of ImapFlow this module uses; tests inject a fake. */
export interface ImapClient {
  mailbox: false | { uidValidity: bigint | number };
  connect(): Promise<void>;
  logout(): Promise<void>;
  close(): void;
  list(): Promise<{ path: string; specialUse?: string }[]>;
  getMailboxLock(path: string, options?: { readOnly?: boolean }): Promise<{ release(): void }>;
  search(query: { since: Date }, options: { uid: true }): Promise<number[] | false | undefined>;
  fetchAll(
    range: number[],
    query: {
      uid: true;
      flags: true;
      internalDate: true;
      source: { maxLength: number };
    },
    options: { uid: true },
  ): Promise<FetchedMessage[]>;
  append(path: string, content: Buffer, flags?: string[]): Promise<unknown>;
}
export interface SmtpClient {
  verify(): Promise<unknown>;
  sendMail(message: { envelope: { from: string; to: string[] }; raw: Buffer }): Promise<unknown>;
  close(): void;
}
export interface ImapConnectOptions {
  host: string;
  servername?: string;
  port: number;
  secure: boolean;
  requireStartTls: boolean;
  user: string;
  pass: string;
  timeoutMs: number;
}
export type SmtpConnectOptions = ImapConnectOptions;
export interface MailboxDeps {
  imap: (options: ImapConnectOptions) => ImapClient;
  smtp: (options: SmtpConnectOptions) => SmtpClient;
  lookup?: Lookup;
}

export const realMailboxDeps: MailboxDeps = {
  imap: (o) => {
    const options: ImapFlowOptions = {
      host: o.host,
      servername: o.servername,
      port: o.port,
      secure: o.secure,
      doSTARTTLS: o.secure ? undefined : true,
      auth: { user: o.user, pass: o.pass },
      // Never log: imapflow's logger would otherwise print protocol traffic.
      logger: false,
      disableAutoIdle: true,
      connectionTimeout: o.timeoutMs,
      greetingTimeout: o.timeoutMs,
      socketTimeout: o.timeoutMs * 4,
      maxLiteralSize: 8 * 1024 * 1024,
      tls: { minVersion: "TLSv1.2", servername: o.servername },
    };
    const client = new ImapFlow(options);
    // An unhandled 'error' event would crash the process; failures surface through promises.
    client.on("error", () => undefined);
    return client as unknown as ImapClient;
  },
  smtp: (o) =>
    createTransport({
      host: o.host,
      port: o.port,
      secure: o.secure,
      requireTLS: !o.secure,
      auth: { user: o.user, pass: o.pass },
      logger: false,
      debug: false,
      connectionTimeout: o.timeoutMs,
      greetingTimeout: o.timeoutMs,
      socketTimeout: o.timeoutMs * 4,
      tls: { minVersion: "TLSv1.2", servername: o.servername },
    }) as unknown as SmtpClient,
};

/* ---------- Mapping ---------- */

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_BODY_CHARS = 200_000;

function stableId(prefix: string, ...parts: (string | number | bigint)[]) {
  return `${prefix}${createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 24)}`;
}
function addressList(value?: AddressObject | AddressObject[]): { address: string; name: string }[] {
  const objects = value === undefined ? [] : Array.isArray(value) ? value : [value];
  const result: { address: string; name: string }[] = [];
  const visit = (entries: AddressObject["value"]) => {
    for (const entry of entries) {
      if (entry.address) result.push({ address: entry.address, name: entry.name ?? "" });
      if (entry.group) visit(entry.group);
    }
  };
  for (const object of objects) visit(object.value);
  return result;
}
function referenceList(value: ParsedMail["references"]): string[] {
  const list = value === undefined ? [] : Array.isArray(value) ? value : value.split(/\s+/);
  return list.map((ref) => ref.trim()).filter((ref) => /^<[^<>\s]+>$/.test(ref));
}

/** Map a parsed RFC 822 message (mailparser decodes charsets such as windows-1256) into the shared model. */
export function mapParsedMail(
  parsed: ParsedMail,
  meta: {
    connectionId: string;
    folder: "INBOX" | "Sent";
    uid: number;
    uidValidity: bigint | number;
    flags?: Set<string>;
    internalDate?: Date | string;
  },
): MailboxMessage {
  const from = addressList(parsed.from)[0];
  const references = referenceList(parsed.references);
  const inReplyTo = parsed.inReplyTo?.trim().match(/<[^<>\s]+>/)?.[0];
  const messageId = parsed.messageId?.trim().match(/^<[^<>\s]+>$/)?.[0];
  const root = references[0] ?? inReplyTo ?? messageId;
  const id = stableId("imap-", meta.connectionId, meta.folder, meta.uidValidity, meta.uid);
  let body = parsed.text?.trim() || (parsed.html ? htmlToPlainText(parsed.html) : "");
  if (body.length > MAX_BODY_CHARS) body = `${body.slice(0, MAX_BODY_CHARS)}\n…`;
  const when = parsed.date ?? (meta.internalDate ? new Date(meta.internalDate) : undefined);
  return {
    id,
    threadId: root ? stableId("imap-t-", meta.connectionId, root) : id,
    from: from?.address ?? "",
    sender: from?.name || from?.address || "",
    to: addressList(parsed.to).map((entry) => entry.address),
    subject: parsed.subject?.trim() || "(بدون موضوع)",
    body,
    date: when && Number.isFinite(when.getTime()) ? when.toISOString() : "",
    unread: !meta.flags?.has("\\Seen"),
    label: meta.folder === "Sent" ? "Sent" : "Inbox",
    attachments: [],
    connectionId: meta.connectionId,
    messageId,
    references: [...new Set([...references, ...(inReplyTo ? [inReplyTo] : [])])],
    folder: meta.folder,
  };
}

/* ---------- Client ---------- */

export interface SyncOptions {
  days?: number;
  inboxLimit?: number;
  sentLimit?: number;
}

export class MailboxClient {
  private readonly timeoutMs: number;
  constructor(
    private readonly settings: MailboxSettings,
    private readonly options: {
      deps?: MailboxDeps;
      allowPrivate?: boolean;
      timeoutMs?: number;
    } = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 20000;
  }
  private get deps() {
    return this.options.deps ?? realMailboxDeps;
  }
  private async target(host: string, port: number, security: MailSecurity) {
    const resolved = await resolveMailHost(host, {
      allowPrivate: this.options.allowPrivate,
      lookup: this.deps.lookup,
    });
    return {
      host: resolved.address,
      servername: resolved.servername,
      port,
      secure: security === "tls",
      requireStartTls: security === "starttls",
      user: this.settings.username || this.settings.email,
      pass: this.settings.password,
      timeoutMs: this.timeoutMs,
    };
  }
  private async withImap<T>(
    work: (client: ImapClient) => Promise<T>,
    budgetMs: number,
    failure = CONNECT_FAILED,
  ) {
    const s = this.settings;
    const client = this.deps.imap(await this.target(s.imapHost, s.imapPort, s.imapSecurity));
    const run = async () => {
      try {
        await client.connect();
      } catch {
        throw new MailboxError(CONNECT_FAILED, 502);
      }
      try {
        return await work(client);
      } catch (error) {
        // Protocol errors can quote server responses; surface a fixed Persian message instead.
        throw error instanceof MailboxError ? error : new MailboxError(failure, 502);
      } finally {
        await client.logout().catch(() => client.close());
      }
    };
    return withTimeout(run(), budgetMs, () => client.close());
  }

  /** Log in to both servers without reading or sending anything. */
  async verify(): Promise<void> {
    await this.withImap(async (client) => {
      await client.list();
    }, this.timeoutMs * 2);
    const s = this.settings;
    const smtp = this.deps.smtp(await this.target(s.smtpHost, s.smtpPort, s.smtpSecurity));
    try {
      await withTimeout(smtp.verify(), this.timeoutMs * 2, () => smtp.close());
    } catch {
      throw new MailboxError(CONNECT_FAILED, 502);
    } finally {
      smtp.close();
    }
  }

  private async sentFolder(client: ImapClient): Promise<string | undefined> {
    const folders = await client.list();
    return (
      folders.find((f) => f.specialUse === "\\Sent")?.path ??
      folders.find((f) =>
        /^(?:sent|sent items|sent messages)$/i.test(f.path.split(/[/.]/).at(-1) ?? ""),
      )?.path
    );
  }
  private async fetchFolder(
    client: ImapClient,
    path: string,
    folder: "INBOX" | "Sent",
    since: Date,
    limit: number,
    connectionId: string,
  ): Promise<MailboxMessage[]> {
    const lock = await client.getMailboxLock(path, { readOnly: true });
    try {
      const found = (await client.search({ since }, { uid: true })) || [];
      const uids = [...found].sort((a, b) => a - b).slice(-limit);
      if (!uids.length) return [];
      const uidValidity = client.mailbox ? client.mailbox.uidValidity : 0;
      // source is a BODY.PEEK fetch, so syncing never marks messages as read.
      const fetched = await client.fetchAll(
        uids,
        { uid: true, flags: true, internalDate: true, source: { maxLength: MAX_SOURCE_BYTES } },
        { uid: true },
      );
      const result: MailboxMessage[] = [];
      for (const message of fetched) {
        if (!message.source) continue;
        try {
          const parsed = await simpleParser(message.source, { skipImageLinks: true });
          result.push(
            mapParsedMail(parsed, {
              connectionId,
              folder,
              uid: message.uid,
              uidValidity,
              flags: message.flags,
              internalDate: message.internalDate,
            }),
          );
        } catch {
          /* One malformed message must not hide the rest of the mailbox. */
        }
      }
      return result;
    } finally {
      lock.release();
    }
  }

  /** Recent INBOX (and Sent, when present) messages within a bounded window. */
  async sync(connectionId: string, options: SyncOptions = {}): Promise<MailboxMessage[]> {
    const since = new Date(Date.now() - (options.days ?? 30) * 86400000);
    return this.withImap(
      async (client) => {
        const inbox = await this.fetchFolder(
          client,
          "INBOX",
          "INBOX",
          since,
          options.inboxLimit ?? 200,
          connectionId,
        );
        const sentPath = await this.sentFolder(client).catch(() => undefined);
        const sent = sentPath
          ? await this.fetchFolder(
              client,
              sentPath,
              "Sent",
              since,
              options.sentLimit ?? 50,
              connectionId,
            ).catch(() => [])
          : [];
        return [...inbox, ...sent];
      },
      120000,
      SYNC_FAILED,
    );
  }

  /**
   * Submit an approved draft over SMTP, then best-effort copy it to the Sent folder.
   * Only call this from the approval executor.
   */
  async send(
    draft: EmailDraft,
    attachments: MailAttachment[],
    reply?: { messageId?: string; references: string[] },
  ): Promise<{ messageId: string; savedToSent: boolean }> {
    const s = this.settings;
    const domain = s.email.split("@")[1] || "localhost";
    const messageId = `<${randomUUID()}@${domain}>`;
    const references = reply?.messageId
      ? [...new Set([...reply.references, reply.messageId])]
      : undefined;
    const raw = await new MailComposer({
      from: s.email,
      to: draft.to,
      cc: draft.cc.length ? draft.cc : undefined,
      bcc: draft.bcc.length ? draft.bcc : undefined,
      subject: draft.subject,
      text: draft.body,
      messageId,
      date: new Date(),
      inReplyTo: reply?.messageId,
      references,
      attachments: attachments.map((a) => ({
        filename: a.name,
        contentType: a.mimeType,
        content: Buffer.from(a.bytes),
      })),
      disableFileAccess: true,
      disableUrlAccess: true,
    })
      .compile()
      .build();
    let smtp: SmtpClient;
    try {
      smtp = this.deps.smtp(await this.target(s.smtpHost, s.smtpPort, s.smtpSecurity));
    } catch (error) {
      if (error instanceof MailboxError) throw error;
      throw new MailboxError(CONNECT_FAILED, 502);
    }
    try {
      await withTimeout(
        smtp.sendMail({
          envelope: { from: s.email, to: [...draft.to, ...draft.cc, ...draft.bcc] },
          raw,
        }),
        this.timeoutMs * 6,
        () => smtp.close(),
      );
    } catch (error) {
      throw smtpFailure(error);
    } finally {
      smtp.close();
    }
    let savedToSent = false;
    try {
      await this.withImap(async (client) => {
        const path = await this.sentFolder(client);
        if (path) {
          await client.append(path, raw, ["\\Seen"]);
          savedToSent = true;
        }
      }, this.timeoutMs * 3);
    } catch {
      /* Delivery already succeeded; a missing Sent copy is not a failure. */
    }
    return { messageId, savedToSent };
  }
}

/** Definite SMTP rejections vs. failures where the message may already be on its way. */
export function smtpFailure(error: unknown): MailboxError {
  const e = (error ?? {}) as { code?: string; responseCode?: number; command?: string };
  if (typeof e.responseCode === "number" && e.responseCode >= 400)
    return new MailboxError(
      e.code === "EAUTH"
        ? "سرور ایمیل گذرواژه را نپذیرفت. گذرواژهٔ برنامه را بررسی کنید و دوباره متصل شوید."
        : e.code === "EENVELOPE"
          ? "سرور ایمیل یک یا چند گیرنده را نپذیرفت. نشانی گیرنده‌ها را بررسی کنید."
          : "سرور ایمیل پیام را نپذیرفت. متن و گیرنده‌ها را بررسی کنید و دوباره تلاش کنید.",
      502,
    );
  if (["EAUTH", "EDNS", "ECONNECTION", "ETLS", "EENVELOPE"].includes(e.code ?? ""))
    return new MailboxError(CONNECT_FAILED, 502);
  return new MailboxError(
    "ممکن است پیام ارسال شده باشد. پیش از تلاش دوباره، پوشهٔ ارسال‌شده را در صندوق ایمیل خود بررسی کنید.",
    502,
    true,
  );
}
