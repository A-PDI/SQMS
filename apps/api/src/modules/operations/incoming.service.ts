import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma } from "@sqms/db";
import {
  buildDimensionalFromTests,
  buildItemForInjector,
  buildSharedSections,
  generateInspectionPdf,
  initSectionData,
  STANDARD_PLANS,
} from "@sqms/legacy-domain";
import type { Actor } from "../../common/auth/actor";
import { AuditService } from "../../common/audit/audit.service";
import { ActivityService } from "../../common/audit/activity.service";
import {
  DbService,
  type Tx,
  type AfterCommit,
} from "../../common/db/db.service";
import {
  BusinessRuleError,
  InvalidTransitionError,
  NotFoundError,
  StaleVersionError,
} from "../../common/errors/app-errors";
import { pageArgs, trimQ } from "../../common/http/pagination";
import { NotificationService } from "../../common/services/notification.service";
import { OutboxService } from "../../common/services/outbox.service";
import type {
  NewIncomingDto,
  OperationsQuery,
  PlanDto,
  UpdateIncomingDto,
} from "./operations.dto";
import {
  completionDisposition,
  digest,
  disposition,
  inspectionItems,
  object,
  receiptDate,
  validateDefinition,
  type JsonObject,
} from "./operations.rules";
import { presentTest } from "./injector.service";
import { EvidenceService } from "./evidence.service";

