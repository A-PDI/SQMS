import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { Actor } from "../auth/actor";

export interface RequestStore {
  correlationId: string;
  ipAddress: string | null;
  userAgent: string | null;
  actor: Actor | null;
}

const storage = new AsyncLocalStorage<RequestStore>();

export const RequestContext = {
  run<T>(store: RequestStore, fn: () => T): T {
    return storage.run(store, fn);
  },
  get(): RequestStore | undefined {
    return storage.getStore();
  },
  setActor(actor: Actor | null): void {
    const s = storage.getStore();
    if (s) s.actor = actor;
  },
  correlationId(): string | null {
    return storage.getStore()?.correlationId ?? null;
  },
};

const VALID_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Express middleware establishing the per-request context and X-Request-Id correlation header. */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header("x-request-id");
  const correlationId = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader("X-Request-Id", correlationId);
  const ua = req.header("user-agent");
  RequestContext.run({ correlationId, ipAddress: req.ip ?? null, userAgent: ua ? ua.slice(0, 400) : null, actor: null }, () => next());
}
