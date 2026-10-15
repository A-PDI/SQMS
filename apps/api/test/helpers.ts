import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { createPrismaClient, hashPassword, type PrismaClient } from "@sqms/db";
import { loadEnv } from "@sqms/server-core";
import request from "supertest";
import type TestAgent from "supertest/lib/agent";
import { createApp } from "../src/bootstrap";
import { TEST_ENV } from "./test-env";

export const PASSWORD = "Test-Password-123!";
let seq = 0;
export const uniq = (p = "t") => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

export interface TestContext {
  app: INestApplication;
  server: ReturnType<INestApplication["getHttpServer"]>;
  prisma: PrismaClient;
  close(): Promise<void>;
}

export async function startApp(overrides: Record<string, string> = {}): Promise<TestContext> {
  const env = loadEnv({ ...process.env, ...TEST_ENV, ...overrides });
  const app = await createApp(env);
  await app.init();
  const prisma = createPrismaClient(env.DATABASE_URL, { connectionLimit: 3 });
  return {
    app,
    server: app.getHttpServer(),
    prisma,
    async close() {
      await prisma.$disconnect();
      await app.close();
    },
  };
}

/** Authenticated HTTP session: keeps the cookie jar and sends the CSRF header on unsafe methods. */
export class Session {
  constructor(
    readonly agent: TestAgent,
    readonly csrf: string,
    readonly userId: string,
  ) {}

  get(url: string) {
    return this.agent.get(`/api/v1${url}`);
  }
  post(url: string, body?: object) {
    return this.agent.post(`/api/v1${url}`).set("x-csrf-token", this.csrf).send(body ?? {});
  }
  patch(url: string, body?: object) {
    return this.agent.patch(`/api/v1${url}`).set("x-csrf-token", this.csrf).send(body ?? {});
  }
  put(url: string, body?: object) {
    return this.agent.put(`/api/v1${url}`).set("x-csrf-token", this.csrf).send(body ?? {});
  }
  delete(url: string) {
    return this.agent.delete(`/api/v1${url}`).set("x-csrf-token", this.csrf);
  }
  upload(url: string, filename: string, content: Buffer, fields: Record<string, string> = {}) {
    let r = this.agent.post(`/api/v1${url}`).set("x-csrf-token", this.csrf);
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    return r.attach("file", content, filename);
  }
}

export async function login(ctx: TestContext, email: string, password = PASSWORD): Promise<Session> {
  const agent = request.agent(ctx.server);
  const res = await agent.post("/api/v1/auth/login").send({ email, password });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  const me = await agent.get("/api/v1/auth/me");
  return new Session(agent, res.body.csrfToken, me.body.id);
}

export async function createUser(
  prisma: PrismaClient,
  opts: { roles: string[]; email?: string; displayName?: string; organizationId?: string; userType?: "INTERNAL" | "EXTERNAL"; status?: "ACTIVE" | "DISABLED" },
): Promise<{ id: string; email: string }> {
  const email = opts.email ?? `${uniq("user")}@test.local`;
  const orgId = opts.organizationId ?? (await prisma.organization.findUniqueOrThrow({ where: { code: "INTERNAL" } })).id;
  const roles = await prisma.role.findMany({ where: { key: { in: opts.roles } } });
  if (roles.length !== opts.roles.length) throw new Error(`Unknown roles in ${opts.roles.join(",")}`);
  const user = await prisma.user.create({
    data: {
      email,
      displayName: opts.displayName ?? email.split("@")[0],
      userType: opts.userType ?? "INTERNAL",
      status: opts.status ?? "ACTIVE",
      passwordHash: await hashPassword(PASSWORD),
      memberships: { create: { organizationId: orgId, roles: { create: roles.map((r) => ({ roleId: r.id })) } } },
    },
  });
  return { id: user.id, email };
}

/** Internal team used across tests (distinct people so separation of duties holds). */
export async function createTeam(ctx: TestContext) {
  const mk = async (roles: string[], name: string) => {
    const u = await createUser(ctx.prisma, { roles, displayName: name });
    return { ...u, session: await login(ctx, u.email) };
  };
  return {
    sourcing: await mk(["SOURCING"], "Sam Sourcing"),
    engineer: await mk(["ENGINEERING"], "Erin Engineer"),
    quality: await mk(["SUPPLIER_QUALITY"], "Quinn Quality"),
    quality2: await mk(["SUPPLIER_QUALITY"], "Quentin Quality"),
    manager: await mk(["APPROVER"], "Morgan Manager"),
    readOnly: await mk(["READ_ONLY"], "Riley Reader"),
  };
}

export type Team = Awaited<ReturnType<typeof createTeam>>;

export function expectStatus(res: request.Response, status: number): request.Response {
  if (res.status !== status) {
    throw new Error(`Expected HTTP ${status} but got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res;
}

export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 30_000, intervalMs = 250): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
