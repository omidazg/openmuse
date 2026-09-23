import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { simpleParser } from "mailparser";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";
import { foldForSearch } from "../apps/server/src/mailbox.ts";
import type { ActionProposal, Workspace } from "../packages/domain/src/index.ts";
import {
  type ImapClient,
  type ImapConnectOptions,
  isPrivateAddress,
  type MailboxDeps,
  MailboxError,
  mapParsedMail,
  resolveMailHost,
  smtpFailure,
} from "../packages/integrations/src/mailbox.ts";
import { decryptSecret } from "../packages/integrations/src/vault.ts";

const PASSWORD = "app-password-SECRET-1234";
const PUBLIC_IP = "93.184.216.34";

/** windows-1256 bytes for «سلام علي», the way many Iranian mail servers still send Persian. */
const CP1256_BODY = Buffer.from([0xd3, 0xe1, 0xc7, 0xe3, 0x20, 0xda, 0xe1, 0xed]);
const b64 = (text: string) => Buffer.from(text).toString("base64");
function rawMessage(options: {
  from: string;
  subject: string;
  messageId: string;
  inReplyTo?: string;
  references?: string;
  date: string;
  body?: Buffer;
  html?: string;
}) {
  const headers = [
    `From: ${options.from}`,
    "To: me@example.ir",
    `Subject: =?UTF-8?B?${b64(options.subject)}?=`,
    `Message-ID: ${options.messageId}`,
    ...(options.inReplyTo ? [`In-Reply-To: ${options.inReplyTo}`] : []),
    ...(options.references ? [`References: ${options.references}`] : []),
    `Date: ${options.date}`,
    "MIME-Version: 1.0",
    options.html
      ? "Content-Type: text/html; charset=utf-8"
      : "Content-Type: text/plain; charset=windows-1256",
    "Content-Transfer-Encoding: 8bit",
    "",
    "",
  ].join("\r\n");
  return Buffer.concat([
    Buffer.from(headers, "latin1"),
    options.html ? Buffer.from(options.html) : (options.body ?? CP1256_BODY),
  ]);
}

interface Stored {
  folder: string;
  uid: number;
  raw: Buffer;
  flags: string[];
}
function fakeMailServer(messages: Stored[], options: { failLogin?: boolean } = {}) {
  const log = {
    imap: [] as ImapConnectOptions[],
    smtp: [] as ImapConnectOptions[],
    sent: [] as { envelope: { from: string; to: string[] }; raw: Buffer }[],
    appended: [] as { path: string; content: string; flags?: string[] }[],
    lookups: [] as string[],
  };
  const deps: MailboxDeps = {
    lookup: async (host) => {
      log.lookups.push(host);
      return [{ address: PUBLIC_IP, family: 4 }];
    },
    imap: (connect) => {
      log.imap.push(connect);
      let current = "";
      const client: ImapClient = {
        mailbox: false,
        async connect() {
          if (options.failLogin) throw new Error(`AUTHENTICATIONFAILED for ${connect.pass}`);
        },
        async logout() {},
        close() {},
        async list() {
          return [{ path: "INBOX" }, { path: "Sent Items", specialUse: "\\Sent" }];
        },
        async getMailboxLock(path) {
          current = path;
          client.mailbox = { uidValidity: 7n };
          return { release() {} };
        },
        async search() {
          return messages.filter((m) => m.folder === current).map((m) => m.uid);
        },
        async fetchAll(uids) {
          return messages
            .filter((m) => m.folder === current && uids.includes(m.uid))
            .map((m) => ({ uid: m.uid, flags: new Set(m.flags), source: m.raw }));
        },
        async append(path, content, flags) {
          log.appended.push({ path, content: content.toString("utf8"), flags });
        },
      };
      return client;
    },
    smtp: (connect) => {
      log.smtp.push(connect);
      return {
        async verify() {
          if (options.failLogin) throw new Error("Invalid login");
        },
        async sendMail(message) {
          log.sent.push(message);
          return { messageId: "x" };
        },
        close() {},
      };
    },
  };
  return { deps, log };
}

