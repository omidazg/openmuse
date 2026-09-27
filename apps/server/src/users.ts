import { createHash, randomBytes } from "node:crypto";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

export type Role = "admin" | "user";
export type UserStatus = "active" | "disabled";
/** Per-user daily limits; undefined/null falls back to the server default, 0 means unlimited. */
export interface QuotaOverrides {
  dailyMessages?: number | null;
  dailyTasks?: number | null;
}
/**
 * A person who can sign in. `id` is also their workspace owner, so records created with
 * env keys ("local-user", "user-<name>") keep pointing at the same data.
 */
export interface UserRecord {
  id: string;
  name: string;
  label?: string;
  phone?: string;
  role: Role;
  status: UserStatus;
  /** env: key lives in OPENMUSE_ACCESS_KEY / OPENMUSE_USER_KEYS; db: key hash stored here. */
  source: "env" | "db";
  /** sha256 hex of the access key (db users only). The plaintext key is never stored. */
  keyHash?: string;
  plan: "free";
  quota?: QuotaOverrides;
  createdAt: string;
  updatedAt?: string;
}
export type PublicUser = Omit<UserRecord, "keyHash">;

export const ADMIN_OWNER = "local-user";
const SYSTEM = "system";
const USERS = "users";
const KEYS = "user-keys";
const SESSIONS = "sessions";

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
/** 32 url-safe characters (192 bits); longer than the 24-character minimum for env keys. */
export const newAccessKey = () => randomBytes(24).toString("base64url");
export const namePattern = /^[a-z0-9_-]{1,32}$/;

