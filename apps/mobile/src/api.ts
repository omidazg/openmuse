import { Platform } from "react-native";
import { BRAND } from "../../../packages/domain/src/brand";
import { faDigits } from "./locale";
import {
  connectivity,
  isNetworkError,
  isRetryableStatus,
  NetworkError,
  retryWithBackoff,
} from "./network";
import { expired } from "./session-errors";

export { friendlyError, onUnauthorized, SESSION_EXPIRED } from "./session-errors";

export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL ||
  // A production web bundle is served by the API server itself (see apps/server/src/static.ts).
  (Platform.OS === "web" && !__DEV__ && typeof window !== "undefined"
    ? window.location.origin
    : Platform.OS === "android"
      ? "http://10.0.2.2:8787"
      : "http://localhost:8787")
).replace(/\/$/, "");

/**
 * Network failures and non-JSON bodies surface as specific Persian errors instead of raw engine
 * text. Every outcome also updates the app-wide online/offline flag.
 */
async function send(
  input: string,
  init: RequestInit,
): Promise<{ response: Response; payload: any }> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    connectivity.set(false);
    throw new NetworkError(
      `اتصال به سرور ${BRAND.nameFa} برقرار نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.`,
    );
  }
  connectivity.set(true);
  let payload: any = {};
  try {
    payload = await response.json();
  } catch {
    if (response.ok) throw new Error("پاسخ سرور خوانده نشد. دوباره تلاش کنید.");
  }
  return { response, payload };
}

/** Extra attempts for idempotent GET requests after a network failure or a 502/503/504. */
const GET_RETRIES = 3;
class RetryableResponse extends Error {}

export class MuseApi {
  constructor(readonly token: string) {}
  async request<T>(path: string, body?: unknown, method?: string): Promise<T> {
    const verb = method ?? (body === undefined ? "GET" : "POST");
    const call = () =>
      send(`${API_URL}${path}`, {
        method: verb,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body === undefined || body instanceof FormData
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body:
          body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      });
    // Only GET is retried automatically: repeating a POST/PUT could repeat its side effect.
    const { response, payload } =
      verb === "GET"
        ? await retryWithBackoff(
            async (attempt) => {
              const result = await call();
              if (attempt < GET_RETRIES && isRetryableStatus(result.response.status))
                throw new RetryableResponse();
              return result;
            },
            {
              retries: GET_RETRIES,
              shouldRetry: (e) => e instanceof RetryableResponse || isNetworkError(e),
            },
          )
        : await call();
    if (response.status === 401) expired(payload?.error);
    if (!response.ok)
      throw new Error(
        typeof payload?.error === "string"
          ? payload.error
          : `درخواست انجام نشد (کد ${faDigits(response.status)}). دوباره تلاش کنید.`,
      );
    return payload;
  }
  url(path: string) {
    return path.startsWith("http") ? path : `${API_URL}${path}`;
  }
}

export type Health = { ok: boolean; mode: "sample" | "live"; otpEnabled?: boolean };
export async function fetchHealth(): Promise<Health | undefined> {
  try {
    const response = await fetch(`${API_URL}/api/health`);
    connectivity.set(true);
    return response.ok ? await response.json() : undefined;
  } catch {
    connectivity.set(false);
    return undefined;
  }
}
async function post<T>(path: string, body: unknown, fallback: string): Promise<T> {
  const { response, payload } = await send(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(payload?.error || fallback);
  return payload;
}
export const requestOtp = (phone: string) =>
  post<{ ok: true; expiresIn: number }>(
    "/api/otp/request",
    { phone },
    "کد ورود فرستاده نشد. شماره را بررسی کنید و دوباره تلاش کنید.",
  );
export const verifyOtp = (phone: string, code: string) =>
  post<{ token: string; mode: "sample" | "live" }>(
    "/api/otp/verify",
    { phone, code },
    "ورود انجام نشد. کد را بررسی کنید و دوباره تلاش کنید.",
  );
/** Best-effort logout; the local token is cleared even when the server is unreachable. */
export async function endSession(token: string) {
  try {
    await fetch(`${API_URL}/api/session`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {}
}

export async function createSession(
  accessKey?: string,
): Promise<{ token: string; mode: "sample" | "live" }> {
  const { response, payload } = await send(`${API_URL}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessKey }),
  });
  if (!response.ok)
    throw new Error(
      payload?.error || "فضای کار شما باز نشد. کلید دسترسی را بررسی کنید و دوباره تلاش کنید.",
    );
  return payload;
}