const inboxMessages = (): Stored[] => [
  {
    folder: "INBOX",
    uid: 11,
    flags: [],
    raw: rawMessage({
      from: '"Ali Rezaei" <ali@company.ir>',
      subject: "جلسهٔ فردا",
      messageId: "<root@company.ir>",
      date: "Mon, 21 Sep 2026 08:00:00 +0330",
    }),
  },
  {
    folder: "INBOX",
    uid: 12,
    flags: ["\\Seen"],
    raw: rawMessage({
      from: "ali@company.ir",
      subject: "Re: جلسهٔ فردا",
      messageId: "<second@company.ir>",
      inReplyTo: "<root@company.ir>",
      references: "<root@company.ir>",
      date: "Mon, 21 Sep 2026 09:00:00 +0330",
      html: "<p>ساعت <b>۱۰</b> خوب است</p><script>alert(1)</script>",
    }),
  },
];

async function appFixture(t: TestContext, deps: MailboxDeps, extra: Partial<Config> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-mailbox-"));
  const db = await createStore();
  const config: Config = {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "sample",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: [],
    encryptionKey: randomBytes(32).toString("base64"),
    ...extra,
  };
  const created = await createApp(db, config, { mailbox: deps });
  t.after(async () => {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  });
  const session = await created.app.request("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const token: string = (await session.json()).token;
  const call = async (path: string, body?: unknown) => {
    const response = await created.app.request(path, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, text: await response.text() };
  };
  return { ...created, db, config, call };
}

const connectBody = {
  preset: "other",
  email: "me@example.ir",
  password: PASSWORD,
  imapHost: "mail.example.ir",
  imapPort: "۹۹۳",
  imapSecurity: "tls",
  smtpHost: "mail.example.ir",
  smtpPort: 587,
  smtpSecurity: "starttls",
};

test("SSRF guard rejects private, loopback and mapped addresses unless explicitly allowed", async () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "172.20.0.5",
    "192.168.1.10",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "::",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "64:ff9b::a00:1",
  ])
    assert.equal(isPrivateAddress(address), true, address);
  for (const address of [PUBLIC_IP, "2606:4700:4700::1111", "::ffff:93.184.216.34"])
    assert.equal(isPrivateAddress(address), false, address);

  const lookup = async (host: string) =>
    host === "rebind.example"
      ? [
          { address: PUBLIC_IP, family: 4 },
          { address: "10.0.0.5", family: 4 },
        ]
      : [{ address: "127.0.0.1", family: 4 }];
  await assert.rejects(resolveMailHost("localhost", { lookup }), /شبکهٔ داخلی/);
  await assert.rejects(resolveMailHost("rebind.example", { lookup }), /شبکهٔ داخلی/);
  await assert.rejects(resolveMailHost("[::1]"), /شبکهٔ داخلی/);
  await assert.rejects(resolveMailHost("http://evil/"), MailboxError);
  assert.deepEqual(await resolveMailHost("localhost", { lookup, allowPrivate: true }), {
    address: "127.0.0.1",
    servername: "localhost",
  });
  // The resolved address is pinned; the hostname only travels as the TLS servername.
  assert.deepEqual(
    await resolveMailHost("Mail.Example.ir", {
      lookup: async () => [{ address: PUBLIC_IP, family: 4 }],
    }),
    { address: PUBLIC_IP, servername: "mail.example.ir" },
  );
});

test("parsed messages map to the shared mail model with Persian-safe decoding and threads", async () => {
  const [first, second] = inboxMessages();
  const meta = { connectionId: "c1", folder: "INBOX" as const, uidValidity: 7n };
  const root = mapParsedMail(await simpleParser(first.raw), {
    ...meta,
    uid: first.uid,
    flags: new Set(),
  });
  const reply = mapParsedMail(await simpleParser(second.raw), {
    ...meta,
    uid: second.uid,
    flags: new Set(["\\Seen"]),
  });
  assert.equal(root.subject, "جلسهٔ فردا");
  assert.equal(root.body, "سلام علي");
  assert.equal(root.from, "ali@company.ir");
  assert.equal(root.sender, "Ali Rezaei");
  assert.deepEqual(root.to, ["me@example.ir"]);
  assert.equal(root.unread, true);
  assert.equal(root.label, "Inbox");
  assert.equal(root.date, "2026-09-21T04:30:00.000Z");
  assert.deepEqual(root.attachments, []);
  assert.match(root.id, /^imap-[0-9a-f]{24}$/);
  assert.equal(reply.threadId, root.threadId);
  assert.notEqual(reply.id, root.id);
  assert.equal(reply.unread, false);
  assert.equal(reply.body, "ساعت ۱۰ خوب است");
  assert.deepEqual(reply.references, ["<root@company.ir>"]);
  assert.equal(foldForSearch("علي ۱۰ كتاب"), foldForSearch("علی 10 کتاب"));
});

