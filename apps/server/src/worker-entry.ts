import { BRAND } from "../../../packages/domain/src/brand.ts";
import { createApp } from "./app.ts";
import { startBots } from "./bot/index.ts";
import { readConfig } from "./config.ts";
import { createStore } from "./db.ts";

const config = readConfig();
if (!config.databaseUrl)
  throw new Error(
    "A separate task worker requires DATABASE_URL. Embedded PGlite runs inside the API process.",
  );
const db = await createStore({ databaseUrl: config.databaseUrl });
const { agent } = await createApp(db, config);
agent.start();
// Messenger bots (Bale/Telegram) poll only when their tokens are set.
const bots = startBots(db, agent);
console.log(`${BRAND.name} task worker running`);
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await bots?.stop();
  await agent.stop();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", () => {
  void stop().catch(() => process.exit(1));
});
process.on("SIGTERM", () => {
  void stop().catch(() => process.exit(1));
});
