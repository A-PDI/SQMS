import { execFileSync, spawn } from "node:child_process";
import { existsSync, openSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createPrismaClient, seedReferenceData } from "@sqms/db";
import IORedis from "ioredis";
import { TEST_ENV } from "./test-env";

/**
 * Prepares the dedicated test database: applies migrations with the migration account, truncates every table and
 * seeds reference data. Refuses to run against a database whose name does not end in "_test".
 */
export default async function globalSetup(): Promise<void> {
  const dbName = new URL(TEST_ENV.MIGRATION_DATABASE_URL).pathname.slice(1);
  if (!dbName.endsWith("_test")) throw new Error(`Refusing to reset non-test database "${dbName}"`);
  const dbPkg = path.resolve(__dirname, "../../../packages/db");
  execFileSync(path.join(dbPkg, "node_modules/.bin/prisma"), ["migrate", "deploy"], {
    cwd: dbPkg,
    env: { ...process.env, MIGRATION_DATABASE_URL: TEST_ENV.MIGRATION_DATABASE_URL, DATABASE_URL: TEST_ENV.MIGRATION_DATABASE_URL },
    stdio: "pipe",
  });
  const admin = createPrismaClient(TEST_ENV.MIGRATION_DATABASE_URL, { connectionLimit: 1 });
  try {
    const tables = await admin.$queryRaw<{ t: string }[]>`SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ${dbName} AND TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME <> '_prisma_migrations'`;
    await admin.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0");
    for (const { t } of tables) {
      if (!/^[a-z0-9_]+$/.test(t)) throw new Error(`Unexpected table name ${t}`);
      await admin.$executeRawUnsafe(`TRUNCATE TABLE \`${t}\``);
    }
    await admin.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1");
  } finally {
    await admin.$disconnect();
  }
  const app = createPrismaClient(TEST_ENV.DATABASE_URL, { connectionLimit: 2 });
  try {
    await seedReferenceData(app, { admin: { email: "admin@test.local", password: "Admin-Test-Pass-1!", displayName: "Test Admin" } });
  } finally {
    await app.$disconnect();
  }
  const redis = new IORedis(TEST_ENV.REDIS_URL);
  await redis.flushdb();
  redis.disconnect();

  // Start the real background worker (malware scanning, email, maintenance) against the test environment.
  const workerMain = path.resolve(__dirname, "../../worker/dist/main.js");
  if (!existsSync(workerMain)) throw new Error("Build the worker first: pnpm --filter @sqms/worker run build");
  const logFd = openSync(path.resolve(__dirname, "../.worker-test.log"), "w");
  const child = spawn(process.execPath, [workerMain], { env: { ...process.env, ...TEST_ENV }, stdio: ["ignore", logFd, logFd], detached: true });
  child.unref();
  writeFileSync(path.resolve(__dirname, "../.worker-test.pid"), String(child.pid));
}
