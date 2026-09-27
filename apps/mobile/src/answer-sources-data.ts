/**
 * Sources behind an assistant answer, read from the tool calls of the same turn: web pages the
 * agent opened or searched (browse_web and any tool returning url/title results) and the
 * user's files it searched or read (search_files, read_file).
 */

export interface WebSource {
  url: string;
  title: string;
  domain: string;
}

export interface AnswerSourceList {
  web: WebSource[];
  files: string[];
}

interface ToolCallLike {
  id: string;
  function?: { name?: string; arguments?: string };
}

export interface MessageLike {
  id: string;
  role: string;
  content?: unknown;
  toolCalls?: ToolCallLike[];
  toolCallId?: string;
}

const FILE_TOOLS = new Set(["search_files", "read_file"]);
/** Tools whose results mention URLs that are not sources of the answer. */
const NOT_SOURCES = new Set([
  "watch_page",
  "delegate_task",
  "create_goal",
  "agent_status",
  "remember_fact",
  "create_pdf",
  "translate_file",
  "search_mail",
  "read_mail_thread",
]);

function parse(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Public http(s) URL with its hostname, or undefined. */
export function webSource(url: unknown, title?: unknown): WebSource | undefined {
  if (typeof url !== "string") return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
  if (parsed.username || parsed.password) return undefined;
  const domain = parsed.hostname.replace(/^www\./, "");
  const name = typeof title === "string" && title.trim() ? title.trim().slice(0, 160) : domain;
  return { url: parsed.toString(), title: name, domain };
}

function collectWeb(value: unknown, out: WebSource[], depth = 0) {
  if (depth > 3) return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 30)) collectWeb(item, out, depth + 1);
    return;
  }
  const object = record(value);
  if (!object) return;
  const source = webSource(
    object.url ?? object.link ?? object.finalUrl,
    object.title ?? object.name,
  );
  if (source) out.push(source);
  for (const key of ["results", "sources", "items", "pages", "citations"])
    if (Array.isArray(object[key])) collectWeb(object[key], out, depth + 1);
}

/** Sources for the turn that `index` (an assistant message) belongs to. */
export function answerSources(messages: MessageLike[], index: number): AnswerSourceList {
  let start = index;
  while (start > 0 && messages[start - 1].role !== "user") start--;
  let end = index;
  while (end + 1 < messages.length && messages[end + 1].role !== "user") end++;
  const turn = messages.slice(start, end + 1);
  const web: WebSource[] = [];
  const files = new Set<string>();
  for (const message of turn) {
    for (const call of message.toolCalls ?? []) {
      const name = call.function?.name ?? "";
      const result = turn.find((item) => item.role === "tool" && item.toolCallId === call.id);
      const value = parse(result?.content);
      const object = record(value);
      if (!result || object?.error || NOT_SOURCES.has(name)) continue;
      if (FILE_TOOLS.has(name)) {
        if (typeof object?.name === "string") files.add(object.name);
        if (Array.isArray(object?.passages))
          for (const passage of object.passages) {
            const fileName = record(passage)?.fileName;
            if (typeof fileName === "string") files.add(fileName);
          }
        continue;
      }
      collectWeb(value, web);
    }
  }
  const unique = web.filter((source, i) => web.findIndex((item) => item.url === source.url) === i);
  return { web: unique.slice(0, 8), files: [...files].slice(0, 8) };
}

/** True when `index` is the last assistant message with text in its turn. */
export function isTurnAnswer(messages: MessageLike[], index: number): boolean {
  const message = messages[index];
  if (message?.role !== "assistant" || typeof message.content !== "string" || !message.content)
    return false;
  for (let i = index + 1; i < messages.length && messages[i].role !== "user"; i++)
    if (
      messages[i].role === "assistant" &&
      typeof messages[i].content === "string" &&
      messages[i].content
    )
      return false;
  return true;
}
