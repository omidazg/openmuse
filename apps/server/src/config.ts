import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { applyMetisProvider } from "./metis.ts";
import { type ModelCatalog, readModelCatalog } from "./models.ts";
import { type PriceTable, parseModelPrices } from "./pricing.ts";

if (existsSync(".env")) process.loadEnvFile(".env");
applyMetisProvider();
process.env.DO_NOT_TRACK ??= "1";
process.env.COPILOTKIT_TELEMETRY_DISABLED ??= "true";

export interface UserKey {
  owner: string;
  key: string;
}

/** OPENMUSE_USER_KEYS="ali:key1,sara:key2" → owners user-ali, user-sara. */
export function parseUserKeys(raw = ""): UserKey[] {
  const keys = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const at = entry.indexOf(":");
      const name = entry.slice(0, at).trim();
      const key = entry.slice(at + 1).trim();
      if (at < 1 || !/^[a-z0-9_-]{1,32}$/.test(name))
        throw new Error(
          "OPENMUSE_USER_KEYS entries must look like name:key (name: a-z, 0-9, _ or -)",
        );
      if (key.length < 24)
        throw new Error(`OPENMUSE_USER_KEYS key for ${name} must be 24+ characters`);
      return { owner: `user-${name}`, key };
    });
  if (new Set(keys.map((k) => k.owner)).size !== keys.length)
    throw new Error("OPENMUSE_USER_KEYS names must be unique");
  if (new Set(keys.map((k) => k.key)).size !== keys.length)
    throw new Error("OPENMUSE_USER_KEYS keys must be unique");
  return keys;
}

export interface Config {
  mode: "sample" | "live";
  port: number;
  host: string;
  publicUrl: string;
  dataDir: string;
  databaseUrl?: string;
  accessKey?: string;
  /** Extra per-person access keys; each maps to its own isolated workspace owner. */
  userKeys?: UserKey[];
  encryptionKey?: string;
  model?: string;
  /** MODELS allowlist people can pick from; omitted means MODEL only. */
  models?: ModelCatalog;
  agentBackend: "sample" | "model" | "agui";
  agentUrl?: string;
  agentToken?: string;
  intelligenceApiKey?: string;
  /** Thread persistence; omitted means Intelligence when a key is set, otherwise local. */
  threadsBackend?: ThreadsBackend;
  googleClientId?: string;
  googleClientSecret?: string;
  googleRedirectUri: string;
  workerUrl?: string;
  workerToken?: string;
  taskWorkerEnabled?: boolean;
  computerEnabled?: boolean;
  computerImage?: string;
  computerDeploymentId?: string;
  /** Lets IMAP/SMTP connectors reach private or loopback hosts (off by default: SSRF guard). */
  allowPrivateMailHosts?: boolean;
  allowedOrigins: string[];
  /** Default daily chat turns per non-admin user (0 = unlimited). */
  dailyMessageLimit?: number;
  /** Default daily new tasks per non-admin user (0 = unlimited). */
  dailyTaskLimit?: number;
  /** SMS login via Kavenegar Verify Lookup; enabled only when both are set. */
  kavenegarApiKey?: string;
  kavenegarTemplate?: string;
  /** Unknown phone numbers create a free user on first successful OTP login. */
  otpSignup?: boolean;
  /** USD per 1M tokens for cost tracking (MODEL_PRICES merged over the defaults). */
  modelPrices?: PriceTable;
  /** Server-wide hard cap on output tokens per model step (MAX_OUTPUT_TOKENS); unset = none. */
  maxOutputTokens?: number;
  /** Replays answers to identical stateless first-turn prompts (RESPONSE_CACHE=on). */
  responseCache?: boolean;
  /** Cache lifetime in seconds (RESPONSE_CACHE_TTL, default 3600). */
  responseCacheTtl?: number;
}

export function otpEnabled(config: Pick<Config, "kavenegarApiKey" | "kavenegarTemplate">) {
  return Boolean(config.kavenegarApiKey?.trim() && config.kavenegarTemplate?.trim());
}

function readLimit(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${name} must be a whole number (0 = unlimited)`);
  return value;
}

function readPositive(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw || raw === "0") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${name} must be a whole number (0 or empty = off)`);
  return value;
}

function readSwitch(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase() || "off";
  if (!["on", "off", "true", "false"].includes(raw)) throw new Error(`${name} must be on or off`);
  return raw === "on" || raw === "true";
}

export type ThreadsBackend = "local" | "intelligence";

/** Explicit THREADS_BACKEND wins; otherwise Intelligence only when a project key is set. */
export function threadsBackend(
  config: Pick<Config, "threadsBackend" | "intelligenceApiKey">,
): ThreadsBackend {
  return config.threadsBackend ?? (config.intelligenceApiKey?.trim() ? "intelligence" : "local");
}

