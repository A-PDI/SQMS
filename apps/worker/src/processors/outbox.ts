import { createHmac } from "node:crypto";
import type { OutboxEvent } from "@sqms/db";
import type { WorkerContext } from "../context";

/**
 * Integration adapter contract for future ERP / Fishbowl / QuickBooks / Power BI / supplier API connectors.
 * Adapters receive committed domain events from the transactional outbox and must be idempotent (event id).
 */
export interface IntegrationAdapter {
  readonly name: string;
  handles(eventType: string): boolean;
  dispatch(event: OutboxEvent): Promise<void>;
}

/** Default adapter: records dispatch in the worker log. */
export class LogIntegrationAdapter implements IntegrationAdapter {
  readonly name = "log";
  constructor(private readonly ctx: WorkerContext) {}
  handles(): boolean {
    return true;
  }
  async dispatch(event: OutboxEvent): Promise<void> {
    this.ctx.log("info", "integration event", { adapter: this.name, eventId: event.id, eventType: event.eventType, aggregateType: event.aggregateType, aggregateId: event.aggregateId });
  }
}

/** Optional signed webhook adapter (enabled when OUTBOX_WEBHOOK_URL and OUTBOX_WEBHOOK_SECRET are set). */
export class WebhookIntegrationAdapter implements IntegrationAdapter {
  readonly name = "webhook";
  constructor(private readonly url: string, private readonly secret: string) {}
  handles(): boolean {
    return true;
  }
  async dispatch(event: OutboxEvent): Promise<void> {
    const body = JSON.stringify({ id: event.id, type: event.eventType, aggregateType: event.aggregateType, aggregateId: event.aggregateId, occurredAt: event.createdAt.toISOString(), data: event.payload });
    const signature = createHmac("sha256", this.secret).update(body).digest("hex");
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sqms-event-id": event.id, "x-sqms-signature": `sha256=${signature}` },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Webhook responded ${res.status}`);
  }
}

const MAX_ATTEMPTS = 10;

/** Dispatches pending outbox events in creation order. Failures back off exponentially per event. */
export async function dispatchOutbox(ctx: WorkerContext, adapters: IntegrationAdapter[], batchSize = 100): Promise<number> {
  const events = await ctx.prisma.outboxEvent.findMany({ where: { status: "PENDING", availableAt: { lte: new Date() } }, orderBy: { createdAt: "asc" }, take: batchSize });
  let dispatched = 0;
  for (const event of events) {
    try {
      for (const adapter of adapters.filter((a) => a.handles(event.eventType))) await adapter.dispatch(event);
      await ctx.prisma.outboxEvent.update({ where: { id: event.id }, data: { status: "DISPATCHED", dispatchedAt: new Date(), attempts: { increment: 1 }, lastError: null } });
      dispatched++;
    } catch (err) {
      const attempts = event.attempts + 1;
      const message = err instanceof Error ? err.message : String(err);
      await ctx.prisma.outboxEvent.update({
        where: { id: event.id },
        data: { attempts, lastError: message.slice(0, 2000), status: attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING", availableAt: new Date(Date.now() + Math.min(3600_000, 2 ** attempts * 5_000)) },
      });
      ctx.log("warn", "outbox dispatch failed", { eventId: event.id, attempts, error: message });
    }
  }
  return dispatched;
}
