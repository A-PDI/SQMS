import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "prisma/config";

// Load a local .env (developer convenience only). In containers/CI, variables come from the environment.
for (const candidate of [path.join(__dirname, ".env"), path.join(__dirname, "../../.env")]) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

export default defineConfig({
  schema: path.join("prisma", "schema"),
  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "node dist/seed/run.js reference",
  },
  datasource: {
    // MIGRATION_DATABASE_URL lets migrations run under a DDL-capable account while the
    // application uses a least-privilege DML account (DATABASE_URL).
    url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
