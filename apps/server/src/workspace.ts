import { randomUUID } from "node:crypto";
import { BRAND } from "../../../packages/domain/src/brand.ts";
import type {
  ActionProposal,
  ActivityEntry,
  Artifact,
  BrowserSession,
  CalendarEvent,
  Mail,
  ProposalInput,
  Workspace,
} from "../../../packages/domain/src/index.ts";
import { GoogleClient } from "../../../packages/integrations/src/google.ts";
import { createSamplePdf } from "../../../packages/integrations/src/pdf.ts";
import type { ActionService } from "./actions.ts";
import { agentConfigured } from "./agent.ts";
import { type Config, threadsBackend } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";
import type { Files } from "./files.ts";
import type { GoogleAuth } from "./google-auth.ts";
import { MailboxService } from "./mailbox.ts";
import { localThreadsEnabled } from "./threads.ts";

const sampleTimeZone = "Asia/Tehran";
/** Which connector an operation needs: mail prefers an IMAP mailbox; calendar and Gmail need Google. */
export type ConnectionPurpose = "mail" | "google";
export function purposeOf(kind: ProposalInput["kind"]): ConnectionPurpose {
  return kind === "email.send" ? "mail" : "google";
}

const NO_MAILBOX =
  "اتصال گوگل قطع است و صندوق ایمیلی هم متصل نیست. در «برنامه‌ها» ایمیل را وصل کنید.";

