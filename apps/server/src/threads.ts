import { MessageSchema } from "@ag-ui/core";
import { Hono } from "hono";
import { z } from "zod";
import { type Config, threadsBackend } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

/**
 * Self-hosted thread persistence (THREADS_BACKEND=local).
 *
 * This generalises the sample workspace's local history (`/api/conversation`, where the client
 * saves the AG-UI message list after every turn) to many threads, so live workspaces can keep the
 * main conversation and side chats in OpenMuse's own database (Postgres or embedded PGlite)
 * without CopilotKit Intelligence. Thread metadata and messages are owner-scoped records.
 */
export interface LocalThread {
  id: string;
  name: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

const THREADS = "threads",
  MESSAGES = "thread-messages";
const threadId = z.string().regex(/^[\w.@:=-]{1,128}$/, "شناسهٔ گفت‌وگو نامعتبر است");

/** Local multi-thread history is used by live workspaces that do not use Intelligence. */
export function localThreadsEnabled(config: Config) {
  return config.mode === "live" && threadsBackend(config) === "local";
}

function textOf(message: unknown): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : ""))
      .join(" ");
  return "";
}

function defaultName(messages: unknown[]) {
  const first = messages.find((m) => (m as { role?: string }).role === "user");
  const text = first ? textOf(first).replace(/\s+/g, " ").trim() : "";
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

export function localThreadRoutes(db: Store) {
  const routes = new Hono<{ Variables: { owner: string } }>();
  routes.get("/", async (c) => {
    const query = z
      .object({
        includeArchived: z.enum(["true", "false"]).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        cursor: z.coerce.number().int().min(0).default(0),
      })
      .parse(c.req.query());
    const threads = (await db.list<LocalThread>(c.get("owner"), THREADS))
      .filter((thread) => query.includeArchived === "true" || !thread.archived)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    const page = threads.slice(query.cursor, query.cursor + query.limit);
    const next = query.cursor + page.length;
    return c.json({ threads: page, nextCursor: next < threads.length ? String(next) : null });
  });
  routes.patch("/:id", async (c) => {
    const id = threadId.parse(c.req.param("id"));
    const body = z
      .object({
        name: z.string().trim().min(1).max(200).optional(),
        archived: z.boolean().optional(),
      })
      .strict()
      .parse(await c.req.json());
    const owner = c.get("owner");
    const thread = await db.get<LocalThread>(owner, THREADS, id);
    if (!thread) throw new AppError("گفت‌وگو پیدا نشد", 404);
    return c.json(await db.put(owner, THREADS, { ...thread, ...body }));
  });
  routes.get("/:id/messages", async (c) => {
    const id = threadId.parse(c.req.param("id"));
    const saved = await db.get<{ messages: unknown[] }>(c.get("owner"), MESSAGES, id);
    return c.json({ threadId: id, messages: saved?.messages ?? [] });
  });
  routes.put("/:id/messages", async (c) => {
    const id = threadId.parse(c.req.param("id"));
    const body = z.object({ messages: z.array(z.unknown()).max(1000) }).parse(await c.req.json());
    // @ag-ui/core bundles its own zod, so map its failures to 422 explicitly.
    if (body.messages.some((message) => !MessageSchema.safeParse(message).success))
      throw new AppError("پیام‌های گفت‌وگو نامعتبر است", 422);
    const owner = c.get("owner"),
      now = new Date().toISOString();
    const existing = await db.get<LocalThread>(owner, THREADS, id);
    await db.put(owner, MESSAGES, { id, messages: body.messages });
    const thread = await db.put<LocalThread>(owner, THREADS, {
      id,
      name: existing?.name || defaultName(body.messages),
      archived: existing?.archived ?? false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    return c.json(thread);
  });
  return routes;
}
