import { Platform } from "react-native";
import { BRAND } from "../../../packages/domain/src/brand";
import { faDigits } from "./locale";
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

/** Network failures and non-JSON bodies surface as specific Persian errors instead of raw engine text. */
async function send(
  input: string,
  init: RequestInit,
): Promise<{ response: Response; payload: any }> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    throw new Error(
      `اتصال به سرور ${BRAND.nameFa} برقرار نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.`,
    );
  }
  let payload: any = {};
  try {
    payload = await response.json();
  } catch {
    if (response.ok) throw new Error("پاسخ سرور خوانده نشد. دوباره تلاش کنید.");
  }
  return { response, payload };
}

export class MuseApi {
  constructor(readonly token: string) {}
  async request<T>(path: string, body?: unknown, method?: string): Promise<T> {
    const { response, payload } = await send(`${API_URL}${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body === undefined || body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
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
    return response.ok ? await response.json() : undefined;
  } catch {
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
