import { Injectable } from "@nestjs/common";
import type { EntityType, Prisma } from "@sqms/db";
import { DbService, type Tx } from "../db/db.service";
import { RequestContext } from "../context/request-context";

export interface AuditInput {
  eventType: string;
  entityType?: EntityType;
  entityId?: string;
  entityLabel?: string;
  changes?: Record<string, { before: unknown; after: unknown }> | null;
  metadata?: Record<string, unknown>;
  reason?: string | null;
  outcome?: "SUCCESS" | "FAILURE" | "DENIED";
  /** For unauthenticated events (e.g. failed login) where no session actor exists. */
  actorEmail?: string;
  actorUserId?: string;
}

function normalize(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return v.toString();
  if (v && typeof v === "object" && "toFixed" in (v as object) && typeof (v as { toString: () => string }).toString === "function" && (v as object).constructor?.name === "Decimal") {
    return (v as { toString: () => string }).toString();
  }
  return v ?? null;
}

/** Computes before/after values for the controlled fields that changed. */
export function diffControlled<T extends Record<string, unknown>>(before: Partial<T>, after: Partial<T>, fields: (keyof T)[]): Record<string, { before: unknown; after: unknown }> | null {
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const f of fields) {
    if (!(f in after)) continue;
    const b = normalize(before[f]);
    const a = normalize(after[f]);
    if (JSON.stringify(b) !== JSON.stringify(a)) changes[f as string] = { before: b, after: a };
  }
  return Object.keys(changes).length ? changes : null;
}

/**
 * Append-only audit writer. Business code passes its transaction client so audit events commit atomically with the
 * change they describe. There is intentionally no update/delete API (database triggers also reject them).
 */
@Injectable()
export class AuditService {
  constructor(private readonly db: DbService) {}

  async record(input: AuditInput, tx?: Tx): Promise<void> {
    const ctx = RequestContext.get();
    const actor = ctx?.actor ?? null;
    const client = tx ?? this.db.client;
    await client.auditEvent.create({
      data: {
        actorType: actor || input.actorUserId ? "USER" : "SYSTEM",
        actorUserId: actor?.userId ?? input.actorUserId ?? null,
        actorEmail: actor?.email ?? input.actorEmail ?? null,
        actorOrganizationId: actor?.organizationId ?? null,
        eventType: input.eventType,
        outcome: input.outcome ?? "SUCCESS",
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        entityLabel: input.entityLabel?.slice(0, 200) ?? null,
        changes: (input.changes ?? undefined) as Prisma.InputJsonValue | undefined,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        reason: input.reason ?? null,
        correlationId: ctx?.correlationId ?? null,
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
      },
    });
  }
}
