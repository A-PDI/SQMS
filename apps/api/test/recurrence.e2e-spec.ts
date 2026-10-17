import { randomUUID } from "node:crypto";
import { AuditService } from "../src/common/audit/audit.service";
import {
  acceptBaselineAndDelta,
  approveIntake,
  cleanUpload,
  completeChecklist,
  createApprovedSupplier,
  createProject,
  decideAll,
} from "./flows";
import {
  createTeam,
  expectStatus,
  startApp,
  uniq,
  type Team,
  type TestContext,
} from "./helpers";

describe("Rejected FAI → approved replacement → recurring production defect", () => {
  let ctx: TestContext, team: Team;
  let project: any,
    qualification: any,
    fai: any,
    ncrA: any,
    ncrB: any,
    feature: any,
    characteristic: any,
    approval: any,
    incoming: any;
  const requestKey = randomUUID();
  beforeAll(async () => {
    ctx = await startApp({ SUPPLIER_PORTAL_ENABLED: "false" });
    team = await createTeam(ctx);
  });
  afterAll(async () => ctx.close());
  it("raises and closes a defect NCR from the rejected FAI, keeping a stable physical-feature identity", async () => {
    const supplier = await createApprovedSupplier(ctx, team);
    project = await createProject(ctx, team, {
      pathway: "B",
      supplierId: supplier.supplier.id,
      siteId: supplier.site.id,
    });
    await approveIntake(ctx, team, project.id);
    await completeChecklist(ctx, team, project.id);
    const revisionId = await acceptBaselineAndDelta(
      ctx,
      team,
      project.configurationId,
    );
    const sp = await ctx.prisma.supplierProduct.findUniqueOrThrow({
      where: { id: project.supplierProductId },
    });
    feature = expectStatus(
      await team.engineer.session.post("/features", {
        internalPartId: sp.internalPartId,
        key: uniq("bore-axis-"),
        name: "Primary housing bore diameter",
      }),
      201,
    ).body;
    characteristic = await ctx.prisma.criticalCharacteristic.create({
      data: {
        configurationRevisionId: revisionId,
        charNumber: "12",
        name: "Primary bore",
        classification: "MAJOR",
        nominal: 25,
        tolerancePlus: 0.02,
        toleranceMinus: 0.02,
        unit: "mm",
        measurementMethod: "Bore micrometer",
      },
    });
    expectStatus(
      await team.engineer.session.post("/feature-revision-mappings", {
        featureId: feature.id,
        configurationRevisionId: revisionId,
        characteristicId: characteristic.id,
        balloonAlias: "12",
        compatibility: "COMPATIBLE",
        reason: "Drawing feature reviewed against the primary bore axis",
      }),
      201,
    );
    qualification = expectStatus(
      await team.quality.session.post("/qualifications", {
        sourcingProjectId: project.id,
      }),
      201,
    ).body;
    fai = expectStatus(
      await team.quality.session.post(
        `/qualifications/${qualification.id}/first-articles`,
        {
          characteristicsInspected: 1,
          nonconformingCount: 1,
          outcome: "FAIL",
          summary: "Primary bore oversized",
        },
      ),
      201,
    ).body;
    const result = expectStatus(
      await team.quality.session.post(
        `/qualifications/${qualification.id}/inspection-results`,
        {
          characteristicId: characteristic.id,
          firstArticleId: fai.id,
          numericValue: 25.05,
          measuredValue: "25.05 mm",
          outcome: "FAIL",
        },
      ),
      201,
    ).body;
    expect(result.specificationSnapshot).toMatchObject({
      featureId: feature.id,
      maximum: 25.02,
      unit: "mm",
      method: "Bore micrometer",
    });
    expectStatus(
      await team.quality2.session.post(
        `/qualifications/first-articles/${fai.id}/review`,
        {
          decision: "REJECTED",
          comment: "Primary bore exceeds the approved specification",
        },
      ),
      201,
    );
    ncrA = expectStatus(
      await team.quality.session.post(`/first-articles/${fai.id}/ncrs`, {
        title: "FAI primary bore oversize",
        resultIds: [result.id],
        defectCode: "DIMENSIONAL",
        quantityAffected: 1,
        requestKey: randomUUID(),
      }),
      201,
    ).body;
    expect(ncrA.source).toBe("FIRST_ARTICLE");
    expect(ncrA.firstArticleId).toBe(fai.id);
    let n = expectStatus(
      await team.quality.session.post(`/ncrs/${ncrA.id}/disposition`, {
        expectedVersion: ncrA.version,
        disposition: "SCRAP",
        dispositionNotes:
          "Failed sample scrapped; supplier to correct tooling and resubmit",
      }),
      201,
    ).body;
    ncrA = expectStatus(
      await team.quality2.session.post(`/ncrs/${ncrA.id}/close`, {
        expectedVersion: n.version,
        comment: "Tooling correction received; new FAI will verify the result",
      }),
      201,
    ).body;
    expect(ncrA.status).toBe("CLOSED");
  });
  it("accepts the corrected replacement and approves the exact supplier-product-site configuration", async () => {
    const replacement = expectStatus(
      await team.quality.session.post(
        `/qualifications/${qualification.id}/first-articles`,
        {
          characteristicsInspected: 1,
          nonconformingCount: 0,
          outcome: "PASS",
          summary: "Replacement after tooling adjustment",
        },
      ),
      201,
    ).body;
    expectStatus(
      await team.quality.session.post(
        `/qualifications/${qualification.id}/inspection-results`,
        {
          characteristicId: characteristic.id,
          firstArticleId: replacement.id,
          numericValue: 25,
          measuredValue: "25.00 mm",
          outcome: "PASS",
        },
      ),
      201,
    );
    expectStatus(
      await team.quality2.session.post(
        `/qualifications/first-articles/${replacement.id}/review`,
        {
          decision: "ACCEPTED",
          comment: "Replacement meets the bore specification",
        },
      ),
      201,
    );
    const q = await ctx.prisma.productQualification.findUniqueOrThrow({
      where: { id: qualification.id },
    });
    expectStatus(
      await team.quality.session.post(`/qualifications/${q.id}/submit`, {
        expectedVersion: q.version,
      }),
      201,
    );
    await decideAll(ctx, team, q.id);
    approval = await ctx.prisma.productApproval.findUniqueOrThrow({
      where: { qualificationId: q.id },
    });
    expect(approval.supplierProductId).toBe(project.supplierProductId);
    expect(approval.configurationRevisionId).toBe(
      characteristic.configurationRevisionId,
    );
    expect(approval.status).toBe("ACTIVE");
  });
  it("shows the closed FAI NCR when a production receipt fails the same feature", async () => {
    const definition = {
      sections: {
        receiving: {
          title: "Receiving & documentation",
          section_type: "pfn_checklist",
          items: [],
        },
      },
      characteristics: [
        {
          key: "primary-bore",
          name: "Primary bore",
          featureId: feature.id,
          minimum: 24.98,
          maximum: 25.02,
          unit: "mm",
          method: "Bore micrometer",
          defectCode: "DIMENSIONAL",
        },
      ],
    };
    const plan = expectStatus(
      await team.engineer.session.post("/inspection-plans", {
        code: uniq("REC-"),
        title: "Production housing inspection",
        definition,
      }),
      201,
    ).body;
    expectStatus(
      await team.engineer.session.post(
        `/inspection-plans/revisions/${plan.revisions[0].id}/release`,
      ),
      201,
    );
    incoming = expectStatus(
      await team.quality.session.post("/incoming-inspections", {
        planRevisionId: plan.revisions[0].id,
        productApprovalId: approval.id,
        itemCount: 1,
        header: {
          po_number: "PO-REC-991",
          date_received: "2026-10-16",
          lot_serial_no: "L-991",
        },
      }),
      201,
    ).body;
    expect(incoming.productApprovalId).toBe(approval.id);
    incoming = expectStatus(
      await team.quality.session.patch(`/incoming-inspections/${incoming.id}`, {
        expectedVersion: incoming.version,
        sectionData: {
          __shared: { receiving: [] },
          __items: [
            {
              __serial_no: "SN-991",
              __disposition: "FAIL",
              __disposition_notes: "Primary bore oversized",
            },
          ],
        },
        measurements: [
          { itemPosition: 0, characteristicKey: "primary-bore", value: 25.06 },
        ],
      }),
      200,
    ).body;
    const file = await cleanUpload(ctx, team.quality.session);
    expectStatus(
      await team.quality.session.post("/record-attachments", {
        entityType: "INCOMING_INSPECTION",
        entityId: incoming.id,
        fileId: file.id,
        context: { itemPosition: 0 },
      }),
      201,
    );
    const history = expectStatus(
      await team.quality.session.get(
        `/incoming-inspections/${incoming.id}/recurrence-candidates`,
      ),
      200,
    ).body;
    expect(history.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ncr: expect.objectContaining({
            id: ncrA.id,
            status: "CLOSED",
            source: "FIRST_ARTICLE",
            firstArticle: expect.objectContaining({ id: fai.id }),
          }),
        }),
      ]),
    );
    expect(
      history.candidates.find((c: any) => c.ncr.id === ncrA.id).lines[0]
        .revisionCompatible,
    ).toBe(true);
  });
  it("rolls back cross-module creation on failure and safely recovers/replays the command", async () => {
    const source = await ctx.prisma.incomingMeasurement.findFirstOrThrow({
      where: { inspectionId: incoming.id, outcome: "FAIL" },
    });
    const body = {
      title: "Production primary bore oversize",
      resultIds: [source.id],
      defectCode: "DIMENSIONAL",
      quantityAffected: 1,
      requestKey,
    };
    const audit = ctx.app.get(AuditService);
    const original = audit.record.bind(audit);
    const before = await ctx.prisma.nonconformance.count({
      where: { incomingInspectionId: incoming.id },
    });
    const spy = jest
      .spyOn(audit, "record")
      .mockImplementation(async (event, tx) => {
        if (event.eventType === "ncr.created")
          throw new Error("Injected pre-commit process failure");
        return original(event, tx);
      });
    try {
      expect(
        (
          await team.quality.session.post(
            `/incoming-inspections/${incoming.id}/ncrs`,
            body,
          )
        ).status,
      ).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(
      await ctx.prisma.nonconformance.count({
        where: { incomingInspectionId: incoming.id },
      }),
    ).toBe(before);
    expect(
      await ctx.prisma.qualityCommand.count({ where: { key: requestKey } }),
    ).toBe(0);
    ncrB = expectStatus(
      await team.quality.session.post(
        `/incoming-inspections/${incoming.id}/ncrs`,
        body,
      ),
      201,
    ).body;
    const replay = expectStatus(
      await team.quality.session.post(
        `/incoming-inspections/${incoming.id}/ncrs`,
        body,
      ),
      201,
    ).body;
    expect(replay.id).toBe(ncrB.id);
    expect(replay.replayed).toBe(true);
    expect(
      await ctx.prisma.nonconformance.count({
        where: { incomingInspectionId: incoming.id },
      }),
    ).toBe(before + 1);
    const relation = await ctx.prisma.recurrenceReview.findUniqueOrThrow({
      where: {
        currentNcrId_historicalNcrId: {
          currentNcrId: ncrB.id,
          historicalNcrId: ncrA.id,
        },
      },
    });
    expect(relation.status).toBe("CANDIDATE");
    const review = expectStatus(
      await team.quality2.session.post(
        `/recurrence-reviews/${relation.id}/decision`,
        {
          status: "CONFIRMED",
          reason:
            "Same physical bore and deviation direction; tooling action needs effectiveness review",
        },
      ),
      201,
    ).body;
    expect(review.status).toBe("CONFIRMED");
    expect(
      (
        await team.readOnly.session.post(
          `/recurrence-reviews/${relation.id}/decision`,
          { status: "DISMISSED", reason: "Unauthorized read-only attempt" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await ctx.prisma.productApproval.findUniqueOrThrow({
          where: { id: approval.id },
        })
      ).status,
    ).toBe("ACTIVE");
  });
  it("keeps both qualification and production history and never equates a reused balloon with another feature", async () => {
    const history = expectStatus(
      await team.quality.session.get(
        `/suppliers/${approval.supplierId}/quality-history?internalPartId=${approval.internalPartId}`,
      ),
      200,
    ).body;
    expect(history.ncrs.map((n: any) => n.id)).toEqual(
      expect.arrayContaining([ncrA.id, ncrB.id]),
    );
    expect(
      history.qualifications.some((q: any) => q.id === qualification.id),
    ).toBe(true);
    expect(history.approvals.some((a: any) => a.id === approval.id)).toBe(true);
    const otherFeature = expectStatus(
      await team.engineer.session.post("/features", {
        internalPartId: approval.internalPartId,
        key: uniq("flange-"),
        name: "Unrelated flange hole",
      }),
      201,
    ).body;
    expectStatus(
      await team.engineer.session.post("/feature-revision-mappings", {
        featureId: otherFeature.id,
        configurationRevisionId: approval.configurationRevisionId,
        balloonAlias: "12",
        compatibility: "COMPATIBLE",
        reason:
          "Balloon 12 reused on a different physical feature; identity stays separate",
      }),
      201,
    );
    const n = expectStatus(
      await team.quality.session.post("/ncrs", {
        title: "Unrelated flange feature",
        dateIdentified: "2026-10-16",
        source: "OTHER",
        supplierProductId: project.supplierProductId,
        configurationRevisionId: approval.configurationRevisionId,
        quantityAffected: 1,
        defectDescription:
          "Unrelated flange hole exceeds its own diameter requirement",
        severity: "MAJOR",
      }),
      201,
    ).body;
    expectStatus(
      await team.quality.session.post(`/ncrs/${n.id}/defect-lines`, {
        expectedVersion: n.version,
        lines: [
          {
            featureId: otherFeature.id,
            defectCode: "DIMENSIONAL",
            deviationDirection: "ABOVE",
            severity: "MAJOR",
            specification: { balloonAlias: "12" },
            actualCondition: "Hole diameter oversized",
            quantityAffected: 1,
          },
        ],
      }),
      201,
    );
    expect(
      expectStatus(
        await team.quality.session.get(`/ncrs/${n.id}/recurrence`),
        200,
      ).body.candidates,
    ).toHaveLength(0);
  });
});