const json = (v: unknown) => v as Prisma.InputJsonValue;
@Injectable()
export class IncomingService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationService,
    private readonly evidence: EvidenceService,
  ) {}

  plans() {
    return this.db.client.inspectionPlan.findMany({
      orderBy: { code: "asc" },
      include: { revisions: { orderBy: { revision: "desc" } } },
    });
  }
  async installStandards(actor: Actor) {
    const installed = [];
    for (const definition of STANDARD_PLANS) {
      const existing = await this.db.client.inspectionPlan.findUnique({
        where: { code: definition.form_no },
      });
      if (existing) continue;
      installed.push(
        await this.createPlan(actor, {
          code: definition.form_no,
          title: definition.title,
          definition: {
            ...definition,
            sourceCommit: "6c53d82",
            requiresReleaseReview: true,
          },
        }),
      );
    }
    return {
      installed: installed.length,
      plans: installed,
      note: "Source defaults installed as draft plans; Quality must review and release the required revisions",
    };
  }
  async createPlan(actor: Actor, dto: PlanDto) {
    validateDefinition(dto.definition);
    return this.db.tx(async (tx) => {
      const p = await tx.inspectionPlan.create({
        data: {
          code: dto.code,
          title: dto.title,
          createdById: actor.userId,
          revisions: {
            create: { revision: 1, definition: json(dto.definition) },
          },
        },
        include: { revisions: true },
      });
      await this.audit.record(
        {
          eventType: "inspection_plan.created",
          entityType: "INSPECTION_PLAN",
          entityId: p.id,
        },
        tx,
      );
      return p;
    });
  }
  async revisePlan(actor: Actor, planId: string, definition: JsonObject) {
    validateDefinition(definition);
    return this.db.tx(async (tx) => {
      if (!(await this.db.lockRow(tx, "inspection_plans", planId)))
        throw new NotFoundError("Plan");
      const last = await tx.inspectionPlanRevision.findFirst({
        where: { planId },
        orderBy: { revision: "desc" },
      });
      const r = await tx.inspectionPlanRevision.create({
        data: {
          planId,
          revision: (last?.revision ?? 0) + 1,
          definition: json(definition),
        },
      });
      await this.audit.record(
        {
          eventType: "inspection_plan.revised",
          entityType: "INSPECTION_PLAN",
          entityId: planId,
          metadata: { revisionId: r.id, revision: r.revision },
        },
        tx,
      );
      return r;
    });
  }
  async releasePlan(actor: Actor, revisionId: string) {
    return this.db.tx(async (tx) => {
      await this.db.lockRow(tx, "inspection_plan_revisions", revisionId);
      const r = await tx.inspectionPlanRevision.findUnique({
        where: { id: revisionId },
      });
      if (!r) throw new NotFoundError("Plan revision");
      if (r.status !== "DRAFT")
        throw new InvalidTransitionError("Plan", r.status, "released");
      validateDefinition(object(r.definition));
      const released = await tx.inspectionPlanRevision.update({
        where: { id: revisionId },
        data: {
          status: "RELEASED",
          definitionHash: digest(r.definition),
          releasedById: actor.userId,
          releasedAt: new Date(),
        },
      });
      await this.audit.record(
        {
          eventType: "inspection_plan.released",
          entityType: "INSPECTION_PLAN",
          entityId: r.planId,
          metadata: { revisionId, definitionHash: released.definitionHash },
        },
        tx,
      );
      return released;
    });
  }
  async list(q: OperationsQuery) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const term = trimQ(q.q);
    const where: Prisma.IncomingInspectionWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.disposition ? { disposition: q.disposition } : {}),
      ...(q.planRevisionId ? { planRevisionId: q.planRevisionId } : {}),
      ...(q.dateFrom || q.dateTo
        ? {
            receivedDate: {
              ...(q.dateFrom ? { gte: new Date(q.dateFrom) } : {}),
              ...(q.dateTo ? { lte: new Date(q.dateTo) } : {}),
            },
          }
        : {}),
      ...(q.supplierId ? { supplierId: q.supplierId } : {}),
      ...(q.internalPartId ? { internalPartId: q.internalPartId } : {}),
      ...(q.assignedToId ? { assignedToId: q.assignedToId } : {}),
      ...(term
        ? {
            OR: [
              { number: { contains: term } },
              { originalPartNumber: { contains: term } },
              { originalSupplier: { contains: term } },
              { items: { some: { serialNumber: { contains: term } } } },
            ],
          }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.db.client.incomingInspection.count({ where }),
      this.db.client.incomingInspection.findMany({
        where,
        skip,
        take,
        orderBy: { updatedAt: "desc" },
        include: { planRevision: { include: { plan: true } } },
      }),
    ]);
    return { items, total, page, pageSize };
  }
  async get(id: string) {
    const r = await this.db.client.incomingInspection.findUnique({
      where: { id },
      include: {
        items: { orderBy: { position: "asc" } },
        measurements: { where: { supersededAt: null } },
        nonconformances: { select: { id: true, number: true, status: true } },
        planRevision: { include: { plan: true } },
        alerts: true,
      },
    });
    if (!r) throw new NotFoundError("Incoming inspection");
    return r;
  }
  async legacyHistory(id: string) {
    await this.get(id);
    const source = await this.db.client.legacyRecord.findFirst({
      where: { entity: "inspections", targetId: id },
    });
    if (!source) return [];
    return this.db.client.legacyRecord.findMany({
      where: {
        sourceSystem: source.sourceSystem,
        entity: { in: ["inspection_notes", "inspection_activity_log"] },
        snapshot: { path: "$.inspection_id", equals: source.sourceId },
      },
      select: { sourceId: true, entity: true, snapshot: true },
      orderBy: { sourceId: "asc" },
    });
  }
  async fromInjectorTests(actor: Actor, ids: string[], planRevisionId: string) {
    if (!ids.length || new Set(ids).size !== ids.length)
      throw new BusinessRuleError("Select unique injector tests");
    return this.db.tx(async (tx, after) => {
      // A stable source selection creates one inspection even after a lost response and retry.
      for (const id of [...ids].sort())
        await this.db.lockRow(tx, "injector_tests", id);
      const key = digest([planRevisionId, ids]);
      const existing = await tx.externalReference.findUnique({
        where: {
          system_entityType_externalId: {
            system: "carbonzapp",
            entityType: "INCOMING_INSPECTION",
            externalId: key,
          },
        },
      });
      if (existing)
        return tx.incomingInspection.findUniqueOrThrow({
          where: { id: existing.entityId },
        });
      const tests = await tx.injectorTest.findMany({
        where: { id: { in: ids } },
      });
      if (tests.length !== ids.length)
        throw new NotFoundError("Selected injector test");
      const rows = ids.map((id) =>
        presentTest(tests.find((t) => t.id === id)!),
      );
      if (new Set(rows.map((r) => r.part_number)).size !== 1)
        throw new BusinessRuleError(
          "Choose one part number per inspection; comparison reports can include multiple parts",
        );
      const plan = await tx.inspectionPlanRevision.findUnique({
        where: { id: planRevisionId },
        include: { plan: true },
      });
      if (plan?.status !== "RELEASED" || plan.plan.code !== "PDI-IQI-012")
        throw new BusinessRuleError(
          "Review and release the Fuel Injector plan PDI-IQI-012 first",
        );
      const r = await this.createIn(tx, after, actor, {
        planRevisionId,
        itemCount: rows.length,
        originalPartNumber: rows[0].part_number ?? undefined,
        assignedToId: actor.userId,
        resolutionNotes:
          "Created from recorded bench results; supplier, receipt and applicable approval require review",
        header: { injectorTestIds: ids, inspector_name: actor.displayName },
      });
      const sections = structuredClone(object(r.planSnapshot).sections);
      const points = new Map<string, number>();
      const dimensional: JsonObject[] = [];
      for (const row of rows)
        for (const point of buildDimensionalFromTests(row.tests).items) {
          const key = digest([point.measurement, point.spec]);
          if (!points.has(key)) {
            points.set(key, dimensional.length + 1);
            dimensional.push({ ...point, id: dimensional.length + 1 });
          }
        }
      sections.dimensional = {
        ...(sections.dimensional ?? {}),
        title: sections.dimensional?.title ?? "Bench measurements",
        section_type: "dimensional",
        items: dimensional,
      };
      const items = rows.map((row) => {
        const item = buildItemForInjector(row, sections);
        const result = buildDimensionalFromTests(row.tests);
        item.dimensional = result.answers.map((answer, i) => ({
          ...answer,
          id: points.get(
            digest([result.items[i].measurement, result.items[i].spec]),
          ),
        }));
        return item;
      });
      // Conversion is a provenance-marked result snapshot; it never releases material or modifies a plan.
      const snapshot = {
        ...object(r.planSnapshot),
        sections,
        benchConversion: {
          testIds: ids,
          sourceHashes: ids.map(
            (id) => tests.find((t) => t.id === id)!.sourceHash,
          ),
          needsInspectorReview: true,
        },
      };
      const result = await tx.incomingInspection.update({
        where: { id: r.id },
        data: {
          planSnapshot: json(snapshot),
          sectionData: json({
            __shared: buildSharedSections(sections),
            __items: items,
          }),
        },
      });
      for (let position = 0; position < items.length; position++)
        await tx.incomingItem.update({
          where: { inspectionId_position: { inspectionId: r.id, position } },
          data: {
            serialNumber: items[position].__serial_no || null,
            results: json(items[position]),
          },
        });
      await tx.externalReference.create({
        data: {
          system: "carbonzapp",
          entityType: "INCOMING_INSPECTION",
          externalId: key,
          entityId: r.id,
          metadata: { injectorTestIds: ids },
        },
      });
      await this.audit.record(
        {
          eventType: "incoming.bench_results_copied",
          entityType: "INCOMING_INSPECTION",
          entityId: r.id,
          metadata: { testIds: ids, basePlanRevisionId: planRevisionId },
        },
        tx,
      );
      return result;
    });
  }
  private async assignee(tx: Tx, id?: string) {
    if (
      id &&
      !(await tx.user.findFirst({
        where: { id, userType: "INTERNAL", status: "ACTIVE" },
      }))
    )
      throw new BusinessRuleError("Inspector must be an active internal user");
  }
  async create(actor: Actor, dto: NewIncomingDto) {
    return this.db.tx((tx, after) => this.createIn(tx, after, actor, dto));
  }
  private async createIn(
    tx: Tx,
    after: AfterCommit,
    actor: Actor,
    dto: NewIncomingDto,
  ) {
    const plan = await tx.inspectionPlanRevision.findUnique({
      where: { id: dto.planRevisionId },
      include: { plan: true },
    });
    if (!plan || plan.status !== "RELEASED")
      throw new BusinessRuleError("Choose a released inspection plan revision");
    await this.assignee(tx, dto.assignedToId);
    let partId = dto.internalPartId ?? null;
    let sp = dto.supplierProductId
      ? await tx.supplierProduct.findUnique({
          where: { id: dto.supplierProductId },
          include: { supplier: true, internalPart: true },
        })
      : null;
    if (dto.supplierProductId && !sp)
      throw new NotFoundError("Supplier product");
    let approval = dto.productApprovalId
      ? await tx.productApproval.findUnique({
          where: { id: dto.productApprovalId },
        })
      : null;
    if (dto.productApprovalId && !approval)
      throw new NotFoundError("Product approval");
    if (approval && !sp)
      sp = await tx.supplierProduct.findUnique({
        where: { id: approval.supplierProductId },
        include: { supplier: true, internalPart: true },
      });
    if (sp && partId && sp.internalPartId !== partId)
      throw new BusinessRuleError(
        "Supplier-product part does not match the receipt",
      );
    if (
      approval &&
      (approval.status !== "ACTIVE" ||
        approval.supplierProductId !== sp?.id ||
        approval.siteId !== sp.siteId ||
        approval.supplierId !== sp.supplierId)
    )
      throw new BusinessRuleError(
        "The approval must be active for this supplier, product and site",
      );
    const received = receiptDate(dto.header.date_received);
    if (
      approval &&
      (approval.effectiveFrom > new Date() ||
        (received &&
          received.getTime() + 86_400_000 <= approval.effectiveFrom.getTime()))
    )
      throw new BusinessRuleError(
        "The selected approval was not effective on this receipt date",
      );
    if (!approval && !dto.resolutionNotes)
      throw new BusinessRuleError(
        "Record an unresolved receipt reason when no supplier-product approval is known; this does not authorize material release",
      );
    partId = sp?.internalPartId ?? partId;
    const part = partId
      ? await tx.internalPart.findUnique({ where: { id: partId } })
      : null;
    if (partId && !part) throw new NotFoundError("Part");
    const spec = partId
      ? await tx.partInspectionSpecification.findUnique({
          where: {
            internalPartId_planRevisionId: {
              internalPartId: partId,
              planRevisionId: plan.id,
            },
          },
        })
      : null;
    const effective = structuredClone(object(plan.definition));
    const specData = object(spec?.data);
    for (const [sectionKey, s] of Object.entries(object(effective.sections)))
      for (const item of object(s).items ?? []) {
        const override = specData[`${sectionKey}.${item.id}`];
        if (override != null) item.spec = String(override);
      }
    for (const c of effective.characteristics ?? []) {
      const override = object(object(specData.characteristics)[c.key]);
      for (const field of [
        "minimum",
        "maximum",
        "unit",
        "method",
        "specification",
      ])
        if (override[field] !== undefined) c[field] = override[field];
    }
    validateDefinition(effective);
    const sections = effective.sections;
    const initial = initSectionData(sections);
    const sharedKeys = Object.keys(sections).filter(
      (k) =>
        k === "receiving" ||
        String(sections[k]?.title ?? "")
          .toUpperCase()
          .includes("RECEIVING"),
    );
    const sectionData = {
      __shared: Object.fromEntries(sharedKeys.map((k) => [k, initial[k]])),
      __items: Array.from({ length: dto.itemCount }, () =>
        Object.fromEntries(
          Object.entries(initial).filter(([k]) => !sharedKeys.includes(k)),
        ),
      ),
    };
    const r = await tx.incomingInspection.create({
      data: {
        number: `IQI-${randomUUID()}`,
        planRevisionId: plan.id,
        planSnapshot: json({
          ...effective,
          partSpecificationVersion: spec?.version ?? null,
        }),
        ...(spec
          ? { specificationSnapshot: spec.data as Prisma.InputJsonValue }
          : {}),
        internalPartId: partId,
        supplierId: sp?.supplierId,
        siteId: sp?.siteId,
        supplierProductId: sp?.id,
        configurationRevisionId: approval?.configurationRevisionId,
        productApprovalId: approval?.id,
        originalPartNumber: part?.partNumber ?? dto.originalPartNumber,
        originalSupplier: sp?.supplier.name ?? dto.originalSupplier,
        resolutionNotes: dto.resolutionNotes,
        receivedDate: receiptDate(dto.header.date_received),
        header: json(dto.header),
        sectionData: json(sectionData),
        itemCount: dto.itemCount,
        assignedToId: dto.assignedToId,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        createdById: actor.userId,
        items: {
          create: Array.from({ length: dto.itemCount }, (_, position) => ({
            position,
            results: {},
          })),
        },
      },
    });
    await this.audit.record(
      {
        eventType: "incoming.created",
        entityType: "INCOMING_INSPECTION",
        entityId: r.id,
        metadata: {
          planRevisionId: plan.id,
          productApprovalId: approval?.id,
          unresolved: !approval,
        },
      },
      tx,
    );
    await this.activity.record(tx, {
      entityType: "INCOMING_INSPECTION",
      entityId: r.id,
      entityLabel: r.number,
      verb: "created",
      summary: `Incoming inspection created for ${r.originalPartNumber ?? "unresolved part"}`,
      supplierId: r.supplierId,
      internalPartId: partId,
    });
    if (dto.assignedToId)
      await this.notifications.notify(tx, after, {
        eventType: "incoming.assigned",
        title: `Inspection assigned: ${r.number}`,
        userIds: [dto.assignedToId],
        entityType: "INCOMING_INSPECTION",
        entityId: r.id,
        link: `/incoming/${r.id}`,
      });
    await this.outbox.publish(
      tx,
      "incoming.created",
      "INCOMING_INSPECTION",
      r.id,
      { number: r.number },
    );
    return r;
  }
  private async lock(tx: Tx, id: string, version: number) {
    await this.db.lockRow(tx, "incoming_inspections", id);
    const r = await tx.incomingInspection.findUnique({ where: { id } });
    if (!r) throw new NotFoundError("Incoming inspection");
    if (r.version !== version)
      throw new StaleVersionError("Incoming inspection");
    return r;
  }
  async update(actor: Actor, id: string, dto: UpdateIncomingDto) {
    return this.db.tx(async (tx) => {
      const r = await this.lock(tx, id, dto.expectedVersion);
      if (!["DRAFT", "IN_PROGRESS"].includes(r.status))
        throw new InvalidTransitionError(
          "Inspection",
          r.status,
          "edited; reopen with a reason first",
        );
      await this.assignee(tx, dto.assignedToId);
      if (dto.sectionData) {
        // Released section definitions live in the plan snapshot, not editable answer JSON.
        if (
          dto.sectionData.__admin_sections &&
          digest(dto.sectionData.__admin_sections) !==
            digest(
              object(r.sectionData).__admin_sections ??
                object(r.planSnapshot).sections,
            )
        )
          throw new BusinessRuleError(
            "Create a new plan revision to change inspection definitions",
          );
        const items = inspectionItems(dto.sectionData, r.itemCount);
        for (let position = 0; position < items.length; position++)
          await tx.incomingItem.update({
            where: { inspectionId_position: { inspectionId: id, position } },
            data: {
              serialNumber:
                String(items[position].__serial_no ?? "").slice(0, 200) || null,
              results: json(items[position]),
            },
          });
      }
      if (dto.measurements) {
        const definitions = object(r.planSnapshot).characteristics ?? [];
        const items = await tx.incomingItem.findMany({
          where: { inspectionId: id },
        });
        const seen = new Set();
        await tx.incomingMeasurement.updateMany({
          where: { inspectionId: id, supersededAt: null },
          data: { supersededAt: new Date() },
        });
        for (const m of dto.measurements) {
          const c = definitions.find(
            (c: JsonObject) => c.key === m.characteristicKey,
          );
          if (!c)
            throw new BusinessRuleError(
              `Unknown characteristic ${m.characteristicKey}`,
            );
          if (c.shared ? m.itemPosition != null : m.itemPosition == null)
            throw new BusinessRuleError(
              "Shared measurements are recorded once; item characteristics require an item position",
            );
          const key = `${m.itemPosition ?? "shared"}:${m.characteristicKey}`;
          if (seen.has(key))
            throw new BusinessRuleError(
              "A characteristic may be recorded once per item",
            );
          seen.add(key);
          const item =
            m.itemPosition == null
              ? null
              : items.find((i) => i.position === m.itemPosition);
          if (m.itemPosition != null && !item)
            throw new BusinessRuleError(
              "Measurement item is outside the receipt",
            );
          if (
            c.featureId &&
            !(await tx.featureIdentity.findFirst({
              where: {
                id: c.featureId,
                internalPartId: r.internalPartId ?? "",
              },
            }))
          )
            throw new BusinessRuleError(
              "Characteristic feature belongs to a different part",
            );
          const numeric = m.value != null;
          const outcome =
            numeric && (c.minimum != null || c.maximum != null)
              ? (c.minimum != null && m.value! < c.minimum) ||
                (c.maximum != null && m.value! > c.maximum)
                ? "FAIL"
                : "PASS"
              : (m.outcome ?? "NOT_INSPECTED");
          await tx.incomingMeasurement.create({
            data: {
              inspectionId: id,
              recordVersion: r.version + 1,
              itemId: item?.id,
              featureId: c.featureId ?? null,
              sectionKey: c.sectionKey ?? "measurements",
              characteristicKey: c.key,
              value: m.value,
              textValue: m.textValue,
              outcome,
              specification: json({
                ...c,
                planRevisionId: r.planRevisionId,
                configurationRevisionId: r.configurationRevisionId,
              }),
            },
          });
        }
      }
      const updated = await tx.incomingInspection.update({
        where: { id },
        data: {
          header: dto.header ? json(dto.header) : undefined,
          receivedDate: dto.header
            ? receiptDate(dto.header.date_received)
            : undefined,
          sectionData: dto.sectionData ? json(dto.sectionData) : undefined,
          assignedToId: dto.assignedToId,
          status: "IN_PROGRESS",
          version: { increment: 1 },
        },
      });
      await this.audit.record(
        {
          eventType: "incoming.updated",
          entityType: "INCOMING_INSPECTION",
          entityId: id,
          metadata: {
            previousVersion: r.version,
            version: updated.version,
            before: { header: r.header, sectionData: r.sectionData },
          },
        },
        tx,
      );
      return updated;
    });
  }
  async complete(actor: Actor, id: string, version: number) {
    return this.db.tx(async (tx, after) => {
      const r = await this.lock(tx, id, version);
      if (!["DRAFT", "IN_PROGRESS"].includes(r.status))
        throw new InvalidTransitionError("Inspection", r.status, "completed");
      const sd = object(r.sectionData);
      const final = completionDisposition(sd, r.itemCount);
      const items = inspectionItems(sd, r.itemCount);
      const attachments = await tx.recordAttachment.findMany({
        where: {
          entityType: "INCOMING_INSPECTION",
          entityId: id,
          removedAt: null,
          file: { status: "CLEAN" },
        },
      });
      const sections = object(object(r.planSnapshot).sections);
      const shared = (key: string) =>
        key === "receiving" ||
        String(sections[key]?.title ?? "")
          .toUpperCase()
          .includes("RECEIVING");
      for (let p = 0; p < items.length; p++) {
        if (disposition(items[p].__disposition) === "PASS") continue;
        if (
          !String(items[p].__disposition_notes ?? "").trim() ||
          !attachments.some(
            (a) =>
              !shared(String(object(a.context).sectionKey ?? "")) &&
              (object(a.context).itemPosition === p || r.itemCount === 1),
          )
        )
          throw new BusinessRuleError(
            `Item ${p + 1} requires disposition notes and scanned evidence`,
          );
      }
      for (const [key, def] of Object.entries(sections)) {
        if (
          !["pfn_checklist", "pass_fail_checklist"].includes(def.section_type)
        )
          continue;
        const positions = shared(key) ? [null] : items.map((_, p) => p);
        for (const p of positions)
          for (const row of (p == null
            ? (sd.__shared?.[key] ?? items[0][key])
            : items[p][key]) ?? []) {
            const failed =
              row.result === "F" || row.status === "F" || row.fail === true;
            const accepted = row.result === "A" || row.status === "A";
            if (!failed && !accepted) continue;
            const hasPhoto = attachments.some((a) => {
              const c = object(a.context);
              return (
                c.sectionKey === key &&
                String(c.rowId) === String(row.id) &&
                (p == null || c.itemPosition === p)
              );
            });
            if (!String(row.notes || row.finding || "").trim() || !hasPhoto)
              throw new BusinessRuleError(
                `${def.title} row ${row.id} requires notes and scanned evidence for a failed or accepted finding`,
              );
            if (
              p != null &&
              failed &&
              disposition(items[p].__disposition) === "PASS"
            )
              throw new BusinessRuleError(
                `Item ${p + 1} has a failed finding and cannot be dispositioned PASS`,
              );
          }
      }
      const measurements = await tx.incomingMeasurement.findMany({
        where: { inspectionId: id, supersededAt: null },
      });
      for (const c of object(r.planSnapshot).characteristics ?? []) {
        const requiredCount = c.shared ? 1 : r.itemCount;
        if (
          measurements.filter(
            (m) =>
              m.characteristicKey === c.key && m.outcome !== "NOT_INSPECTED",
          ).length !== requiredCount
        )
          throw new BusinessRuleError(
            `Complete characteristic ${c.key} for every applicable item`,
          );
      }
      if (final === "PASS" && measurements.some((m) => m.outcome === "FAIL"))
        throw new BusinessRuleError(
          "Failed measurements require a FAIL or ACCEPTED disposition and evidence",
        );
      const recordedItems = await tx.incomingItem.findMany({
        where: { inspectionId: id },
      });
      for (const m of measurements.filter(
        (m) => m.itemId && m.outcome === "FAIL",
      )) {
        const position = recordedItems.find((i) => i.id === m.itemId)!.position;
        if (disposition(items[position].__disposition) === "PASS")
          throw new BusinessRuleError(
            `Item ${position + 1} contains failed measurements and cannot be dispositioned PASS`,
          );
      }
      const updated = await tx.incomingInspection.update({
        where: { id },
        data: {
          status: "COMPLETE",
          disposition: final,
          completedAt: new Date(),
          completedById: actor.userId,
          version: { increment: 1 },
        },
      });
      if (final !== "PASS") {
        await tx.operationalAlert.create({
          data: {
            inspectionId: id,
            originalPartNumber: r.originalPartNumber,
            originalSupplier: r.originalSupplier,
            triggeredById: actor.userId,
            completionVersion: updated.version,
            type:
              final === "FAIL" ? "inspection_failure" : "accepted_disposition",
          },
        });
        await this.notifications.notify(tx, after, {
          eventType: "incoming.quality_alert",
          title: `${final}: ${r.number}`,
          roleKeys: ["QUALITY_MANAGER", "SUPPLIER_QUALITY"],
          entityType: "INCOMING_INSPECTION",
          entityId: id,
          link: `/incoming/${id}`,
        });
      }
      await this.audit.record(
        {
          eventType: "incoming.completed",
          entityType: "INCOMING_INSPECTION",
          entityId: id,
          metadata: { disposition: final, version: updated.version },
        },
        tx,
      );
      await this.activity.record(tx, {
        entityType: "INCOMING_INSPECTION",
        entityId: id,
        entityLabel: r.number,
        verb: "completed",
        summary: `Inspection completed: ${final}`,
        supplierId: r.supplierId,
        internalPartId: r.internalPartId,
      });
      await this.outbox.publish(
        tx,
        "incoming.completed",
        "INCOMING_INSPECTION",
        id,
        { number: r.number, disposition: final, version: updated.version },
      );
      return updated;
    });
  }
  async reopen(actor: Actor, id: string, version: number, reason: string) {
    if (reason.trim().length < 5)
      throw new BusinessRuleError("A meaningful reopening reason is required");
    return this.db.tx(async (tx) => {
      const r = await this.lock(tx, id, version);
      if (r.status !== "COMPLETE")
        throw new InvalidTransitionError("Inspection", r.status, "reopened");
      await this.audit.record(
        {
          eventType: "incoming.reopened",
          entityType: "INCOMING_INSPECTION",
          entityId: id,
          reason,
          metadata: {
            completedRecord: {
              sectionData: r.sectionData,
              header: r.header,
              disposition: r.disposition,
              completedAt: r.completedAt?.toISOString(),
              version: r.version,
            },
          },
        },
        tx,
      );
      await this.activity.record(tx, {
        entityType: "INCOMING_INSPECTION",
        entityId: id,
        entityLabel: r.number,
        verb: "reopened",
        summary: `Reopened: ${reason}`,
        supplierId: r.supplierId,
        internalPartId: r.internalPartId,
      });
      return tx.incomingInspection.update({
        where: { id },
        data: { status: "IN_PROGRESS", version: { increment: 1 } },
      });
    });
  }
  async pdf(actor: Actor, id: string) {
    const r = await this.get(id);
    const plan = object(r.planSnapshot);
    const reportPlan = structuredClone(plan);
    const data = structuredClone(object(r.sectionData));
    if (r.measurements.length) {
      const characteristicDefinitions: JsonObject[] =
        plan.characteristics ?? [];
      const definition = (shared: boolean) => ({
        title: shared
          ? "Receiving measurements (once per receipt)"
          : "Recorded characteristic measurements",
        section_type: "dimensional",
        layout: "single_value",
        items: characteristicDefinitions
          .filter((c) => !!c.shared === shared)
          .map((c) => ({
            id: c.key,
            measurement: c.name ?? c.key,
            location: c.method ?? "",
            spec:
              c.specification ??
              `${c.minimum ?? ""} to ${c.maximum ?? ""} ${c.unit ?? ""}`,
          })),
      });
      reportPlan.sections = {
        ...object(reportPlan.sections),
        structured_item_measurements: definition(false),
        ...(characteristicDefinitions.some((c) => c.shared)
          ? { receiving_measurements: definition(true) }
          : {}),
      };
      const items = inspectionItems(data, r.itemCount).map((item) => ({
        ...item,
      }));
      data.__items = items;
      for (let position = 0; position < items.length; position++)
        items[position].structured_item_measurements = r.measurements
          .filter(
            (m) =>
              m.itemId === r.items.find((i) => i.position === position)?.id,
          )
          .map((m) => ({
            id: m.characteristicKey,
            actual1: String(m.value ?? m.textValue ?? ""),
            status:
              m.outcome === "PASS" ? "P" : m.outcome === "FAIL" ? "F" : "",
          }));
      data.__shared = {
        ...object(data.__shared),
        receiving_measurements: r.measurements
          .filter((m) => !m.itemId)
          .map((m) => ({
            id: m.characteristicKey,
            actual1: String(m.value ?? m.textValue ?? ""),
            status:
              m.outcome === "PASS" ? "P" : m.outcome === "FAIL" ? "F" : "",
          })),
      };
      if (data.__admin_sections) data.__admin_sections = reportPlan.sections;
    }
    return this.evidence.render(actor, "INCOMING_INSPECTION", id, (images) =>
      generateInspectionPdf(
        {
          ...object(r.header),
          form_no: plan.form_no ?? r.planRevision.plan.code,
          part_number: r.originalPartNumber,
          supplier: r.originalSupplier,
          disposition: r.disposition,
          section_data: data,
          created_at: object(r.header).created_at ?? r.createdAt.toISOString(),
        },
        { ...reportPlan, title: plan.title ?? r.planRevision.plan.title },
        images,
      ),
    );
  }
  alerts() {
    return this.db.client.operationalAlert.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
      include: {
        inspection: {
          select: {
            id: true,
            number: true,
            originalPartNumber: true,
            disposition: true,
          },
        },
      },
    });
  }
  async acknowledge(actor: Actor, id: string) {
    return this.db.tx(async (tx) => {
      const a = await tx.operationalAlert.findUnique({ where: { id } });
      if (!a) throw new NotFoundError("Alert");
      const result = await tx.operationalAlert.updateMany({
        where: { id, acknowledgedAt: null },
        data: { acknowledgedAt: new Date(), acknowledgedById: actor.userId },
      });
      if (result.count)
        await this.audit.record(
          {
            eventType: "incoming.alert_acknowledged",
            entityType: a.inspectionId ? "INCOMING_INSPECTION" : "SYSTEM",
            entityId: a.inspectionId ?? id,
            metadata: { alertId: id },
          },
          tx,
        );
      return tx.operationalAlert.findUniqueOrThrow({ where: { id } });
    });
  }
  async alertPage(q: OperationsQuery & { acknowledged?: string }) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where: Prisma.OperationalAlertWhereInput = {
      ...(q.acknowledged === "false"
        ? { acknowledgedAt: null }
        : q.acknowledged === "true"
          ? { acknowledgedAt: { not: null } }
          : {}),
      ...(q.q?.trim()
        ? {
            OR: [
              { originalPartNumber: { contains: q.q.trim() } },
              { originalSupplier: { contains: q.q.trim() } },
              { notes: { contains: q.q.trim() } },
            ],
          }
        : {}),
    };
    const [items, total, unacknowledged] = await Promise.all([
      this.db.client.operationalAlert.findMany({
        where,
        skip,
        take,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        include: { inspection: { select: { id: true, number: true } } },
      }),
      this.db.client.operationalAlert.count({ where }),
      this.db.client.operationalAlert.count({
        where: { acknowledgedAt: null },
      }),
    ]);
    return { items, total, page, pageSize, unacknowledged };
  }
}
