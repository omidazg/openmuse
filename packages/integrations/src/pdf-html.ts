import { formatJalali, tehranDate } from "../../domain/src/iran-holidays.ts";

/**
 * Safe HTML fragments for Persian PDFs rendered by the browser worker's Chromium.
 * Every piece of user or model text is escaped; callers never pass raw HTML through.
 * The worker wraps the fragment with the Vazirmatn font, RTL direction and print CSS.
 */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Inline markdown: **bold** and `code`; everything else is escaped text. */
function inline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, '<code dir="ltr">$1</code>');
}

const tableRow = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());

/**
 * A small, predictable markdown subset: `#`–`###` headings, `-`/`*`/`•` bullets,
 * numbered lists (Latin or Persian digits), `|` tables, `---` rules and paragraphs.
 */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const html: string[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | undefined;
  const flush = () => {
    if (paragraph.length) html.push(`<p dir="auto">${paragraph.map(inline).join("<br>")}</p>`);
    paragraph = [];
    if (list) {
      const tag = list.ordered ? "ol" : "ul";
      html.push(
        `<${tag}>${list.items.map((item) => `<li dir="auto">${inline(item)}</li>`).join("")}</${tag}>`,
      );
    }
    list = undefined;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*[0-9۰-۹]+[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) flush();
    else if (heading) {
      flush();
      const level = heading[1].length + 1;
      html.push(`<h${level} dir="auto">${inline(heading[2])}</h${level}>`);
    } else if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      flush();
      html.push("<hr>");
    } else if (line.trim().startsWith("|")) {
      flush();
      const rows: string[][] = [];
      for (; i < lines.length && lines[i].trim().startsWith("|"); i++) {
        if (/^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i])) continue;
        rows.push(tableRow(lines[i]));
      }
      i--;
      const [head, ...body] = rows;
      html.push(
        `<table><thead><tr>${head.map((cell) => `<th dir="auto">${inline(cell)}</th>`).join("")}</tr></thead><tbody>${body
          .map(
            (row) =>
              `<tr>${row.map((cell) => `<td dir="auto">${inline(cell)}</td>`).join("")}</tr>`,
          )
          .join("")}</tbody></table>`,
      );
    } else if (bullet || numbered) {
      const ordered = !!numbered;
      if (paragraph.length || (list && list.ordered !== ordered)) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)?.[1] ?? "");
    } else {
      if (list) flush();
      paragraph.push(line.trim());
    }
  }
  flush();
  return html.join("\n");
}

/** Readable HTML for arbitrary JSON data (plans, comparisons, report data). */
export function dataToHtml(value: unknown, depth = 0): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string")
    return value.includes("\n") ? markdownToHtml(value) : inline(value);
  if (typeof value === "number" || typeof value === "boolean") return escapeHtml(String(value));
  if (depth > 4) return escapeHtml(JSON.stringify(value).slice(0, 2000));
  if (Array.isArray(value)) {
    if (!value.length) return "";
    const objects = value.filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === "object" && !Array.isArray(item),
    );
    if (objects.length === value.length) {
      const keys = [...new Set(objects.flatMap((item) => Object.keys(item)))].slice(0, 8);
      return `<table><thead><tr>${keys.map((key) => `<th dir="auto">${escapeHtml(key)}</th>`).join("")}</tr></thead><tbody>${objects
        .slice(0, 500)
        .map(
          (item) =>
            `<tr>${keys.map((key) => `<td dir="auto">${dataToHtml(item[key], depth + 1)}</td>`).join("")}</tr>`,
        )
        .join("")}</tbody></table>`;
    }
    return `<ul>${value
      .slice(0, 500)
      .map((item) => `<li dir="auto">${dataToHtml(item, depth + 1)}</li>`)
      .join("")}</ul>`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, item]) => item !== null && item !== undefined && item !== "",
    );
    if (!entries.length) return "";
    return `<table class="pairs"><tbody>${entries
      .slice(0, 200)
      .map(
        ([key, item]) =>
          `<tr><th dir="auto">${escapeHtml(key)}</th><td dir="auto">${dataToHtml(item, depth + 1)}</td></tr>`,
      )
      .join("")}</tbody></table>`;
  }
  return "";
}

