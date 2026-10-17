import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ObjectStorage } from "@sqms/server-core";
import { LegacyMigration } from "../src/migration/legacy-migration";
import { assertDisposableTarget } from "../src/migration/isolation";
import type {
  DisposableTarget,
  Intake,
  MigrationMappings,
} from "../src/migration/types";
import { startApp, createUser, type TestContext } from "./helpers";
import { STORAGE } from "../src/infra/tokens";

describe("Repeatable migration rehearsal", () => {
  let ctx: TestContext,
    storage: ObjectStorage,
    intake: Intake,
    target: DisposableTarget,
    migration: LegacyMigration,
    root: string;
  const legacyRepository = process.env.LEGACY_QMS_REPOSITORY;
  beforeAll(async () => {
    ctx = await startApp({
      SUPPLIER_PORTAL_ENABLED: "false",
      MAIL_TRANSPORT: "disabled",
    });
    storage = ctx.app.get(STORAGE);
    const actor = await createUser(ctx.prisma, { roles: ["SYSTEM_ADMIN"] });
    const org = await ctx.prisma.organization.findUniqueOrThrow({
      where: { code: "INTERNAL" },
    });
    root = mkdtempSync(path.join(tmpdir(), "sqms-seed-rehearsal-"));
    execFileSync(
      "python3",
      legacyRepository
        ? [
            path.resolve(
              __dirname,
              "../../../tools/migration/seed-rehearsal.py",
            ),
            "--legacy-repository",
            legacyRepository,
            "--output-root",
            path.join(root, "fixture"),
          ]
        : [
            path.resolve(
              __dirname,
              "../../../tools/migration/synthetic-fixture.py",
            ),
            "--output-root",
            path.join(root, "fixture"),
          ],
      { stdio: "pipe" },
    );
    intake = JSON.parse(
      readFileSync(path.join(root, "fixture/intake.json"), "utf8"),
    );
    const mappings: MigrationMappings = {
      roles: {
        admin: {
          roleKeys: ["SYSTEM_ADMIN"],
          reviewedById: actor.id,
          reason:
            "Explicit repository fixture role mapping for migration regression",
        },
      },
    };
    target = {
      purpose: "disposable-qms-migration",
      datasetId: intake.datasetId,
      sourceSystem: "PDI_QMS_FIXTURE",
      databaseHost: "127.0.0.1",
      databaseName: "sqms_unified_test",
      storageEndpoint: "http://127.0.0.1:9000",
      redisHost: "127.0.0.1",
      redisDatabase: 1,
      storageBucket: "sqms-test-files",
    };
    migration = new LegacyMigration(
      ctx.prisma,
      storage,
      target,
      mappings,
      actor.id,
      org.id,
      path.join(root, "fixture/uploads"),
    );
  });
  afterAll(async () => {
    if (ctx) await ctx.close();
    if (root) rmSync(root, { recursive: true, force: true });
  });
  it("rejects an operational target or an enabled delivery/bench/portal configuration", () => {
    const env = {
      NODE_ENV: "test",
      DATABASE_URL: "mysql://test:test@127.0.0.1/sqms_unified_test",
      S3_ENDPOINT: "http://127.0.0.1:9000",
      S3_BUCKET: "sqms-test-files",
      REDIS_URL: "redis://127.0.0.1:6379/1",
      SUPPLIER_PORTAL_ENABLED: "false",
      MAIL_TRANSPORT: "disabled",
    };
    expect(() => assertDisposableTarget(target, intake, env)).not.toThrow();
    for (const override of [
      { DATABASE_URL: "mysql://x:x@production.invalid/qms" },
      { S3_BUCKET: "operational-files" },
      { SUPPLIER_PORTAL_ENABLED: "true" },
      { MAIL_TRANSPORT: "smtp" },
      { OUTBOX_WEBHOOK_URL: "https://supplier.invalid" },
      { CARBONZAPP_API_KEY: "must-not-be-used" },
    ])
      expect(() =>
        assertDisposableTarget(target, intake, { ...env, ...override }),
      ).toThrow();
  });
  it("profiles and dry-runs the seed without target writes or old-application startup", async () => {
    const before = await ctx.prisma.legacyRecord.count();
    const report = await migration.run(intake, "dry-run");
    expect(await ctx.prisma.legacyRecord.count()).toBe(before);
    expect(report.fixtureOnly).toBe(true);
    expect(report.sourceCounts.inspections).toBe(3);
    expect(report.sourceCounts.inspection_templates).toBe(13);
    expect(report.sourceCounts.inspection_attachments).toBe(2);
    expect(report.totals.FAILED ?? 0).toBe(0);
  });
  it("imports copies, retains unresolved suppliers and raw history, then repeats without duplicates or credential logging", async () => {
    const first = await migration.run(intake, "import");
    expect(first.totals.FAILED ?? 0).toBe(0);
    expect(first.totals.CONFLICT ?? 0).toBe(0);
    const mappings = await ctx.prisma.legacyRecord.findMany({
      where: { sourceSystem: target.sourceSystem, entity: "inspections" },
    });
    expect(mappings).toHaveLength(3);
    for (const mapping of mappings) {
      const r = await ctx.prisma.incomingInspection.findUniqueOrThrow({
        where: { id: mapping.targetId! },
      });
      expect(r.supplierId).toBeNull();
      expect(r.productApprovalId).toBeNull();
      expect(r.resolutionNotes).toMatch(/Supplier/);
    }
    const users = await ctx.prisma.legacyRecord.findMany({
      where: { sourceSystem: target.sourceSystem, entity: "users" },
    });
    expect(JSON.stringify(users.map((u) => u.snapshot))).not.toContain(
      "password_hash",
    );
    expect(JSON.stringify(first)).not.toMatch(/\$2[aby]\$/);
    expect(
      await ctx.prisma.legacyRecord.count({
        where: {
          sourceSystem: target.sourceSystem,
          entity: "inspection_activity_log",
        },
      }),
    ).toBe(18);
    const counts = first.targetCounts;
    const repeated = await migration.run(intake, "import");
    expect(repeated.targetCounts).toEqual(counts);
    expect(repeated.totals.FAILED ?? 0).toBe(0);
    expect(repeated.totals.CONFLICT ?? 0).toBe(0);
    expect(repeated.totals.UNCHANGED).toBe(
      Object.values(intake.tables).reduce((sum, rows) => sum + rows.length, 0),
    );
    const validated = await migration.run(intake, "validate");
    expect(validated.businessChecks?.every((c) => c.passed)).toBe(true);
  });
  it("detects target test edits and validates file hashes without overwriting records", async () => {
    const record = await ctx.prisma.legacyRecord.findFirstOrThrow({
      where: {
        sourceSystem: target.sourceSystem,
        entity: "inspections",
        targetId: { not: null },
      },
    });
    await ctx.prisma.incomingInspection.update({
      where: { id: record.targetId! },
      data: {
        header: { testOnlyEdit: "Preserve this correction" },
        version: { increment: 1 },
      },
    });
    const count = await ctx.prisma.migrationRun.count();
    const validation = await migration.run(intake, "validate");
    expect(validation.totals.CONFLICT).toBe(1);
    expect(await ctx.prisma.migrationRun.count()).toBe(count);
    expect(
      (
        await ctx.prisma.incomingInspection.findUniqueOrThrow({
          where: { id: record.targetId! },
        })
      ).header,
    ).toEqual({ testOnlyEdit: "Preserve this correction" });
    expect(validation.attachments).toHaveLength(2);
    expect(validation.attachments?.every((a) => a.bytesMatch)).toBe(true);
  });
});
