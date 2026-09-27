import { createHash, randomBytes, randomUUID } from "node:crypto";
import { access, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { z } from "zod";
import { BRAND } from "../../../packages/domain/src/brand.ts";
import { formatJalali, tehranDate } from "../../../packages/domain/src/iran-holidays.ts";
import { createPersianDocx } from "../../../packages/integrations/src/docx.ts";
import {
  type ConversationEntry,
  conversationHtml,
  escapeHtml,
} from "../../../packages/integrations/src/pdf-html.ts";
import { type Config, threadsBackend } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";
import { PdfRenderer } from "./pdf-render.ts";
import {
  defaultName,
  type LocalThread,
  localThreadsEnabled,
  MESSAGES,
  THREADS,
  textOf,
} from "./threads.ts";

/**
 * Conversation export (PDF, Word) and private read-only share links.
 *
 * Exports read the owner's saved history (local threads, or the single sample conversation
 * `default`). A share stores a snapshot of the chosen messages under the owner plus a public
 * index record keyed by sha256(token), so the page at /s/<token> never scans other owners.
 * Tokens are 128 random bits (base64url, 22 characters); revoking deletes both records.
 */

const SHARES = "shares",
  SHARE_INDEX = "share-tokens",
  // Owner namespace for the public token index; real owners never use this value.
  PUBLIC_OWNER = "~public",
  MAX_SHARES = 200;
const threadIdSchema = z.string().regex(/^[\w.@:=-]{1,128}$/, "شناسهٔ گفت‌وگو نامعتبر است");
const messageIdSchema = z.string().min(1).max(200);
const TOKEN = /^[A-Za-z0-9_-]{22}$/;

export const ROLE_LABELS = { user: "شما", assistant: BRAND.nameFa } as const;
const PUBLIC_LABELS = { user: "کاربر", assistant: BRAND.nameFa } as const;

export interface Share {
  id: string;
  token: string;
  threadId: string;
  messageId?: string;
  title: string;
  messages: ConversationEntry[];
  createdAt: string;
  expiresAt: string | null;
}

interface ShareIndex {
  id: string;
  owner: string;
  shareId: string;
}

const persianDigits = (text: string) => text.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

/** «۲ مهر ۱۴۰۵، ساعت ۱۴:۳۰» in Tehran time (+03:30, no DST). */
export function jalaliDateTime(date: Date): string {
  const time = new Date(date.getTime() + 210 * 60_000).toISOString().slice(11, 16);
  return `${formatJalali(tehranDate(date), false)}، ساعت ${persianDigits(time)}`;
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Visible user and assistant turns with text, in order. Tool calls and tool results are left out. */
function entries(messages: unknown[]): (ConversationEntry & { id: string })[] {
  return messages.flatMap((message) => {
    const { role, id } = message as { role?: unknown; id?: unknown };
    if (role !== "user" && role !== "assistant") return [];
    const text = textOf(message).trim();
    return text ? [{ id: String(id ?? ""), role, text }] : [];
  });
}

/** The owner's saved conversation, or a 404 when it does not exist for this owner. */
async function loadConversation(db: Store, config: Config, owner: string, threadId: string) {
  if (localThreadsEnabled(config)) {
    const saved = await db.get<{ messages: unknown[] }>(owner, MESSAGES, threadId);
    if (!saved) throw new AppError("گفت‌وگو پیدا نشد. پیش از خروجی گرفتن، یک پیام بفرستید.", 404);
    const thread = await db.get<LocalThread>(owner, THREADS, threadId);
    return {
      title: thread?.name || defaultName(saved.messages) || `گفت‌وگو با ${BRAND.nameFa}`,
      messages: entries(saved.messages),
    };
  }
  if (config.mode === "live" && threadsBackend(config) === "intelligence")
    throw new AppError(
      "خروجی و اشتراک‌گذاری فقط برای گفت‌وگوهایی در دسترس است که در همین سرور ذخیره می‌شوند.",
      409,
    );
  if (threadId !== "default") throw new AppError("گفت‌وگو پیدا نشد", 404);
  const saved = await db.get<{ messages: unknown[] }>(owner, "conversations", "default");
  return {
    title: defaultName(saved?.messages ?? []) || `گفت‌وگو با ${BRAND.nameFa}`,
    messages: entries(saved?.messages ?? []),
  };
}

/** The whole conversation, or only one assistant answer when `messageId` is given. */
async function selection(
  db: Store,
  config: Config,
  owner: string,
  threadId: string,
  messageId?: string,
) {
  const conversation = await loadConversation(db, config, owner, threadId);
  if (!messageId) {
    if (!conversation.messages.length)
      throw new AppError("این گفت‌وگو هنوز پیامی ندارد. پس از گفت‌وگو دوباره تلاش کنید.", 422);
    return {
      title: conversation.title,
      messages: conversation.messages.map(({ role, text }) => ({ role, text })),
    };
  }
  const answer = conversation.messages.find(
    (message) => message.id === messageId && message.role === "assistant",
  );
  if (!answer) throw new AppError("این پاسخ پیدا نشد. صفحه را تازه کنید و دوباره تلاش کنید.", 404);
  return {
    title: `پاسخ ${BRAND.nameFa}`,
    messages: [{ role: answer.role, text: answer.text }],
  };
}

const CONVERSATION_CSS = `<style>
.message { margin: 0 0 1.1em; padding-top: 0.6em; border-top: 0.75pt solid #e3e8e9 }
.message .role { font-weight: 700; font-size: 9.5pt; color: #5f686c; margin: 0 0 0.3em }
.message.assistant .role { color: #1f6f8b }
</style>`;

function attachment(name: string, extension: string) {
  const safe =
    name
      .replace(/[\\/:*?"<>|\n\r\t]+/g, " ")
      .trim()
      .slice(0, 80) || "conversation";
  return `attachment; filename="conversation.${extension}"; filename*=UTF-8''${encodeURIComponent(`${safe}.${extension}`)}`;
}

function publicShare(share: Share, now = Date.now()) {
  return {
    id: share.id,
    threadId: share.threadId,
    messageId: share.messageId ?? null,
    title: share.title,
    messageCount: share.messages.length,
    path: `/s/${share.token}`,
    createdAt: share.createdAt,
    expiresAt: share.expiresAt,
    expired: share.expiresAt !== null && Date.parse(share.expiresAt) <= now,
  };
}

/** Authenticated, owner-scoped routes; mounted under /api after the session middleware. */
export function shareRoutes(db: Store, config: Config) {
  const routes = new Hono<{ Variables: { owner: string } }>();
  const pdf = new PdfRenderer(config);
  routes.get("/threads/:id/export", async (c) => {
    const threadId = threadIdSchema.parse(c.req.param("id"));
    const query = z
      .object({ format: z.enum(["pdf", "docx"]), messageId: messageIdSchema.optional() })
      .parse(c.req.query());
    const owner = c.get("owner");
    const chosen = await selection(db, config, owner, threadId, query.messageId);
    const now = new Date();
    const meta = `${jalaliDateTime(now)} · ${chosen.messages.length === 1 ? "یک پیام" : `${persianDigits(String(chosen.messages.length))} پیام`}`;
    c.header("Content-Disposition", attachment(chosen.title, query.format));
    if (query.format === "docx") {
      c.header(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      return c.body(
        createPersianDocx({
          title: chosen.title,
          meta,
          created: now,
          blocks: chosen.messages.map((message) => ({
            label: ROLE_LABELS[message.role],
            labelColor: message.role === "assistant" ? "1F6F8B" : "5F686C",
            markdown: message.text,
          })),
        }),
      );
    }
    const html =
      CONVERSATION_CSS +
      conversationHtml({
        title: chosen.title,
        meta,
        messages: chosen.messages,
        labels: ROLE_LABELS,
      });
    const bytes = await pdf.render(html, { title: chosen.title, signal: c.req.raw.signal });
    c.header("Content-Type", "application/pdf");
    return c.body(new Uint8Array(bytes));
  });
  routes.get("/shares", async (c) => {
    const threadId = c.req.query("threadId");
    const shares = (await db.list<Share>(c.get("owner"), SHARES))
      .filter((share) => !threadId || share.threadId === threadId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return c.json({ shares: shares.map((share) => publicShare(share)) });
  });
  routes.post("/shares", async (c) => {
    const body = z
      .object({
        threadId: threadIdSchema,
        messageId: messageIdSchema.optional(),
        expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
      })
      .strict()
      .parse(await c.req.json());
    const owner = c.get("owner");
    if ((await db.list(owner, SHARES)).length >= MAX_SHARES)
      throw new AppError(
        `حداکثر ${persianDigits(String(MAX_SHARES))} پیوند اشتراکی می‌توانید داشته باشید. چند پیوند قدیمی را لغو کنید و دوباره تلاش کنید.`,
        429,
      );
    const chosen = await selection(db, config, owner, body.threadId, body.messageId);
    const now = new Date();
    const token = randomBytes(16).toString("base64url");
    const share: Share = {
      id: randomUUID(),
      token,
      threadId: body.threadId,
      ...(body.messageId ? { messageId: body.messageId } : {}),
      title: chosen.title,
      messages: chosen.messages,
      createdAt: now.toISOString(),
      expiresAt: body.expiresInDays
        ? new Date(now.getTime() + body.expiresInDays * 86_400_000).toISOString()
        : null,
    };
    await db.put(owner, SHARES, share);
    await db.put<ShareIndex>(PUBLIC_OWNER, SHARE_INDEX, {
      id: tokenHash(token),
      owner,
      shareId: share.id,
    });
    return c.json(publicShare(share), 201);
  });
  routes.delete("/shares/:id", async (c) => {
    const owner = c.get("owner");
    const share = await db.get<Share>(owner, SHARES, c.req.param("id"));
    if (!share) throw new AppError("پیوند اشتراکی پیدا نشد", 404);
    await db.remove(PUBLIC_OWNER, SHARE_INDEX, tokenHash(share.token));
    await db.remove(owner, SHARES, share.id);
    return c.json({ ok: true });
  });
  return routes;
}

/** Looks up a live share by token; revoked, expired and unknown tokens all read as missing. */
export async function findShare(db: Store, token: string, now = Date.now()): Promise<Share | null> {
  if (!TOKEN.test(token)) return null;
  const index = await db.get<ShareIndex>(PUBLIC_OWNER, SHARE_INDEX, tokenHash(token));
  if (!index) return null;
  const share = await db.get<Share>(index.owner, SHARES, index.shareId);
  if (!share || share.token !== token) return null;
  if (share.expiresAt !== null && Date.parse(share.expiresAt) <= now) return null;
  return share;
}

let fonts: Promise<Record<string, string | undefined>> | undefined;
/**
 * Vazirmatn for the public page: the exported web app's copy (WEB_DIST) in production,
 * the worker's bundled copy in a development checkout. Missing fonts fall back to Tahoma.
 */
function fontFiles(): Promise<Record<string, string | undefined>> {
  fonts ??= (async () => {
    const found: Record<string, string | undefined> = {};
    const dist = process.env.WEB_DIST;
    if (dist) {
      const root = resolve(dist, "assets");
      try {
        for (const entry of await readdir(root, { recursive: true })) {
          const match = /(?:^|[\\/])Vazirmatn_(400Regular|700Bold)(?:\.[0-9a-f]+)?\.ttf$/.exec(
            entry,
          );
          if (match) found[match[1] === "700Bold" ? "700" : "400"] ??= join(root, entry);
        }
      } catch {}
    }
    for (const [weight, file] of [
      ["400", "Vazirmatn-Regular.ttf"],
      ["700", "Vazirmatn-Bold.ttf"],
    ] as const) {
      if (found[weight]) continue;
      const candidate = fileURLToPath(
        new URL(`../../worker/assets/fonts/${file}`, import.meta.url),
      );
      try {
        await access(candidate);
        found[weight] = candidate;
      } catch {}
    }
    return found;
  })();
  return fonts;
}

function page(title: string, body: string, status: "ok" | "missing"): string {
  return `<!doctype html>
<html lang="fa-IR" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)} | ${escapeHtml(BRAND.nameFa)}</title>
<style>
@font-face { font-family: "Vazirmatn"; font-weight: 400; font-display: swap; src: local("Vazirmatn"), url("/s/_font/400.ttf") format("truetype") }
@font-face { font-family: "Vazirmatn"; font-weight: 700; font-display: swap; src: local("Vazirmatn Bold"), url("/s/_font/700.ttf") format("truetype") }
:root { --bg: #f6f8f8; --card: #ffffff; --text: #111a1c; --muted: #5f686c; --line: #e3e8e9; --accent: #1f6f8b; --user: #e6f0f3; --code: #eef2f3 }
@media (prefers-color-scheme: dark) {
  :root { --bg: #0f1415; --card: #171e20; --text: #e8eef0; --muted: #9aa6aa; --line: #2a3437; --accent: #7cc4dc; --user: #1d2a2e; --code: #222c2f }
}
* { box-sizing: border-box }
html { font-family: "Vazirmatn", Tahoma, sans-serif; font-size: 16px; line-height: 1.8; color: var(--text); background: var(--bg) }
body { margin: 0; padding: 24px 16px 40px }
main { max-width: 760px; margin: 0 auto }
.brand { color: var(--muted); font-size: 14px; margin: 0 0 16px; font-weight: 700 }
article { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 24px 20px }
h1 { font-size: 26px; line-height: 1.35; margin: 0 0 4px }
h2, h3, h4 { line-height: 1.4; margin: 1.1em 0 0.4em }
.meta { color: var(--muted); font-size: 14px; margin: 0 0 20px }
header { border-bottom: 1px solid var(--line); margin-bottom: 8px }
.message { padding: 14px 0; border-bottom: 1px solid var(--line) }
.message:last-child { border-bottom: 0 }
.message.user { background: var(--user); border-radius: 12px; padding: 12px 14px; margin: 12px 0; border-bottom: 0 }
.role { font-weight: 700; font-size: 14px; color: var(--muted); margin: 0 0 4px }
.message.assistant .role { color: var(--accent) }
p { margin: 0 0 0.7em; overflow-wrap: anywhere }
ul, ol { margin: 0 0 0.8em; padding-inline-start: 1.4em }
table { display: block; overflow-x: auto; max-width: 100%; border-collapse: collapse; margin: 0.4em 0 1em; font-size: 14px; line-height: 1.6 }
th, td { border: 1px solid var(--line); padding: 6px 8px; text-align: start; vertical-align: top }
thead th { background: var(--code) }
hr { border: 0; border-top: 1px solid var(--line); margin: 1em 0 }
code { direction: ltr; unicode-bidi: isolate; font-family: ui-monospace, Consolas, monospace; font-size: 0.9em; background: var(--code); border-radius: 4px; padding: 0 4px }
footer { color: var(--muted); font-size: 13px; text-align: center; margin-top: 16px }
.missing { text-align: center }
</style>
</head>
<body>
<main>
<p class="brand">${escapeHtml(BRAND.nameFa)}</p>
<article${status === "missing" ? ' class="missing"' : ""}>
${body}
</article>
<footer>این صفحه فقط‌خواندنی است و با پیوندی خصوصی به اشتراک گذاشته شده است.</footer>
</main>
</body>
</html>`;
}

/** Public, unauthenticated routes: the read-only share page and its font files. */
export function publicShareRoutes(db: Store) {
  const routes = new Hono();
  routes.use("*", async (c, next) => {
    await next();
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.header("X-Frame-Options", "DENY");
  });
  routes.get("/_font/:file", async (c) => {
    const weight = /^(400|700)\.ttf$/.exec(c.req.param("file"))?.[1];
    const path = weight ? (await fontFiles())[weight] : undefined;
    if (!path) return c.text("Not found", 404);
    c.header("Content-Type", "font/ttf");
    c.header("Cache-Control", "public, max-age=604800");
    return c.body(new Uint8Array(await readFile(path)));
  });
  routes.get("/:token", async (c) => {
    c.header(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    const share = await findShare(db, c.req.param("token"));
    if (!share)
      return c.html(
        page(
          "پیوند در دسترس نیست",
          `<h1>این پیوند در دسترس نیست</h1><p class="meta">ممکن است مالک گفت‌وگو آن را لغو کرده باشد یا تاریخ انقضای آن گذشته باشد. برای دیدن گفت‌وگو، پیوند تازه‌ای از او بخواهید.</p>`,
          "missing",
        ),
        404,
      );
    const meta = `اشتراک‌گذاشته‌شده در ${jalaliDateTime(new Date(share.createdAt))}${
      share.expiresAt ? ` · معتبر تا ${jalaliDateTime(new Date(share.expiresAt))}` : ""
    }`;
    return c.html(
      page(
        share.title,
        conversationHtml({
          title: share.title,
          meta,
          messages: share.messages,
          labels: PUBLIC_LABELS,
        }),
        "ok",
      ),
    );
  });
  return routes;
}
