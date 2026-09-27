/**
 * Metis AI (https://metisai.ir) gateway support.
 *
 * OpenAI, Anthropic and Google reject requests from Iranian IP addresses. Metis exposes
 * provider-compatible wrappers that are reachable from Iran:
 *   - OpenAI (Responses + Chat Completions):  {base}/openai/v1
 *   - Anthropic Messages:                     {base}/anthropic/v1
 *   - Google Gemini:                          {base}/v1beta
 *
 * When METIS_API_KEY is set, every `MODEL=provider/model-id` resolved by the CopilotKit
 * BuiltInAgent (chat agent, task worker, computer tools) is routed through Metis, because the
 * runtime reads these provider variables at model-resolution time.
 */
export const METIS_DEFAULT_BASE_URL = "https://api.metisai.ir";
/** Verified default: strong, streams, and supports function calling through the OpenAI wrapper. */
export const METIS_DEFAULT_MODEL = "openai/gpt-4.1";

export interface MetisEndpoints {
  openai: string;
  anthropic: string;
  google: string;
}

export function metisEndpoints(baseUrl = METIS_DEFAULT_BASE_URL): MetisEndpoints {
  // Accept either the host root or a provider URL such as https://api.metisai.ir/openai/v1.
  const root = baseUrl
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/(openai|anthropic)\/v1$/, "")
    .replace(/\/v1beta$/, "");
  return {
    openai: `${root}/openai/v1`,
    anthropic: `${root}/anthropic/v1`,
    google: `${root}/v1beta`,
  };
}

/**
 * Point all supported providers at Metis when METIS_API_KEY is present.
 * Returns true when Metis is active. Never logs the key.
 */
export function applyMetisProvider(env: NodeJS.ProcessEnv = process.env): boolean {
  const key = env.METIS_API_KEY?.trim();
  if (!key) return false;
  const urls = metisEndpoints(env.METIS_BASE_URL || METIS_DEFAULT_BASE_URL);
  env.OPENAI_API_KEY = key;
  env.OPENAI_BASE_URL = urls.openai;
  env.ANTHROPIC_API_KEY = key;
  env.ANTHROPIC_BASE_URL = urls.anthropic;
  env.GOOGLE_API_KEY = key;
  env.GOOGLE_GENERATIVE_AI_BASE_URL = urls.google;
  if (!env.MODEL?.trim()) env.MODEL = METIS_DEFAULT_MODEL;
  return true;
}
