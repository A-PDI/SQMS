import { FORM_DEFINITION_SEEDS } from "@sqms/shared";
import { PDF_BYTES } from "./fixtures";
import { createTeam, expectStatus, startApp, uniq, waitFor, type Session, type Team, type TestContext } from "./helpers";

describe("Document library and controlled documents", () => {
  let ctx: TestContext;
  let team: Team;

  beforeAll(async () => {
    ctx = await startApp();
    team = await createTeam(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  const typeId = async (code: string) => (await ctx.prisma.documentType.findUniqueOrThrow({ where: { code } })).id;
  const cleanFile = async (s: Session, name = "report.pdf", bytes = PDF_BYTES) => {
    const f = expectStatus(await s.upload("/files", name, bytes), 201).body;
    await waitFor(async () => (await ctx.prisma.fileObject.findUnique({ where: { id: f.id } }))?.status === "CLEAN", 60_000);
    return f;
  };
  const approveAll = async (subjectId: string, approvers: Session[]) => {
    for (const s of approvers) {
      const item = await waitFor(async () => (expectStatus(await s.get("/approvals/inbox"), 200).body as { subjectId: string; canDecide: boolean }[]).find((i) => i.subjectId === subjectId && i.canDecide));
      expectStatus(await s.post(`/approvals/${(item as unknown as { id: string }).id}/decision`, { decision: "APPROVE", comment: "Reviewed" }), 201);
    }
  };
  const getDoc = async (s: Session, id: string) => expectStatus(await s.get(`/documents/${id}`), 200).body;

  it("exposes the 37-type library with governance metadata and templates", async () => {
    const list = expectStatus(await team.readOnly.session.get("/document-types?pageSize=200"), 200).body;
    expect(list.total).toBe(37);
    const psw = list.items.find((t: { code: string }) => t.code === "VAL-06");
    expect(psw.origin).toBe("EXTERNAL_STANDARD");
    expect(psw.externalStandardRef).toMatch(/PPAP/);
    expect(psw.currentTemplateRevision.revisionLabel).toBe("A");
    const detail = expectStatus(await team.readOnly.session.get(`/document-types/${psw.id}`), 200).body;
    expect(detail.rules.length).toBeGreaterThan(0);
    expect(detail.retentionPolicy.retentionMonths).toBeNull();
    const pathwayC = expectStatus(await team.readOnly.session.get("/document-types?pathway=C&category=ENGINEERING"), 200).body;
    expect(pathwayC.items.map((t: { code: string }) => t.code)).toContain("ENG-06");
  });

  it("runs an uploaded document through review, release, revision and supersession without overwriting releases", async () => {
    const q = team.quality.session;
    const created = expectStatus(await q.post("/documents", { documentTypeId: await typeId("VAL-02"), title: `FAI turbo housing ${uniq()}`, submissionMethod: "UPLOAD" }), 201).body;
    const docId = created.document.id;
    let rev = created.revision;
    expect(rev.templateRevisionId).toBeTruthy();
    // Submitting without the primary file fails.
    expect((await q.post(`/documents/${docId}/revisions/${rev.id}/submit`, { expectedVersion: rev.version })).status).toBe(422);
    const file = await cleanFile(q, "FAIR-housing.pdf");
    expectStatus(await q.post(`/documents/${docId}/revisions/${rev.id}/files`, { fileId: file.id }), 201);
    rev = (await getDoc(q, docId)).revisions[0];
    expect(rev.files[0].role).toBe("PRIMARY");
    expectStatus(await q.post(`/documents/${docId}/revisions/${rev.id}/submit`, { expectedVersion: rev.version }), 201);
    let doc = await getDoc(q, docId);
    expect(doc.revisions[0].status).toBe("IN_REVIEW");
    expect(doc.revisions[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
    // In-review content is frozen.
    expect((await q.post(`/documents/${docId}/revisions/${rev.id}/files`, { fileId: file.id })).status).toBe(409);
    await approveAll(rev.id, [team.quality2.session]);
    doc = await getDoc(q, docId);
    expect(doc.revisions[0].status).toBe("APPROVED");
    const relA = expectStatus(await q.post(`/documents/${docId}/revisions/${rev.id}/release`, { expectedVersion: doc.revisions[0].version, effectiveDate: "2026-10-15" }), 201).body;
    expect(relA.status).toBe("RELEASED");
    doc = await getDoc(q, docId);
    expect(doc.releasedRevisionId).toBe(rev.id);
    expect(doc.revisions[0].release.releaseNumber).toMatch(/^REL-\d{4}-\d{5}$/);

    // Released revision cannot be modified silently.
    const tamper = await q.patch(`/documents/${docId}/revisions/${rev.id}`, { expectedVersion: doc.revisions[0].version, changeSummary: "tamper" });
    expect(tamper.status).toBe(409);
    expect(tamper.body.error.code).toBe("CONTROLLED_RECORD");
    expect((await q.delete(`/documents/${docId}/revisions/${rev.id}/files/${doc.revisions[0].files[0].id}`)).status).toBe(409);
    expect((await q.patch(`/documents/${docId}`, { expectedVersion: doc.version, title: "Renamed" })).status).toBe(409);

    // Revise: B copies the file references; A stays released until B is released.
    const revB = expectStatus(await q.post(`/documents/${docId}/revisions`, { changeSummary: "Added CMM report for critical bores" }), 201).body;
    expect(revB.revisionLabel).toBe("B");
    expect((await q.post(`/documents/${docId}/revisions`, { changeSummary: "Second draft attempt" })).status).toBe(409);
    const extra = await cleanFile(q, "cmm-report.pdf");
    expectStatus(await q.post(`/documents/${docId}/revisions/${revB.id}/files`, { fileId: extra.id, role: "SUPPORTING" }), 201);
    doc = await getDoc(q, docId);
    const b = doc.revisions.find((r: { id: string }) => r.id === revB.id);
    expect(b.files).toHaveLength(2);
    expectStatus(await q.post(`/documents/${docId}/revisions/${revB.id}/submit`, { expectedVersion: b.version }), 201);
    await approveAll(revB.id, [team.quality2.session]);
    doc = await getDoc(q, docId);
    expectStatus(await q.post(`/documents/${docId}/revisions/${revB.id}/release`, { expectedVersion: doc.revisions.find((r: { id: string }) => r.id === revB.id).version, effectiveDate: "2026-10-16" }), 201);
    doc = await getDoc(q, docId);
    const a = doc.revisions.find((r: { id: string }) => r.id === rev.id);
    expect(a.status).toBe("SUPERSEDED");
    expect(a.supersededByRevisionId).toBe(revB.id);
    expect(a.files).toHaveLength(1);
    expect(doc.releasedRevisionId).toBe(revB.id);
    // Superseded file remains retrievable.
    expect((await q.get(`/files/${a.files[0].file.id}/download`)).status).toBe(200);
  });

  it("validates native form submissions against the versioned schema", async () => {
    const q = team.quality.session;
    const created = expectStatus(await q.post("/documents", { documentTypeId: await typeId("SUP-01"), title: `SQQ ${uniq()}`, submissionMethod: "NATIVE_FORM", formData: { legalName: "Turbo GmbH" } }), 201).body;
    const docId = created.document.id;
    let rev = created.revision;
    const incomplete = await q.post(`/documents/${docId}/revisions/${rev.id}/submit`, { expectedVersion: rev.version });
    expect(incomplete.status).toBe(422);
    expect(incomplete.body.error.details.issues.map((i: { path: string }) => i.path)).toContain("hasCertifiedQms");
    const bad = await q.patch(`/documents/${docId}/revisions/${rev.id}`, { expectedVersion: rev.version, formData: { yearEstablished: "nineteen" } });
    expect(bad.status).toBe(422);
    rev = expectStatus(
      await q.patch(`/documents/${docId}/revisions/${rev.id}`, {
        expectedVersion: rev.version,
        formData: {
          legalName: "Turbo GmbH",
          hasCertifiedQms: "YES",
          certifications: [{ standard: "IATF 16949", certificateNumber: "IATF-001" }],
          inspectionCapabilities: "CMM, balancing",
          calibrationProgram: "YES",
          processes: ["CNC_MACHINING"],
          productTypes: "Turbochargers",
          usesSubTier: "NO",
          changeNotificationCommitment: true,
          preparedBy: "A. Weber",
          preparedDate: "2026-10-01",
          unknownField: "dropped",
        },
      }),
      200,
    ).body;
    expect(rev.formData.unknownField).toBeUndefined();
    const sqq = FORM_DEFINITION_SEEDS.find((f) => f.key === "SQQ")!;
    const formVersion = await ctx.prisma.formDefinitionVersion.findUniqueOrThrow({ where: { id: rev.formDefinitionVersionId } });
    expect((formVersion.schema as { key: string }).key).toBe(sqq.schema.key);
    expectStatus(await q.post(`/documents/${docId}/revisions/${rev.id}/submit`, { expectedVersion: rev.version }), 201);
  });

  it("supports parallel review, rejection, resubmission and request-for-information", async () => {
    const e = team.engineer.session;
    const created = expectStatus(await e.post("/documents", { documentTypeId: await typeId("ENG-02"), title: `DRR ${uniq()}`, submissionMethod: "UPLOAD" }), 201).body;
    const docId = created.document.id;
    const revId = created.revision.id;
    const f = await cleanFile(e, "drr-minutes.pdf");
    expectStatus(await e.post(`/documents/${docId}/revisions/${revId}/files`, { fileId: f.id }), 201);
    let doc = await getDoc(e, docId);
    expectStatus(await e.post(`/documents/${docId}/revisions/${revId}/submit`, { expectedVersion: doc.revisions[0].version }), 201);
    const engineer2 = await (async () => {
      const { createUser, login } = await import("./helpers");
      const u = await createUser(ctx.prisma, { roles: ["ENGINEERING"] });
      return login(ctx, u.email);
    })();
    // Parallel group: engineering and quality.
    const items = expectStatus(await engineer2.get("/approvals/inbox"), 200).body.filter((i: { subjectId: string }) => i.subjectId === revId);
    expect(items).toHaveLength(1);
    expectStatus(await engineer2.post(`/approvals/${items[0].id}/decision`, { decision: "APPROVE" }), 201);
    const qItem = expectStatus(await team.quality.session.get("/approvals/inbox"), 200).body.find((i: { subjectId: string }) => i.subjectId === revId);
    expectStatus(await team.quality.session.post(`/approvals/${qItem.id}/decision`, { decision: "REJECT", comment: "Missing tolerance stack-up analysis" }), 201);
    doc = await getDoc(e, docId);
    expect(doc.revisions[0].status).toBe("REJECTED");
    expect(doc.revisions[0].rejectionReason).toMatch(/stack-up/);
    expectStatus(await e.post(`/documents/${docId}/revisions/${revId}/reopen`, { expectedVersion: doc.revisions[0].version }), 201);
    doc = await getDoc(e, docId);
    expectStatus(await e.post(`/documents/${docId}/revisions/${revId}/submit`, { expectedVersion: doc.revisions[0].version }), 201);
    const qItem2 = expectStatus(await team.quality.session.get("/approvals/inbox"), 200).body.find((i: { subjectId: string }) => i.subjectId === revId);
    expectStatus(await team.quality.session.post(`/approvals/${qItem2.id}/decision`, { decision: "REQUEST_INFO", comment: "Please attach analysis" }), 201);
    doc = await getDoc(e, docId);
    expect(doc.revisions[0].status).toBe("DRAFT");
    const history = expectStatus(await e.get(`/approvals/history?subjectType=DOCUMENT_REVISION&subjectId=${revId}`), 200).body;
    expect(history.map((h: { status: string }) => h.status)).toEqual(["INFO_REQUESTED", "REJECTED"]);
  });

  it("keeps state consistent under concurrent approvals and concurrent release attempts", async () => {
    const e = team.engineer.session;
    const created = expectStatus(await e.post("/documents", { documentTypeId: await typeId("ENG-08"), title: `CCM ${uniq()}`, submissionMethod: "UPLOAD" }), 201).body;
    const docId = created.document.id;
    const revId = created.revision.id;
    const f = await cleanFile(e, "ccm.pdf");
    expectStatus(await e.post(`/documents/${docId}/revisions/${revId}/files`, { fileId: f.id }), 201);
    let doc = await getDoc(e, docId);
    expectStatus(await e.post(`/documents/${docId}/revisions/${revId}/submit`, { expectedVersion: doc.revisions[0].version }), 201);
    const { createUser, login } = await import("./helpers");
    const eng2 = await login(ctx, (await createUser(ctx.prisma, { roles: ["ENGINEERING"] })).email);
    const engItem = expectStatus(await eng2.get("/approvals/inbox"), 200).body.find((i: { subjectId: string }) => i.subjectId === revId);
    const sqItem = expectStatus(await team.quality.session.get("/approvals/inbox"), 200).body.find((i: { subjectId: string }) => i.subjectId === revId);
    // Both parallel approvals at the same time, plus a duplicate decision on the same assignment.
    const [r1, r2, dup] = await Promise.all([
      eng2.post(`/approvals/${engItem.id}/decision`, { decision: "APPROVE" }),
      team.quality.session.post(`/approvals/${sqItem.id}/decision`, { decision: "APPROVE" }),
      team.quality.session.post(`/approvals/${sqItem.id}/decision`, { decision: "APPROVE" }),
    ]);
    const statuses = [r1.status, r2.status, dup.status].sort();
    expect(statuses).toEqual([201, 201, 409]);
    const instances = await ctx.prisma.workflowInstance.findMany({ where: { subjectId: revId } });
    expect(instances).toHaveLength(1);
    expect(instances[0].status).toBe("APPROVED");
    doc = await getDoc(e, docId);
    expect(doc.revisions[0].status).toBe("APPROVED");
    const v = doc.revisions[0].version;
    const releases = await Promise.all([
      team.quality.session.post(`/documents/${docId}/revisions/${revId}/release`, { expectedVersion: v, effectiveDate: "2026-10-15" }),
      team.quality2.session.post(`/documents/${docId}/revisions/${revId}/release`, { expectedVersion: v, effectiveDate: "2026-10-15" }),
    ]);
    expect(releases.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await ctx.prisma.documentRelease.count({ where: { revisionId: revId } })).toBe(1);
  });

  it("manages template revisions and form versions without code changes", async () => {
    const admin = await (async () => {
      const { createUser, login } = await import("./helpers");
      return login(ctx, (await createUser(ctx.prisma, { roles: ["SYSTEM_ADMIN"] })).email);
    })();
    const type = expectStatus(await admin.get(`/document-types/${await typeId("VAL-03")}`), 200).body;
    const templateId = type.templates[0].id;
    const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200, 1)]);
    const tf = expectStatus(await admin.upload("/files", "PTR-template.docx", docx), 201).body;
    const tr = expectStatus(await admin.post(`/document-templates/${templateId}/revisions`, { changeSummary: "Added flow test section", fileId: tf.id }), 201).body;
    expect(tr.revisionLabel).toBe("B");
    await waitFor(async () => (await ctx.prisma.fileObject.findUnique({ where: { id: tf.id } }))?.status === "CLEAN", 60_000);
    expectStatus(await admin.post(`/template-revisions/${tr.id}/publish`, { effectiveDate: "2026-10-15" }), 201);
    const after = expectStatus(await admin.get(`/document-types/${type.id}`), 200).body;
    const revs = after.templates[0].revisions;
    expect(revs.find((r: { revisionLabel: string }) => r.revisionLabel === "A").status).toBe("SUPERSEDED");
    expect(revs.find((r: { revisionLabel: string }) => r.revisionLabel === "B").status).toBe("EFFECTIVE");
    const newDoc = expectStatus(await team.engineer.session.post("/documents", { documentTypeId: type.id, title: `PTR ${uniq()}`, submissionMethod: "UPLOAD" }), 201).body;
    expect(newDoc.revision.templateRevisionId).toBe(tr.id);
    expect((await team.engineer.session.post(`/document-templates/${templateId}/revisions`, { changeSummary: "Not allowed" })).status).toBe(403);

    const invalid = await admin.post("/form-definitions/SQQ/versions", { schema: { key: "SQQ", title: "x", sections: [{ key: "s", title: "S", fields: [{ key: "bad key", label: "", type: "nope" }] }] }, changeSummary: "Broken schema" });
    expect(invalid.status).toBe(422);
    const sqq = FORM_DEFINITION_SEEDS.find((f) => f.key === "SQQ")!.schema;
    const v2 = expectStatus(await admin.post("/form-definitions/SQQ/versions", { schema: { ...sqq, title: `${sqq.title} (v2)` }, changeSummary: "Title update" }), 201).body;
    expect(v2.version).toBe(2);
    expectStatus(await admin.post(`/form-definition-versions/${v2.id}/publish`), 201);
    const published = expectStatus(await admin.get("/form-definitions/SQQ/published"), 200).body;
    expect(published.version).toBe(2);

    const patch = await admin.patch(`/document-types/${type.id}`, { expectedVersion: type.version, origin: "EXTERNAL_STANDARD", externalStandardRef: null });
    expect(patch.status).toBe(422);
    const ok = expectStatus(await admin.patch(`/document-types/${type.id}`, { expectedVersion: type.version, instructions: "Attach raw test data." }), 200).body;
    expect(ok.instructions).toBe("Attach raw test data.");
  });

  it("restricts sharing of internal-only types", async () => {
    const supplier = expectStatus(await team.sourcing.session.post("/suppliers", { name: `Share Co ${uniq()}`, country: "US" }), 201).body;
    const created = expectStatus(await team.quality.session.post("/documents", { documentTypeId: await typeId("SUP-02"), title: `SCA ${uniq()}`, submissionMethod: "UPLOAD", supplierId: supplier.id }), 201).body;
    const res = await team.quality.session.post(`/documents/${created.document.id}/shares`, { supplierId: supplier.id });
    expect(res.status).toBe(422);
  });
});
