import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BRAND } from "../../../packages/domain/src/brand.ts";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";
import { ADMIN_OWNER, type Role, Users } from "./users.ts";

const digest = (value: string) => createHash("sha256").update(value).digest();
export class Auth {
  constructor(
    private readonly db: Store,
    private readonly config: Config,
    private readonly signingKey: string,
    readonly users: Users = new Users(db),
  ) {}
  /** The admin key owns the original workspace; each OPENMUSE_USER_KEYS entry gets its own. */
  private ownerFor(accessKey?: string): string | undefined {
    if (this.config.mode !== "live") return "local-user";
    if (!accessKey) return undefined;
    const given = digest(accessKey);
    let owner: string | undefined;
    // Compare against every key so timing does not reveal which one matched.
    for (const { owner: candidate, key } of [
      ...(this.config.accessKey ? [{ owner: "local-user", key: this.config.accessKey }] : []),
      ...(this.config.userKeys ?? []),
    ])
      if (timingSafeEqual(given, digest(key))) owner ??= candidate;
    return owner;
  }
  async session(accessKey?: string) {
    if (this.config.mode !== "live") return this.issue("local-user");
    const owner =
      this.ownerFor(accessKey) ?? (accessKey ? (await this.users.byKey(accessKey))?.id : undefined);
    if (!owner) throw new AppError("کلید دسترسی نادرست است", 401);
    return this.issue(owner);
  }
  /** Creates a 24-hour session for an owner that has already proven who they are. */
  async issue(owner: string) {
    const user = await this.users.get(owner);
    if (user?.status === "disabled")
      throw new AppError("حساب شما غیرفعال شده است. با مدیر سرویس تماس بگیرید.", 403);
    const token = randomBytes(32).toString("base64url");
    await this.db.put("system", "sessions", {
      id: digest(token).toString("hex"),
      owner,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });
    return { token, mode: this.config.mode, owner };
  }
  /** Session owner and role; sessions of disabled users are removed on first use. */
  async identity(authorization?: string): Promise<{ owner: string; role: Role }> {
    if (!authorization?.startsWith("Bearer ")) throw new AppError(`وارد ${BRAND.nameFa} شوید`, 401);
    const id = digest(authorization.slice(7)).toString("hex");
    const session = await this.db.get<{ owner: string; expiresAt: number }>(
      "system",
      "sessions",
      id,
    );
    if (!session || session.expiresAt < Date.now())
      throw new AppError("نشست منقضی شده است. دوباره وارد شوید.", 401);
    const user = await this.users.get(session.owner);
    if (user?.status === "disabled") {
      await this.db.remove("system", "sessions", id);
      throw new AppError("حساب شما غیرفعال شده است. با مدیر سرویس تماس بگیرید.", 401);
    }
    const admin = session.owner === ADMIN_OWNER || user?.role === "admin";
    return { owner: session.owner, role: admin ? "admin" : "user" };
  }
  async owner(authorization?: string) {
    return (await this.identity(authorization)).owner;
  }
  /** Logout: forget this one session token. */
  async end(authorization?: string) {
    if (!authorization?.startsWith("Bearer ")) return;
    await this.db.remove("system", "sessions", digest(authorization.slice(7)).toString("hex"));
  }
  /** Keyed hash for short-lived secrets such as SMS codes. */
  mac(value: string) {
    return createHmac("sha256", this.signingKey).update(value).digest("hex");
  }
  sign(owner: string, path: string) {
    const expires = String(Date.now() + 15 * 60 * 1000);
    const signature = createHmac("sha256", this.signingKey)
      .update(`${owner}\n${path}\n${expires}`)
      .digest("hex");
    return `${this.config.publicUrl}${path}?owner=${encodeURIComponent(owner)}&expires=${expires}&signature=${signature}`;
  }
  verify(url: URL) {
    const owner = url.searchParams.get("owner") ?? "";
    const expires = url.searchParams.get("expires") ?? "";
    const signature = url.searchParams.get("signature") ?? "";
    if (
      !owner ||
      !/^\d+$/.test(expires) ||
      Number(expires) < Date.now() ||
      !/^\w{64}$/.test(signature)
    )
      throw new AppError("پیوند سند منقضی شده است؛ فضای کاری را تازه کنید", 401);
    const expected = createHmac("sha256", this.signingKey)
      .update(`${owner}\n${url.pathname}\n${expires}`)
      .digest("hex");
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature)))
      throw new AppError("پیوند دسترسی نامعتبر است", 403);
    return owner;
  }
}
export async function createAuth(db: Store, config: Config) {
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  const path = join(config.dataDir, "session-signing-key");
  let key: string;
  try {
    key = await readFile(path, "utf8");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    key = randomBytes(32).toString("base64");
    await writeFile(path, key, { mode: 0o600, flag: "wx" });
  }
  const auth = new Auth(db, config, key);
  await auth.users.syncEnv(config);
  return auth;
}
