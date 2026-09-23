import { Hono } from "hono";
import type { Store } from "../db.ts";
import { AppError } from "../errors.ts";
import { createLinkCode, listLinks, unlinkChat } from "./links.ts";

/** Authenticated routes mounted at /api/bot; the owner comes from the session middleware. */
export function botRoutes(db: Store) {
  const app = new Hono<{ Variables: { owner: string } }>();
  let window = 0,
    issued = 0;
  app.post("/link-code", async (c) => {
    // Codes are 6 digits; bound how many can exist at once across all accounts.
    if (Date.now() - window > 60_000) {
      window = Date.now();
      issued = 0;
    }
    if (++issued > 60)
      throw new AppError("درخواست کد اتصال زیاد بوده است. یک دقیقهٔ دیگر دوباره تلاش کنید.", 429);
    return c.json(await createLinkCode(db, c.get("owner")), 201);
  });
  app.get("/links", async (c) =>
    c.json(
      (await listLinks(db, c.get("owner"))).map(({ id, platform, name, linkedAt }) => ({
        id,
        platform,
        name,
        linkedAt,
      })),
    ),
  );
  app.delete("/links/:id", async (c) => {
    const id = c.req.param("id");
    const mine = (await listLinks(db, c.get("owner"))).some((link) => link.id === id);
    if (!mine) throw new AppError("این اتصال پیدا نشد", 404);
    await unlinkChat(db, id);
    return c.json({ ok: true });
  });
  return app;
}
