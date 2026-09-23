/** Bot API messages are limited to 4096 UTF-16 units; keep a margin. */
export const MESSAGE_LIMIT = 4000;

/** Persian (۰–۹) and Arabic-Indic (٠–٩) digits typed by the user → ASCII. */
export function toLatinDigits(text: string): string {
  return text
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** ASCII digits → Persian digits for visible numbers. */
export function faDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

/**
 * Messages are sent without parse_mode, so Markdown would show up literally. Remove the
 * common model-generated markup while keeping the words, links and code content.
 */
export function toPlainText(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/^```[^\n]*\n?/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/!?\[([^\]\n]+)\]\((\S+?)\)/g, (_, label: string, url: string) =>
      label === url ? url : `${label} (${url})`,
    )
    .replace(/^(\s*)[*-]\s+/gm, "$1• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Split text into chunks of at most `limit` UTF-16 units, preferring paragraph, line, then
 * word boundaries, and never cutting a surrogate pair.
 */
export function splitMessage(text: string, limit = MESSAGE_LIMIT): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    let cut = -1;
    for (const separator of ["\n\n", "\n", " "]) {
      const at = window.lastIndexOf(separator);
      if (at > limit / 3) {
        cut = at;
        break;
      }
    }
    if (cut < 0) {
      cut = limit;
      const code = rest.charCodeAt(cut - 1);
      if (code >= 0xd800 && code <= 0xdbff) cut--;
    }
    const chunk = rest.slice(0, cut).trim();
    if (chunk) chunks.push(chunk);
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}
