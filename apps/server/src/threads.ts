import { randomUUID } from "node:crypto";
import { MessageSchema } from "@ag-ui/core";
import { Hono } from "hono";
import { z } from "zod";
import {
  findMatch,
  normalizeSearch,
  snippetAround,
  type TextRange,
} from "../../../packages/domain/src/search.ts";
import { type Config, threadsBackend } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

/**
 * Self-hosted thread persistence (THREADS_BACKEND=local).
 *
 * This generalises the sample workspace's local history (`/api/conversation`, where the client
 * saves the AG-UI message list after every turn) to many threads, so live workspaces can keep the
 * main conversation and side chats in OpenMuse's own database (Postgres or embedded PGlite)
 * without CopilotKit Intelligence. Thread metadata, messages and labels are owner-scoped records.
 */
export interface LocalThread {
  id: string;
  name: string;
  archived: boolean;
  /** Pinned threads are listed first. */
  pinned?: boolean;
  /** Ids of the owner's thread labels. */
  labels?: string[];
  createdAt: string;
  updatedAt: string;
}
export interface ThreadLabel {
  id: string;
  name: string;
  createdAt: string;
}
export interface ThreadSearchResult {
  thread: LocalThread;
  /** Match inside the thread name, if the name matched. */
  nameMatch: TextRange | null;
  /** Excerpt of the first matching message, with the match range inside the excerpt. */
  snippet: { text: string; start: number; end: number; messageId: string; role: string } | null;
}

const THREADS = "threads",
  MESSAGES = "thread-messages",
  LABELS = "thread-labels";
const MAX_LABELS = 50;
const threadId = z.string().regex(/^[\w.@:=-]{1,128}$/, "شناسهٔ گفت‌وگو نامعتبر است");
const labelName = z
  .string()
  .trim()
  .min(1, "نام برچسب را بنویسید")
  .max(40, "نام برچسب حداکثر ۴۰ نویسه است");

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

/** Owner-scoped search over thread names and the text of user and assistant messages. */
export async function searchThreads(
  db: Store,
  owner: string,
  query: string,
  limit = 30,
): Promise<ThreadSearchResult[]> {
  if (!normalizeSearch(query)) return [];
  const [threads, saved] = await Promise.all([
    db.list<LocalThread>(owner, THREADS),
    db.list<{ id: string; messages: unknown[] }>(owner, MESSAGES),
  ]);
  const messagesById = new Map(saved.map((item) => [item.id, item.messages]));
  const results: ThreadSearchResult[] = [];
  for (const thread of threads.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const nameMatch = thread.name ? findMatch(thread.name, query) : null;
    let snippet: ThreadSearchResult["snippet"] = null;
    for (const message of messagesById.get(thread.id) ?? []) {
      const { role, id } = message as { role?: string; id?: string };
      if (role !== "user" && role !== "assistant") continue;
      const text = textOf(message);
      const match = findMatch(text, query);
      if (match) {
        snippet = { ...snippetAround(text, match), messageId: String(id), role };
        break;
      }
    }
    if (nameMatch || snippet) results.push({ thread, nameMatch, snippet });
    if (results.length >= limit) break;
  }
  return results;
}

export function localThreadRoutes(db: Store) {
  const routes = new Hono<{ Variables: { owner: string } }>();
  routes.get("/", async (c) => {
    const query = z
      .object({
        includeArchived: z.enum(["true", "false"]).optional(),
        label: z.string().max(64).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        cursor: z.coerce.number().int().min(0).default(0),
      })
      .parse(c.req.query());
    const threads = (await db.list<LocalThread>(c.get("owner"), THREADS))
      .filter((thread) => query.includeArchived === "true" || !thread.archived)
      .filter((thread) => !query.label || (thread.labels ?? []).includes(query.label))
      .sort(
        (a, b) =>
          Number(b.pinned === true) - Number(a.pinned === true) ||
          b.updatedAt.localeCompare(a.updatedAt) ||
          a.id.localeCompare(b.id),
      );
    const page = threads.slice(query.cursor, query.cursor + query.limit);
    const next = query.cursor + page.length;
    return c.json({ threads: page, nextCursor: next < threads.length ? String(next) : null });
  });
  routes.get("/search", async (c) => {
    const query = z
      .object({
        q: z.string().max(200, "عبارت جست‌وجو حداکثر ۲۰۰ نویسه است"),
        limit: z.coerce.number().int().min(1).max(50).default(30),
      })
      .parse(c.req.query());
    const results = await searchThreads(db, c.get("owner"), query.q, query.limit);
    return c.json({ query: query.q, results });
  });
  routes.get("/labels", async (c) => {
    const labels = await db.list<ThreadLabel>(c.get("owner"), LABELS);
    return c.json({ labels: labels.sort((a, b) => a.name.localeCompare(b.name, "fa")) });
  });
  routes.post("/labels", async (c) => {
    const body = z
      .object({ name: labelName })
      .strict()
      .parse(await c.req.json());
    const owner = c.get("owner");
    const labels = await db.list<ThreadLabel>(owner, LABELS);
    const same = labels.find((label) => normalizeSearch(label.name) === normalizeSearch(body.name));
    if (same) return c.json(same);
    if (labels.length >= MAX_LABELS)
      throw new AppError("حداکثر ۵۰ برچسب می‌توانید بسازید. برچسبی را حذف کنید.", 409);
    const label = { id: randomUUID(), name: body.name, createdAt: new Date().toISOString() };
    return c.json(await db.put(owner, LABELS, label), 201);
  });
  routes.patch("/labels/:labelId", async (c) => {
    const body = z
      .object({ name: labelName })
      .strict()
      .parse(await c.req.json());
    const owner = c.get("owner");
    const label = await db.get<ThreadLabel>(owner, LABELS, c.req.param("labelId"));
    if (!label) throw new AppError("برچسب پیدا نشد", 404);
    return c.json(await db.put(owner, LABELS, { ...label, name: body.name }));
  });
  routes.delete("/labels/:labelId", async (c) => {
    const owner = c.get("owner"),
      labelId = c.req.param("labelId");
    const label = await db.take<ThreadLabel>(owner, LABELS, labelId);
    if (!label) throw new AppError("برچسب پیدا نشد", 404);
    for (const thread of await db.list<LocalThread>(owner, THREADS))
      if (thread.labels?.includes(labelId))
        await db.put(owner, THREADS, {
          ...thread,
          labels: thread.labels.filter((id) => id !== labelId),
        });
    return c.json({ ok: true });
  });
  routes.patch("/:id", async (c) => {
    const id = threadId.parse(c.req.param("id"));
    const body = z
      .object({
        name: z.string().trim().min(1).max(200).optional(),
        archived: z.boolean().optional(),
        pinned: z.boolean().optional(),
        labels: z.array(z.string().max(64)).max(10, "هر گفت‌وگو حداکثر ۱۰ برچسب دارد").optional(),
      })
      .strict()
      .parse(await c.req.json());
    const owner = c.get("owner");
    const thread = await db.get<LocalThread>(owner, THREADS, id);
    if (!thread) throw new AppError("گفت‌وگو پیدا نشد", 404);
    if (body.labels) {
      body.labels = [...new Set(body.labels)];
      const known = new Set((await db.list<ThreadLabel>(owner, LABELS)).map((label) => label.id));
      if (body.labels.some((label) => !known.has(label)))
        throw new AppError("برچسب پیدا نشد. فهرست برچسب‌ها را تازه کنید.", 422);
    }
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
    // Keep pins and labels; only the name default, archive flag and timestamps are managed here.
    const thread = await db.put<LocalThread>(owner, THREADS, {
      ...existing,
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
