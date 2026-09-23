import { randomInt, timingSafeEqual } from "node:crypto";
import type { Auth } from "./auth.ts";
import { type Config, otpEnabled } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";
import { RateLimiter } from "./rate-limit.ts";
import { normalizePhone, toLatinDigits, type Users } from "./users.ts";

const CODE_TTL = 2 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const KIND = "otp";

interface OtpRecord {
  id: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
}

const invalidPhone = "شمارهٔ موبایل نامعتبر است. آن را به شکل ۰۹۱۲۱۲۳۴۵۶۷ وارد کنید.";
const tooMany = "درخواست‌ها بیش از حد بوده است. چند دقیقهٔ دیگر دوباره تلاش کنید.";

/** One-time SMS codes through Kavenegar Verify Lookup. Off unless the API key and template are set. */
export class OtpService {
  private readonly perPhoneMinute = new RateLimiter(1, 60 * 1000);
  private readonly perPhoneHour = new RateLimiter(5, 60 * 60 * 1000);
  private readonly requestsPerIp = new RateLimiter(5, 10 * 60 * 1000);
  private readonly verifiesPerIp = new RateLimiter(20, 10 * 60 * 1000);
  constructor(
    private readonly db: Store,
    private readonly config: Config,
    private readonly users: Users,
    private readonly auth: Auth,
    private readonly fetcher: typeof fetch = (...args) => fetch(...args),
  ) {}
  get enabled() {
    return otpEnabled(this.config);
  }
  private phone(raw: string) {
    if (!this.enabled) throw new AppError("ورود با پیامک روی این سرور فعال نیست.", 404);
    const phone = normalizePhone(raw);
    if (!phone) throw new AppError(invalidPhone, 422);
    return phone;
  }
  async request(raw: string, ip: string) {
    const phone = this.phone(raw);
    if (!this.requestsPerIp.take(ip)) throw new AppError(tooMany, 429);
    const user = await this.users.byPhone(phone);
    if (!user && !this.config.otpSignup)
      throw new AppError(
        "این شماره در سامانه ثبت نشده است. از مدیر سرویس بخواهید شماره‌تان را اضافه کند.",
        404,
      );
    if (user?.status === "disabled")
      throw new AppError("حساب شما غیرفعال شده است. با مدیر سرویس تماس بگیرید.", 403);
    if (!this.perPhoneMinute.take(phone))
      throw new AppError("کد تازه فرستاده شده است. یک دقیقه صبر کنید و دوباره تلاش کنید.", 429);
    if (!this.perPhoneHour.take(phone)) throw new AppError(tooMany, 429);
    const code = String(randomInt(100000, 1000000));
    await this.db.put<OtpRecord>("system", KIND, {
      id: phone,
      codeHash: this.auth.mac(`otp:${phone}:${code}`),
      expiresAt: Date.now() + CODE_TTL,
      attempts: 0,
    });
    await this.send(phone, code);
    return { ok: true, expiresIn: CODE_TTL / 1000 };
  }
  async verify(raw: string, rawCode: string, ip: string) {
    const phone = this.phone(raw);
    if (!this.verifiesPerIp.take(ip)) throw new AppError(tooMany, 429);
    const code = toLatinDigits(rawCode).replace(/\s/g, "");
    const record = await this.db.get<OtpRecord>("system", KIND, phone);
    if (!record || record.expiresAt < Date.now()) {
      if (record) await this.db.remove("system", KIND, phone);
      throw new AppError("کد منقضی شده است. کد تازه بگیرید.", 401);
    }
    if (record.attempts >= MAX_ATTEMPTS) {
      await this.db.remove("system", KIND, phone);
      throw new AppError("تلاش‌های نادرست بیش از حد بوده است. کد تازه بگیرید.", 429);
    }
    const expected = Buffer.from(record.codeHash);
    const given = Buffer.from(this.auth.mac(`otp:${phone}:${code}`));
    if (!/^\d{6}$/.test(code) || !timingSafeEqual(expected, given)) {
      await this.db.put("system", KIND, { ...record, attempts: record.attempts + 1 });
      throw new AppError("کد واردشده درست نیست. دوباره بررسی کنید.", 401);
    }
    await this.db.remove("system", KIND, phone);
    let user = await this.users.byPhone(phone);
    if (!user) {
      if (!this.config.otpSignup) throw new AppError("این شماره در سامانه ثبت نشده است.", 404);
      const name = `p${phone.slice(1)}`;
      user =
        (await this.users.get(`user-${name}`)) ??
        (await this.users.create({ name, phone, label: phone })).user;
    }
    return this.auth.issue(user.id);
  }
  private async send(phone: string, code: string) {
    const key = encodeURIComponent(this.config.kavenegarApiKey ?? "");
    const query = new URLSearchParams({
      receptor: phone,
      token: code,
      template: this.config.kavenegarTemplate ?? "",
    });
    let ok = false;
    try {
      const response = await this.fetcher(
        `https://api.kavenegar.com/v1/${key}/verify/lookup.json?${query}`,
        { method: "GET", signal: AbortSignal.timeout(10000) },
      );
      const payload = (await response.json().catch(() => null)) as {
        return?: { status?: number };
      } | null;
      ok = response.ok && payload?.return?.status === 200;
      // The URL holds the API key; log only the provider status.
      if (!ok)
        console.error(`[otp] Kavenegar status ${payload?.return?.status ?? response.status}`);
    } catch {
      console.error("[otp] Kavenegar request failed");
    }
    if (!ok) {
      await this.db.remove("system", KIND, phone);
      this.perPhoneMinute.reset(phone);
      throw new AppError("پیامک فرستاده نشد. چند دقیقهٔ دیگر دوباره تلاش کنید.", 502);
    }
  }
}
