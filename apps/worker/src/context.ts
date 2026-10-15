import type { PrismaClient } from "@sqms/db";
import type { AppEnv, EmailAdapter, MalwareScanner, ObjectStorage, QueueRegistry } from "@sqms/server-core";

/** Dependencies shared by all job processors. */
export interface WorkerContext {
  env: AppEnv;
  prisma: PrismaClient;
  storage: ObjectStorage;
  scanner: MalwareScanner;
  mailer: EmailAdapter;
  queues: QueueRegistry;
  log: (level: "info" | "warn" | "error", message: string, meta?: Record<string, unknown>) => void;
}

/** Structured JSON logger (one line per event). */
export function createLogger(json: boolean) {
  return (level: "info" | "warn" | "error", message: string, meta?: Record<string, unknown>) => {
    const entry = { ts: new Date().toISOString(), level, component: "worker", message, ...(meta ?? {}) };
    const line = json ? JSON.stringify(entry) : `${entry.ts} ${level.toUpperCase()} ${message}${meta ? ` ${JSON.stringify(meta)}` : ""}`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  };
}
