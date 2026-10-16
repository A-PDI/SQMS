/** Isolated rehearsal CLI. Deliberately refuses production/remote targets and live integrations. */
import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { createPrismaClient } from "@sqms/db";
import { loadEnv, ObjectStorage, QueueRegistry } from "@sqms/server-core";
import IORedis from "ioredis";
import { assertDisposableTarget } from "./isolation";
import { LegacyMigration } from "./legacy-migration";
import type { DisposableTarget, Intake, MigrationMappings } from "./types";

async function main() {
  const { values } = parseArgs({
    options: {
      intake: { type: "string" },
      target: { type: "string" },
      mappings: { type: "string" },
      mode: { type: "string", default: "dry-run" },
      "operator-id": { type: "string" },
      "attachment-copy": { type: "string" },
      report: { type: "string" },
    },
  });
  if (
    !values.intake ||
    !values.target ||
    !values.mappings ||
    !values.report ||
    !values["operator-id"]
  )
    throw new Error(
      "Required: --intake --target --mappings --operator-id --report; optional --mode dry-run|import|validate --attachment-copy",
    );
  if (!["dry-run", "import", "validate"].includes(values.mode!))
    throw new Error("Unknown migration mode");
  const intake: Intake = JSON.parse(await readFile(values.intake, "utf8"));
  const target: DisposableTarget = JSON.parse(
    await readFile(values.target, "utf8"),
  );
  const mappings: MigrationMappings = JSON.parse(
    await readFile(values.mappings, "utf8"),
  );
  assertDisposableTarget(target, intake, process.env);
  const env = loadEnv();
  const db = createPrismaClient(env.DATABASE_URL, { connectionLimit: 2 });
  const storage = new ObjectStorage({
    endpoint: env.S3_ENDPOINT,
    bucket: env.S3_BUCKET,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });
  const redis = new IORedis(env.REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    commandTimeout: 5000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  redis.on("error", () => undefined);
  const queues = new QueueRegistry(redis);
  try {
    const operator = await db.user.findFirst({
      where: {
        id: values["operator-id"],
        status: "ACTIVE",
        userType: "INTERNAL",
      },
      include: {
        memberships: {
          where: { status: "ACTIVE", organization: { type: "INTERNAL" } },
          include: {
            roles: {
              include: {
                role: {
                  include: { permissions: { include: { permission: true } } },
                },
              },
            },
          },
        },
      },
    });
    const membership = operator?.memberships.find(
      (m) =>
        m.roles.some((r) =>
          r.role.permissions.some((p) => p.permission.key === "admin:users"),
        ) &&
        m.roles.some((r) =>
          r.role.permissions.some((p) => p.permission.key === "admin:settings"),
        ),
    );
    if (!operator || !membership)
      throw new Error(
        "Migration operator must be an active internal administrator",
      );
    if (values.mode === "import")
      await storage.ensureBucket(env.S3_AUTO_CREATE_BUCKET);
    if (values.mode === "import") await redis.connect().catch(() => undefined);
    const migration = new LegacyMigration(
      db,
      storage,
      target,
      mappings,
      operator.id,
      membership.organizationId,
      values["attachment-copy"],
      (id) => queues.enqueueFileScan(id),
    );
    const report = await migration.run(
      intake,
      values.mode as "dry-run" | "import" | "validate",
    );
    await writeFile(values.report, JSON.stringify(report, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    console.log(
      JSON.stringify({
        datasetId: report.datasetId,
        mode: report.mode,
        fixtureOnly: report.fixtureOnly,
        sourceCounts: report.sourceCounts,
        totals: report.totals,
        targetCounts: report.targetCounts,
        durationMs: report.durationMs,
      }),
    );
    if (
      report.totals.FAILED ||
      report.totals.CONFLICT ||
      report.businessChecks?.some((c) => !c.passed)
    )
      process.exitCode = 2;
    else if (
      report.totals.UNRESOLVED ||
      report.unresolvedMappings ||
      report.attachments?.some((a) => !a.readable)
    )
      process.exitCode = 3;
  } finally {
    await queues.close().catch(() => undefined);
    redis.disconnect();
    storage.client.destroy();
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error(
    "Migration refused or failed. Inspect the private reconciliation report and non-secret configuration; no source values or credentials are logged.",
  );
  process.exitCode = 1;
});