test("connecting validates, encrypts the password per owner and never echoes it", async (t) => {
  const { deps, log } = fakeMailServer(inboxMessages());
  const { call, db, config } = await appFixture(t, deps);
  const connected = await call("/api/mailbox/connect", connectBody);
  assert.equal(connected.status, 201, connected.text);
  assert.equal(connected.text.includes(PASSWORD), false);
  assert.equal(JSON.parse(connected.text).account, "me@example.ir");
  // Connections go to the pinned public IP with the hostname kept for TLS.
  assert.equal(log.imap[0].host, PUBLIC_IP);
  assert.equal(log.imap[0].servername, "mail.example.ir");
  assert.equal(log.imap[0].port, 993);
  assert.equal(log.imap[0].secure, true);
  assert.equal(log.smtp[0].secure, false);
  assert.equal(log.smtp[0].requireStartTls, true);

  const [{ owner, value }] = (await db.scan<{ id: string; secret: string }>("credentials")).filter(
    (row) => row.value.id === "imap",
  );
  assert.equal(JSON.stringify(value).includes(PASSWORD), false);
  const settings = JSON.parse(decryptSecret(value.secret, config.encryptionKey ?? ""));
  assert.equal(settings.password, PASSWORD);
  assert.equal(settings.username, "me@example.ir");
  assert.equal(await db.get(`${owner}-other`, "credentials", "imap"), null);

  const workspace: Workspace = JSON.parse((await call("/api/workspace")).text);
  const imap = workspace.connections.find((c) => c.id === "imap");
  assert.equal(imap?.status, "connected");
  assert.ok(imap?.syncedAt);
  assert.equal(JSON.stringify(workspace).includes(PASSWORD), false);
  assert.equal(workspace.mail.length, 2);
  assert.equal(workspace.mail[0].subject, "Re: جلسهٔ فردا");

  assert.equal((await call("/api/mailbox/disconnect", {})).status, 200);
  const after: Workspace = JSON.parse((await call("/api/workspace")).text);
  assert.equal(after.connections.find((c) => c.id === "imap")?.status, "disconnected");
  assert.equal(
    after.mail.some((m) => m.id.startsWith("imap-")),
    false,
  );
  assert.equal((await db.list(owner, "imap-mail")).length, 0);
  assert.equal(await db.get(owner, "credentials", "imap"), null);
});

test("failed logins return the Persian guidance, store nothing and are rate limited", async (t) => {
  const { deps } = fakeMailServer([], { failLogin: true });
  const { call, db } = await appFixture(t, deps);
  const failed = await call("/api/mailbox/connect", connectBody);
  assert.equal(failed.status, 502);
  assert.equal(
    JSON.parse(failed.text).error,
    "اتصال به سرور ایمیل برقرار نشد. نشانی سرور، درگاه و گذرواژهٔ برنامه را بررسی کنید.",
  );
  assert.equal(failed.text.includes(PASSWORD), false);
  assert.equal((await db.scan("credentials")).length, 0);
  for (let attempt = 2; attempt <= 5; attempt++)
    assert.equal((await call("/api/mailbox/connect", connectBody)).status, 502);
  const limited = await call("/api/mailbox/connect", connectBody);
  assert.equal(limited.status, 429);
});

