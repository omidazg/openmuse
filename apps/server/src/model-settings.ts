/**
 * Per-run BuiltInAgent settings shared by chat turns and delegated tasks: the fallback gateway
 * wrapper (FALLBACK_*), the answer length preference and the MAX_OUTPUT_TOKENS hard cap.
 */
import { withFallback } from "./fallback.ts";
import { lengthInstruction, maxOutputTokens, type ResponseLength } from "./response-length.ts";

export function modelSettings<T extends { model: string; prompt: string }>(
  config: T,
  options: { length?: ResponseLength; cap?: number } = {},
) {
  const length = options.length ?? "normal";
  return {
    ...config,
    model: withFallback(config.model),
    prompt: config.prompt + lengthInstruction(length),
    maxOutputTokens: maxOutputTokens(length, options.cap),
  };
}
