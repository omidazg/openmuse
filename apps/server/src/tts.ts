/**
 * «خواندن با صدا»: Persian text-to-speech for assistant answers.
 *
 * Text goes to the OpenAI-compatible /audio/speech endpoint (through Metis when METIS_API_KEY is
 * set, see metis.ts). Verified on Metis: gpt-4o-mini-tts and tts-1 both return audio/mpeg.
 * Results are cached in memory by a hash of model, voice and text so replaying an answer does not
 * call the gateway again, and only cache misses count against the per-owner rate limit.
 * When TTS is disabled the web app falls back to the browser's speechSynthesis.
 */
import { createHash } from "node:crypto";
import { AppError } from "./errors.ts";
import { RateLimiter } from "./rate-limit.ts";

export const TTS_DEFAULT_MODEL = "gpt-4o-mini-tts";
export const TTS_DEFAULT_VOICE = "alloy";
/** Longest text spoken in one request; longer answers are cut at a sentence boundary. */
export const TTS_DEFAULT_MAX_CHARS = 3000;
/** Requests with more text than this are rejected before any work. */
export const TTS_MAX_INPUT_CHARS = 20_000;

export function ttsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TTS_ENABLED !== "false" && Boolean(env.OPENAI_API_KEY?.trim());
}

function maxChars(env: NodeJS.ProcessEnv) {
  const value = Number(env.TTS_MAX_CHARS);
  return Number.isInteger(value) && value >= 100 && value <= 4000 ? value : TTS_DEFAULT_MAX_CHARS;
}

/** Markdown and link noise removed so the voice reads words, not symbols. */
export function speakableText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s{0,3}(#{1,6}|[-*+]|>|\d+[.)])\s+/gm, "")
    .replace(/[*_`~]+/g, "")
    .replace(/[#|]+/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Cuts to at most `limit` characters, preferring the end of a sentence or line. */
export function capText(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  const head = text.slice(0, limit);
  const cut = Math.max(...[".", "؟", "!", "\n", "؛"].map((mark) => head.lastIndexOf(mark)));
  return {
    text: (cut > limit * 0.5 ? head.slice(0, cut + 1) : head).trim(),
    truncated: true,
  };
}

export interface SpeechResult {
  audio: Uint8Array;
  truncated: boolean;
  cached: boolean;
}

export class TtsService {
  private readonly cache = new Map<string, Uint8Array>();
  private cacheBytes = 0;
  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly limiter = new RateLimiter(30, 10 * 60 * 1000),
    private readonly maxCacheBytes = 32 * 1024 * 1024,
  ) {}
  get enabled() {
    return ttsEnabled(this.env);
  }
  private model() {
    return (this.env.TTS_MODEL?.trim() || TTS_DEFAULT_MODEL).replace(/^openai\//, "");
  }
  private remember(key: string, audio: Uint8Array) {
    if (audio.length > this.maxCacheBytes) return;
    this.cache.set(key, audio);
    this.cacheBytes += audio.length;
    for (const [oldest, value] of this.cache) {
      if (this.cacheBytes <= this.maxCacheBytes) break;
      this.cache.delete(oldest);
      this.cacheBytes -= value.length;
    }
  }
  async speak(owner: string, input: unknown): Promise<SpeechResult> {
    if (!this.enabled) throw new AppError("خواندن با صدا روی این سرور فعال نیست.", 503);
    if (typeof input !== "string" || !input.trim())
      throw new AppError("متنی برای خواندن فرستاده نشد.", 400);
    if (input.length > TTS_MAX_INPUT_CHARS)
      throw new AppError("این متن برای خواندن با صدا خیلی بلند است.", 413);
    const { text, truncated } = capText(speakableText(input), maxChars(this.env));
    if (!text) throw new AppError("این پاسخ متنی برای خواندن ندارد.", 422);
    const model = this.model();
    const voice = this.env.TTS_VOICE?.trim() || TTS_DEFAULT_VOICE;
    const key = createHash("sha256").update(`${model}\0${voice}\0${text}`).digest("hex");
    const hit = this.cache.get(key);
    if (hit) {
      // Refresh recency for the simple insertion-ordered LRU.
      this.cache.delete(key);
      this.cache.set(key, hit);
      return { audio: hit, truncated, cached: true };
    }
    if (!this.limiter.take(owner))
      throw new AppError(
        "تعداد درخواست‌های خواندن با صدا زیاد بوده است. چند دقیقهٔ دیگر دوباره تلاش کنید.",
        429,
      );
    const base = (this.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(
      /\/+$/,
      "",
    );
    const failed = () => new AppError("ساخت صدا انجام نشد. چند لحظهٔ دیگر دوباره تلاش کنید.", 502);
    let response: Response;
    try {
      response = await fetch(`${base}/audio/speech`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.env.OPENAI_API_KEY?.trim() ?? ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          voice,
          input: text,
          response_format: "mp3",
          ...(model.startsWith("gpt-4o")
            ? { instructions: "Read in natural, clear Persian (Farsi) with a calm, friendly tone." }
            : {}),
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw failed();
    }
    if (!response.ok) throw failed();
    const audio = new Uint8Array(await response.arrayBuffer());
    if (!audio.length) throw failed();
    this.remember(key, audio);
    return { audio, truncated, cached: false };
  }
}
