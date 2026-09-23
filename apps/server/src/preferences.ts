/**
 * Small per-owner app preferences that should follow the person across devices: whether the
 * welcome onboarding was finished and the newest «تازه‌ها» (What's new) entry already seen.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Store } from "./db.ts";

const KIND = "conversation-settings";
const ID = "app-preferences";

export interface Preferences {
  onboardingDone: boolean;
  changelogSeen: string | null;
}

const patchSchema = z
  .object({
    onboardingDone: z.boolean().optional(),
    changelogSeen: z
      .string()
      .max(100)
      .regex(/^[A-Za-z0-9._-]*$/, "شناسهٔ تازه‌ها نامعتبر است")
      .nullable()
      .optional(),
  })
  .strict();

export async function readPreferences(db: Store, owner: string): Promise<Preferences> {
  const saved = await db.get<Partial<Preferences>>(owner, KIND, ID);
  return {
    onboardingDone: saved?.onboardingDone === true,
    changelogSeen: typeof saved?.changelogSeen === "string" ? saved.changelogSeen : null,
  };
}

export function preferenceRoutes(db: Store) {
  const app = new Hono<{ Variables: { owner: string } }>();
  app.get("/", async (c) => c.json(await readPreferences(db, c.get("owner"))));
  app.patch("/", async (c) => {
    const patch = patchSchema.parse(await c.req.json());
    const owner = c.get("owner");
    const next = { ...(await readPreferences(db, owner)), ...patch };
    await db.put(owner, KIND, { id: ID, ...next, updatedAt: new Date().toISOString() });
    return c.json(next);
  });
  return app;
}
