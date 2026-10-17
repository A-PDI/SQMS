import type { DisposableTarget, Intake } from "./types";

export function assertDisposableTarget(
  target: DisposableTarget,
  intake: Intake,
  env: Record<string, string | undefined>,
) {
  if (env.NODE_ENV !== "test" && env.NODE_ENV !== "development")
    throw new Error(
      "Migration rehearsals require NODE_ENV=test or development",
    );
  if (
    target.purpose !== "disposable-qms-migration" ||
    target.datasetId !== intake.datasetId
  )
    throw new Error(
      "Explicit disposable target manifest does not match this dataset",
    );
  if (!/^PDI_QMS(?:_[A-Z0-9_]+)?$/.test(target.sourceSystem))
    throw new Error("Invalid source namespace");
  const db = new URL(env.DATABASE_URL ?? "");
  const local = (host: string) =>
    ["127.0.0.1", "localhost", "[::1]"].includes(host);
  if (
    !local(db.hostname) ||
    db.hostname !== target.databaseHost ||
    decodeURIComponent(db.pathname.slice(1)) !== target.databaseName ||
    !/_(test|migration)$/.test(target.databaseName)
  )
    throw new Error(
      "Rehearsals require an explicitly named local _test or _migration database",
    );
  const s3 = new URL(env.S3_ENDPOINT ?? "");
  if (
    !local(s3.hostname) ||
    s3.origin !== new URL(target.storageEndpoint).origin ||
    env.S3_BUCKET !== target.storageBucket ||
    !/-(test|migration)(-files)?$/.test(target.storageBucket)
  )
    throw new Error(
      "Rehearsals require the manifest's isolated local storage and test bucket",
    );
  const redis = new URL(env.REDIS_URL ?? "");
  if (
    !local(redis.hostname) ||
    redis.hostname !== target.redisHost ||
    !Number.isInteger(target.redisDatabase) ||
    target.redisDatabase < 1 ||
    target.redisDatabase > 15 ||
    Number(redis.pathname.slice(1)) !== target.redisDatabase
  )
    throw new Error(
      "Rehearsals require the manifest's isolated loopback Redis database (1–15)",
    );
  if (
    env.SUPPLIER_PORTAL_ENABLED !== "false" ||
    env.MAIL_TRANSPORT !== "disabled" ||
    env.OUTBOX_WEBHOOK_URL ||
    (env.INJECTOR_SHEET_MODE && env.INJECTOR_SHEET_MODE !== "disabled") ||
    env.CARBONZAPP_API_KEY ||
    (env.CARBONZAPP_MODE && env.CARBONZAPP_MODE !== "disabled")
  )
    throw new Error(
      "Disable portal, mail, webhooks and live bench access for migration rehearsals",
    );
}