/** A titled Persian document: heading, Jalali date line and markdown body. */
export function documentHtml(options: {
  title: string;
  body: string;
  subtitle?: string;
  date?: Date;
}): string {
  const date = formatJalali(tehranDate(options.date ?? new Date()), false);
  return [
    `<header><h1 dir="auto">${inline(options.title)}</h1>`,
    `<p class="meta">${escapeHtml(options.subtitle ? `${options.subtitle} · ${date}` : date)}</p></header>`,
    markdownToHtml(options.body),
  ].join("\n");
}

/** One turn of an exported or shared conversation. */
export interface ConversationEntry {
  role: "user" | "assistant";
  text: string;
}

/**
 * A titled conversation: heading, meta line (Jalali date) and one section per message,
 * labelled with who wrote it. Used for PDF export and for the public share page.
 */
export function conversationHtml(options: {
  title: string;
  meta: string;
  messages: ConversationEntry[];
  labels: Record<ConversationEntry["role"], string>;
}): string {
  return [
    `<header><h1 dir="auto">${inline(options.title)}</h1>`,
    `<p class="meta">${escapeHtml(options.meta)}</p></header>`,
    ...options.messages.map(
      (message) =>
        `<section class="message ${message.role}"><p class="role">${escapeHtml(options.labels[message.role])}</p>\n${markdownToHtml(message.text)}</section>`,
    ),
  ].join("\n");
}

/** HTML for a saved plan, comparison or report artifact. */
export function artifactHtml(artifact: {
  kind: string;
  title: string;
  summary: string;
  data: Record<string, unknown>;
  createdAt: string;
}): string {
  const kinds: Record<string, string> = { plan: "برنامه", comparison: "مقایسه", report: "گزارش" };
  const data = dataToHtml(artifact.data);
  return [
    `<header><h1 dir="auto">${inline(artifact.title)}</h1>`,
    `<p class="meta">${escapeHtml(kinds[artifact.kind] ?? "سند")} · ${escapeHtml(formatJalali(tehranDate(new Date(artifact.createdAt)), false))}</p></header>`,
    markdownToHtml(artifact.summary),
    data ? `<h2>جزئیات</h2>\n${data}` : "",
  ].join("\n");
}

/**
 * One page per value, all the same size, each value at the top-left corner in a box of
 * its field's size. Used to overlay Persian text onto AcroForm widgets.
 */
export function overlayHtml(
  items: { width: number; height: number; text: string; fontSize: number; multiline: boolean }[],
): { html: string; pageWidth: number; pageHeight: number } {
  const pageWidth = Math.ceil(Math.max(72, ...items.map((item) => item.width)));
  const pageHeight = Math.ceil(Math.max(72, ...items.map((item) => item.height)));
  const style = `<style>@page { size: ${pageWidth}pt ${pageHeight}pt; margin: 0 }
html, body { margin: 0; padding: 0; background: transparent }
.page { position: relative; width: ${pageWidth}pt; height: ${pageHeight}pt; overflow: hidden; break-after: page }
.page:last-child { break-after: auto }
.value { position: absolute; top: 0; left: 0; box-sizing: border-box; overflow: hidden; padding: 0 3pt; color: #000; text-align: start; line-height: 1.35; display: flex; flex-direction: column }
.single { justify-content: center; white-space: nowrap }
.multi { justify-content: flex-start; padding-top: 2pt; white-space: pre-wrap }</style>`;
  const pages = items.map(
    (item) =>
      `<div class="page"><div class="value ${item.multiline ? "multi" : "single"}" dir="auto" style="width:${item.width}pt;height:${item.height}pt;font-size:${item.fontSize}pt">${escapeHtml(item.text)}</div></div>`,
  );
  return { html: `${style}\n${pages.join("\n")}`, pageWidth, pageHeight };
}
