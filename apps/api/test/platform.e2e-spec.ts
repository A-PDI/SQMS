import request from "supertest";
import { createApprovedSupplier, createProject, decideAll, fulfillRequirement, approveIntake } from "./flows";
import { createTeam, createUser, expectStatus, login, PASSWORD, startApp, uniq, waitFor, type Session, type Team, type TestContext } from "./helpers";

const MAILPIT = process.env.TEST_MAILPIT_URL ?? "http://127.0.0.1:8025";

async function mailTo(address: string): Promise<string> {
  return waitFor(
    async () => {
      const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`);
      if (!res.ok) return null;
      const list = (await res.json()) as { messages: { ID: string }[] };
      if (!list.messages.length) return null;
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${list.messages[0].ID}`)).json()) as { Text: string };
      return msg.Text;
    },
    60_000,
    500,
  );
}

describe("Platform services: tasks, collaboration, administration, audit, reports and search", () => {
  let ctx: TestContext;
  let team: Team;
  let admin: { id: string; email: string; session: Session };
  let supplier: Awaited<ReturnType<typeof createApprovedSupplier>>;

  beforeAll(async () => {
    ctx = await startApp();
    team = await createTeam(ctx);
    const u = await createUser(ctx.prisma, { roles: ["SYSTEM_ADMIN"], displayName: "Ada Admin" });
    admin = { ...u, session: await login(ctx, u.email) };
    supplier = await createApprovedSupplier(ctx, team);
  });
  afterAll(async () => {
    await ctx.close();
  });

  describe("tasks", () => {
    it("creates, claims and completes manual tasks and protects approval tasks", async () => {
      const task = expectStatus(await team.quality.session.post("/tasks", { title: "Review supplier audit report", type: "REVIEW", assigneeRoleKey: "ENGINEERING", dueAt: "2026-11-01T12:00:00Z", entityType: "SUPPLIER", entityId: supplier.supplier.id }), 201).body;
      expect(task.entityLabel).toContain(supplier.supplier.name);
      const mine = expectStatus(await team.engineer.session.get("/tasks?pageSize=100"), 200).body;
      expect(mine.items.map((t: { id: string }) => t.id)).toContain(task.id);
      expect((await team.readOnly.session.patch(`/tasks/${task.id}`, { status: "DONE" })).status).toBe(403);
      // An engineer claims the role task, then completes it.
      expectStatus(await team.engineer.session.patch(`/tasks/${task.id}`, { assigneeUserId: team.engineer.id }), 200);
      expect((await team.engineer.session.patch(`/tasks/${task.id}`, { assigneeUserId: team.quality2.id })).status).toBe(403);
      const done = expectStatus(await team.engineer.session.patch(`/tasks/${task.id}`, { status: "DONE" }), 200).body;
      expect(done.status).toBe("DONE");
      expect(done.completedById).toBe(team.engineer.id);
      expect((await team.engineer.session.post("/tasks", { title: "No assignee", type: "ACTION" })).status).toBe(422);
      expect((await team.quality.session.post("/tasks", { title: "Bad entity", type: "ACTION", assigneeUserId: team.engineer.id, entityType: "NCR", entityId: "00000000-0000-7000-8000-000000000000" })).status).toBe(404);

      // Approval tasks follow their approval and cannot be closed manually.
      const q = expectStatus(await team.quality.session.post(`/suppliers/${supplier.supplier.id}/qualifications`, { type: "PERIODIC_REVIEW", proposedStatus: "APPROVED", summary: "Annual review" }), 201).body;
      expectStatus(await team.quality.session.post(`/supplier-qualifications/${q.id}/submit`, { expectedVersion: q.version }), 201);
      const approvalTask = await ctx.prisma.task.findFirstOrThrow({ where: { entityId: q.id, type: "APPROVAL", status: "OPEN" } });
      const blocked = await team.quality2.session.patch(`/tasks/${approvalTask.id}`, { status: "DONE" });
      expect(blocked.status).toBe(409);
      await decideAll(ctx, team, q.id);
      expect((await ctx.prisma.task.findUniqueOrThrow({ where: { id: approvalTask.id } })).status).toBe("DONE");
      const summary = expectStatus(await team.engineer.session.get("/tasks/summary"), 200).body;
      expect(summary).toEqual(expect.objectContaining({ open: expect.any(Number), overdue: expect.any(Number), approvals: expect.any(Number) }));
    });

    it("completes document submission tasks automatically when the requirement is accepted", async () => {
      const p = await createProject(ctx, team, { pathway: "B", supplierId: supplier.supplier.id, siteId: supplier.site.id });
      await approveIntake(ctx, team, p.id);
      const req = await ctx.prisma.requiredDocument.findFirstOrThrow({ where: { projectId: p.id, documentType: { code: "ENG-04" } } });
      const task = await ctx.prisma.task.findFirstOrThrow({ where: { requiredDocumentId: req.id } });
      expect(task.status).toBe("OPEN");
      expect((await team.engineer.session.patch(`/tasks/${task.id}`, { assigneeUserId: team.engineer.id })).status).toBe(200);
      expect((await team.engineer.session.patch(`/tasks/${task.id}`, { status: "DONE" })).status).toBe(422);
      await fulfillRequirement(ctx, team, req.id);
      expect((await ctx.prisma.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("DONE");
    });
  });

  describe("comments, activity, notifications and saved views", () => {
    it("separates internal and supplier-visible comments and audits edits", async () => {
      const ref = { entityType: "SUPPLIER", entityId: supplier.supplier.id };
      const internal = expectStatus(await team.quality.session.post("/comments", { ...ref, body: "Consider dual sourcing; pricing is not competitive" }), 201).body;
      expect(internal.visibility).toBe("INTERNAL");
      const shared = expectStatus(await team.quality.session.post("/comments", { ...ref, body: "Please send the updated quality manual", visibility: "SUPPLIER" }), 201).body;
      expect((await team.quality.session.post("/comments", { ...ref, body: "Reply leaking internal", visibility: "SUPPLIER", parentId: internal.id })).status).toBe(422);
      const sup = await ctx.prisma.supplier.findUniqueOrThrow({ where: { id: supplier.supplier.id } });
      const ext = await createUser(ctx.prisma, { roles: ["SUPPLIER_CONTRIBUTOR"], organizationId: sup.organizationId, userType: "EXTERNAL" });
      const extSession = await login(ctx, ext.email);
      const seen = expectStatus(await extSession.get(`/comments?entityType=SUPPLIER&entityId=${supplier.supplier.id}`), 200).body as { id: string }[];
      expect(seen.map((c) => c.id)).toEqual([shared.id]);
      const reply = expectStatus(await extSession.post("/comments", { ...ref, body: "Manual attached in the portal", parentId: shared.id }), 201).body;
      expect(reply.visibility).toBe("SUPPLIER");
      expect((await extSession.post("/comments", { ...ref, body: "Trying internal", visibility: "INTERNAL" })).status).toBe(403);
      const other = await createApprovedSupplier(ctx, team);
      expect((await extSession.get(`/comments?entityType=SUPPLIER&entityId=${other.supplier.id}`)).status).toBe(404);

      expect((await team.quality2.session.patch(`/comments/${internal.id}`, { body: "Not my comment" })).status).toBe(403);
      expectStatus(await team.quality.session.patch(`/comments/${internal.id}`, { body: "Consider dual sourcing" }), 200);
      const audit = await ctx.prisma.auditEvent.findFirstOrThrow({ where: { eventType: "comment.edited", entityId: supplier.supplier.id } });
      expect((audit.changes as { body: { before: string } }).body.before).toContain("pricing");
      expectStatus(await team.quality.session.delete(`/comments/${internal.id}`), 204);
      const after = expectStatus(await team.quality.session.get(`/comments?entityType=SUPPLIER&entityId=${supplier.supplier.id}`), 200).body as { id: string; deleted: boolean; body: string | null }[];
      expect(after.find((c) => c.id === internal.id)).toEqual(expect.objectContaining({ deleted: true, body: null }));
    });

    it("shows record timelines with supplier filtering", async () => {
      const internal = expectStatus(await team.quality.session.get(`/activity/SUPPLIER/${supplier.supplier.id}?pageSize=200`), 200).body;
      expect(internal.items.length).toBeGreaterThan(0);
      const sup = await ctx.prisma.supplier.findUniqueOrThrow({ where: { id: supplier.supplier.id } });
      const ext = await createUser(ctx.prisma, { roles: ["SUPPLIER_READ_ONLY"], organizationId: sup.organizationId, userType: "EXTERNAL" });
      const extSession = await login(ctx, ext.email);
      const external = expectStatus(await extSession.get(`/activity/SUPPLIER/${supplier.supplier.id}?pageSize=200`), 200).body;
      expect(external.items.every((e: { visibility: string }) => e.visibility === "SUPPLIER")).toBe(true);
      expect(external.items.length).toBeLessThan(internal.items.length);
    });

    it("lists, reads and configures notifications", async () => {
      const list = expectStatus(await team.quality2.session.get("/notifications?unread=true"), 200).body;
      expect(list.unread).toBeGreaterThan(0);
      const first = list.items[0];
      expectStatus(await team.quality2.session.post(`/notifications/${first.id}/read`), 200);
      expect((await team.engineer.session.post(`/notifications/${first.id}/read`)).status).toBe(404);
      const all = expectStatus(await team.quality2.session.post("/notifications/read-all"), 200).body;
      expect(all.updated).toBeGreaterThanOrEqual(0);
      expect(expectStatus(await team.quality2.session.get("/notifications/unread-count"), 200).body.unread).toBe(0);

      expect((await team.quality2.session.put("/notifications/preferences", { items: [{ eventType: "made.up", channel: "EMAIL", enabled: false }] })).status).toBe(422);
      const prefs = expectStatus(await team.quality2.session.put("/notifications/preferences", { items: [{ eventType: "approval.requested", channel: "EMAIL", enabled: false }] }), 200).body;
      expect(prefs.events.find((e: { eventType: string }) => e.eventType === "approval.requested").EMAIL).toBe(false);
      // The preference suppresses email deliveries for that event type.
      const before = await ctx.prisma.notificationDelivery.count({ where: { notification: { userId: team.quality2.id, eventType: "approval.requested" } } });
      const q = expectStatus(await team.quality.session.post(`/suppliers/${supplier.supplier.id}/qualifications`, { type: "PERIODIC_REVIEW", proposedStatus: "APPROVED", summary: "Second review" }), 201).body;
      expectStatus(await team.quality.session.post(`/supplier-qualifications/${q.id}/submit`, { expectedVersion: q.version }), 201);
      expect(await ctx.prisma.notification.count({ where: { userId: team.quality2.id, eventType: "approval.requested", entityId: q.id } })).toBe(1);
      expect(await ctx.prisma.notificationDelivery.count({ where: { notification: { userId: team.quality2.id, eventType: "approval.requested" } } })).toBe(before);
      await decideAll(ctx, team, q.id);
    });

    it("saves personal and shared list views", async () => {
      const v = expectStatus(await team.quality.session.post("/saved-views", { module: "ncrs", name: "Open critical", filters: { status: ["OPEN"], severity: ["CRITICAL"] }, isShared: true }), 201).body;
      expectStatus(await team.engineer.session.post("/saved-views", { module: "ncrs", name: "Mine", filters: { owner: "me" } }), 201);
      const forEngineer = expectStatus(await team.engineer.session.get("/saved-views?module=ncrs"), 200).body as { id: string; name: string }[];
      expect(forEngineer.map((x) => x.name).sort()).toEqual(["Mine", "Open critical"]);
      expect((await team.engineer.session.patch(`/saved-views/${v.id}`, { name: "Hijack" })).status).toBe(404);
      expectStatus(await team.quality.session.delete(`/saved-views/${v.id}`), 204);
      expect((await team.quality.session.post("/saved-views", { module: "NCRS!", name: "x", filters: {} })).status).toBe(400);
    });
  });

  describe("administration", () => {
    it("requires administrator permissions", async () => {
      for (const path of ["/admin/users", "/admin/roles", "/admin/settings", "/admin/workflows", "/admin/applicability-policies"]) {
        expect((await team.quality.session.get(path)).status).toBe(403);
        expect((await admin.session.get(path)).status).toBe(200);
      }
    });

    it("invites a user by email and lets them set a password", async () => {
      const email = `${uniq("invitee")}@test.local`;
      const inv = expectStatus(await admin.session.post("/admin/invitations", { email, displayName: "Ivy Invitee", roleKeys: ["READ_ONLY"] }), 201).body;
      expect(inv.token).toBeUndefined();
      expect((await admin.session.post("/admin/invitations", { email: `${uniq()}@test.local`, roleKeys: ["SUPPLIER_ADMIN"] })).status).toBe(422);
      const text = await mailTo(email);
      const token = /token=([A-Za-z0-9_-]+)/.exec(text)?.[1];
      expect(token).toBeTruthy();
      const agent = request(ctx.server);
      expectStatus(await agent.get(`/api/v1/auth/invitations/lookup?token=${token}`), 200);
      expectStatus(await agent.post("/api/v1/auth/invitations/accept").send({ token, password: PASSWORD }), 204);
      const s = await login(ctx, email);
      const me = expectStatus(await s.get("/auth/me"), 200).body;
      expect(me.roles).toEqual(["READ_ONLY"]);
      const list = expectStatus(await admin.session.get(`/admin/invitations?q=${encodeURIComponent(email)}`), 200).body;
      expect(list.items[0].status).toBe("ACCEPTED");
    });

    it("disables users immediately and protects administrator access", async () => {
      const u = await createUser(ctx.prisma, { roles: ["ENGINEERING"] });
      const s = await login(ctx, u.email);
      expectStatus(await s.get("/auth/me"), 200);
      expect((await admin.session.post(`/admin/users/${u.id}/status`, { status: "DISABLED", reason: "x" })).status).toBe(400);
      expectStatus(await admin.session.post(`/admin/users/${u.id}/status`, { status: "DISABLED", reason: "Left the company" }), 201);
      expect((await s.get("/auth/me")).status).toBe(401);
      expect((await request(ctx.server).post("/api/v1/auth/login").send({ email: u.email, password: PASSWORD })).status).toBe(401);
      expect((await admin.session.post(`/admin/users/${admin.id}/status`, { status: "DISABLED", reason: "Self disable attempt" })).status).toBe(422);
      expect((await admin.session.put(`/admin/users/${admin.id}/roles`, { roleKeys: ["READ_ONLY"], reason: "Self demotion attempt" })).status).toBe(422);

      // Role changes apply on the next request; supplier roles cannot be granted to internal users.
      const r = await createUser(ctx.prisma, { roles: ["READ_ONLY"] });
      const rs = await login(ctx, r.email);
      expect((await rs.post("/ncrs", {})).status).toBe(403);
      expect((await admin.session.put(`/admin/users/${r.id}/roles`, { roleKeys: ["SUPPLIER_ADMIN"], reason: "Wrong scope" })).status).toBe(422);
      const updated = expectStatus(await admin.session.put(`/admin/users/${r.id}/roles`, { roleKeys: ["SUPPLIER_QUALITY"], reason: "Joined supplier quality" }), 200).body;
      expect(updated.memberships[0].roles.map((x: { role: { key: string } }) => x.role.key)).toEqual(["SUPPLIER_QUALITY"]);
      expect((await rs.post("/ncrs", {})).status).toBe(400);
      const event = await ctx.prisma.auditEvent.findFirstOrThrow({ where: { eventType: "admin.user.roles_changed", entityId: r.id } });
      expect(event.changes).toEqual({ roles: { before: ["READ_ONLY"], after: ["SUPPLIER_QUALITY"] } });
    });

    it("never grants internal-only permissions to supplier roles", async () => {
      const roles = expectStatus(await admin.session.get("/admin/roles"), 200).body as { id: string; key: string; permissions: string[] }[];
      const supplierRole = roles.find((r) => r.key === "SUPPLIER_CONTRIBUTOR")!;
      const bad = await admin.session.put(`/admin/roles/${supplierRole.id}/permissions`, { permissionKeys: [...supplierRole.permissions, "ncr:disposition"], reason: "Testing scope guard" });
      expect(bad.status).toBe(422);
      const sysAdmin = roles.find((r) => r.key === "SYSTEM_ADMIN")!;
      expect((await admin.session.put(`/admin/roles/${sysAdmin.id}/permissions`, { permissionKeys: [], reason: "Lock everyone out" })).status).toBe(422);
      const custom = expectStatus(await admin.session.post("/admin/roles", { key: uniq("AUDITOR_").toUpperCase(), name: "Auditor", scope: "INTERNAL", permissionKeys: ["audit:read", "supplier:read"] }), 201).body;
      expect(custom.isSystem).toBe(false);
    });

    it("validates settings, numbering and retention changes and records them in the audit trail", async () => {
      expect((await admin.session.put("/admin/settings/scar.defaultResponseDays", { value: -3 })).status).toBe(422);
      expect((await admin.session.put("/admin/settings/unknown.key", { value: 1 })).status).toBe(404);
      const matrix = (await ctx.prisma.systemSetting.findUniqueOrThrow({ where: { key: "qualification.workflowMatrix" } })).value as Record<string, Record<string, string>>;
      expect((await admin.session.put("/admin/settings/qualification.workflowMatrix", { value: { ...matrix, A: { ...matrix.A, LOW: "no-such-workflow" } } })).status).toBe(422);
      const original = (await ctx.prisma.systemSetting.findUniqueOrThrow({ where: { key: "scar.defaultResponseDays" } })).value;
      expectStatus(await admin.session.put("/admin/settings/scar.defaultResponseDays", { value: 21 }), 200);
      const scar = expectStatus(await team.quality.session.post("/scars", { title: "Window test", supplierId: supplier.supplier.id, problemDescription: "Checks the configured response window", severity: "MINOR" }), 201).body;
      const expected = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) + 21 * 86_400_000).toISOString().slice(0, 10);
      expect(scar.responseDueDate.slice(0, 10)).toBe(expected);
      expectStatus(await admin.session.put("/admin/settings/scar.defaultResponseDays", { value: original }), 200);

      expect((await admin.session.patch("/admin/numbering/NCR", { pattern: "{prefix}-{bogus}" })).status).toBe(422);
      const seq = expectStatus(await admin.session.patch("/admin/numbering/NCR", { padding: 5 }), 200).body;
      expect(seq.padding).toBe(5);
      expectStatus(await admin.session.patch("/admin/numbering/NCR", { padding: 4 }), 200);

      const policies = expectStatus(await admin.session.get("/admin/retention-policies"), 200).body as { id: string; retentionMonths: number | null; trigger: string }[];
      // No retention period is assumed by the system; it must be defined by company policy.
      expect(policies.every((p) => p.retentionMonths === null)).toBe(true);
      expect((await admin.session.patch(`/admin/retention-policies/${policies[0].id}`, { retentionMonths: 120, trigger: "UNDEFINED", reason: "Company policy QP-12" })).status).toBe(422);
      const set = expectStatus(await admin.session.patch(`/admin/retention-policies/${policies[0].id}`, { retentionMonths: 120, trigger: "FROM_SUPERSESSION", reason: "Company policy QP-12" }), 200).body;
      expect(set.retentionMonths).toBe(120);
      const events = await ctx.prisma.auditEvent.findMany({ where: { eventType: { in: ["admin.setting.updated", "admin.numbering.updated", "admin.retention_policy.updated"] }, actorUserId: admin.id } });
      expect(events.length).toBeGreaterThanOrEqual(4);
    });

    it("versions applicability policies and keeps active versions immutable", async () => {
      const policies = expectStatus(await admin.session.get("/admin/applicability-policies"), 200).body as { id: string; versions: { id: string; status: string; version: number }[] }[];
      const policy = policies[0];
      const active = policy.versions.find((v) => v.status === "ACTIVE")!;
      const activeDetail = expectStatus(await admin.session.get(`/admin/applicability-policies/versions/${active.id}`), 200).body;
      expect((await admin.session.put(`/admin/applicability-policies/versions/${active.id}/rules`, { rules: [] })).status).toBe(409);
      const draft = expectStatus(await admin.session.post(`/admin/applicability-policies/${policy.id}/versions`, { notes: "Require OPS-02 for high risk" }), 201).body;
      expect(draft.status).toBe("DRAFT");
      expect(draft.rules.length).toBe(activeDetail.rules.length);
      expect((await admin.session.post(`/admin/applicability-policies/${policy.id}/versions`, {})).status).toBe(409);
      const rules = draft.rules.map((r: { documentType: { code: string }; outcome: string; priority: number; conditions: object; reason: string; dueOffsetDays: number | null; defaultAssigneeRoleKey: string | null }) => ({
        documentTypeCode: r.documentType.code,
        outcome: r.outcome,
        priority: r.priority,
        conditions: r.conditions,
        reason: r.reason,
        ...(r.dueOffsetDays !== null ? { dueOffsetDays: r.dueOffsetDays } : {}),
        ...(r.defaultAssigneeRoleKey ? { defaultAssigneeRoleKey: r.defaultAssigneeRoleKey } : {}),
      }));
      const invalid = await admin.session.put(`/admin/applicability-policies/versions/${draft.id}/rules`, { rules: [...rules, { documentTypeCode: "OPS-02", outcome: "REQUIRED", priority: 20, conditions: { field: "colour", op: "eq", value: "red" }, reason: "Invalid field" }] });
      expect(invalid.status).toBe(422);
      expectStatus(await admin.session.put(`/admin/applicability-policies/versions/${draft.id}/rules`, { rules: [...rules, { documentTypeCode: "OPS-02", outcome: "REQUIRED", priority: 20, conditions: { field: "riskLevel", op: "gte", value: "HIGH" }, reason: "High risk requires a supplier packaging specification" }] }), 200);
      const ctxBody = { pathway: "B", riskLevel: "HIGH", criticality: "MEDIUM", supplierStatus: "APPROVED", newSupplier: false, engineeringOwnership: "SUPPLIER", reverseEngineering: false, specialProcesses: false, customerRequirements: false };
      const preview = expectStatus(await admin.session.post("/admin/applicability-policies/evaluate", { versionId: draft.id, context: ctxBody }), 201).body;
      expect(preview.requirements.find((r: { documentTypeCode: string }) => r.documentTypeCode === "OPS-02")?.level).toBe("REQUIRED");
      const current = expectStatus(await admin.session.post("/admin/applicability-policies/evaluate", { context: ctxBody }), 201).body;
      expect(current.requirements.find((r: { documentTypeCode: string; level: string }) => r.documentTypeCode === "OPS-02" && r.level !== "NOT_APPLICABLE")).toBeUndefined();
      expect((await admin.session.post("/admin/applicability-policies/evaluate", { context: { pathway: "Z" } })).status).toBe(422);

      // Activation does not alter projects created under the earlier version, which keep their recorded version.
      const before = await createProject(ctx, team, { pathway: "B", supplierId: supplier.supplier.id, siteId: supplier.site.id });
      expectStatus(await admin.session.post(`/admin/applicability-policies/versions/${draft.id}/activate`, { reason: "Approved by quality council" }), 201);
      const projBefore = await ctx.prisma.sourcingProject.findUniqueOrThrow({ where: { id: before.id } });
      expect(projBefore.applicabilityPolicyVersionId).toBe(active.id);
      const afterProject = await createProject(ctx, team, { pathway: "B", supplierId: supplier.supplier.id, siteId: supplier.site.id });
      expect((await ctx.prisma.sourcingProject.findUniqueOrThrow({ where: { id: afterProject.id } })).applicabilityPolicyVersionId).toBe(draft.id);
      expect((await ctx.prisma.applicabilityPolicyVersion.findUniqueOrThrow({ where: { id: active.id } })).status).toBe("RETIRED");

      // Restore the original rules as a new version so other tests see the default policy.
      const restore = expectStatus(await admin.session.post(`/admin/applicability-policies/${policy.id}/versions`, { fromVersionId: active.id, notes: "Restore defaults" }), 201).body;
      expectStatus(await admin.session.post(`/admin/applicability-policies/versions/${restore.id}/activate`, { reason: "Restore defaults after test" }), 201);
    });

    it("publishes new workflow versions without affecting running approvals", async () => {
      const wfs = expectStatus(await admin.session.get("/admin/workflows"), 200).body as { key: string; current: { version: number; steps: unknown[] } }[];
      const dev = wfs.find((w) => w.key === "deviation-approval")!;
      expect((await admin.session.post("/admin/workflows/deviation-approval/versions", { name: "Invalid", steps: [{ stepOrder: 2, key: "only", name: "Gap", approverType: "ROLE", approverRoleKey: "ENGINEERING" }] })).status).toBe(422);
      const published = expectStatus(
        await admin.session.post("/admin/workflows/deviation-approval/versions", {
          name: "Deviation approval with management",
          steps: [
            { stepOrder: 1, key: "eng-approval", name: "Engineering approval", approverType: "ROLE", approverRoleKey: "ENGINEERING" },
            { stepOrder: 1, key: "sq-approval", name: "Supplier Quality approval", approverType: "ROLE", approverRoleKey: "SUPPLIER_QUALITY" },
            { stepOrder: 2, key: "mgmt-approval", name: "Management approval", approverType: "ROLE", approverRoleKey: "APPROVER", escalateAfterDays: 3, escalateToRoleKey: "SYSTEM_ADMIN" },
          ],
        }),
        201,
      ).body;
      expect(published.version).toBe(dev.current.version + 1);
      const sp = await ctx.prisma.supplierProduct.findFirstOrThrow({ where: { supplierId: supplier.supplier.id } });
      const d = expectStatus(await team.quality.session.post("/deviations", { type: "DEVIATION", title: "Temporary alternate packaging", supplierProductId: sp.id, description: "Use returnable totes for 3 months", justification: "Packaging supplier strike", endDate: "2027-01-31" }), 201).body;
      expectStatus(await team.quality.session.post(`/deviations/${d.id}/submit`, { expectedVersion: d.version }), 201);
      const instance = await ctx.prisma.workflowInstance.findFirstOrThrow({ where: { subjectId: d.id }, include: { definition: true } });
      expect(instance.definition.version).toBe(published.version);
      await decideAll(ctx, team, d.id);
      expect((await ctx.prisma.deviation.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("APPROVED");
      // Restore the previous step layout as a newer version.
      expectStatus(await admin.session.post("/admin/workflows/deviation-approval/versions", { name: "Deviation / concession approval", steps: dev.current.steps.map((s: unknown) => { const x = s as Record<string, unknown>; return { stepOrder: x.stepOrder, key: x.key, name: x.name, approverType: x.approverType, approverRoleKey: x.approverRoleKey ?? undefined }; }) }), 201);
    });
  });

  describe("audit, dashboard, reports and search", () => {
    it("exposes the append-only audit trail to authorized users only", async () => {
      expect((await team.engineer.session.get("/audit")).status).toBe(403);
      const page = expectStatus(await team.quality.session.get(`/audit?entityId=${supplier.supplier.id}&pageSize=200`), 200).body;
      expect(page.items.length).toBeGreaterThan(0);
      const prefix = expectStatus(await team.quality.session.get("/audit?eventType=admin.&pageSize=5"), 200).body;
      expect(prefix.items.every((e: { eventType: string }) => e.eventType.startsWith("admin."))).toBe(true);
      const csv = await team.quality.session.get(`/audit/export.csv?entityId=${supplier.supplier.id}`);
      expect(csv.status).toBe(200);
      expect(csv.text.split("\r\n")[0]).toContain("Occurred (UTC)");
      // No route modifies audit events, and the database rejects modification attempts.
      expect((await admin.session.delete(`/audit/${page.items[0].id}`)).status).toBe(404);
      await expect(ctx.prisma.auditEvent.update({ where: { id: page.items[0].id }, data: { reason: "tampered" } })).rejects.toThrow();
    });

    it("builds the dashboard and every report, with CSV export", async () => {
      const dash = expectStatus(await team.quality.session.get("/dashboard"), 200).body;
      expect(dash.myWork).toEqual(expect.objectContaining({ tasksOpen: expect.any(Number) }));
      expect(dash.suppliers.byStatus.APPROVED).toBeGreaterThan(0);
      const reports = expectStatus(await team.quality.session.get("/reports"), 200).body as { key: string }[];
      expect(reports.length).toBe(6);
      for (const r of reports) {
        const res = expectStatus(await team.quality.session.get(`/reports/${r.key}`), 200).body;
        expect(res.columns.length).toBeGreaterThan(3);
        const csv = await team.quality.session.get(`/reports/${r.key}/export.csv`);
        expect(csv.status).toBe(200);
        expect(csv.headers["content-disposition"]).toContain(".csv");
      }
      const asl = expectStatus(await team.quality.session.get(`/reports/approved-suppliers?supplierId=${supplier.supplier.id}`), 200).body;
      expect(asl.rows).toHaveLength(1);
      expect((await team.readOnly.session.get("/reports/approved-suppliers/export.csv")).status).toBe(403);
      expect((await team.quality.session.get("/reports/nope")).status).toBe(404);
    });

    it("searches across modules within the caller's access", async () => {
      const res = expectStatus(await team.readOnly.session.get(`/search?q=${encodeURIComponent(supplier.supplier.name)}`), 200).body;
      expect(res.results.some((r: { type: string; id: string }) => r.type === "supplier" && r.id === supplier.supplier.id)).toBe(true);
      expect((await team.readOnly.session.get("/search?q=a")).status).toBe(400);
      const sup = await ctx.prisma.supplier.findUniqueOrThrow({ where: { id: supplier.supplier.id } });
      const ext = await createUser(ctx.prisma, { roles: ["SUPPLIER_CONTRIBUTOR"], organizationId: sup.organizationId, userType: "EXTERNAL" });
      const extSession = await login(ctx, ext.email);
      const other = await createApprovedSupplier(ctx, team);
      const ncr = expectStatus(await team.quality.session.post("/ncrs", { title: "Search isolation NCR", dateIdentified: "2026-10-01", source: "AUDIT", supplierId: other.supplier.id, internalPartId: (await ctx.prisma.internalPart.findFirstOrThrow()).id, quantityAffected: 1, defectDescription: "Isolation check defect description", severity: "MINOR", supplierVisible: true }), 201).body;
      const extRes = expectStatus(await extSession.get(`/search?q=${encodeURIComponent("Search isolation")}`), 200).body;
      expect(extRes.results.some((r: { id: string }) => r.id === ncr.id)).toBe(false);
      const intRes = expectStatus(await team.quality.session.get(`/search?q=${encodeURIComponent("Search isolation")}&types=ncr`), 200).body;
      expect(intRes.results.map((r: { id: string }) => r.id)).toContain(ncr.id);
    });
  });
});