export class WorkspaceService {
  private seeding = new Map<string, Promise<void>>();
  constructor(
    private readonly db: Store,
    private readonly config: Config,
    private readonly files: Files,
    private readonly googleAuth: GoogleAuth,
    readonly mailbox: MailboxService = new MailboxService(db, config),
  ) {}
  google(owner: string, connectionId?: string) {
    return new GoogleClient({
      getAccessToken: () => this.googleAuth.accessToken(owner, connectionId),
    });
  }
  /**
   * The account an operation acts on. Without a purpose this is the primary connection
   * (Google, else the IMAP mailbox), which tasks record to detect account switches.
   */
  async connection(
    owner: string,
    purpose?: ConnectionPurpose,
  ): Promise<{ id: string; account: string } | null> {
    if (purpose === "mail") {
      const mailbox = await this.mailbox.status(owner);
      if (mailbox) return { id: mailbox.connectionId, account: mailbox.account };
    }
    const google = await this.googleConnection(owner);
    if (google || purpose === "google") return google;
    const mailbox = await this.mailbox.status(owner);
    return mailbox ? { id: mailbox.connectionId, account: mailbox.account } : null;
  }
  private async googleConnection(owner: string) {
    if (this.config.mode === "sample") {
      const value = await this.db.get<{ enabled: boolean; connectionId?: string }>(
        owner,
        "settings",
        "google",
      );
      return value?.enabled === false
        ? null
        : { id: value?.connectionId ?? "sample-google", account: "arash@example.com" };
    }
    const tokens = await this.googleAuth.tokens(owner);
    return tokens ? { id: tokens.connectionId, account: tokens.account } : null;
  }
  async connected(owner: string, purpose?: ConnectionPurpose) {
    if (purpose !== "google" && (await this.mailbox.status(owner))) return true;
    return this.googleConnected(owner);
  }
  private async googleConnected(owner: string) {
    return this.config.mode === "sample"
      ? (await this.db.get<{ enabled: boolean }>(owner, "settings", "google"))?.enabled !== false
      : Boolean(await this.googleAuth.tokens(owner));
  }
  async calendars(owner: string) {
    const connection = await this.connection(owner, "google");
    if (!connection) return [];
    if (this.config.mode === "sample")
      return [
        {
          id: "primary",
          name: "شخصی",
          timeZone: sampleTimeZone,
          accessRole: "owner",
        },
      ];
    return this.google(owner, connection.id).listCalendars();
  }
  async events(
    owner: string,
    options: { calendarId?: string; timeMin?: string; timeMax?: string } = {},
  ) {
    const connection = await this.connection(owner, "google");
    if (!connection) return [];
    if (this.config.mode === "live") return this.google(owner, connection.id).listEvents(options);
    return (await this.db.list<CalendarEvent>(owner, "events"))
      .filter(
        (event) =>
          event.calendarId === (options.calendarId ?? "primary") &&
          (!options.timeMax || Date.parse(event.start) < Date.parse(options.timeMax)) &&
          (!options.timeMin || Date.parse(event.end) > Date.parse(options.timeMin)),
      )
      .sort((a, b) => a.start.localeCompare(b.start));
  }
  private async cacheMail(owner: string, mail: Mail[], connectionId: string) {
    const imports = await this.db.list<{ id: string; artifactId: string; connectionId?: string }>(
      owner,
      "imports",
    );
    const result = mail.map((message) => ({
      ...message,
      attachments: message.attachments.map(
        (ref) =>
          imports.find((i) => i.id === ref && i.connectionId === connectionId)?.artifactId ?? ref,
      ),
    }));
    for (const message of result) await this.db.put(owner, "mail", { ...message, connectionId });
    return result;
  }
  async thread(owner: string, id: string) {
    if (await this.mailbox.status(owner)) {
      const messages = await this.mailbox.thread(owner, id);
      if (!messages.length) throw new AppError("رشتهٔ ایمیل پیدا نشد", 404);
      return messages;
    }
    const connection = await this.connection(owner, "google");
    if (!connection) throw new AppError(NO_MAILBOX, 409);
    const mail =
      this.config.mode === "sample"
        ? (await this.db.list<Mail>(owner, "mail")).filter((m) => m.threadId === id)
        : await this.cacheMail(
            owner,
            await this.google(owner, connection.id).getThread(id),
            connection.id,
          );
    if (!mail.length) throw new AppError("رشتهٔ ایمیل پیدا نشد", 404);
    return mail.sort((a, b) => a.date.localeCompare(b.date));
  }
  async searchMail(owner: string, query: string) {
    if (await this.mailbox.status(owner)) return this.mailbox.search(owner, query);
    const connection = await this.connection(owner, "google");
    if (!connection) throw new AppError(NO_MAILBOX, 409);
    if (this.config.mode === "live")
      return this.cacheMail(
        owner,
        await this.google(owner, connection.id).listMail(query || "in:inbox"),
        connection.id,
      );
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return (await this.db.list<Mail>(owner, "mail"))
      .filter(
        (message) =>
          !/^Sent\b/i.test(message.label) &&
          words.every((word) =>
            `${message.sender} ${message.from} ${message.subject} ${message.body}`
              .toLowerCase()
              .includes(word),
          ),
      )
      .sort((a, b) => b.date.localeCompare(a.date));
  }
  async ensureSample(owner: string, actions: ActionService) {
    if (this.config.mode !== "sample") return;
    const active = this.seeding.get(owner);
    if (active) return active;
    const task = this.seed(owner, actions).finally(() => this.seeding.delete(owner));
    this.seeding.set(owner, task);
    await task;
  }
  private async seed(owner: string, actions: ActionService) {
    if (await this.db.get(owner, "settings", "seeded")) return;
    const file = await this.files.import(
      owner,
      "رضایت‌نامهٔ اردو.pdf",
      await createSamplePdf({ renderHtml: this.files.renderHtml }),
      "Gmail · دبیرستان فرهنگ",
    );
    // Sample times are wall-clock hours in Tehran (UTC+03:30, no DST); storage stays UTC.
    const tehranOffset = 210 * 60000;
    const now = new Date();
    const today = new Date(now.getTime() + tehranOffset);
    const at = (h: number, m = 0) =>
      new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), h, m) -
          tehranOffset,
      ).toISOString();
    const mails: Mail[] = [
      {
        id: "mail-fieldtrip",
        threadId: "trip-thread",
        sender: "دبیرستان فرهنگ",
        from: "office@farhang-school.example",
        to: ["arash@example.com"],
        subject: "یادآوری: رضایت‌نامهٔ اردو را تا چهارشنبه بفرستید",
        body: "سلام آقای کریمی،\n\nکلاس ما این چهارشنبه برای بازدید به آکواریوم تهران می‌رود. لطفاً رضایت‌نامهٔ پیوست را تکمیل کنید و هر وقت فرصت کردید برای ما بفرستید.\n\nساعت ۸:۱۵ صبح از مدرسه حرکت می‌کنیم و تا ساعت ۱۶:۳۰ برمی‌گردیم. لطفاً ناهار و یک بطری آب همراه دانش‌آموز بفرستید.\n\nبا سپاس،\nخانم رضایی\n\nاین پیام بخشی از فضای کاری محلی شماست.",
        date: at(8, 42),
        unread: true,
        label: "مدرسه",
        attachments: [file.id],
      },
      {
        id: "mail-design",
        threadId: "design-thread",
        sender: "سارا احمدی",
        from: "sara@example.com",
        to: ["arash@example.com"],
        subject: "یک قهوه و کمی گپ؟",
        body: "سلام آرش،\n\nخیلی دوست دارم این هفته همدیگر را ببینیم. پنجشنبه بعدازظهر وقتم آزاد است. ساعت ۱۵ در کافه نارنج چطور است؟\n\nسارا\n\nاین دعوت بخشی از فضای کاری محلی شماست.",
        date: at(8, 15),
        unread: true,
        label: "شخصی",
        attachments: [],
      },
      {
        id: "mail-stay",
        threadId: "stay-thread",
        sender: "اقامتگاه ساحلی نیلوفر",
        from: "stay@niloufar.example",
        to: ["arash@example.com"],
        subject: "آخر هفته‌تان آماده است",
        body: `رزرو شما در رامسر تأیید شد.\n\nورود: پنجشنبه، ساعت ۱۴\nخروج: شنبه، ساعت ۱۲\n\nاین رزرو خیالی نشان می‌دهد ${BRAND.nameFa} چطور جزئیات سفر را مرتب می‌کند.`,
        date: at(7, 30),
        unread: false,
        label: "سفر",
        attachments: [],
      },
      {
        id: "mail-studio",
        threadId: "studio-thread",
        sender: "استودیو شمال",
        from: "hello@studioshomal.example",
        to: ["arash@example.com"],
        subject: "یادداشت‌های گفت‌وگوی قبلی‌مان",
        body: "از گفت‌وگوی خوب دیروز ممنونیم. در جلسهٔ بعد نمونهٔ اولیه را مرور کنیم و سه مسیر را برای آزمون انتخاب کنیم.\n\nاین پروژه بخشی از فضای کاری محلی شماست.",
        date: new Date(now.getTime() - 86400000).toISOString(),
        unread: false,
        label: "کار",
        attachments: [],
      },
    ];
    for (const mail of mails) await this.db.put(owner, "mail", mail);
    const base = {
      calendarId: "primary",
      allDay: false,
      timeZone: sampleTimeZone,
      description: "کمی وقت برای گپ‌وگفت",
      attendees: [],
    };
    for (const event of [
      {
        ...base,
        id: "event-standup",
        title: "شروعی آرام · پیاده‌روی صبحگاهی",
        start: at(9),
        end: at(9, 30),
        location: "پارک ملت",
      },
      {
        ...base,
        id: "event-review",
        title: "هم‌فکری طراحی",
        start: at(11),
        end: at(11, 45),
        location: "استودیو شمال",
      },
      {
        ...base,
        id: "event-lunch",
        title: "ناهار با مریم",
        start: at(13),
        end: at(14),
        location: "رستوران نارون",
      },
    ])
      await this.db.put(owner, "events", event);
    await actions.propose(owner, {
      kind: "calendar.create",
      data: {
        ...base,
        title: "قهوه با سارا",
        start: at(15),
        end: at(16),
        location: "کافه نارنج",
        description: "گپ‌وگفت با یک فنجان قهوه",
        attendees: ["sara@example.com"],
      },
    });
    await this.db.put(owner, "settings", { id: "google", enabled: true });
    await this.db.put(owner, "settings", { id: "seeded", value: true });
  }
  async snapshot(owner: string, query?: string): Promise<Workspace> {
    let mail: Mail[], events: CalendarEvent[];
    const connected = await this.googleConnected(owner);
    const mailbox = await this.mailbox.status(owner);
    if (this.config.mode === "live" && connected) {
      const connection = await this.googleConnection(owner);
      if (!connection) throw new AppError("اتصال گوگل قطع است", 409);
      const google = this.google(owner, connection.id);
      [mail, events] = await Promise.all([
        mailbox ? [] : google.listMail(query),
        google.listEvents(),
      ]);
      mail = await this.cacheMail(owner, mail, connection.id);
      for (const event of events) await this.db.put(owner, "events", event);
    } else if (this.config.mode === "sample" && connected) {
      mail = await this.db.list<Mail>(owner, "mail");
      events = await this.db.list<CalendarEvent>(owner, "events");
      if (query)
        mail = mail.filter((m) =>
          `${m.sender} ${m.subject} ${m.body}`.toLowerCase().includes(query.toLowerCase()),
        );
    } else {
      mail = [];
      events = [];
    }
    if (mailbox) {
      mail = await this.mailbox.list(owner);
      if (query) {
        const q = query.toLowerCase();
        mail = mail.filter((m) => `${m.sender} ${m.subject} ${m.body}`.toLowerCase().includes(q));
      }
    }
    const tokens = this.config.mode === "live" ? await this.googleAuth.tokens(owner) : null;
    return {
      mode: this.config.mode,
      profile: {
        name: this.config.mode === "sample" ? "آرش" : "شما",
        email:
          tokens?.account ??
          (this.config.mode === "sample" ? "arash@example.com" : (mailbox?.account ?? "")),
      },
      mail: mail.sort((a, b) => b.date.localeCompare(a.date)),
      events: events.sort((a, b) => a.start.localeCompare(b.start)),
      files: await this.files.list(owner),
      browsers: await this.db.list<BrowserSession>(owner, "browsers"),
      actions: await this.db.list<ActionProposal>(owner, "actions"),
      activity: await this.db.list<ActivityEntry>(owner, "activity"),
      connections: [
        {
          id: "google",
          name: "Google",
          // Live workspaces may run without Google OAuth (e.g. where Google is unreachable);
          // report that as unconfigured so the UI does not offer a connect flow that must fail.
          status: connected
            ? this.config.mode === "sample"
              ? "sample"
              : "connected"
            : this.config.mode === "live" && !this.googleAuth.configured()
              ? "unconfigured"
              : "disconnected",
          account:
            tokens?.account ?? (this.config.mode === "sample" ? "arash@example.com" : undefined),
          capabilities: this.config.mode === "sample" ? ["Gmail", "تقویم"] : (tokens?.scopes ?? []),
        },
        {
          id: "imap",
          name: "ایمیل (IMAP/SMTP)",
          status: mailbox ? "connected" : "disconnected",
          account: mailbox?.account,
          capabilities: mailbox ? ["خواندن ایمیل", "ارسال با تأیید شما"] : [],
          syncedAt: mailbox?.lastSyncAt,
          error: mailbox?.lastError,
        },
        {
          id: "browser",
          name: "مرورگر",
          status: this.config.workerUrl && this.config.workerToken ? "connected" : "unconfigured",
          capabilities: ["نشست‌های ماندگار", "دانلود PDF"],
        },
        {
          id: "openbot",
          name: "OpenBot",
          status: "unconfigured",
          capabilities: ["آداپتور یکپارچه‌سازی در دسترس است"],
        },
      ],
      runtime: {
        provider: this.config.agentBackend === "sample" ? "sample" : "model",
        configured: agentConfigured(this.config),
        openbotConfigured: false,
        richThreads:
          threadsBackend(this.config) === "intelligence" &&
          Boolean(this.config.intelligenceApiKey?.trim()),
        localThreads: localThreadsEnabled(this.config),
      },
    };
  }
  async prepare(owner: string, input: ProposalInput, connectionId?: string) {
    if (input.kind === "email.send") {
      for (const id of input.data.attachmentIds) await this.files.get(owner, id);
      return { input };
    }
    if (input.kind === "calendar.create" || this.config.mode === "sample") return { input };
    const reviewed = await this.google(owner, connectionId).reviewEvent(
      input.data.calendarId,
      input.data.eventId,
    );
    return {
      input:
        input.kind === "calendar.delete"
          ? { ...input, data: { ...input.data, title: reviewed.event.title } }
          : input,
      target: reviewed.event,
      targetVersion: reviewed.version,
    };
  }
  async execute(
    owner: string,
    input: ProposalInput,
    connectionId?: string,
    targetVersion?: string,
  ): Promise<string> {
    if (input.kind === "email.send" && connectionId) {
      const mailbox = await this.mailbox.status(owner);
      if (mailbox?.connectionId === connectionId)
        return this.mailbox.send(
          owner,
          connectionId,
          input.data,
          await this.attachments(owner, input.data.attachmentIds),
        );
    }
    if (this.config.mode === "sample") {
      if (input.kind === "email.send") {
        const id = randomUUID();
        await this.db.put(owner, "mail", {
          id,
          threadId: input.data.threadId ?? id,
          sender: "You",
          from: "arash@example.com",
          to: input.data.to,
          subject: input.data.subject,
          body: input.data.body,
          date: new Date().toISOString(),
          unread: false,
          label: "Sent · local",
          attachments: input.data.attachmentIds,
        });
        return `در ایمیل‌های ارسالی محلی ذخیره شد · ${id}`;
      }
      if (input.kind === "calendar.delete") {
        await this.db.remove(owner, "events", input.data.eventId);
        return "از تقویم محلی حذف شد";
      }
      const id = input.kind === "calendar.update" ? input.data.eventId : randomUUID();
      await this.db.put(owner, "events", { ...input.data, id });
      return `در تقویم محلی ذخیره شد · ${id}`;
    }
    const tokens = await this.googleAuth.tokens(owner);
    if (!tokens) throw new AppError("اتصال گوگل قطع است", 409);
    const capability = input.kind === "email.send" ? "gmail.send" : "calendar.events";
    if (!tokens.scopes.includes(`https://www.googleapis.com/auth/${capability}`))
      throw new AppError("پیش از تأیید، دسترسی نوشتن گوگل را در بخش اتصال‌ها فعال کنید", 403);
    if (tokens.connectionId !== connectionId)
      throw new AppError("حساب یا اتصال گوگل تغییر کرده است. اقدام تازه‌ای آماده کنید.", 409);
    const google = this.google(owner, connectionId);
    if ((input.kind === "calendar.update" || input.kind === "calendar.delete") && !targetVersion)
      throw new AppError(
        "این بازبینی تقویم مربوط به پیش از بررسی نسخه است. بازبینی تازه‌ای آماده کنید.",
        409,
      );
    if (input.kind === "email.send") {
      const attachments = await this.attachments(owner, input.data.attachmentIds);
      const receipt = await google.sendEmail(input.data, attachments);
      return `پیام با Gmail ارسال شد · ${receipt.id}`;
    }
    if (input.kind === "calendar.delete") {
      await google.deleteEvent(input.data.calendarId, input.data.eventId, targetVersion);
      await this.db.remove(owner, "events", input.data.eventId);
      return `رویداد تقویم گوگل حذف شد · ${input.data.eventId}`;
    }
    const event =
      input.kind === "calendar.create"
        ? await google.createEvent(input.data)
        : await google.updateEvent(input.data.eventId, input.data, targetVersion);
    await this.db.put(owner, "events", event);
    return `رویداد تقویم گوگل · ${event.id}`;
  }
  private attachments(owner: string, ids: string[]) {
    return Promise.all(
      ids.map(async (id) => {
        const file = await this.files.get(owner, id);
        return {
          name: file.name,
          mimeType: file.mimeType,
          bytes: await this.files.bytes(owner, id),
        };
      }),
    );
  }
  async importAttachment(owner: string, reference: string): Promise<Artifact> {
    const connection = await this.connection(owner, "google");
    if (!connection) throw new AppError("اتصال گوگل قطع است", 409);
    const cached = await this.db.get<{ artifactId: string; connectionId?: string }>(
      owner,
      "imports",
      reference,
    );
    if (cached && cached.connectionId === connection.id)
      return this.files.signed(owner, await this.files.get(owner, cached.artifactId));
    const [messageId, attachmentId, filename] = reference.split(":");
    if (!messageId || !attachmentId || !filename) throw new AppError("ارجاع پیوست نامعتبر است");
    const message = await this.db.get<Mail & { connectionId?: string }>(owner, "mail", messageId);
    if (!message?.attachments.includes(reference) || message.connectionId !== connection.id)
      throw new AppError("پیوست پیدا نشد. صندوق ورودی حساب فعلی را تازه کنید.", 404);
    const file = await this.files.import(
      owner,
      decodeURIComponent(filename),
      await this.google(owner, connection.id).getAttachment(messageId, attachmentId),
      `Gmail · ${message.subject}`,
    );
    await this.db.put(owner, "imports", {
      id: reference,
      artifactId: file.id,
      connectionId: connection.id,
    });
    return file;
  }
}
