import type { Config } from "./config.ts";
import { AppError } from "./errors.ts";

const MAX_PDF_BYTES = 10 * 1024 * 1024;

/**
 * Persian PDF rendering through the browser worker's Chromium (POST /pdf). pdf-lib cannot
 * shape Arabic-script text, so any PDF with Persian text is produced here. When the worker
 * is not configured, `available` is false and callers keep their pdf-lib paths.
 */
export class PdfRenderer {
  constructor(private readonly config: Config) {}
  get available(): boolean {
    return Boolean(this.config.workerUrl && this.config.workerToken);
  }
  async render(
    html: string,
    options: { title?: string; direction?: "rtl" | "ltr"; signal?: AbortSignal } = {},
  ): Promise<Uint8Array> {
    if (!this.available)
      throw new AppError(
        "ساخت PDF فارسی به سرویس مرورگر نیاز دارد. آن را طبق راهنمای راه‌اندازی اجرا کنید.",
        503,
      );
    const timeout = AbortSignal.timeout(60_000);
    let response: Response;
    try {
      response = await fetch(`${this.config.workerUrl}/pdf`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.workerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          html,
          title: (options.title ?? "").slice(0, 300),
          direction: options.direction ?? "rtl",
          lang: "fa-IR",
        }),
        signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
      });
    } catch {
      options.signal?.throwIfAborted();
      throw new AppError(
        "سرویس ساخت PDF در دسترس نیست. بررسی کنید کانتینر سرویس مرورگر در حال اجرا باشد.",
        503,
      );
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new AppError(
        response.status === 413
          ? "این سند برای تبدیل به PDF خیلی بزرگ است. متن کوتاه‌تری انتخاب کنید."
          : `ساخت PDF ناموفق بود${typeof payload?.error?.code === "string" ? ` (${payload.error.code})` : ""}. کمی بعد دوباره تلاش کنید.`,
        502,
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > MAX_PDF_BYTES || Buffer.from(bytes.subarray(0, 1024)).indexOf("%PDF-") < 0)
      throw new AppError("سرویس ساخت PDF خروجی نامعتبری برگرداند. دوباره تلاش کنید.", 502);
    return bytes;
  }
}