const missingIntelligenceKeyMessage =
  "THREADS_BACKEND=intelligence requires CPK_INTELLIGENCE_API_KEY for durable Rich Threads. " +
  "Run `npx copilotkit@latest login` and `npx copilotkit@latest project select`, " +
  "then set the generated server-only key, or set THREADS_BACKEND=local to keep threads " +
  "in the app's own database. " +
  "See https://docs.copilotkit.ai/intelligence/connect-your-runtime";

export function assertApiDeploymentConfig(config: Config): void {
  // Only the Intelligence backend needs the CopilotKit cloud key; THREADS_BACKEND=local is
  // fully self-hosted. Access-key and encryption-key checks stay in readConfig.
  if (threadsBackend(config) === "intelligence" && !config.intelligenceApiKey?.trim()) {
    throw new Error(missingIntelligenceKeyMessage);
  }
}

export function readConfig(): Config {
  const mode = process.env.WORKSPACE_MODE ?? "sample";
  if (mode !== "sample" && mode !== "live")
    throw new Error("WORKSPACE_MODE must be sample or live");
  const backend = process.env.AGENT_BACKEND ?? (mode === "sample" ? "sample" : "model");
  if (backend !== "sample" && backend !== "model" && backend !== "agui")
    throw new Error("AGENT_BACKEND must be sample, model or agui");
  if (mode === "live" && backend === "sample")
    throw new Error("Live workspaces cannot use the sample agent");
  const threads = process.env.THREADS_BACKEND?.trim() || undefined;
  if (threads !== undefined && threads !== "local" && threads !== "intelligence")
    throw new Error("THREADS_BACKEND must be local or intelligence");
  const port = Number(process.env.PORT ?? 8787);
  const publicUrl = process.env.PUBLIC_API_URL ?? `http://localhost:${port}`;
  const config: Config = {
    mode,
    port,
    host: process.env.HOST ?? "127.0.0.1",
    publicUrl,
    dataDir: resolve(process.env.DATA_DIR ?? ".openmuse"),
    databaseUrl: process.env.DATABASE_URL,
    accessKey: process.env.OPENMUSE_ACCESS_KEY,
    userKeys: parseUserKeys(process.env.OPENMUSE_USER_KEYS),
    encryptionKey: process.env.TOKEN_ENCRYPTION_KEY,
    model: process.env.MODEL,
    models: readModelCatalog(),
    agentBackend: backend,
    agentUrl: process.env.AGENT_URL,
    agentToken: process.env.AGENT_TOKEN,
    intelligenceApiKey: process.env.CPK_INTELLIGENCE_API_KEY,
    threadsBackend: threads,
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    googleRedirectUri: `${publicUrl}/api/google/callback`,
    workerUrl: process.env.BROWSER_WORKER_URL,
    workerToken: process.env.WORKER_TOKEN,
    taskWorkerEnabled: process.env.TASK_WORKER_ENABLED !== "false",
    computerEnabled: process.env.COMPUTER_ENABLED === "true",
    computerImage: process.env.COMPUTER_IMAGE ?? "openmuse-computer:local",
    computerDeploymentId: process.env.COMPUTER_DEPLOYMENT_ID,
    allowPrivateMailHosts: process.env.ALLOW_PRIVATE_MAIL_HOSTS === "true",
    allowedOrigins: (
      process.env.ALLOWED_ORIGINS ?? "http://localhost:8081,http://127.0.0.1:8081"
    ).split(","),
    dailyMessageLimit: readLimit("DAILY_MESSAGE_LIMIT", 200),
    dailyTaskLimit: readLimit("DAILY_TASK_LIMIT", 30),
    kavenegarApiKey: process.env.KAVENEGAR_API_KEY?.trim() || undefined,
    kavenegarTemplate: process.env.KAVENEGAR_TEMPLATE?.trim() || undefined,
    otpSignup: process.env.OTP_SIGNUP === "true",
    modelPrices: parseModelPrices(process.env.MODEL_PRICES),
    maxOutputTokens: readPositive("MAX_OUTPUT_TOKENS"),
    responseCache: readSwitch("RESPONSE_CACHE"),
    responseCacheTtl: readPositive("RESPONSE_CACHE_TTL") ?? 3600,
  };
  if (
    mode === "live" &&
    (!config.accessKey || config.accessKey.length < 24 || !config.encryptionKey)
  )
    throw new Error(
      "Live mode requires OPENMUSE_ACCESS_KEY (24+ characters) and TOKEN_ENCRYPTION_KEY (32-byte base64)",
    );
  if (mode === "sample" && !["127.0.0.1", "localhost", "::1"].includes(config.host))
    throw new Error("Sample workspace is local-only. HOST must be a loopback address.");
  return config;
}
