export const SESSION_EXPIRED = "نشست شما به پایان رسیده است. دوباره وارد شوید.";
export const QUOTA_EXCEEDED = "سقف استفادهٔ امروز شما تمام شده است. فردا دوباره تلاش کنید.";

let unauthorized: ((message: string) => void) | undefined;
/** App registers one handler that returns to the login screen when the server rejects the session. */
export function onUnauthorized(handler: ((message: string) => void) | undefined) {
  unauthorized = handler;
}
export function expired(message?: unknown) {
  unauthorized?.(typeof message === "string" && message ? message : SESSION_EXPIRED);
}

/**
 * CopilotKit reports HTTP failures as `HTTP 429: {"error":"…"}` (with `status`/`payload` on the
 * error). Show the server's Persian message instead, and treat 401 as an ended session.
 */
export function friendlyError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const details = (error ?? {}) as { status?: unknown; payload?: { error?: unknown } };
  const match = /HTTP (\d{3}): ([\s\S]*)$/.exec(raw);
  const status = typeof details.status === "number" ? details.status : Number(match?.[1]);
  let message: unknown = details.payload?.error;
  if (typeof message !== "string" && match) {
    try {
      message = JSON.parse(match[2])?.error;
    } catch {}
  }
  if (status === 401) {
    expired(message);
    return typeof message === "string" && message ? message : SESSION_EXPIRED;
  }
  if (typeof message === "string" && message) return message;
  if (status === 429) return QUOTA_EXCEEDED;
  return raw;
}
