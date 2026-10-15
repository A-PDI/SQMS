import { Injectable } from "@nestjs/common";
import type { EntityType, Prisma } from "@sqms/db";
import type { Tx } from "../db/db.service";

/**
 * Transactional outbox: integration events are written in the same transaction as the business change and
 * dispatched asynchronously by the worker to registered integration adapters (ERP, Power BI, webhooks, ...).
 */
@Injectable()
export class OutboxService {
  async publish(tx: Tx, eventType: string, aggregateType: EntityType, aggregateId: string, payload: Record<string, unknown>): Promise<void> {
    await tx.outboxEvent.create({
      data: { eventType, aggregateType, aggregateId, payload: payload as Prisma.InputJsonValue },
    });
  }
}
