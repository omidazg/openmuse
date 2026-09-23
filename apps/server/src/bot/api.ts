/**
 * Minimal client for the Telegram Bot API. Bale (https://tapi.bale.ai) implements the same
 * methods, so one client serves both platforms and differs only by base URL.
 * The token is part of every request URL; never log URLs or raw fetch errors from here.
 */
export type BotPlatform = "bale" | "telegram";

export const DEFAULT_API_BASE: Record<BotPlatform, string> = {
  bale: "https://tapi.bale.ai",
  telegram: "https://api.telegram.org",
};

export interface BotChat {
  id: number | string;
  type: string;
}
export interface BotMessage {
  message_id: number;
  chat: BotChat;
  from?: { id: number | string; first_name?: string; username?: string };
  text?: string;
  voice?: unknown;
  audio?: unknown;
  photo?: unknown;
  document?: unknown;
}
export interface BotUpdate {
  update_id: number;
  message?: BotMessage;
}

export class BotApiError extends Error {
  constructor(
    readonly method: string,
    readonly status: number,
    readonly description?: string,
    readonly retryAfter?: number,
  ) {
    super(`Bot API ${method} failed (${status})${description ? `: ${description}` : ""}`);
    this.name = "BotApiError";
  }
}

export class BotApi {
  private readonly base: string;
  constructor(
    readonly platform: BotPlatform,
    private readonly token: string,
    base?: string,
    private readonly fetcher: typeof fetch = (...args) => fetch(...args),
  ) {
    this.base = (base?.trim() || DEFAULT_API_BASE[platform]).replace(/\/+$/, "");
  }
  async call<T>(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.base}/bot${this.token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      // Network errors can embed the request URL (and therefore the token); drop the details.
      throw new BotApiError(method, 0, "network error");
    }
    let body:
      | {
          ok?: boolean;
          result?: T;
          description?: string;
          parameters?: { retry_after?: number };
        }
      | undefined;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    if (!response.ok || !body?.ok)
      throw new BotApiError(
        method,
        response.status,
        body?.description,
        body?.parameters?.retry_after,
      );
    return body.result as T;
  }
  getUpdates(offset: number, timeoutSeconds: number, signal?: AbortSignal) {
    return this.call<BotUpdate[]>(
      "getUpdates",
      { offset, timeout: timeoutSeconds, allowed_updates: ["message"] },
      signal,
    );
  }
  sendMessage(chatId: number | string, text: string) {
    return this.call<BotMessage>("sendMessage", {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    });
  }
  sendTyping(chatId: number | string) {
    return this.call<boolean>("sendChatAction", { chat_id: chatId, action: "typing" });
  }
}