/** Persian (۰–۹) and Arabic-Indic (٠–٩) digits → ASCII. */
export function toLatinDigits(text: string): string {
  return text
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** Iranian mobile numbers in any common form (۰۹۱۲…، +98912…، 0098912…، 912…) → "09121234567". */
export function normalizePhone(raw: string): string | undefined {
  const digits = toLatinDigits(raw)
    .trim()
    .replace(/[\s\-().‌‎‏]/g, "");
  const match = /^(?:\+98|0098|98|0)?(9\d{9})$/.exec(digits);
  return match ? `0${match[1]}` : undefined;
}

export function publicUser(user: UserRecord): PublicUser {
  const { keyHash: _, ...rest } = user;
  return rest;
}

export class Users {
  constructor(private readonly db: Store) {}
  get(id: string) {
    return this.db.get<UserRecord>(SYSTEM, USERS, id);
  }
  list() {
    return this.db.list<UserRecord>(SYSTEM, USERS);
  }
  async byPhone(phone: string) {
    return (await this.list()).find((user) => user.phone === phone) ?? null;
  }
  /** Database users only; env keys are matched in Auth so they keep working without the database. */
  async byKey(accessKey: string) {
    const hash = sha256(accessKey);
    const index = await this.db.get<{ userId: string }>(SYSTEM, KEYS, hash);
    if (!index) return null;
    const user = await this.get(index.userId);
    return user?.source === "db" && user.keyHash === hash ? user : null;
  }
  async isAdmin(owner: string) {
    if (owner === ADMIN_OWNER) return true;
    return (await this.get(owner))?.role === "admin";
  }
  /** Mirror env-defined keys into the users collection so admins can see and disable them. */
  async syncEnv(config: Config) {
    const now = new Date().toISOString();
    const entries = [
      { id: ADMIN_OWNER, name: "admin", role: "admin" as Role },
      ...(config.userKeys ?? []).map(({ owner }) => ({
        id: owner,
        name: owner.slice("user-".length),
        role: "user" as Role,
      })),
    ];
    for (const entry of entries) {
      const existing = await this.get(entry.id);
      if (existing?.source === "db") continue;
      await this.db.put<UserRecord>(SYSTEM, USERS, {
        plan: "free",
        createdAt: now,
        ...existing,
        id: entry.id,
        name: entry.name,
        role: entry.id === ADMIN_OWNER ? "admin" : (existing?.role ?? entry.role),
        // The server's own admin key can never be locked out.
        status: entry.id === ADMIN_OWNER ? "active" : (existing?.status ?? "active"),
        source: "env",
      });
    }
  }
  async create(input: {
    name: string;
    label?: string;
    phone?: string;
    role?: Role;
    quota?: QuotaOverrides;
  }) {
    if (!namePattern.test(input.name))
      throw new AppError(
        "نام کاربری فقط می‌تواند حروف کوچک انگلیسی، عدد، «_» یا «-» باشد (حداکثر ۳۲ نویسه).",
        422,
      );
    const id = `user-${input.name}`;
    if (await this.get(id))
      throw new AppError("این نام کاربری قبلاً ثبت شده است. نام دیگری انتخاب کنید.", 409);
    if (input.phone) await this.assertPhoneFree(input.phone);
    const key = newAccessKey();
    const user: UserRecord = {
      id,
      name: input.name,
      label: input.label || undefined,
      phone: input.phone,
      role: input.role ?? "user",
      status: "active",
      source: "db",
      keyHash: sha256(key),
      plan: "free",
      quota: input.quota,
      createdAt: new Date().toISOString(),
    };
    const inserted = await this.db.insertIfAbsent(SYSTEM, USERS, user);
    if (!inserted)
      throw new AppError("این نام کاربری قبلاً ثبت شده است. نام دیگری انتخاب کنید.", 409);
    await this.db.put(SYSTEM, KEYS, { id: user.keyHash as string, userId: id });
    return { user, key };
  }
  async update(
    id: string,
    patch: {
      label?: string | null;
      phone?: string | null;
      role?: Role;
      status?: UserStatus;
      quota?: QuotaOverrides;
    },
  ) {
    const user = await this.require(id);
    if (id === ADMIN_OWNER && (patch.status === "disabled" || patch.role === "user"))
      throw new AppError("حساب مدیر اصلی سرور غیرفعال یا محدود نمی‌شود.", 409);
    if (patch.phone && patch.phone !== user.phone) await this.assertPhoneFree(patch.phone, id);
    const next: UserRecord = {
      ...user,
      ...(patch.label !== undefined ? { label: patch.label || undefined } : {}),
      ...(patch.phone !== undefined ? { phone: patch.phone || undefined } : {}),
      ...(patch.role ? { role: patch.role } : {}),
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.quota ? { quota: { ...user.quota, ...patch.quota } } : {}),
      updatedAt: new Date().toISOString(),
    };
    await this.db.put(SYSTEM, USERS, next);
    if (next.status === "disabled") await this.deleteSessions(id);
    return next;
  }
  async rotateKey(id: string) {
    const user = await this.require(id);
    if (user.source !== "db")
      throw new AppError(
        "کلید این کاربر در تنظیمات سرور (OPENMUSE_ACCESS_KEY یا OPENMUSE_USER_KEYS) تعریف شده است و از همان‌جا عوض می‌شود.",
        409,
      );
    const key = newAccessKey();
    if (user.keyHash) await this.db.remove(SYSTEM, KEYS, user.keyHash);
    const next: UserRecord = { ...user, keyHash: sha256(key), updatedAt: new Date().toISOString() };
    await this.db.put(SYSTEM, KEYS, { id: next.keyHash as string, userId: id });
    await this.db.put(SYSTEM, USERS, next);
    await this.deleteSessions(id);
    return { user: next, key };
  }
  /** Removes every session of one owner (and expired sessions of anyone). */
  async deleteSessions(owner: string) {
    let deleted = 0;
    for (const session of await this.db.list<{ id: string; owner: string; expiresAt: number }>(
      SYSTEM,
      SESSIONS,
    ))
      if (session.owner === owner || session.expiresAt < Date.now()) {
        await this.db.remove(SYSTEM, SESSIONS, session.id);
        if (session.owner === owner) deleted++;
      }
    return deleted;
  }
  async sessionCounts() {
    const counts = new Map<string, number>();
    for (const session of await this.db.list<{ owner: string; expiresAt: number }>(
      SYSTEM,
      SESSIONS,
    ))
      if (session.expiresAt >= Date.now())
        counts.set(session.owner, (counts.get(session.owner) ?? 0) + 1);
    return counts;
  }
  private async require(id: string) {
    const user = await this.get(id);
    if (!user) throw new AppError("این کاربر پیدا نشد. فهرست کاربران را تازه کنید.", 404);
    return user;
  }
  private async assertPhoneFree(phone: string, except?: string) {
    const other = await this.byPhone(phone);
    if (other && other.id !== except)
      throw new AppError("این شمارهٔ موبایل برای کاربر دیگری ثبت شده است.", 409);
  }
}
