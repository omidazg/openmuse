import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { applyMetisProvider } from "./metis.ts";

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
