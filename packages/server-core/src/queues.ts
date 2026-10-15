/** Background job queue definitions shared by the API (producer) and the worker (consumer). */
import { Queue, type JobsOptions } from "bullmq";
import IORedis from "ioredis";

export const QUEUE_NAMES = {
  FILE_SCAN: "file-scan",
  EMAIL: "email",
  MAINTENANCE: "maintenance",
  OUTBOX: "outbox",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export interface FileScanJob {
  fileId: string;
}

export interface EmailJob {
  deliveryId: string;
}

export type MaintenanceJobName =
  | "sweep-pending-deliveries"
  | "sweep-pending-scans"
  | "task-reminders"
  | "approval-escalation"
  | "scar-escalation"
  | "certification-expiry"
  | "deviation-expiry"
  | "supplier-metrics";

export const DEFAULT_JOB_OPTIONS: Record<QueueName, JobsOptions> = {
  [QUEUE_NAMES.FILE_SCAN]: { attempts: 6, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: 1000, removeOnFail: 5000 },
  [QUEUE_NAMES.EMAIL]: { attempts: 6, backoff: { type: "exponential", delay: 10_000 }, removeOnComplete: 1000, removeOnFail: 5000 },
  [QUEUE_NAMES.MAINTENANCE]: { attempts: 3, backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: 200, removeOnFail: 1000 },
  [QUEUE_NAMES.OUTBOX]: { attempts: 3, backoff: { type: "exponential", delay: 10_000 }, removeOnComplete: 200, removeOnFail: 1000 },
};

/** BullMQ requires maxRetriesPerRequest = null on connections used by workers. */
export function createRedisConnection(url: string): IORedis {
  return new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: false });
}

export class QueueRegistry {
  private readonly queues = new Map<QueueName, Queue>();

  constructor(private readonly connection: IORedis) {}

  get(name: QueueName): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.connection, defaultJobOptions: DEFAULT_JOB_OPTIONS[name] });
      this.queues.set(name, q);
    }
    return q;
  }

  async enqueueFileScan(fileId: string): Promise<void> {
    // jobId makes enqueueing idempotent (re-enqueue of the same file is ignored while the job exists).
    await this.get(QUEUE_NAMES.FILE_SCAN).add("scan", { fileId } satisfies FileScanJob, { jobId: `scan-${fileId}` });
  }

  async enqueueEmail(deliveryId: string): Promise<void> {
    await this.get(QUEUE_NAMES.EMAIL).add("send", { deliveryId } satisfies EmailJob, { jobId: `email-${deliveryId}` });
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    this.queues.clear();
  }
}
