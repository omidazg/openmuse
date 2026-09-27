/**
 * Optional, dependency-free error reporting to a Sentry-compatible endpoint (Sentry or a
 * self-hosted GlitchTip). Without SENTRY_DSN every export is a no-op.
 *
 * Privacy: only the error type, a scrubbed message, stack frames and a few tags (component,
 * HTTP method, route pattern) are sent. Never request bodies, headers, query strings,
 * cookies or tokens.
 */
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

export interface ReportContext {
  component?: string;
  method?: string;
  route?: string;
  level?: "error" | "fatal";
}

interface ParsedDsn {
  dsn: string;
  publicKey: string;
  envelopeUrl: string;
}

const MAX_EVENTS_PER_MINUTE = 30;
let windowStart = 0;
let sentInWindow = 0;
let cachedDsn: { raw: string | undefined; parsed: ParsedDsn | undefined } | undefined;

/** https://<key>@host[:port][/prefix]/<project> -> envelope endpoint. */
export function parseDsn(raw: string | undefined): ParsedDsn | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const url = new URL(raw.trim());
    const parts = url.pathname.split("/").filter(Boolean);
    const project = parts.pop();
    if (!url.username || !project || !/^https?:$/.test(url.protocol)) return undefined;
    const prefix = parts.length ? `/${parts.join("/")}` : "";
    return {
      dsn: raw.trim(),
      publicKey: decodeURIComponent(url.username),
      envelopeUrl: `${url.protocol}//${url.host}${prefix}/api/${project}/envelope/`,
    };
  } catch {
    return undefined;
  }
}

function currentDsn() {
  const raw = process.env.SENTRY_DSN;
  if (!cachedDsn || cachedDsn.raw !== raw) cachedDsn = { raw, parsed: parseDsn(raw) };
  return cachedDsn.parsed;
}

export function errorReportingEnabled() {
  return currentDsn() !== undefined;
}

/** Removes bearer tokens, API keys, secrets and signed-URL parameters from free text. */
export function scrub(text: string) {
  return text
    .replace(/(Bearer|Basic|apikey)\s+[\w.~+/=-]+/gi, "$1 [Filtered]")
    .replace(
      /\b([\w-]*(?:token|secret|password|passwd|api[_-]?key|access[_-]?key|authorization|signature|dsn)[\w-]*)(["']?\s*[:=]\s*["']?)[^\s"'&,;]+/gi,
      "$1$2[Filtered]",
    )
    .replace(/\b(?:sk|pk|rk)-[\w-]{10,}/g, "[Filtered]")
    .replace(/\b(?:postgres(?:ql)?|https?):\/\/[^/\s:@]+:[^@\s]+@/gi, (m) =>
      m.replace(/\/\/[^@]+@/, "//[Filtered]@"),
    )
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[Filtered]")
    .slice(0, 1000);
}

function frames(stack: string | undefined) {
  if (!stack) return undefined;
  const parsed = stack
    .split("\n")
    .slice(1)
    .map((line) => /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({
      function: m[1] ?? "?",
      filename: m[2],
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app: !m[2]?.includes("node_modules") && !m[2]?.startsWith("node:"),
    }));
  // Sentry expects the oldest frame first.
  return parsed.length ? { frames: parsed.reverse() } : undefined;
}

export function buildEnvelope(error: unknown, context: ReportContext, dsn: ParsedDsn) {
  const err = error instanceof Error ? error : new Error(typeof error);
  const eventId = randomUUID().replaceAll("-", "");
  const tags: Record<string, string> = {};
  if (context.component) tags.component = context.component;
  if (context.method) tags.method = context.method;
  if (context.route) tags.route = context.route.split("?")[0] ?? "";
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: "node",
    level: context.level ?? "error",
    logger: context.component ?? "server",
    server_name: hostname(),
    environment: process.env.SENTRY_ENVIRONMENT || "production",
    ...(process.env.SENTRY_RELEASE ? { release: process.env.SENTRY_RELEASE } : {}),
    tags,
    exception: {
      values: [
        {
          type: err.name || "Error",
          value: scrub(err.message ?? ""),
          stacktrace: frames(err.stack),
          mechanism: { type: context.component ?? "generic", handled: context.level !== "fatal" },
        },
      ],
    },
    sdk: { name: "dastyar.minimal", version: "1.0.0" },
  };
  return [
    JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn: dsn.dsn }),
    JSON.stringify({ type: "event", content_type: "application/json" }),
    JSON.stringify(event),
  ].join("\n");
}

/** Sends one event; never throws and never blocks longer than 5 seconds. */
export async function reportError(error: unknown, context: ReportContext = {}) {
  const dsn = currentDsn();
  if (!dsn) return;
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    sentInWindow = 0;
  }
  if (++sentInWindow > MAX_EVENTS_PER_MINUTE) return;
  try {
    await fetch(dsn.envelopeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=dastyar.minimal/1.0.0`,
      },
      body: buildEnvelope(error, context, dsn),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Reporting must never affect the request or the process.
  }
}

/**
 * With SENTRY_DSN set, reports uncaught exceptions and unhandled rejections, then exits
 * with code 1 like Node's default. Without a DSN nothing is installed.
 */
export function installProcessErrorReporting(component: string) {
  if (!errorReportingEnabled()) return;
  let exiting = false;
  const fatal = (error: unknown) => {
    // Same output as Node's default crash handler.
    console.error(error);
    if (exiting) return;
    exiting = true;
    void reportError(error, { component, level: "fatal" }).finally(() => process.exit(1));
  };
  process.on("uncaughtException", fatal);
  process.on("unhandledRejection", fatal);
}
