import { randomInt } from "node:crypto";
import type { Store } from "../db.ts";
import type { BotPlatform } from "./api.ts";

/** Chat bindings and pending link codes live under the shared "system" owner. */
export const SYSTEM_OWNER = "system";
export const LINKS_KIND = "bot-links";
export const CODES_KIND = "bot-link-codes";
export const HISTORY_KIND = "bot-history";
export const LINK_CODE_TTL_MS = 10 * 60 * 1000;

export interface BotLink {
  /** `${platform}:${chatId}` */
  id: string;
  platform: BotPlatform;
  chatId: string;
  owner: string;
  linkedAt: string;
  /** Notifications created after this instant are forwarded to the chat. */
  notifiedAt: string;
  name?: string;
}
interface LinkCode {
  id: string;
  owner: string;
  expiresAt: number;
}

export const linkId = (platform: BotPlatform, chatId: number | string) => `${platform}:${chatId}`;

/** A fresh 6-digit code for `owner`; any older code of the same owner stops working. */
export async function createLinkCode(db: Store, owner: string, now = Date.now()) {
  for (const { value } of await db.scan<LinkCode>(CODES_KIND))
    if (value.owner === owner || value.expiresAt < now)
      await db.remove(SYSTEM_OWNER, CODES_KIND, value.id);
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = String(randomInt(100000, 1000000));
    const saved = await db.insertIfAbsent<LinkCode>(SYSTEM_OWNER, CODES_KIND, {
      id: code,
      owner,
      expiresAt: now + LINK_CODE_TTL_MS,
    });
    if (saved) return { code, expiresAt: new Date(saved.expiresAt).toISOString() };
  }
  throw new Error("Could not allocate a bot link code");
}

/** Single-use: the code is deleted atomically whether or not it is still valid. */
export async function consumeLinkCode(db: Store, code: string, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return undefined;
  const value = await db.take<LinkCode>(SYSTEM_OWNER, CODES_KIND, code);
  return value && value.expiresAt >= now ? value.owner : undefined;
}

export function findLink(db: Store, platform: BotPlatform, chatId: number | string) {
  return db.get<BotLink>(SYSTEM_OWNER, LINKS_KIND, linkId(platform, chatId));
}

export async function linkChat(
  db: Store,
  platform: BotPlatform,
  chatId: number | string,
  owner: string,
  name?: string,
  now = Date.now(),
) {
  const id = linkId(platform, chatId);
  // A chat that moves to another account must not carry the previous owner's history.
  const previous = await db.get<BotLink>(SYSTEM_OWNER, LINKS_KIND, id);
  if (previous) await db.remove(previous.owner, HISTORY_KIND, id);
  const at = new Date(now).toISOString();
  return db.put<BotLink>(SYSTEM_OWNER, LINKS_KIND, {
    id,
    platform,
    chatId: String(chatId),
    owner,
    linkedAt: at,
    notifiedAt: at,
    ...(name ? { name } : {}),
  });
}

export async function unlinkChat(db: Store, id: string) {
  const link = await db.take<BotLink>(SYSTEM_OWNER, LINKS_KIND, id);
  if (link) await db.remove(link.owner, HISTORY_KIND, id);
  return link;
}

export async function listLinks(db: Store, owner?: string) {
  return (await db.scan<BotLink>(LINKS_KIND))
    .map(({ value }) => value)
    .filter((link) => !owner || link.owner === owner);
}
