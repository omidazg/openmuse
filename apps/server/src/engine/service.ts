import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  type AgentArtifact,
  type AgentIdentity,
  type AgentMemory,
  type AgentNotification,
  type AgentTask,
  type AgentWorkspace,
  createTaskSchema,
  type Evidence,
  type Goal,
  goalInputSchema,
  type Idea,
  type Monitor,
  monitorInputSchema,
  type RunEvent,
} from "../../../../packages/domain/src/agent.ts";
import type {
  ActionProposal,
  Artifact,
  BrowserSession,
  Mail,
  ProposalInput,
} from "../../../../packages/domain/src/index.ts";
import type { ActionService } from "../actions.ts";
import type { BrowserService } from "../browser.ts";
import { ComputerService } from "../computer.ts";
import type { Config } from "../config.ts";
import type { Store } from "../db.ts";
import { AppError } from "../errors.ts";
import type { Files } from "../files.ts";
import { backgroundFailure } from "../log.ts";
import type { WorkspaceService } from "../workspace.ts";
import { analyzeSpending, faDate, faNumber } from "./finance.ts";
import { executeModelTask } from "./model.ts";
import { LostLeaseError, type TaskContext, TaskWorker } from "./worker.ts";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const date = () => new Date().toISOString();
const terminal = new Set(["succeeded", "failed", "cancelled"]);
/** Persian display labels for task statuses; the stored status values stay in English. */
const statusLabels: Record<AgentTask["status"], string> = {
  queued: "در صف",
  running: "در حال انجام",
  scheduled: "زمان‌بندی‌شده",
  paused: "متوقف‌شده",
  waiting_input: "در انتظار اطلاعات شما",
  waiting_approval: "در انتظار تأیید شما",
  succeeded: "انجام‌شده",
  failed: "ناموفق",
  cancelled: "لغوشده",
};
const conditionLabels: Record<Monitor["condition"], string> = {
  change: "تغییر",
  contains: "وجود متن",
  price_below: "قیمت کمتر از",
};
export class AgentService {
  readonly worker: TaskWorker;
  private maintenance?: ReturnType<typeof setInterval>;
  private refreshing = false;
  constructor(
    readonly db: Store,
    readonly config: Config,
    readonly workspace: WorkspaceService,
    readonly files: Files,
    readonly actions: ActionService,
    readonly browser: BrowserService,
    readonly computer: ComputerService = new ComputerService(db, config),
  ) {
    this.worker = new TaskWorker(db, (owner, task, context) => this.execute(owner, task, context), {
      settled: (owner, task) => this.publishOutcome(owner, task),
    });
  }
  start() {
    this.worker.start();
    // Maintenance is independent of the HTTP response and reconciles durable records.
    void this.maintain().catch((error) => backgroundFailure("initial maintenance", error));
    this.maintenance = setInterval(() => {
      void this.maintain().catch((error) => backgroundFailure("maintenance", error));
    }, 60000);
  }
  async stop() {
    if (this.maintenance) clearInterval(this.maintenance);
    this.maintenance = undefined;
    await this.worker.stop();
    while (this.refreshing) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  private async maintain() {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      // Recover publications if the process exited after committing an outcome.
      for (const { owner, value } of await this.db.scan<AgentTask>("tasks"))
        await this.publishOutcome(owner, value);
      for (const { owner, value } of await this.db.scan<Monitor>("monitors"))
        await this.activateMonitor(owner, value);
      for (const { owner, value } of await this.db.scan<Idea>("ideas"))
        if (
          value.status === "accepted" &&
          value.taskId &&
          !(await this.db.get(owner, "tasks", value.taskId))
        )
          await this.decideIdea(owner, value.id, "accept").catch(async (error) => {
            backgroundFailure("recover accepted idea", error);
            await this.notify(
              owner,
              "ایدهٔ پذیرفته‌شده نیاز به بررسی دارد",
              "پس از باز کردن جا برای یک کار دیگر، دوباره ایده را باز کنید.",
              undefined,
              `idea-recovery:${value.id}`,
            );
          });
      for (const { owner, value } of await this.db.scan<{ id: string; lastIdeasAt?: string }>(
        "agent-settings",
      )) {
        if (value.id !== "identity") continue;
        if (!value.lastIdeasAt || Date.now() - Date.parse(value.lastIdeasAt) > 15 * 60000)
          await this.refreshIdeas(owner).catch(async () => {
            await this.notify(
              owner,
              "به‌روزرسانی منبع نیاز به بررسی دارد",
              "منبع را دوباره وصل کنید یا ایده‌ها را تازه کنید تا خطا را ببینید.",
              undefined,
              `source-error:${Math.floor(Date.now() / 3600000)}`,
            );
          });
      }
    } finally {
      this.refreshing = false;
    }
  }
  async ensure(owner: string) {
    await this.db.insertIfAbsent(owner, "agent-settings", {
      id: "identity",
      name: "OpenMuse",
      tone: "warm",
    });
  }
  async snapshot(owner: string): Promise<AgentWorkspace> {
    await this.ensure(owner);
    const [tasks, goals, monitors, ideas, memories, artifacts, notifications, identity] =
      await Promise.all([
        this.db.list<AgentTask>(owner, "tasks"),
        this.db.list<Goal>(owner, "goals"),
        this.db.list<Monitor>(owner, "monitors"),
        this.db.list<Idea>(owner, "ideas"),
        this.db.list<AgentMemory>(owner, "memories"),
        this.db.list<AgentArtifact>(owner, "agent-artifacts"),
        this.db.list<AgentNotification>(owner, "notifications"),
        this.db.get<AgentIdentity>(owner, "agent-settings", "identity"),
      ]);
    const heartbeat = await this.db.get<{ lastTickAt: string }>("system", "worker-status", "tasks");
    return {
      tasks,
      goals,
      monitors,
      ideas,
      memories,
      artifacts,
      notifications,
      identity: identity ?? { name: "OpenMuse", tone: "warm" },
      worker: {
        running:
          this.worker.running ||
          Boolean(heartbeat && Date.now() - Date.parse(heartbeat.lastTickAt) < 15000),
        lastTickAt: heartbeat?.lastTickAt ?? this.worker.lastTickAt,
      },
    };
  }
  async getTask(owner: string, id: string) {
    const task = await this.db.get<AgentTask>(owner, "tasks", id);
    if (!task) throw new AppError("این کار پیدا نشد. فهرست کارها را تازه کنید.", 404);
    return task;
  }
  async detail(owner: string, id: string) {
    const task = await this.getTask(owner, id);
    const files = (await this.db.list<Artifact>(owner, "files")).filter((file) =>
      task.artifactIds.includes(file.id),
    );
    const browsers = (await this.db.list<BrowserSession>(owner, "browsers")).filter((browser) =>
      [task.state.browserId, task.state.sessionId].includes(browser.id),
    );
    return {
      task,
      files: files.map((file) => this.files.signed(owner, file)),
      browsers: browsers.map((browser) => this.browser.decorate(owner, browser)),
      events: (await this.db.list<RunEvent>(owner, "run-events"))
        .filter((e) => e.taskId === id)
        .sort((a, b) => a.date.localeCompare(b.date)),
      artifacts: (await this.db.list<AgentArtifact>(owner, "agent-artifacts")).filter(
        (a) => a.taskId === id,
      ),
    };
  }
  async createTask(owner: string, raw: unknown, idempotencyKey?: string, held = false) {
    const input = createTaskSchema.parse(raw);
    if (input.goalId && !(await this.db.get(owner, "goals", input.goalId)))
      throw new AppError("این هدف پیدا نشد. هدف دیگری انتخاب کنید.", 404);
    const id = idempotencyKey ? hash(`task:${idempotencyKey}`) : randomUUID();
    const existing = await this.db.get<AgentTask>(owner, "tasks", id);
    if (existing) return existing;
    if (
      (await this.db.list<AgentTask>(owner, "tasks")).filter((t) => !terminal.has(t.status))
        .length >= 100
    )
      throw new AppError(
        "تعداد کارهای باز به حداکثر رسیده است. پیش از افزودن کار جدید، چند کار را تمام یا لغو کنید.",
        409,
      );
    const titles =
      input.kind === "document"
        ? [
            "پیدا کردن سند اصلی",
            "پر کردن یک نسخهٔ جدید",
            "آماده کردن پاسخ",
            "انتظار برای تصمیم شما",
            "ثبت نتیجه",
          ]
        : input.kind === "monitor"
          ? ["بررسی منبع", "مقایسه با آخرین مشاهده", "گزارش تغییر مهم"]
          : input.kind === "finance"
            ? ["اعتبارسنجی تراکنش‌ها", "محاسبهٔ خلاصه", "ذخیرهٔ ردیاب شما"]
            : ["درک نتیجهٔ مورد نظر", "برنامه‌ریزی کار", "استفاده از ابزارهای متصل", "ارائهٔ نتیجه"];
    const task: AgentTask = {
      id,
      title: input.title ?? input.prompt.slice(0, 90),
      prompt: input.prompt,
      kind: input.kind,
      goalId: input.goalId,
      status: held ? "paused" : "queued",
      plan: titles.map((title, i) => ({ id: String(i), title, status: "pending" })),
      evidence: [],
      input: input.input,
      state: {
        connectionId: (await this.workspace.connection(owner))?.id ?? null,
        ...(held && input.kind === "monitor" ? { initializingMonitor: true } : {}),
      },
      createdAt: date(),
      updatedAt: date(),
      attempts: 0,
      leaseId: null,
      leaseUntil: null,
      artifactIds: [],
    };
    await this.ensure(owner);
    await this.db.insertIfAbsent(owner, "tasks", task);
    return (await this.db.get<AgentTask>(owner, "tasks", id)) ?? task;
  }
  async control(owner: string, id: string, action: "pause" | "resume" | "cancel" | "retry") {
    const task = await this.getTask(owner, id);
    if (action === "cancel" && task.status === "succeeded")
      throw new AppError("این کار قبلاً انجام شده است و لغو نمی‌شود.", 409);
    if (action === "retry" && task.status !== "failed")
      throw new AppError("تلاش دوباره فقط برای کارهای ناموفق ممکن است.", 409);
    if (action === "resume" && task.status !== "paused")
      throw new AppError("این کار متوقف نشده است. فقط کارهای متوقف‌شده ادامه پیدا می‌کنند.", 409);
    if (action === "pause" && (terminal.has(task.status) || task.status === "paused")) return task;
    const status =
      action === "cancel"
        ? "cancelled"
        : action === "pause"
          ? "paused"
          : task.actionId
            ? "waiting_approval"
            : "queued";
    if (action === "retry" && task.actionId) {
      const a = await this.db.get<ActionProposal>(owner, "actions", task.actionId);
      if (a && a.status !== "succeeded")
        throw new AppError(
          "نتیجهٔ اقدام بررسی‌شده ممکن است نامشخص باشد. پیش از تلاش دوباره آن را بررسی کنید و پس از روشن شدن وضعیت، یک کار جدید شروع کنید.",
          409,
        );
    }
    const updated = await this.db.compareAndSwap<AgentTask>(
      owner,
      "tasks",
      id,
      { status: task.status, leaseId: task.leaseId ?? null },
      {
        status,
        leaseId: null,
        leaseUntil: null,
        error: null,
        updatedAt: date(),
        result:
          action === "cancel"
            ? "شما این کار را متوقف کردید."
            : action === "pause"
              ? "متوقف شد. هر وقت آماده بودید ادامه دهید."
              : "",
        ...(task.kind === "monitor" && action === "resume"
          ? { state: { ...task.state, failures: 0, notice: null } }
          : {}),
      },
    );
    if (!updated)
      throw new AppError("کار تغییر کرده است؛ صفحه را تازه کنید و دوباره امتحان کنید", 409);
    this.worker.abort(id);
    if (task.kind === "monitor")
      await this.db.compareAndSwap(
        owner,
        "monitors",
        String(task.input.monitorId),
        {},
        {
          status: action === "cancel" ? "stopped" : action === "pause" ? "paused" : "active",
          nextCheckAt: date(),
        },
      );
    if (action === "cancel" && task.actionId) {
      const proposal = await this.db.get<ActionProposal>(owner, "actions", task.actionId);
      if (proposal?.status === "awaiting_review")
        await this.actions.decide(owner, proposal.id, proposal.hash, "deny");
    }
    await this.db.put(owner, "run-events", {
      id: randomUUID(),
      taskId: id,
      kind: "status",
      date: date(),
      title: `وضعیت کار: ${statusLabels[status]}`,
      detail: "توسط شما تغییر کرد",
    });
    return updated;
  }
  async answer(
    owner: string,
    id: string,
    answer: string,
    fields?: Record<string, string | boolean>,
  ) {
    const task = await this.getTask(owner, id);
    if (task.status !== "waiting_input") throw new AppError("این کار منتظر اطلاعات شما نیست", 409);
    const next = await this.db.compareAndSwap<AgentTask>(
      owner,
      "tasks",
      id,
      { status: "waiting_input" },
      {
        status: "queued",
        question: null,
        input: { ...task.input, ...(fields ? { fields } : {}) },
        state: { ...task.state, answer },
        updatedAt: date(),
      },
    );
    if (!next)
      throw new AppError("کار تغییر کرده است؛ صفحه را تازه کنید و دوباره امتحان کنید", 409);
    return next;
  }
  async createGoal(owner: string, raw: unknown, id?: string) {
    const input = goalInputSchema.parse(raw);
    const goal: Goal = {
      id: id ?? randomUUID(),
      title: input.title,
      description: input.description,
      category: input.category,
      status: "active",
      milestones: input.milestones.map((title) => ({ id: randomUUID(), title, done: false })),
      createdAt: date(),
    };
    await this.db.insertIfAbsent(owner, "goals", goal);
    return (await this.db.get<Goal>(owner, "goals", goal.id)) ?? goal;
  }
  async updateGoal(
    owner: string,
    id: string,
    patch: { status?: Goal["status"]; milestones?: Goal["milestones"] },
  ) {
    const goal = await this.db.get<Goal>(owner, "goals", id);
    if (!goal) throw new AppError("این هدف پیدا نشد. فهرست هدف‌ها را تازه کنید.", 404);
    const saved = await this.db.put(owner, "goals", { ...goal, ...patch });
    if (patch.status === "paused")
      for (const task of await this.db.list<AgentTask>(owner, "tasks"))
        if (task.goalId === id && !terminal.has(task.status) && task.status !== "paused")
          await this.control(owner, task.id, "pause");
    return saved;
  }
  async createMonitor(owner: string, raw: unknown, idempotencyKey?: string) {
    const input = monitorInputSchema.parse(raw);
    const url = new URL(input.url);
    if (url.protocol === "sample:" && this.config.mode !== "sample")
      throw new AppError(
        "منابع نمونه در فضای کاری واقعی در دسترس نیستند. نشانی یک صفحهٔ عمومی را وارد کنید.",
        422,
      );
    if (!["https:", "http:", "sample:"].includes(url.protocol) || url.username || url.password)
      throw new AppError(
        "این نشانی پشتیبانی نمی‌شود. نشانی یک صفحهٔ عمومی HTTP یا HTTPS را وارد کنید.",
        422,
      );
    if (url.protocol === "sample:" && input.url !== "sample://availability")
      throw new AppError("این منبع نمونه شناخته‌شده نیست. منبع دیگری انتخاب کنید.", 422);
    const id = idempotencyKey ? hash(`monitor:${idempotencyKey}`) : randomUUID();
    const existing = await this.db.get<Monitor>(owner, "monitors", id);
    if (existing) {
      await this.activateMonitor(owner, existing);
      return existing;
    }
    const task = await this.createTask(
      owner,
      {
        kind: "monitor",
        title: input.title,
        prompt: `پیگیری ${input.url} برای ${conditionLabels[input.condition]}${input.value ? `: ${input.value}` : ""}`,
        input: { monitorId: id },
      },
      `monitor:${id}`,
      true,
    );
    const monitor: Monitor = {
      id,
      taskId: task.id,
      ...input,
      status: "active",
      nextCheckAt: date(),
      checks: 0,
    };
    await this.db.insertIfAbsent(owner, "monitors", monitor);
    await this.activateMonitor(owner, monitor);
    return monitor;
  }
  private async activateMonitor(owner: string, monitor: Monitor) {
    if (monitor.status !== "active") return;
    const task = await this.getTask(owner, monitor.taskId);
    if (task.status !== "paused" || !task.state.initializingMonitor) return;
    await this.db.compareAndSwap(
      owner,
      "tasks",
      task.id,
      { status: "paused", attempts: 0, state: { initializingMonitor: true } },
      {
        status: "queued",
        state: { ...task.state, initializingMonitor: false },
      },
    );
  }
  async controlMonitor(owner: string, id: string, action: "pause" | "resume" | "stop" | "check") {
    const monitor = await this.db.get<Monitor>(owner, "monitors", id);
    if (!monitor) throw new AppError("این پیگیری پیدا نشد. فهرست پیگیری‌ها را تازه کنید.", 404);
    if (monitor.status === "stopped" && action !== "stop")
      throw new AppError("برای راه‌اندازی دوبارهٔ این پیگیریِ متوقف‌شده، یک پیگیری جدید بسازید", 409);
    const status = action === "pause" ? "paused" : action === "stop" ? "stopped" : "active";
    const saved = await this.db.put(owner, "monitors", { ...monitor, status, nextCheckAt: date() });
    const task = await this.getTask(owner, monitor.taskId);
    if (action === "pause" || action === "stop")
      await this.control(owner, task.id, action === "pause" ? "pause" : "cancel");
    else {
      this.worker.abort(task.id);
      await this.db.compareAndSwap(
        owner,
        "tasks",
        task.id,
        { status: task.status, leaseId: task.leaseId ?? null },
        {
          status: "queued",
          nextRunAt: date(),
          leaseId: null,
          leaseUntil: null,
          error: null,
          state: { ...task.state, failures: 0, notice: null },
        },
      );
    }
    return saved;
  }
  async refreshIdeas(owner: string) {
    const w = await this.workspace.snapshot(owner);
    const sentIds = new Set(
      w.mail.filter((mail) => /^Sent\b/i.test(mail.label)).map((mail) => mail.id),
    );
    const completedSources = new Set(
      (await this.db.list<AgentTask>(owner, "tasks"))
        .filter((task) => task.status === "succeeded" && typeof task.input.messageId === "string")
        .map((task) => `${task.kind}:${task.input.messageId}`),
    );
    const obsolete = (kind: AgentTask["kind"], messageId: unknown) =>
      typeof messageId === "string" &&
      (sentIds.has(messageId) || completedSources.has(`${kind}:${messageId}`));
    // Retire earlier suggestions as well as preventing new duplicates. A concurrent
    // acceptance wins its own compare-and-swap and is never overwritten here.
    for (const idea of await this.db.list<Idea>(owner, "ideas"))
      if (idea.status === "new" && obsolete(idea.kind, idea.input.messageId))
        await this.db.compareAndSwap(
          owner,
          "ideas",
          idea.id,
          { status: "new" },
          { status: "dismissed" },
        );
    for (const mail of w.mail
      .filter(
        (m) =>
          !obsolete("document", m.id) &&
          m.attachments.length &&
          /form|permission|complete|fill|sign|فرم|اجازه|رضایت|تکمیل|پر کن|امضا/i.test(
            `${m.subject} ${m.body}`,
          ),
      )
      .slice(0, 5)) {
      const id = hash(`document:${mail.id}:${mail.body}`);
      const idea: Idea = {
        id,
        title: `می‌توانم در «${mail.subject}» کمکتان کنم`,
        reason: `${mail.sender} سندی فرستاده که شاید به توجه شما نیاز داشته باشد. می‌توانم آن را همراه با یک پاسخ برای بررسی شما آماده کنم.`,
        evidence: [this.mailEvidence(mail)],
        prompt: `فایل PDF ایمیل «${mail.subject}» را تکمیل کن و یک پاسخ برای بررسی آماده کن.`,
        kind: "document",
        input: { messageId: mail.id },
        status: "new",
        createdAt: date(),
      };
      await this.db.insertIfAbsent(owner, "ideas", idea);
    }
    for (const mail of w.mail
      .filter(
        (m) =>
          !obsolete("agent", m.id) &&
          /coffee|meet|available|schedule|قهوه|جلسه|دیدار|ملاقات|وقت آزاد|هماهنگ/i.test(
            `${m.subject} ${m.body}`,
          ),
      )
      .slice(0, 5)) {
      await this.db.insertIfAbsent(owner, "ideas", {
        id: hash(`coordination:${mail.id}`),
        title: `می‌توانم در هماهنگی «${mail.subject}» کمکتان کنم`,
        reason: `${mail.sender} به یک دیدار اشاره کرده است. می‌توانم تقویمتان را بررسی کنم و پاسخی برای بررسی شما آماده کنم.`,
        evidence: [this.mailEvidence(mail)],
        prompt: `ایمیل «${mail.subject}» را بررسی کن، تقویمم را چک کن و قدم بعدی را پیشنهاد بده. پیش از آماده کردن پاسخ، ترجیحاتی را که نمی‌دانی از من بپرس.`,
        kind: "agent",
        input: { messageId: mail.id },
        status: "new",
        createdAt: date(),
      } satisfies Idea);
    }
    for (const goal of await this.db.list<Goal>(owner, "goals"))
      if (goal.status === "active" && !goal.milestones.length) {
        const id = hash(`goal:${goal.id}:${goal.description}`);
        await this.db.insertIfAbsent(owner, "ideas", {
          id,
          title: `بیایید برای «${goal.title}» برنامه بریزیم`,
          reason: "این هدف هنوز هیچ مرحله‌ای ندارد. یک برنامهٔ مشخص، قدم بعدی را روشن می‌کند.",
          evidence: [{ id: goal.id, kind: "user", title: goal.title, excerpt: goal.description }],
          prompt: `یک برنامهٔ عملی برای «${goal.title}» بساز. ${goal.description}`,
          kind: "plan",
          input: { goalId: goal.id },
          status: "new",
          createdAt: date(),
        } satisfies Idea);
      }
    await this.ensure(owner);
    await this.db.compareAndSwap(owner, "agent-settings", "identity", {}, { lastIdeasAt: date() });
    return this.db.list<Idea>(owner, "ideas");
  }
  async decideIdea(owner: string, id: string, action: "accept" | "dismiss", prompt?: string) {
    let idea = await this.db.get<Idea>(owner, "ideas", id);
    if (!idea) throw new AppError("این ایده پیدا نشد. ایده‌ها را تازه کنید.", 404);
    if (idea.status === "dismissed" || (idea.status === "accepted" && action === "dismiss"))
      return idea;
    if (action === "dismiss")
      return this.db.compareAndSwap<Idea>(
        owner,
        "ideas",
        id,
        { status: "new" },
        { status: "dismissed" },
      );
    if (idea.status === "new") {
      const claimed = await this.db.compareAndSwap<Idea>(
        owner,
        "ideas",
        id,
        { status: "new" },
        {
          status: "accepted",
          taskId: hash(`task:idea:${id}`),
          prompt: prompt ?? idea.prompt,
        },
      );
      idea = claimed ?? (await this.db.get<Idea>(owner, "ideas", id));
      if (idea?.status !== "accepted") return idea;
    }
    const goal = await this.createGoal(
      owner,
      { title: idea.title, description: idea.reason },
      hash(`idea-goal:${id}`),
    );
    const task = await this.createTask(
      owner,
      {
        title: idea.title,
        prompt: idea.prompt,
        kind: idea.kind,
        input: idea.input,
        goalId: goal.id,
      },
      `idea:${id}`,
    );
    await this.db.compareAndSwap(
      owner,
      "ideas",
      id,
      { status: "new" },
      { status: "accepted", taskId: task.id },
    );
    return this.db.get<Idea>(owner, "ideas", id);
  }
  async notify(owner: string, title: string, body: string, taskId?: string, key?: string) {
    const value: AgentNotification = {
      id: key ? hash(key) : randomUUID(),
      taskId,
      title,
      body,
      createdAt: date(),
      read: false,
    };
    await this.db.insertIfAbsent(owner, "notifications", value);
  }
  mailEvidence(mail: Mail): Evidence {
    return { id: mail.id, kind: "mail", title: mail.subject, excerpt: mail.body.slice(0, 400) };
  }
  async artifact(
    owner: string,
    task: AgentTask,
    kind: AgentArtifact["kind"],
    title: string,
    summary: string,
    data: Record<string, unknown>,
    key: string = kind,
  ) {
    const value: AgentArtifact = {
      id: hash(`${task.id}:${key}`),
      taskId: task.id,
      kind,
      title,
      summary,
      data,
      createdAt: date(),
    };
    await this.db.put(owner, "agent-artifacts", value);
    return value;
  }
  async prepare(
    owner: string,
    task: AgentTask,
    input: ProposalInput,
    key: string,
    context: TaskContext,
  ) {
    await context.guard();
    const connection = await this.workspace.connection(owner);
    if (connection?.id !== task.state.connectionId)
      throw new AppError(
        "اتصال گوگل در طول این کار تغییر کرد. با حساب فعلی یک کار جدید شروع کنید.",
        409,
      );
    const proposal = await this.actions.propose(owner, input, `${task.id}:${key}`, task.id);
    try {
      await context.checkpoint({ actionId: proposal.id });
    } catch (error) {
      if (proposal.status === "awaiting_review")
        await this.actions.decide(owner, proposal.id, proposal.hash, "deny");
      throw error;
    }
    await context.event(
      "approval",
      proposal.title,
      `بررسی برای ${proposal.account ?? "حساب متصل"} آماده شد`,
    );
    return proposal;
  }
  private async execute(
    owner: string,
    task: AgentTask,
    context: TaskContext,
  ): Promise<Partial<AgentTask>> {
    await context.event(
      "status",
      task.attempts === 1 ? "کار شروع شد" : "کار از سر گرفته شد",
      task.prompt,
    );
    if (task.actionId) {
      const action = await this.db.get<ActionProposal>(owner, "actions", task.actionId);
      if (!action) throw new Error("بررسیِ مرتبط با این کار پیدا نشد. یک کار جدید شروع کنید.");
      if (action.status === "succeeded") {
        await context.event("result", "اقدام تأییدشده انجام شد", action.result);
        if (task.kind === "document")
          return this.finish(task, context, action.result ?? "پاسخ ارسال شد");
        task = await context.checkpoint({
          state: { ...task.state, approvalResult: action.result },
          actionId: null,
        });
      } else if (action.status !== "awaiting_review" && action.status !== "executing")
        throw new Error(
          `اقدام بررسی‌شده انجام نشد (${action.status}): ${action.error ?? "اقدام دیگری انجام نشد"}`,
        );
      else return { status: "waiting_approval" };
    }
    if (task.kind === "document") return this.document(owner, task, context);
    if (task.kind === "monitor") {
      try {
        return await this.observe(owner, task, context);
      } catch (error) {
        if (error instanceof LostLeaseError || context.signal.aborted) throw error;
        await context.guard();
        const failures = Number(task.state.failures ?? 0) + 1;
        const detail =
          error instanceof Error
            ? error.message
            : "بررسی صفحه انجام نشد. نشانی را بررسی کنید و دوباره تلاش کنید.";
        const nextCheckAt = new Date(
          Date.now() + Math.min(60, 2 ** failures) * 60000,
        ).toISOString();
        await this.db.compareAndSwap(
          owner,
          "monitors",
          String(task.input.monitorId),
          { status: "active" },
          {
            error: detail,
            nextCheckAt,
            ...(failures >= 5 ? { status: "paused" } : {}),
          },
        );
        await context.event(
          "error",
          failures >= 5
            ? "پیگیری پس از چند خطای پیاپی متوقف شد"
            : "بررسی ناموفق بود؛ تلاش دوباره زمان‌بندی شد",
          detail,
        );
        return {
          status: failures >= 5 ? "paused" : "scheduled",
          error: detail,
          nextRunAt: nextCheckAt,
          state: {
            ...task.state,
            failures,
            notice: {
              title: "پیگیری نیاز به بررسی دارد",
              body: detail,
              key: `watch-error:${task.id}:${failures >= 5 ? "paused" : "retry"}`,
            },
          },
        };
      }
    }
    if (task.kind === "finance") {
      await context.event("step", "در حال تحلیل تراکنش‌های واردشده");
      const csv = z.string().parse(task.input.csv);
      const data = analyzeSpending(csv);
      const artifact = await this.artifact(
        owner,
        task,
        "finance",
        "ردیاب هزینه‌ها",
        `${faNumber(data.count)} تراکنش · ${faNumber(data.spending)} هزینه`,
        data,
      );
      task = await context.checkpoint({
        artifactIds: [artifact.id],
        evidence: [
          {
            id: task.id,
            kind: "user",
            title: "فایل CSV تراکنش‌های شما",
            excerpt: `${faNumber(data.count)} ردیف؛ از ${faDate(data.period.from)} تا ${faDate(data.period.to)}`,
          },
        ],
      });
      return this.finish(task, context, artifact.summary);
    }
    return executeModelTask(this, owner, task, context);
  }
  async finish(task: AgentTask, context: TaskContext, result: string) {
    await context.guard();
    await context.event("result", "کار انجام شد", result);
    return {
      status: "succeeded" as const,
      result,
      plan: task.plan.map((s) => ({ ...s, status: "succeeded" as const })),
    };
  }
  private async publishOutcome(owner: string, saved: AgentTask) {
    const task = await this.getTask(owner, saved.id);
    if (task.status === "succeeded") {
      await this.notify(
        owner,
        task.title,
        task.result ?? "کار انجام شد",
        task.id,
        `task-done:${task.id}`,
      );
      if (task.goalId) {
        for (let attempt = 0; attempt < 8; attempt++) {
          const goal = await this.db.get<Goal>(owner, "goals", task.goalId);
          if (!goal || goal.milestones.some((m) => m.id === task.id)) break;
          if (
            await this.db.compareAndSwap(
              owner,
              "goals",
              goal.id,
              { milestones: goal.milestones },
              {
                milestones: [...goal.milestones, { id: task.id, title: task.title, done: true }],
              },
            )
          )
            break;
        }
      }
    } else if (task.status === "failed") {
      await this.notify(
        owner,
        "کار نیاز به بررسی دارد",
        task.error ?? task.title,
        task.id,
        `task-error:${task.id}:${task.attempts}`,
      );
    } else if (task.status === "waiting_input") {
      await this.notify(
        owner,
        "به اطلاعات شما نیاز است",
        task.question ?? task.title,
        task.id,
        `input:${task.id}:${hash(task.question ?? "")}`,
      );
    } else if (task.status === "waiting_approval") {
      await this.notify(owner, "آمادهٔ بررسی شما", task.title, task.id, `review:${task.actionId}`);
    }
    const notice = z
      .object({ title: z.string(), body: z.string(), key: z.string() })
      .safeParse(task.state.notice);
    if ((task.status === "scheduled" || (task.status === "paused" && task.error)) && notice.success)
      await this.notify(owner, notice.data.title, notice.data.body, task.id, notice.data.key);
  }
  private async document(
    owner: string,
    task: AgentTask,
    ctx: TaskContext,
  ): Promise<Partial<AgentTask>> {
    let source = task.state.source as { mail: Mail; fileId: string } | undefined;
    if (!source) {
      const w = await this.workspace.snapshot(owner);
      const mail = w.mail.find((m) => m.id === task.input.messageId);
      if (!mail) throw new Error("برای شروع این کار، یک ایمیل فعلی با پیوست PDF انتخاب کنید");
      const ref = mail.attachments[0];
      if (!ref) throw new Error("این ایمیل پیوست PDF ندارد");
      await ctx.guard();
      let file: Artifact;
      try {
        file = await this.files.get(owner, ref);
      } catch (error) {
        if (!(error instanceof AppError && error.status === 404)) throw error;
        file = await this.workspace.importAttachment(owner, ref);
      }
      source = { mail, fileId: file.id };
      task = await ctx.checkpoint({
        state: { ...task.state, source },
        evidence: [this.mailEvidence(mail)],
        plan: task.plan.map((s, i) => ({ ...s, status: i === 0 ? "succeeded" : "pending" })),
      });
      await ctx.event("step", "سند پیدا شد", file.name);
    }
    const fields = z
      .record(z.string(), z.union([z.string(), z.boolean()]))
      .optional()
      .parse(task.input.fields);
    if (!fields || !Object.keys(fields).length) {
      const file = await this.files.get(owner, source.fileId);
      const names = file.fields
        ?.filter((f) => f.type !== "unsupported")
        .map((f) => f.name)
        .join("، ");
      if (!names)
        throw new Error(
          "این PDF هیچ فیلد قابل‌پرکردنِ پشتیبانی‌شده‌ای ندارد. آن را در «فایل‌ها» باز کنید و بررسی کنید.",
        );
      return {
        status: "waiting_input",
        question: `مقادیری را که می‌خواهید در فرم وارد شود بنویسید. فیلدهای پشتیبانی‌شده: ${names}. فایل PDF اصلی دست‌نخورده می‌ماند.`,
        state: {
          ...task.state,
          source,
          missingFields: file.fields?.filter((f) => f.type !== "unsupported"),
        },
      };
    }
    let filledId = typeof task.state.filledId === "string" ? task.state.filledId : undefined;
    if (!filledId) {
      await ctx.guard();
      const filled = await this.files.fill(owner, source.fileId, fields);
      filledId = filled.id;
      task = await ctx.checkpoint({
        state: { ...task.state, source, filledId },
        artifactIds: [filledId],
        plan: task.plan.map((s, i) => ({ ...s, status: i <= 1 ? "succeeded" : "pending" })),
      });
      await ctx.event("step", "یک نسخهٔ پرشده ذخیره شد", filled.name);
    }
    const input: ProposalInput = {
      kind: "email.send",
      data: {
        to: [source.mail.from],
        cc: [],
        bcc: [],
        subject: /^re:/i.test(source.mail.subject)
          ? source.mail.subject
          : `Re: ${source.mail.subject}`,
        body:
          typeof task.input.reply === "string"
            ? task.input.reply
            : "سلام،\n\nفرم تکمیل‌شده پیوست این ایمیل است.\n\nبا سپاس",
        attachmentIds: [filledId],
        threadId: source.mail.threadId,
        replyToMessageId: source.mail.id,
      },
    };
    const proposal = await this.prepare(owner, task, input, "document-reply", ctx);
    return {
      status: "waiting_approval",
      actionId: proposal.id,
      plan: task.plan.map((s, i) => ({
        ...s,
        status: i < 3 ? "succeeded" : i === 3 ? "waiting" : "pending",
      })),
    };
  }
  private async observe(
    owner: string,
    task: AgentTask,
    ctx: TaskContext,
  ): Promise<Partial<AgentTask>> {
    const monitor = await this.db.get<Monitor>(owner, "monitors", String(task.input.monitorId));
    if (!monitor) throw new Error("این پیگیری پیدا نشد. یک پیگیری جدید بسازید.");
    if (monitor.status !== "active")
      return { status: monitor.status === "paused" ? "paused" : "cancelled" };
    let observation: { url: string; title: string; text: string; sessionId?: string };
    if (monitor.url === "sample://availability") {
      if (this.config.mode !== "sample")
        throw new Error("منبع نمونه در این فضای کاری در دسترس نیست. یک صفحهٔ عمومی را پیگیری کنید.");
      const page = await this.db.get<{ text: string }>(owner, "sample-pages", "availability");
      observation = {
        url: monitor.url,
        title: "نمونهٔ میزهای خالی شام",
        text: page?.text ?? "میز خالی وجود ندارد. بعداً دوباره بررسی کنید.",
      };
    } else {
      await ctx.guard();
      observation = await this.browser.observe(
        owner,
        monitor.url,
        typeof task.state.sessionId === "string" ? task.state.sessionId : undefined,
      );
    }
    const text = observation.text.replace(/\s+/g, " ").trim();
    const currentHash = hash(text);
    const previousHash = monitor.lastHash;
    const matched =
      monitor.condition === "change"
        ? Boolean(previousHash && previousHash !== currentHash)
        : monitor.condition === "contains"
          ? text.toLowerCase().includes(monitor.value.toLowerCase())
          : this.matchesPrice(text, Number(monitor.value));
    const previouslyMatched = Boolean(task.state.matched);
    const shouldNotify = matched && (monitor.condition === "change" || !previouslyMatched);
    const nextCheckAt = new Date(Date.now() + monitor.intervalMinutes * 60000).toISOString();
    await ctx.guard();
    // Worker lease is checked before each publication; monitor control also invalidates that lease.
    const savedMonitor = await this.db.compareAndSwap(
      owner,
      "monitors",
      monitor.id,
      { status: "active" },
      {
        checks: monitor.checks + 1,
        lastCheckedAt: date(),
        lastHash: currentHash,
        lastValue: text.slice(0, 1000),
        nextCheckAt,
        error: null,
      },
    );
    if (!savedMonitor) throw new LostLeaseError();
    await ctx.event(
      "observation",
      previousHash ? "تغییرات بررسی شد" : "اولین مشاهده ذخیره شد",
      text.slice(0, 1000),
    );
    if (shouldNotify) {
      await ctx.guard();
      await ctx.event("result", "یک تغییر مهم پیدا شد", text.slice(0, 500));
    }
    return {
      status: "scheduled",
      nextRunAt: nextCheckAt,
      result: shouldNotify
        ? "تغییری پیدا شد. یک اعلان آماده است."
        : "در حال پیگیری هستم. طبق زمان‌بندی دوباره بررسی می‌کنم.",
      state: {
        ...task.state,
        sessionId: observation.sessionId,
        matched,
        failures: 0,
        notice: shouldNotify
          ? {
              title: monitor.title,
              body: `شرط در ${observation.url} برقرار شد: ${text.slice(0, 240)}`,
              key: `monitor:${monitor.id}:${currentHash}`,
            }
          : null,
      },
      error: null,
      evidence: [
        {
          id: monitor.id,
          kind: "web",
          title: observation.title,
          url: observation.url,
          excerpt: text.slice(0, 600),
        },
      ],
      plan: task.plan.map((s) => ({ ...s, status: "succeeded" })),
    };
  }
  private matchesPrice(text: string, threshold: number) {
    // Accept Persian/Arabic digits and separators, and amounts written as «۱۲ دلار».
    const latin = text
      .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
      .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
      .replace(/[٬،]/g, ",")
      .replace(/٫/g, ".");
    const amount = "(\\d+(?:,\\d{3})*(?:\\.\\d{1,2})?)";
    const matches = [
      ...latin.matchAll(new RegExp(`(?:\\$|USD\\s*)${amount}`, "g")),
      ...latin.matchAll(new RegExp(`${amount}\\s*دلار`, "g")),
    ];
    return matches.some((m) => Number(m[1].replace(/,/g, "")) < threshold);
  }
}