test("private mail hosts are refused unless ALLOW_PRIVATE_MAIL_HOSTS is set", async (t) => {
  const { deps, log } = fakeMailServer([]);
  const internal = { ...deps, lookup: async () => [{ address: "10.0.0.8", family: 4 }] };
  const blocked = await appFixture(t, internal);
  const refused = await blocked.call("/api/mailbox/connect", connectBody);
  assert.equal(refused.status, 422);
  assert.match(JSON.parse(refused.text).error, /شبکهٔ داخلی/);
  assert.equal(log.imap.length, 0);
  const allowed = await appFixture(t, internal, { allowPrivateMailHosts: true });
  assert.equal((await allowed.call("/api/mailbox/connect", connectBody)).status, 201);
  assert.equal(log.imap[0].host, "10.0.0.8");
});

test("IMAP mail feeds search and threads; SMTP sends only after approval", async (t) => {
  const { deps, log } = fakeMailServer(inboxMessages());
  const { call, workspace, db } = await appFixture(t, deps);
  assert.equal((await call("/api/mailbox/connect", connectBody)).status, 201);
  const [{ owner }] = await db.scan("credentials");

  // search_mail / read_mail_thread go through these workspace methods.
  const found = await workspace.searchMail(owner, "علی");
  assert.equal(found.length, 1);
  assert.equal(found[0].subject, "جلسهٔ فردا");
  const thread = await workspace.thread(owner, found[0].threadId);
  assert.deepEqual(
    thread.map((m) => m.subject),
    ["جلسهٔ فردا", "Re: جلسهٔ فردا"],
  );

  const draft = {
    kind: "email.send",
    data: {
      to: ["ali@company.ir"],
      subject: "Re: جلسهٔ فردا",
      body: "سلام، ساعت ۱۰ می‌آیم.",
      threadId: thread[1].threadId,
      replyToMessageId: thread[1].id,
    },
  };
  const proposed = await call("/api/actions", draft);
  assert.equal(proposed.status, 201, proposed.text);
  const proposal: ActionProposal = JSON.parse(proposed.text);
  assert.equal(proposal.status, "awaiting_review");
  assert.equal(proposal.account, "me@example.ir");
  assert.equal(log.sent.length, 0, "preparing an email must not send it");

  const denied = await call(`/api/actions/${proposal.id}/decide`, {
    hash: proposal.hash,
    decision: "deny",
  });
  assert.equal(JSON.parse(denied.text).status, "denied");
  assert.equal(log.sent.length, 0, "a denied email is never sent");

  const again: ActionProposal = JSON.parse((await call("/api/actions", draft)).text);
  const approved = await call(`/api/actions/${again.id}/decide`, {
    hash: again.hash,
    decision: "approve",
  });
  const result: ActionProposal = JSON.parse(approved.text);
  assert.equal(result.status, "succeeded", approved.text);
  assert.match(result.result ?? "", /SMTP/);
  assert.equal(log.sent.length, 1);
  assert.deepEqual(log.sent[0].envelope, { from: "me@example.ir", to: ["ali@company.ir"] });
  const raw = log.sent[0].raw.toString("utf8");
  assert.match(raw, /In-Reply-To: <second@company\.ir>/);
  assert.match(raw, /References: <root@company\.ir> <second@company\.ir>/);
  assert.equal(log.appended.length, 1);
  assert.equal(log.appended[0].path, "Sent Items");
  assert.deepEqual(log.appended[0].flags, ["\\Seen"]);

  // Calendar actions keep using the Google connection even while the mailbox handles mail.
  const event: ActionProposal = JSON.parse(
    (
      await call("/api/actions", {
        kind: "calendar.create",
        data: {
          title: "جلسه",
          start: "2026-09-24T10:00:00+03:30",
          end: "2026-09-24T11:00:00+03:30",
        },
      })
    ).text,
  );
  assert.notEqual(event.connectionId, proposal.connectionId);
  assert.equal(event.account, "arash@example.com");
});

test("SMTP failures separate definite rejections from possibly-sent outcomes", () => {
  assert.equal(smtpFailure({ code: "EAUTH", responseCode: 535 }).outcomeUnknown, false);
  assert.equal(smtpFailure({ code: "EENVELOPE", responseCode: 550 }).outcomeUnknown, false);
  assert.equal(smtpFailure({ code: "ECONNECTION" }).outcomeUnknown, false);
  assert.equal(smtpFailure({ code: "ETIMEDOUT", command: "DATA" }).outcomeUnknown, true);
  assert.equal(smtpFailure(new Error("socket closed")).outcomeUnknown, true);
});
