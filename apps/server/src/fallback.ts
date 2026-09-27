/**
 * Optional fallback gateway for when Metis (or the primary provider) is down.
 *
 * FALLBACK_BASE_URL / FALLBACK_API_KEY / FALLBACK_MODEL name an OpenAI-compatible Chat Completions
 * endpoint. When all three are set, every model step first goes to the primary model; if that
 * request fails with a 5xx, a network error or no response within FALLBACK_TIMEOUT_MS before any
 * token has streamed, the same step is retried once on the fallback and the rest of the run stays
 * there. 4xx errors (bad key, quota, invalid request) and user cancellations are not retried.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { resolveModel } from "@copilotkit/runtime/v2";
import { BRAND } from "../../../packages/domain/src/brand.ts";

export interface FallbackConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  /** How long to wait for the primary's response headers before switching. */
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 45_000;

export function readFallback(env: NodeJS.ProcessEnv = process.env): FallbackConfig | undefined {
  const baseURL = env.FALLBACK_BASE_URL?.trim().replace(/\/+$/, "");
  const apiKey = env.FALLBACK_API_KEY?.trim();
  const model = env.FALLBACK_MODEL?.trim();
  if (!baseURL || !apiKey || !model) return undefined;
  const timeout = Number(env.FALLBACK_TIMEOUT_MS?.trim() || DEFAULT_TIMEOUT_MS);
  return {
    baseURL,
    apiKey,
    model,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
  };
}

export function fallbackConfigured(env: NodeJS.ProcessEnv = process.env) {
  return readFallback(env) !== undefined;
}

const NETWORK =
  /fetch failed|network|socket|ECONN(RESET|REFUSED|ABORTED)|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR|timed? ?out/i;

/** 5xx, network failures and timeouts are worth one retry elsewhere; 4xx are not. */
export function isGatewayFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { statusCode?: unknown; message?: unknown; cause?: unknown };
  if (typeof record.statusCode === "number") return record.statusCode >= 500;
  const text = [record.message, (record.cause as { message?: unknown } | undefined)?.message]
    .concat((record.cause as { code?: unknown } | undefined)?.code)
    .filter((part) => typeof part === "string")
    .join(" ");
  return NETWORK.test(text);
}

type ChatModel = ReturnType<ReturnType<typeof createOpenAI>["chat"]>;
type StreamOptions = Parameters<ChatModel["doStream"]>[0];
type GenerateOptions = Parameters<ChatModel["doGenerate"]>[0];
/** The model surface BuiltInAgent calls (AI SDK LanguageModelV3). */
type Model = Pick<ChatModel, "specificationVersion" | "provider" | "modelId" | "supportedUrls"> & {
  doStream(options: StreamOptions): ReturnType<ChatModel["doStream"]>;
  doGenerate(options: GenerateOptions): ReturnType<ChatModel["doGenerate"]>;
};

/**
 * The model to hand to BuiltInAgent: the plain `provider/model` string when no fallback is
 * configured (unchanged behavior), otherwise a wrapper that retries once on the fallback.
 * `modelId` follows the model actually answering, so usage and cost name the right model.
 */
export function withFallback(
  spec: string,
  env: NodeJS.ProcessEnv = process.env,
  log: (message: string) => void = (message) => console.warn(message),
): string | Model {
  const found = readFallback(env);
  if (!found) return spec;
  const config = found;
  const resolved = resolveModel(spec);
  if (typeof resolved === "string" || resolved.specificationVersion !== "v3") return spec;
  const primary = resolved as unknown as Model;
  let fallback: Model | undefined;
  let switched = false;
  const secondary = () => {
    fallback ??= createOpenAI({
      name: "fallback",
      baseURL: config.baseURL,
      apiKey: config.apiKey,
    }).chat(config.model) as unknown as Model;
    return fallback;
  };
  async function attempt<T>(
    call: (model: Model, options: StreamOptions) => PromiseLike<T>,
    options: StreamOptions,
    timeoutMs?: number,
  ): Promise<T> {
    if (switched) return call(secondary(), options);
    const outer = options.abortSignal;
    const controller = new AbortController();
    // Stays linked for the whole stream so a user's Stop still reaches the primary.
    if (outer?.aborted) controller.abort(outer.reason);
    else outer?.addEventListener("abort", () => controller.abort(outer.reason), { once: true });
    let timedOut = false;
    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            controller.abort(new Error("primary model gateway timed out"));
          }, timeoutMs);
    try {
      return await call(primary, { ...options, abortSignal: controller.signal });
    } catch (error) {
      if (outer?.aborted || !(timedOut || isGatewayFailure(error))) throw error;
      const reason = timedOut
        ? "timeout"
        : typeof (error as { statusCode?: unknown }).statusCode === "number"
          ? `HTTP ${(error as { statusCode: number }).statusCode}`
          : "network error";
      log(
        `[${BRAND.name}] model gateway failed for ${spec} (${reason}); retrying once on the fallback gateway (${config.model})`,
      );
      switched = true;
      return call(secondary(), options);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return {
    specificationVersion: primary.specificationVersion,
    get provider() {
      return switched ? secondary().provider : primary.provider;
    },
    get modelId() {
      return switched ? config.model : primary.modelId;
    },
    supportedUrls: primary.supportedUrls,
    doStream: (options) =>
      attempt((model, o) => model.doStream(o), options, config.timeoutMs) as ReturnType<
        ChatModel["doStream"]
      >,
    doGenerate: (options) =>
      attempt((model, o) => model.doGenerate(o), options) as ReturnType<ChatModel["doGenerate"]>,
  };
}
