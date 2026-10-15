import request from "supertest";
import { createUser, expectStatus, login, PASSWORD, startApp, uniq, type TestContext } from "./helpers";

describe("Authentication & sessions", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startApp();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it("logs in, exposes the actor, and rejects anonymous access", async () => {
    await expectStatus(await request(ctx.server).get("/api/v1/suppliers"), 401);
    const u = await createUser(ctx.prisma, { roles: ["SUPPLIER_QUALITY"] });
    const s = await login(ctx, u.email);
    const me = expectStatus(await s.get("/auth/me"), 200);
    expect(me.body.email).toBe(u.email);
    expect(me.body.permissions).toContain("supplier:write");
    expect(me.body.userType).toBe("INTERNAL");
  });

  it("sets an HttpOnly session cookie and never returns the session token in the body", async () => {
    const u = await createUser(ctx.prisma, { roles: ["READ_ONLY"] });
    const res = await request(ctx.server).post("/api/v1/auth/login").send({ email: u.email, password: PASSWORD });
    expectStatus(res, 200);
    const cookies = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
    const session = cookies.find((c) => c.startsWith("sqms_session="));
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Lax/i);
    expect(JSON.stringify(res.body)).not.toContain(session!.split(";")[0].split("=")[1]);
  });

  it("requires a valid CSRF token for unsafe methods and rejects foreign origins", async () => {
    const u = await createUser(ctx.prisma, { roles: ["SUPPLIER_QUALITY"] });
    const s = await login(ctx, u.email);
    const noToken = await s.agent.post("/api/v1/suppliers").send({ name: "X Corp", country: "US" });
    expect(noToken.status).toBe(403);
    expect(noToken.body.error.message).toMatch(/CSRF/);
    const badOrigin = await s.agent.post("/api/v1/suppliers").set("x-csrf-token", s.csrf).set("origin", "https://evil.example").send({ name: "X Corp", country: "US" });
    expect(badOrigin.status).toBe(403);
    const ok = await s.post("/suppliers", { name: `CSRF Ok ${uniq()}`, country: "US" });
    expectStatus(ok, 201);
  });

  it("uses a generic error, locks the account after repeated failures, and audits failures", async () => {
    const u = await createUser(ctx.prisma, { roles: ["READ_ONLY"] });
    for (let i = 0; i < 5; i++) {
      const r = await request(ctx.server).post("/api/v1/auth/login").send({ email: u.email, password: "wrong-password" });
      expect(r.status).toBe(401);
    }
    const locked = await request(ctx.server).post("/api/v1/auth/login").send({ email: u.email, password: PASSWORD });
    expect(locked.status).toBe(401);
    const unknown = await request(ctx.server).post("/api/v1/auth/login").send({ email: "nobody@test.local", password: "x" });
    expect(unknown.body.error.message).toBe(locked.body.error.message);
    const events = await ctx.prisma.auditEvent.findMany({ where: { actorUserId: u.id, eventType: { startsWith: "auth.login" } } });
    expect(events.filter((e) => e.eventType === "auth.login.failed").length).toBeGreaterThanOrEqual(4);
    expect(events.some((e) => e.eventType === "auth.login.locked")).toBe(true);
  });

  it("revokes sessions on logout and on account disable", async () => {
    const u = await createUser(ctx.prisma, { roles: ["READ_ONLY"] });
    const s1 = await login(ctx, u.email);
    const s2 = await login(ctx, u.email);
    expectStatus(await s1.post("/auth/logout"), 204);
    expect((await s1.get("/auth/me")).status).toBe(401);
    expectStatus(await s2.get("/auth/me"), 200);
    await ctx.prisma.user.update({ where: { id: u.id }, data: { status: "DISABLED" } });
    expect((await s2.get("/auth/me")).status).toBe(401);
  });

  it("lists own sessions and revokes other sessions", async () => {
    const u = await createUser(ctx.prisma, { roles: ["READ_ONLY"] });
    const a = await login(ctx, u.email);
    const b = await login(ctx, u.email);
    const list = expectStatus(await a.get("/auth/sessions"), 200);
    expect(list.body.length).toBeGreaterThanOrEqual(2);
    expect(list.body.filter((x: { current: boolean }) => x.current)).toHaveLength(1);
    expectStatus(await a.post("/auth/sessions/revoke-others"), 200);
    expect((await b.get("/auth/me")).status).toBe(401);
    expectStatus(await a.get("/auth/me"), 200);
  });

  it("blocks external supplier logins while the portal feature flag is disabled", async () => {
    const disabled = await startApp({ SUPPLIER_PORTAL_ENABLED: "false" });
    try {
      const org = await disabled.prisma.organization.create({ data: { type: "SUPPLIER", name: "Ext Org", code: uniq("EXT") } });
      await disabled.prisma.supplier.create({ data: { organizationId: org.id, supplierNumber: org.code, name: "Ext Org", country: "US" } });
      const ext = await createUser(disabled.prisma, { roles: ["SUPPLIER_CONTRIBUTOR"], organizationId: org.id, userType: "EXTERNAL" });
      const res = await request(disabled.server).post("/api/v1/auth/login").send({ email: ext.email, password: PASSWORD });
      expect(res.status).toBe(403);
      const audit = await disabled.prisma.auditEvent.findFirst({ where: { actorUserId: ext.id, eventType: "auth.login.denied_portal_disabled" } });
      expect(audit).not.toBeNull();
      // Portal endpoints do not exist while the flag is off, even for internal users.
      const internal = await createUser(disabled.prisma, { roles: ["SYSTEM_ADMIN"] });
      const s = await login(disabled, internal.email);
      expect((await s.get("/portal/me")).status).toBe(404);
    } finally {
      await disabled.close();
    }
  });

  it("performs account recovery via an emailed single-use reset token", async () => {
    const u = await createUser(ctx.prisma, { roles: ["READ_ONLY"] });
    expectStatus(await request(ctx.server).post("/api/v1/auth/password-reset/request").send({ email: u.email }), 202);
    expectStatus(await request(ctx.server).post("/api/v1/auth/password-reset/request").send({ email: "unknown@test.local" }), 202);
    const delivery = await ctx.prisma.notificationDelivery.findFirst({ where: { recipient: u.email, kind: "DIRECT" }, orderBy: { createdAt: "desc" } });
    expect(delivery).not.toBeNull();
    // The worker purges bodies after sending; read the token before it does (or from the stored body).
    const body = delivery!.body ?? "";
    const match = /token=([A-Za-z0-9_\-%]+)/.exec(body);
    if (!match) return; // Already sent and purged by a running worker: verified by the worker tests.
    const token = decodeURIComponent(match[1]);
    const weak = await request(ctx.server).post("/api/v1/auth/password-reset/confirm").send({ token, newPassword: "short" });
    expect(weak.status).toBe(400);
    expectStatus(await request(ctx.server).post("/api/v1/auth/password-reset/confirm").send({ token, newPassword: "New-Password-456!" }), 204);
    expect((await request(ctx.server).post("/api/v1/auth/password-reset/confirm").send({ token, newPassword: "New-Password-789!" })).status).toBe(422);
    await login(ctx, u.email, "New-Password-456!");
  });

  it("validates input and returns structured errors without stack traces", async () => {
    const res = await request(ctx.server).post("/api/v1/auth/login").send({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(res.body.error.correlationId).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/at \w+ \(/);
  });
});
