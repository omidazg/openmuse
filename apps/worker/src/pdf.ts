import { readFile } from "node:fs/promises";
import type { Browser } from "playwright";
import { WorkerError } from "./errors.ts";

/** Largest HTML fragment accepted by POST /pdf. */
export const MAX_PDF_HTML_BYTES = 2 * 1024 * 1024;
/** Largest PDF returned by the renderer. */
export const MAX_RENDERED_PDF_BYTES = 10 * 1024 * 1024;

export interface PdfRequest {
  html: string;
  title: string;
  direction: "rtl" | "ltr";
  lang: string;
}

export function validatePdfRequest(body: Record<string, unknown>): PdfRequest {
  if (typeof body.html !== "string" || !body.html.trim())
    throw new WorkerError("INVALID_HTML", "An HTML fragment is required.");
  if (Buffer.byteLength(body.html) > MAX_PDF_HTML_BYTES)
    throw new WorkerError("HTML_TOO_LARGE", "The HTML fragment exceeds 2 MiB.", 413);
  if (body.title !== undefined && (typeof body.title !== "string" || body.title.length > 300))
    throw new WorkerError("INVALID_TITLE", "The title must be a string of at most 300 characters.");
  if (body.direction !== undefined && body.direction !== "rtl" && body.direction !== "ltr")
    throw new WorkerError("INVALID_DIRECTION", 'Direction must be "rtl" or "ltr".');
  if (
    body.lang !== undefined &&
    (typeof body.lang !== "string" || !/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(body.lang))
  )
    throw new WorkerError("INVALID_LANG", "The language must be a BCP 47 tag such as fa-IR.");
  return {
    html: body.html,
    title: typeof body.title === "string" ? body.title : "",
    direction: body.direction === "ltr" ? "ltr" : "rtl",
    lang: typeof body.lang === "string" ? body.lang : "fa-IR",
  };
}

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );

let fontFaces: Promise<string> | undefined;

/** Vazirmatn (SIL OFL 1.1) embedded as data URLs, so rendering never touches the network. */
export function vazirmatnFontFaces(): Promise<string> {
  fontFaces ??= Promise.all(
    [
      ["Vazirmatn-Regular.ttf", 400],
      ["Vazirmatn-Bold.ttf", 700],
    ].map(async ([file, weight]) => {
      const bytes = await readFile(new URL(`../assets/fonts/${file}`, import.meta.url));
      return `@font-face { font-family: "Vazirmatn"; font-style: normal; font-weight: ${weight}; font-display: block; src: url(data:font/ttf;base64,${bytes.toString("base64")}) format("truetype"); }`;
    }),
  ).then((faces) => faces.join("\n"));
  return fontFaces;
}

/** A complete print document around a trusted server-built fragment. Scripts are blocked by CSP. */
export async function printDocument(request: PdfRequest): Promise<string> {
  return `<!doctype html>
<html lang="${escapeHtml(request.lang)}" dir="${request.direction}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:">
<title>${escapeHtml(request.title)}</title>
<style>
${await vazirmatnFontFaces()}
@page { size: A4; margin: 18mm 16mm 20mm }
html { font-family: "Vazirmatn", sans-serif; font-size: 11pt; line-height: 1.8; color: #111a1c; -webkit-print-color-adjust: exact; print-color-adjust: exact }
body { margin: 0 }
h1, h2, h3, h4 { line-height: 1.35; margin: 1.1em 0 0.45em; font-weight: 700; break-after: avoid }
h1 { font-size: 20pt; margin-top: 0 }
h2 { font-size: 15pt }
h3 { font-size: 13pt }
h4 { font-size: 11.5pt }
p { margin: 0 0 0.7em }
.meta { color: #5f686c; font-size: 9.5pt; margin-bottom: 1.4em }
header { border-bottom: 1pt solid #dde3e6; margin-bottom: 1.2em }
ul, ol { margin: 0 0 0.8em; padding-inline-start: 1.4em }
li { margin-bottom: 0.25em }
table { width: 100%; border-collapse: collapse; margin: 0.4em 0 1em; font-size: 10pt; line-height: 1.6 }
th, td { border: 0.75pt solid #cfd6d9; padding: 4pt 6pt; text-align: start; vertical-align: top }
thead th, table.pairs th { background: #f1f4f5; font-weight: 700 }
table.pairs th { width: 28% }
tr { break-inside: avoid }
hr { border: 0; border-top: 0.75pt solid #dde3e6; margin: 1em 0 }
code { font-family: ui-monospace, "DejaVu Sans Mono", monospace; font-size: 9.5pt }
</style>
</head>
<body>
${request.html}
</body>
</html>`;
}

/** Chromium HTML-to-PDF renderer. JavaScript and all network requests are disabled. */
export function createPdfRenderer(launch?: () => Promise<Browser>) {
  let browser: Promise<Browser> | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const start = async () => {
    if (launch) return launch();
    const { chromium } = await import("playwright");
    return chromium.launch({
      headless: true,
      env: {
        HOME: process.env.HOME ?? "/tmp",
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        LANG: "C.UTF-8",
      },
      args: ["--disable-extensions", "--host-resolver-rules=MAP * ~NOTFOUND"],
      timeout: 25_000,
    });
  };
  async function renderNow(request: PdfRequest): Promise<Buffer> {
    browser ??= start().catch((error) => {
      browser = undefined;
      throw error;
    });
    let instance: Browser;
    try {
      instance = await browser;
      if (!instance.isConnected()) {
        browser = start();
        instance = await browser;
      }
    } catch {
      browser = undefined;
      throw new WorkerError(
        "BROWSER_UNAVAILABLE",
        "Chromium could not start. Rebuild the browser-worker image and check its resource limits.",
        503,
      );
    }
    const context = await instance.newContext({ javaScriptEnabled: false, offline: true });
    try {
      await context.route("**/*", (route) =>
        route.request().url().startsWith("data:")
          ? route.continue()
          : route.abort("blockedbyclient"),
      );
      const page = await context.newPage();
      await page.setContent(await printDocument(request), { waitUntil: "load", timeout: 20_000 });
      const pdf = await page.pdf({
        printBackground: true,
        preferCSSPageSize: true,
        format: "A4",
        tagged: true,
        outline: false,
      });
      if (pdf.length > MAX_RENDERED_PDF_BYTES)
        throw new WorkerError("PDF_TOO_LARGE", "The rendered PDF exceeds 10 MiB.", 413);
      return pdf;
    } catch (error) {
      if (error instanceof WorkerError) throw error;
      throw new WorkerError("PDF_FAILED", "The PDF could not be rendered.", 500);
    } finally {
      await context.close().catch(() => {});
    }
  }
  return {
    /** Renders one document at a time to bound memory use. */
    render(request: PdfRequest): Promise<Buffer> {
      const result = queue.then(() => renderNow(request));
      queue = result.catch(() => {});
      return result;
    },
    async close() {
      const current = browser;
      browser = undefined;
      if (current) await (await current.catch(() => undefined))?.close().catch(() => {});
    },
  };
}
