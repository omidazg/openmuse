import { Hono } from "hono";
import { z } from "zod";
import type {
  AgentIdentity,
  AgentMemory,
  AgentNotification,
} from "../../../../packages/domain/src/agent.ts";
import { AppError } from "../errors.ts";
import {
  memoryText,
  personalSettingsSchema,
  pinPersona,
  readPersonal,
  saveMemory,
  savePersonal,
  threadPersona,
} from "./personal.ts";
import type { AgentService } from "./service.ts";

const memorySchema = z.object({
  text: memoryText,
  source: z.string().trim().min(1).max(200).optional(),
});
const threadIdSchema = z.string().regex(/^[\w.@:=-]{1,128}$/, "شناسهٔ گفت‌وگو نامعتبر است");
const goalPatchSchema = z.object({
  status: z.enum(["active", "paused", "completed"]).optional(),
  milestones: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        title: z.string().trim().min(1).max(200),
        done: z.boolean(),
      }),
    )
    .max(100)
    .optional(),
});

export function agentRoutes(service: AgentService): Hono<{ Variables: { owner: string } }> {
  const app = new Hono<{ Variables: { owner: string } }>();
  app.get("/", async (c) => c.json(await service.snapshot(c.get("owner"))));
  app.post("/tasks", async (c) =>
    c.json(await service.createTask(c.get("owner"), await c.req.json()), 201),
  );
  app.get("/tasks/:id", async (c) =>
    c.json(await service.detail(c.get("owner"), c.req.param("id"))),
  );
  app.post("/tasks/:id/control", async (c) => {
    const { action } = z
      .object({ action: z.enum(["pause", "resume", "cancel", "retry"]) })
      .parse(await c.req.json());
    return c.json(await service.control(c.get("owner"), c.req.param("id"), action));
  });
  app.post("/tasks/:id/input", async (c) => {
    const body = z
      .object({
        answer: z.string().trim().min(1).max(12000),
        fields: z
          .record(z.string().min(1).max(300), z.union([z.string().max(12000), z.boolean()]))
          .optional(),
      })
      .parse(await c.req.json());
    return c.json(
      await service.answer(c.get("owner"), c.req.param("id"), body.answer, body.fields),
    );
  });
  app.post("/artifacts/:id/pdf", async (c) =>
    c.json(await service.exportArtifactPdf(c.get("owner"), c.req.param("id")), 201),
  );
  app.post("/goals", async (c) =>
    c.json(await service.createGoal(c.get("owner"), await c.req.json()), 201),
  );
  app.post("/goals/:id", async (c) => {
    const body = goalPatchSchema.parse(await c.req.json());
    return c.json(await service.updateGoal(c.get("owner"), c.req.param("id"), body));
  });
  app.post("/monitors", async (c) =>
    c.json(await service.createMonitor(c.get("owner"), await c.req.json()), 201),
  );
  app.post("/monitors/:id/control", async (c) => {
    const { action } = z
      .object({ action: z.enum(["pause", "resume", "stop", "check"]) })
      .parse(await c.req.json());
    return c.json(await service.controlMonitor(c.get("owner"), c.req.param("id"), action));
  });
  app.post("/ideas/refresh", async (c) => c.json(await service.refreshIdeas(c.get("owner"))));
  app.post("/ideas/:id", async (c) => {
    const body = z
      .object({
        action: z.enum(["accept", "dismiss"]),
        prompt: z.string().trim().min(1).max(12000).optional(),
      })
      .parse(await c.req.json());
    return c.json(
      await service.decideIdea(c.get("owner"), c.req.param("id"), body.action, body.prompt),
    );
  });
  app.post("/memories", async (c) => {
    const body = memorySchema.parse(await c.req.json());
    const owner = c.get("owner");
    return c.json(await saveMemory(service.db, owner, body.text, body.source ?? "شما"), 201);
  });
  // Registered before /memories/:id so "clear" is never read as a memory id.
  app.post("/memories/clear", async (c) =>
    c.json({ ok: true, removed: await service.db.removeAll(c.get("owner"), "memories") }),
  );
  app.post("/memories/:id", async (c) => {
    const body = memorySchema.parse(await c.req.json());
    const memory = await service.db.compareAndSwap<AgentMemory>(
      c.get("owner"),
      "memories",
      c.req.param("id"),
      {},
      { ...body, updatedAt: new Date().toISOString() },
    );
    if (!memory) throw new AppError("این مورد حافظه پیدا نشد. فهرست حافظه را تازه کنید.", 404);
    return c.json(memory);
  });
  app.post("/memories/:id/forget", async (c) => {
    if (!(await service.db.take(c.get("owner"), "memories", c.req.param("id"))))
      throw new AppError("این مورد حافظه پیدا نشد. فهرست حافظه را تازه کنید.", 404);
    return c.json({ ok: true });
  });
  app.get("/personal", async (c) => c.json(await readPersonal(service.db, c.get("owner"))));
  app.post("/personal", async (c) => {
    const body = personalSettingsSchema.parse(await c.req.json());
    return c.json(await savePersonal(service.db, c.get("owner"), body));
  });
  app.get("/threads/:threadId/persona", async (c) => {
    const threadId = threadIdSchema.parse(c.req.param("threadId"));
    const persona = await threadPersona(service.db, c.get("owner"), threadId);
    return c.json({ personaId: persona?.id ?? null });
  });
  app.post("/threads/:threadId/persona", async (c) => {
    const threadId = threadIdSchema.parse(c.req.param("threadId"));
    const { personaId } = z
      .object({ personaId: z.string().min(1).max(64) })
      .parse(await c.req.json());
    const persona = await pinPersona(service.db, c.get("owner"), threadId, personaId);
    return c.json({ personaId: persona.id }, 201);
  });
  app.post("/identity", async (c) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(80),
        tone: z.enum(["warm", "concise", "thoughtful"]),
        avatar: z.enum(["sky", "sand", "lilac"]).optional(),
        showChatUpdates: z.boolean().optional(),
      })
      .parse(await c.req.json());
    const owner = c.get("owner");
    await service.ensure(owner);
    const identity = await service.db.compareAndSwap<AgentIdentity>(
      owner,
      "agent-settings",
      "identity",
      {},
      body,
    );
    if (!identity)
      throw new AppError(
        "مشخصات دستیار تغییر کرده است. صفحه را تازه کنید و دوباره تلاش کنید.",
        409,
      );
    return c.json(identity);
  });
  app.get("/notifications", async (c) =>
    c.json((await service.snapshot(c.get("owner"))).notifications),
  );
  app.post("/notifications/:id/read", async (c) => {
    const notification = await service.db.compareAndSwap<AgentNotification>(
      c.get("owner"),
      "notifications",
      c.req.param("id"),
      {},
      { read: true },
    );
    if (!notification) throw new AppError("این اعلان پیدا نشد. اعلان‌ها را تازه کنید.", 404);
    return c.json(notification);
  });
  app.post("/sample-page", async (c) => {
    if (service.config.mode !== "sample") throw new AppError("پیدا نشد", 404);
    const body = z.object({ text: z.string().max(100000) }).parse(await c.req.json());
    await service.db.put(c.get("owner"), "sample-pages", { id: "availability", text: body.text });
    return c.json({ ok: true });
  });
  return app;
}
