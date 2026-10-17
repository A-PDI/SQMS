import { Inject, Injectable, Logger } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@sqms/db";
import { PRISMA } from "../../infra/tokens";

export type Tx = Prisma.TransactionClient;

export interface AfterCommit {
  /** Registers a side effect (e.g. enqueue a job) that runs only after the transaction commits. */
  add(hook: () => Promise<unknown> | unknown): void;
}

/** Tables that may be row-locked with lockRow (fixed allow-list; never interpolate user input). */
const LOCKABLE = new Set([
  "inspection_plans", "inspection_plan_revisions", "incoming_inspections", "injector_tests", "injector_repair_cases", "injector_repair_attempts", "feature_identities",
  "workflow_instances",
  "document_records",
  "document_revisions",
  "configuration_revisions",
  "product_configurations",
  "product_qualifications",
  "change_requests",
  "sourcing_projects",
  "nonconformances",
  "corrective_actions",
  "supplier_products",
  "suppliers",
  "deviations",
  "required_documents",
]);

@Injectable()
export class DbService {
  private readonly logger = new Logger("Db");

  constructor(@Inject(PRISMA) readonly client: PrismaClient) {}

  /**
   * Runs a business operation in an interactive transaction. After-commit hooks run once the transaction has
   * committed; hook failures are logged (background sweepers provide eventual delivery).
   */
  async tx<T>(fn: (tx: Tx, after: AfterCommit) => Promise<T>, options: { timeoutMs?: number } = {}): Promise<T> {
    const hooks: (() => Promise<unknown> | unknown)[] = [];
    // READ COMMITTED: every statement sees the latest committed data, so reads performed after acquiring a row lock
    // (SELECT ... FOR UPDATE) observe concurrent transactions that committed while we waited. Under REPEATABLE READ
    // the snapshot could predate the lock and serialized decisions would act on stale state.
    const result = await this.client.$transaction((tx) => fn(tx, { add: (h) => hooks.push(h) }), {
      maxWait: 10_000,
      timeout: options.timeoutMs ?? 30_000,
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
    for (const hook of hooks) {
      try {
        await hook();
      } catch (err) {
        this.logger.warn(`after-commit hook failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return result;
  }

  /** Acquires an exclusive row lock (SELECT ... FOR UPDATE) for the remainder of the transaction. */
  async lockRow(tx: Tx, table: string, id: string): Promise<boolean> {
    if (!LOCKABLE.has(table)) throw new Error(`Table ${table} is not lockable`);
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM ${Prisma.raw(`\`${table}\``)} WHERE id = ${id} FOR UPDATE`);
    return rows.length === 1;
  }
}
