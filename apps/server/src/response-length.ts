/**
 * Per-person answer length preference («کوتاه / معمولی / مفصل») plus the server-wide hard cap
 * MAX_OUTPUT_TOKENS. The preference becomes a prompt hint and, for «کوتاه», a lower output limit.
 */
import { z } from "zod";
import type { Store } from "./db.ts";

export const RESPONSE_LENGTHS = ["short", "normal", "long"] as const;
export type ResponseLength = (typeof RESPONSE_LENGTHS)[number];
export const responseLengthSchema = z.enum(RESPONSE_LENGTHS, {
  error: "طول پاسخ باید «کوتاه»، «معمولی» یا «مفصل» باشد.",
});

const SETTINGS_KIND = "conversation-settings";
const SETTINGS_ID = "response-length";
/** Room for a few sentences and a short tool call; documents still fit in «معمولی» and «مفصل». */
const SHORT_OUTPUT_TOKENS = 1500;

export async function responseLength(db: Store, owner: string): Promise<ResponseLength> {
  const saved = await db.get<{ length?: string }>(owner, SETTINGS_KIND, SETTINGS_ID);
  const parsed = responseLengthSchema.safeParse(saved?.length);
  return parsed.success ? parsed.data : "normal";
}

export async function saveResponseLength(db: Store, owner: string, length: ResponseLength) {
  await db.put(owner, SETTINGS_KIND, {
    id: SETTINGS_ID,
    length,
    updatedAt: new Date().toISOString(),
  });
  return length;
}

/** Output token limit for one model step: the preference, never above the server cap. */
export function maxOutputTokens(length: ResponseLength, cap?: number): number | undefined {
  const preferred = length === "short" ? SHORT_OUTPUT_TOKENS : undefined;
  if (preferred === undefined) return cap;
  return cap === undefined ? preferred : Math.min(preferred, cap);
}

/** Model-facing instruction for the preference; «معمولی» keeps the default «concise» rule. */
export function lengthInstruction(length: ResponseLength): string {
  if (length === "short")
    return " Answer length preference: SHORT. Reply in at most three or four short sentences or a very short list unless the user explicitly asks for more detail.";
  if (length === "long")
    return " Answer length preference: DETAILED. Give thorough, well-structured answers with headings, lists and examples when they help; this overrides the default brevity rule.";
  return "";
}
