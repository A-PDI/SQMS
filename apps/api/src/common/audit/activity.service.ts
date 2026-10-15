import { Injectable } from "@nestjs/common";
import type { EntityType, Prisma } from "@sqms/db";
import { RequestContext } from "../context/request-context";
import type { Tx } from "../db/db.service";

export interface ActivityInput {
  entityType: EntityType;
  entityId: string;
  entityLabel?: string;
  verb: string;
  summary: string;
  data?: Record<string, unknown>;
  /** SUPPLIER activity may be shown to the supplier in the portal; INTERNAL never is. */
  visibility?: "INTERNAL" | "SUPPLIER";
  supplierId?: string | null;
  internalPartId?: string | null;
  projectId?: string | null;
}

/** Record-level activity timeline (human-readable history, complementary to the audit trail). */
@Injectable()
export class ActivityService {
  async record(tx: Tx, input: ActivityInput): Promise<void> {
    const actor = RequestContext.get()?.actor ?? null;
    await tx.activityEvent.create({
      data: {
        entityType: input.entityType,
        entityId: input.entityId,
        entityLabel: input.entityLabel?.slice(0, 200) ?? null,
        actorId: actor?.userId ?? null,
        actorName: actor?.displayName ?? "System",
        verb: input.verb,
        summary: input.summary.slice(0, 1000),
        data: (input.data ?? undefined) as Prisma.InputJsonValue | undefined,
        visibility: input.visibility ?? "INTERNAL",
        supplierId: input.supplierId ?? null,
        internalPartId: input.internalPartId ?? null,
        projectId: input.projectId ?? null,
      },
    });
  }
}
