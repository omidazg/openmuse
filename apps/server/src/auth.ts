import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BRAND } from "../../../packages/domain/src/brand.ts";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

const digest = (value: string) => createHash("sha256").update(value).digest();
export class Auth {
  constructor(
    private readonly db: Store,
    private readonly config: Config,
    private readonly signingKey: string,
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
    const owner = this.ownerFor(accessKey);
    if (!owner) throw new AppError("کلید دسترسی نادرست است", 401);
    const token = randomBytes(32).toString("base64url");
    await this.db.put("system", "sessions", {
      id: digest(token).toString("hex"),
      owner,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });
    return { token, mode: this.config.mode, owner };
  }
  async owner(authorization?: string) {
    if (!authorization?.startsWith("Bearer ")) throw new AppError(`وارد ${BRAND.nameFa} شوید`, 401);
    const session = await this.db.get<{ owner: string; expiresAt: number }>(
      "system",
      "sessions",
      digest(authorization.slice(7)).toString("hex"),
    );
    if (!session || session.expiresAt < Date.now())
      throw new AppError("نشست منقضی شده است. دوباره وارد شوید.", 401);
    return session.owner;
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
  return new Auth(db, config, key);
}
