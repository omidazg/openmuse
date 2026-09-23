import { BRAND } from "../../../../packages/domain/src/brand.ts";
import type { Store } from "../db.ts";
import type { AgentService } from "../engine/service.ts";
import { BotApi } from "./api.ts";
import { assistantReply } from "./assistant.ts";
import { BotService, type QuotaCheck } from "./service.ts";

export interface BotEnv {
  BALE_BOT_TOKEN?: string;
  BALE_API_BASE?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_API_BASE?: string;
}

/** One client per configured token; Telegram can go through a reverse proxy (TELEGRAM_API_BASE). */
export function botsFromEnv(env: BotEnv = process.env, fetcher?: typeof fetch): BotApi[] {
  const bots: BotApi[] = [];
  if (env.BALE_BOT_TOKEN?.trim())
    bots.push(new BotApi("bale", env.BALE_BOT_TOKEN.trim(), env.BALE_API_BASE, fetcher));
  if (env.TELEGRAM_BOT_TOKEN?.trim())
    bots.push(
      new BotApi("telegram", env.TELEGRAM_BOT_TOKEN.trim(), env.TELEGRAM_API_BASE, fetcher),
    );
  return bots;
}

/**
 * Start long polling for every configured messenger bot. Returns undefined when no token is
 * set. Run this in exactly one process per token (the task worker), or getUpdates conflicts.
 */
export function startBots(
  db: Store,
  agent: AgentService,
  options: { env?: BotEnv; quota?: QuotaCheck } = {},
) {
  const bots = botsFromEnv(options.env);
  if (!bots.length) return undefined;
  const service = new BotService(db, bots, {
    reply: assistantReply(agent),
    // TODO(quota): pass the shared usage-quota check here once the quota module exists, e.g.
    // quota: async (owner) => ((await quotas.allow(owner)) ? undefined : "سهمیهٔ امروز شما تمام شده است."),
    quota: options.quota,
  });
  service.start();
  console.log(`${BRAND.name} messenger bots polling: ${service.platforms.join(", ")}`);
  return service;
}
