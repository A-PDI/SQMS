import { createPrismaClient } from "@sqms/db";
import {
  ClamdScanner,
  createRedisConnection,
  DisabledEmailAdapter,
  EicarTestScanner,
  loadEnv,
  ObjectStorage,
  QUEUE_NAMES,
  QueueRegistry,
  SmtpEmailAdapter,
  type EmailJob,
  type FileScanJob,
  type MaintenanceJobName,
} from "@sqms/server-core";
import { Worker, type Job } from "bullmq";
import { createLogger, type WorkerContext } from "./context";
import { markEmailFailed, processEmail } from "./processors/email";
import { MAINTENANCE_HANDLERS, MAINTENANCE_SCHEDULES } from "./processors/maintenance";
import { dispatchOutbox, LogIntegrationAdapter, WebhookIntegrationAdapter, type IntegrationAdapter } from "./processors/outbox";
import { markScanFailed, processFileScan } from "./processors/scan";

async function main() {
  const env = loadEnv();
  const log = createLogger(env.LOG_JSON);
  const prisma = createPrismaClient(env.DATABASE_URL, { connectionLimit: Math.max(4, Math.min(env.DATABASE_CONNECTION_LIMIT, 10)) });
  const connection = createRedisConnection(env.REDIS_URL);
  const queues = new QueueRegistry(connection);
  const storage = new ObjectStorage({ endpoint: env.S3_ENDPOINT, region: env.S3_REGION, bucket: env.S3_BUCKET, accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY, forcePathStyle: env.S3_FORCE_PATH_STYLE });
  const scanner = env.SCANNER_MODE === "clamav" ? new ClamdScanner(env.CLAMAV_HOST, env.CLAMAV_PORT, env.CLAMAV_TIMEOUT_MS) : new EicarTestScanner();
  const mailer =
    env.MAIL_TRANSPORT === "smtp"
      ? new SmtpEmailAdapter({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE, requireTLS: env.SMTP_REQUIRE_TLS, user: env.SMTP_USER, password: env.SMTP_PASSWORD, from: env.MAIL_FROM })
      : new DisabledEmailAdapter();
  const ctx: WorkerContext = { env, prisma, storage, scanner, mailer, queues, log };

  await prisma.$connect();
  if (!(await scanner.ping())) log("warn", "malware scanner is not reachable; files will remain quarantined until it is", { scanner: scanner.name });

  const adapters: IntegrationAdapter[] = [new LogIntegrationAdapter(ctx)];
  if (process.env.OUTBOX_WEBHOOK_URL && process.env.OUTBOX_WEBHOOK_SECRET) adapters.push(new WebhookIntegrationAdapter(process.env.OUTBOX_WEBHOOK_URL, process.env.OUTBOX_WEBHOOK_SECRET));

  const workerOpts = { connection, autorun: true };
  const scanWorker = new Worker<FileScanJob>(QUEUE_NAMES.FILE_SCAN, async (job) => processFileScan(ctx, job.data.fileId), { ...workerOpts, concurrency: 2 });
  const emailWorker = new Worker<EmailJob>(QUEUE_NAMES.EMAIL, async (job) => processEmail(ctx, job.data.deliveryId), { ...workerOpts, concurrency: 4 });
  const maintenanceWorker = new Worker(
    QUEUE_NAMES.MAINTENANCE,
    async (job: Job) => {
      const handler = MAINTENANCE_HANDLERS[job.name as MaintenanceJobName];
      if (!handler) throw new Error(`Unknown maintenance job ${job.name}`);
      const count = await handler(ctx);
      if (count) log("info", "maintenance job completed", { job: job.name, count });
      return count;
    },
    { ...workerOpts, concurrency: 1 },
  );
  const outboxWorker = new Worker(QUEUE_NAMES.OUTBOX, async () => dispatchOutbox(ctx, adapters), { ...workerOpts, concurrency: 1 });

  const isFinalFailure = (job: Job | undefined) => !!job && job.attemptsMade >= (job.opts.attempts ?? 1);
  scanWorker.on("failed", (job, err) => {
    log("warn", "scan attempt failed", { fileId: job?.data.fileId, attempt: job?.attemptsMade, error: err.message });
    if (job && isFinalFailure(job)) void markScanFailed(ctx, job.data.fileId, err.message);
  });
  emailWorker.on("failed", (job, err) => {
    if (job && isFinalFailure(job)) void markEmailFailed(ctx, job.data.deliveryId, err.message);
  });
  for (const w of [scanWorker, emailWorker, maintenanceWorker, outboxWorker]) w.on("error", (err) => log("error", "worker error", { error: err.message }));

  const maintenance = queues.get(QUEUE_NAMES.MAINTENANCE);
  for (const s of MAINTENANCE_SCHEDULES) {
    await maintenance.upsertJobScheduler(`schedule:${s.name}`, s.every ? { every: s.every } : { pattern: s.pattern!, tz: "UTC" }, { name: s.name });
  }
  await queues.get(QUEUE_NAMES.OUTBOX).upsertJobScheduler("schedule:outbox", { every: 15_000 }, { name: "dispatch" });
  log("info", "worker started", { scanner: scanner.name, mailer: mailer.name, adapters: adapters.map((a) => a.name) });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log("info", "worker shutting down", { signal });
    await Promise.allSettled([scanWorker.close(), emailWorker.close(), maintenanceWorker.close(), outboxWorker.close()]);
    await queues.close().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    connection.disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(JSON.stringify({ level: "error", component: "worker", message: "worker failed to start", error: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
});
