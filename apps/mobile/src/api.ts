import { Platform } from "react-native";
import { faDigits } from "./locale";

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
      "اتصال به سرور OpenMuse برقرار نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.",
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
