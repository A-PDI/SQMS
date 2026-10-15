import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { loadEnv } from "@sqms/server-core";
import { createApp } from "./bootstrap";

async function main() {
  const env = loadEnv();
  const app = await createApp(env);
  await app.listen(env.PORT, "0.0.0.0");
  new Logger("Bootstrap").log(`SQMS API listening on port ${env.PORT} (portal ${env.SUPPLIER_PORTAL_ENABLED ? "ENABLED" : "disabled"})`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
