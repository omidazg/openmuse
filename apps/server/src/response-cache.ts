/**
 * Optional in-memory cache for repeated identical short prompts (RESPONSE_CACHE=on).
 *
 * Only stateless first turns are cached: a single short text message in a new thread, without
 * attached documents, links or client context, whose answer needed no tool call. Keys are scoped
 * to the owner and include the model, the length preference and a hash of the whole system prompt,
 * so memory, custom instructions and the date (all part of the prompt) change the key and a cached
 * answer is never shared between people.
 */
import { createHash } from "node:crypto";
import type { RunAgentInput } from "@ag-ui/core";

/** Longest prompt (after normalization) that may be cached. */
export const CACHE_MAX_PROMPT = 200;
const MAX_ENTRIES = 500;
/** Answers that depend on the clock, prices or news are never cached. */
const TIME_SENSITIVE =
  /ساعت|الان|اکنون|امروز|امشب|فردا|دیروز|تاریخ|چندم|هفته|ماه|سال|قیمت|نرخ|دلار|یورو|طلا|سکه|بورس|هوا|اخبار|خبر|\b(time|date|today|now|tomorrow|price|weather|news)\b/i;

/**
 * The system prompt without per-second values (the calendar context carries the current instant),
 * so it can be part of a cache key; the Tehran calendar day stays in, so keys change daily.
 */
export function stablePrompt(system: string): string {
  return system.replace(/"(nowIso|tehranTime)":"[^"]*"/g, "");
}

/**
 * Normalizes Persian text so trivially different spellings share a key: Arabic ي/ك → ی/ک,
 * Persian/Arabic digits → Latin, diacritics and tatweel removed, ZWNJ and whitespace collapsed to
 * one space, case folded and trailing punctuation dropped.
 */
export function normalizePrompt(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[\s\u200c\u200f\u200e]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[\s.!?؟،,؛;:…]+$/u, "");
}

/** The prompt text when this run is a cacheable stateless first turn, otherwise undefined. */
export function cacheablePrompt(input: RunAgentInput): string | undefined {
  if (input.messages.length !== 1 || input.context?.length) return undefined;
  const [message] = input.messages;
  if (message.role !== "user" || typeof message.content !== "string") return undefined;
  if (/https?:|www\.|اسناد پیوست|شناسهٔ سند/i.test(message.content)) return undefined;
  if (TIME_SENSITIVE.test(message.content)) return undefined;
  const text = normalizePrompt(message.content);
  return text && text.length <= CACHE_MAX_PROMPT ? text : undefined;
}

export function cacheKey(parts: {
  owner: string;
  model: string;
  length: string;
  prompt: string;
  system: string;
}) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/** Small LRU with a time-to-live; Map keeps insertion order, so the first key is the oldest. */
export class ResponseCache {
  private readonly entries = new Map<string, { text: string; expires: number }>();
  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = MAX_ENTRIES,
    private readonly now = () => Date.now(),
  ) {}
  get(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expires <= this.now()) return undefined;
    this.entries.set(key, entry);
    return entry.text;
  }
  set(key: string, text: string) {
    this.entries.delete(key);
    this.entries.set(key, { text, expires: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
  get size() {
    return this.entries.size;
  }
}

let shared: ResponseCache | undefined;
/** One cache per server process (chat turns run in the app service only). */
export function sharedResponseCache(ttlMs: number) {
  shared ??= new ResponseCache(ttlMs);
  return shared;
}
