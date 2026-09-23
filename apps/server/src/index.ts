import { serve } from "@hono/node-server";
import { BRAND } from "../../../packages/domain/src/brand.ts";
import { createApp } from "./app.ts";
import { startBots } from "./bot/index.ts";
import { assertApiDeploymentConfig, readConfig } from "./config.ts";
import { createStore } from "./db.ts";
import { withStaticWeb } from "./static.ts";

const config = readConfig();
assertApiDeploymentConfig(config);
const db = await createStore({
  dataDir: `${config.dataDir}/postgres`,
  databaseUrl: config.databaseUrl,
});
await db.recoverInterruptedActions();
const { app, agent } = await createApp(db, config);
if (config.taskWorkerEnabled) agent.start();
// Bots run next to the task worker so exactly one process polls each token.
const bots = config.taskWorkerEnabled ? startBots(db, agent) : undefined;
const server = serve(
  { fetch: withStaticWeb(app.fetch), port: config.port, hostname: config.host },
  () => console.log(`${BRAND.name} ${config.mode} API ready at ${config.publicUrl}`),
);
const shutdown = () => {
  server.close(() => {
    void Promise.resolve(bots?.stop())
      .then(() => agent.stop())
      .then(() => db.close())
      .then(() => process.exit(0));
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
