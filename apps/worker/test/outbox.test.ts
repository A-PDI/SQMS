import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { OutboxEvent } from "@sqms/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WorkerContext } from "../src/context";
import { dispatchOutbox, WebhookIntegrationAdapter, type IntegrationAdapter } from "../src/processors/outbox";

const event = (id: string, attempts = 0): OutboxEvent =>
  ({ id, eventType: "product_approval.granted", aggregateType: "PRODUCT_APPROVAL", aggregateId: `agg-${id}`, payload: { number: "PA-2026-0001" }, status: "PENDING", attempts, availableAt: new Date(0), createdAt: new Date("2026-10-15T00:00:00Z") }) as unknown as OutboxEvent;

function fakeContext(events: OutboxEvent[]) {
  const update = vi.fn().mockResolvedValue({});
  const ctx = { prisma: { outboxEvent: { findMany: vi.fn().mockResolvedValue(events), update } }, log: vi.fn() } as unknown as WorkerContext;
  return { ctx, update };
}

describe("WebhookIntegrationAdapter", () => {
  let server: Server;
  let url = "";
  let status = 200;
  const received: { headers: IncomingMessage["headers"]; body: string }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push({ headers: req.headers, body });
        res.writeHead(status).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("posts the event with an HMAC-SHA256 signature of the exact body", async () => {
    status = 200;
    await new WebhookIntegrationAdapter(url, "s3cret").dispatch(event("e1"));
    const last = received.at(-1)!;
    expect(last.headers["x-sqms-event-id"]).toBe("e1");
    expect(last.headers["x-sqms-signature"]).toBe(`sha256=${createHmac("sha256", "s3cret").update(last.body).digest("hex")}`);
    expect(JSON.parse(last.body)).toMatchObject({ id: "e1", type: "product_approval.granted", aggregateId: "agg-e1", data: { number: "PA-2026-0001" } });
  });

  it("fails on a non-2xx response so the event is retried", async () => {
    status = 503;
    await expect(new WebhookIntegrationAdapter(url, "s3cret").dispatch(event("e2"))).rejects.toThrow("Webhook responded 503");
  });
});

describe("dispatchOutbox", () => {
  const ok: IntegrationAdapter = { name: "ok", handles: () => true, dispatch: vi.fn().mockResolvedValue(undefined) };

  it("marks delivered events as dispatched", async () => {
    const { ctx, update } = fakeContext([event("a"), event("b")]);
    expect(await dispatchOutbox(ctx, [ok])).toBe(2);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "a" }, data: expect.objectContaining({ status: "DISPATCHED" }) }));
  });

  it("backs off failed events exponentially and gives up after ten attempts", async () => {
    const failing: IntegrationAdapter = { name: "down", handles: () => true, dispatch: vi.fn().mockRejectedValue(new Error("connection refused")) };
    const { ctx, update } = fakeContext([event("c", 0), event("d", 9)]);
    const before = Date.now();
    expect(await dispatchOutbox(ctx, [failing])).toBe(0);
    const first = update.mock.calls[0][0].data;
    expect(first).toMatchObject({ attempts: 1, status: "PENDING", lastError: "connection refused" });
    expect(first.availableAt.getTime()).toBeGreaterThanOrEqual(before + 10_000);
    expect(update.mock.calls[1][0].data).toMatchObject({ attempts: 10, status: "FAILED" });
  });

  it("only calls adapters that handle the event type", async () => {
    const other: IntegrationAdapter = { name: "other", handles: (t) => t.startsWith("ncr."), dispatch: vi.fn() };
    const { ctx } = fakeContext([event("e")]);
    await dispatchOutbox(ctx, [other, ok]);
    expect(other.dispatch).not.toHaveBeenCalled();
  });
});
