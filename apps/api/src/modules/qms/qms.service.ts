import { Injectable, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Prisma } from "@sqms/db";
import {
  STANDARD_PLANS,
  generateInspectionPdf,
  generateNcrPdf,
} from "@sqms/legacy-domain";
import type { Actor } from "../../common/auth/actor";
import { DbService, Tx } from "../../common/db/db.service";
import { AuditService } from "../../common/audit/audit.service";
import { ActivityService } from "../../common/audit/activity.service";
import {
  BusinessRuleError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
} from "../../common/errors/app-errors";
import { EvidenceService } from "../operations/evidence.service";
import * as p from "./qms-presenters";
import type { Row } from "./qms-presenters";
const json = (v: any) => v as Prisma.InputJsonValue;
const include = {
  planRevision: { include: { plan: true } },
  assignedTo: { select: { displayName: true } },
};
const scalar = [
  "part_number",
  "supplier",
  "po_number",
  "description",
  "date_received",
  "inspector_name",
  "lot_size",
  "aql_level",
  "sample_size",
  "lot_serial_no",
  "signature",
  "due_date",
  "item_count",
  "assigned_to",
];
const pick = (v: Row, keys: string[]) =>
  Object.fromEntries(
    keys.filter((k) => v[k] !== undefined).map((k) => [k, v[k]]),
  );
function checkedDate(v: any) {
  if (!v) return null;
  const d = new Date(v);
  if (!Number.isFinite(d.getTime()))
    throw new BusinessRuleError("Invalid date");
  return d;
}
@Injectable()
export class QmsService implements OnModuleInit {
  constructor(
    readonly db: DbService,
    readonly audit: AuditService,
    readonly activity: ActivityService,
    readonly evidence: EvidenceService,
  ) {}
  async onModuleInit() {
    for (const def of STANDARD_PLANS)
      await this.db.client.inspectionPlan.upsert({
        where: { code: def.form_no },
        update: {},
        create: {
          code: def.form_no,
          title: def.title,
          revisions: {
            create: {
              revision: 1,
              status: "RELEASED",
              definition: json(def),
              releasedAt: new Date(),
            },
          },
        },
      });
    const revisions = await this.db.client.inspectionPlanRevision.findMany({
        orderBy: { revision: "desc" },
      }),
      seen = new Set<string>();
    for (const r of revisions) {
      const d = p.object(r.definition),
        id = d.__qms_template_id || r.id,
        active =
          d.active !== undefined
            ? !!d.active
            : !seen.has(r.planId) && r.status !== "RETIRED";
      seen.add(r.planId);
      await this.db.client.operationalTemplate.upsert({
        where: { id },
        update: {},
        create: { id, currentRevisionId: r.id, active },
      });
    }
  }
  async revisionId(id: string) {
    return (
      (await this.db.client.operationalTemplate.findUnique({ where: { id } }))
        ?.currentRevisionId || id
    );
  }
  async templates(all = false): Promise<Row[]> {
    const rows = await this.db.client.operationalTemplate.findMany({
      where: all ? {} : { active: true },
      include: { currentRevision: { include: { plan: true } } },
    });
    return rows
      .map(
        (r): Row => ({
          ...p.template(r.currentRevision),
          id: r.id,
          active: r.active ? 1 : 0,
        }),
      )
      .sort((a, b) => String(a.form_no).localeCompare(String(b.form_no)));
  }
  async template(id: string): Promise<Row> {
    const row = await this.db.client.operationalTemplate.findUnique({
      where: { id },
      include: { currentRevision: { include: { plan: true } } },
    });
    if (!row) throw new NotFoundError("Template");
    return {
      ...p.template(row.currentRevision),
      id: row.id,
      active: row.active ? 1 : 0,
    };
  }
  async saveTemplate(
    actor: Actor,
    id: string | null,
    body: Row,
    version = false,
  ) {
    const old = id ? await this.template(id) : null;
    const def: Row = {
      ...old,
      ...pick(body, [
        "form_no",
        "title",
        "component_type",
        "disposition_type",
        "revision",
        "header_schema",
        "sections",
        "active",
      ]),
      form_type: old?.form_type || "iqi_standard",
    };
    if (!def.form_no || !def.title || !def.component_type)
      throw new BusinessRuleError(
        "form_no, title, component_type are required",
      );
    if (
      !def.sections ||
      typeof def.sections !== "object" ||
      Array.isArray(def.sections)
    )
      throw new BusinessRuleError("sections must be an object");
    const stableId = !id || version ? randomUUID() : id;
    await this.db.tx(async (tx) => {
      let plan;
      const binding = id
        ? await tx.operationalTemplate.findUniqueOrThrow({
            where: { id },
            include: { currentRevision: true },
          })
        : null;
      if (binding) {
        plan = await tx.inspectionPlan.findUniqueOrThrow({
          where: { id: binding.currentRevision.planId },
        });
        await this.db.lockRow(tx, "inspection_plans", plan.id);
      } else {
        plan = await tx.inspectionPlan.findUnique({
          where: { code: def.form_no },
        });
        if (!plan)
          plan = await tx.inspectionPlan.create({
            data: {
              code: def.form_no,
              title: def.title,
              createdById: actor.userId,
            },
          });
        await this.db.lockRow(tx, "inspection_plans", plan.id);
      }
      const last = await tx.inspectionPlanRevision.findFirst({
        where: { planId: plan.id },
        orderBy: { revision: "desc" },
      });
      const revision = await tx.inspectionPlanRevision.create({
        data: {
          planId: plan.id,
          revision: (last?.revision || 0) + 1,
          status: "RELEASED",
          definition: json({
            ...def,
            __qms_template_id: stableId,
            version: version ? (old?.version || 1) + 1 : old?.version || 1,
            ...(version ? { parent_template_id: id, active: 1 } : {}),
          }),
          releasedAt: new Date(),
          releasedById: actor.userId,
        },
      });
      if (version)
        await tx.operationalTemplate.update({
          where: { id: id! },
          data: { active: false },
        });
      const active = version || def.active !== 0;
      await tx.operationalTemplate.upsert({
        where: { id: stableId },
        create: { id: stableId, currentRevisionId: revision.id, active },
        update: { currentRevisionId: revision.id, active },
      });
      if (binding && !version)
        await tx.partInspectionSpecification.updateMany({
          where: { planRevisionId: binding.currentRevisionId },
          data: { planRevisionId: revision.id },
        });
      await this.audit.record(
        {
          eventType: version ? "qms.template.versioned" : "qms.template.saved",
          entityType: "INSPECTION_PLAN",
          entityId: plan.id,
          metadata: {
            operationalTemplateId: stableId,
            revisionId: revision.id,
          },
        },
        tx,
      );
    });
    return this.template(stableId);
  }
  async deleteTemplate(id: string) {
    const current = await this.revisionId(id);
    const linked = await this.db.client.incomingInspection.findFirst({
      where: {
        OR: [
          { planRevisionId: current },
          { header: { path: "$.__qms_template_id", equals: id } },
        ],
      },
    });
    if (linked)
      throw new ConflictError(
        "Cannot delete — this template has linked inspections. Deactivate it instead.",
      );
    await this.db.client.operationalTemplate.update({
      where: { id },
      data: { active: false },
    });
    return { ok: true };
  }
  async inspectionItems() {
    const buckets: Record<string, Map<string, Row>> = {};
    for (const t of await this.templates())
      for (const [key, section] of Object.entries(t.sections) as [
        string,
        Row,
      ][]) {
        if (key.startsWith("__") || !section.section_type) continue;
        for (const item of section.items || []) {
          const name = String(item.name || item.measurement || "").trim(),
            requirement = String(
              item.requirement || item.location || "",
            ).trim();
          if (!name) continue;
          const bucket = (buckets[section.section_type] ||= new Map());
          if (!bucket.has(name.toLowerCase()))
            bucket.set(name.toLowerCase(), { name, requirement });
          else if (!bucket.get(name.toLowerCase())!.requirement && requirement)
            bucket.get(name.toLowerCase())!.requirement = requirement;
        }
      }
    return {
      items: Object.fromEntries(
        Object.entries(buckets).map(([key, values]) => [
          key,
          [...values.values()].sort((a, b) => a.name.localeCompare(b.name)),
        ]),
      ),
    };
  }
  async allInspections() {
    return (
      await this.db.client.incomingInspection.findMany({
        where: { status: { not: "ARCHIVED" } },
        include,
      })
    ).map(p.inspection);
  }
  filterInspections(rows: Row[], q: Row) {
    return rows.filter((r) => {
      for (const key of [
        "status",
        "component_type",
        "inspector_name",
        "assigned_to",
        "template_id",
        "disposition",
      ])
        if (q[key] && q[key] !== "All" && r[key] !== q[key]) return false;
      if (
        (q.date_from && (!r.date_received || r.date_received < q.date_from)) ||
        (q.date_to && (!r.date_received || r.date_received > q.date_to))
      )
        return false;
      if (
        q.exclude_disposition &&
        String(q.exclude_disposition)
          .toUpperCase()
          .split(",")
          .includes(String(r.disposition || "").toUpperCase())
      )
        return false;
      return (
        !q.search ||
        [r.part_number, r.po_number, r.inspector_name, r.lot_serial_no].some(
          (v) =>
            String(v || "")
              .toLowerCase()
              .includes(String(q.search).toLowerCase()),
        )
      );
    });
  }
  async list(q: Row) {
    const rows = this.filterInspections(await this.allInspections(), q);
    p.sort(rows, q, [
      "component_type",
      "part_number",
      "po_number",
      "lot_serial_no",
      "inspector_name",
      "date_received",
      "created_at",
      "status",
      "disposition",
      "item_count",
    ]);
    const page = p.paginate(rows, q);
    return {
      inspections: page.rows,
      total: page.total,
      page: page.page,
      limit: page.limit,
    };
  }
  async detail(id: string) {
    const r = await this.db.client.incomingInspection.findUnique({
      where: { id },
      include,
    });
    if (!r || r.status === "ARCHIVED") throw new NotFoundError("Inspection");
    const [attachments, events, legacy, partSpec] = await Promise.all([
      this.db.client.recordAttachment.findMany({
        where: {
          entityType: "INCOMING_INSPECTION",
          entityId: id,
          removedAt: null,
        },
        include: { file: true },
        orderBy: { addedAt: "asc" },
      }),
      this.db.client.activityEvent.findMany({
        where: { entityType: "INCOMING_INSPECTION", entityId: id },
        orderBy: { occurredAt: "desc" },
        take: 50,
      }),
      this.db.client.legacyRecord.findMany({
        where: {
          entity: "inspection_activity_log",
          snapshot: { path: "$.inspection_id", equals: id },
        },
      }),
      this.specs({
        template_id: p.object(r.header).__qms_template_id || r.planRevisionId,
        part_number: r.originalPartNumber,
      }),
    ]);
    return {
      inspection: p.inspection(r),
      template: { ...p.object(r.planSnapshot), id: r.planRevisionId } as Row,
      attachments: attachments.map(p.attachment),
      activity: [
        ...events.map((e) => ({
          id: e.id,
          action_type: e.verb,
          actor_name: e.actorName,
          notes: p.object(e.data).reason || null,
          created_at: p.iso(e.occurredAt),
        })),
        ...legacy.map((l) => l.snapshot),
      ]
        .sort((a: any, b: any) =>
          String(b.created_at).localeCompare(String(a.created_at)),
        )
        .slice(0, 50),
      partSpec: partSpec.specs[0] || null,
    };
  }
  async log(tx: Tx, actor: Actor, id: string, verb: string, reason?: string) {
    await this.activity.record(tx, {
      entityType: "INCOMING_INSPECTION",
      entityId: id,
      verb,
      summary: reason || verb,
      data: reason ? { reason } : undefined,
    });
    await this.audit.record(
      {
        eventType: "qms.inspection." + verb,
        entityType: "INCOMING_INSPECTION",
        entityId: id,
        reason,
      },
      tx,
    );
  }
  async projectItems(tx: Tx, r: Row) {
    const sd = p.object(r.sectionData),
      items = Array.isArray(sd.__items)
        ? sd.__items
        : [
            Object.fromEntries(
              Object.entries(sd).filter(([k]) => !k.startsWith("__")),
            ),
          ];
    for (let position = 0; position < r.itemCount; position++) {
      const data = p.object(items[position]);
      await tx.incomingItem.upsert({
        where: { inspectionId_position: { inspectionId: r.id, position } },
        create: {
          inspectionId: r.id,
          position,
          serialNumber: String(data.__serial_no || "").slice(0, 200) || null,
          results: json(data),
        },
        update: {
          serialNumber: String(data.__serial_no || "").slice(0, 200) || null,
          results: json(data),
        },
      });
    }
    const removed = await tx.incomingItem.findMany({
      where: { inspectionId: r.id, position: { gte: r.itemCount } },
    });
    for (const item of removed)
      await tx.incomingItem.update({
        where: { id: item.id },
        data: {
          serialNumber: null,
          results: json({ ...p.object(item.results), __qms_removed: true }),
        },
      });
    if (removed.length)
      await tx.incomingMeasurement.updateMany({
        where: { itemId: { in: removed.map((i) => i.id) }, supersededAt: null },
        data: { supersededAt: new Date() },
      });
  }
  async create(actor: Actor, body: Row) {
    if (!body.template_id)
      throw new BusinessRuleError("template_id is required");
    const t = await this.template(body.template_id);
    const count = Math.min(100, Math.max(1, parseInt(body.item_count) || 1));
    return this.db.tx(async (tx) => {
      const part = body.part_number
        ? await tx.internalPart.findUnique({
            where: { partNumber: String(body.part_number) },
          })
        : null;
      const r = await tx.incomingInspection.create({
        data: {
          number: "IQI-" + randomUUID(),
          planRevisionId: await this.revisionId(body.template_id),
          planSnapshot: json(t),
          header: json({
            ...pick(body, scalar),
            __qms_template_id: body.template_id,
          }),
          originalPartNumber: body.part_number || null,
          originalSupplier: body.supplier || null,
          internalPartId: part?.id,
          receivedDate: checkedDate(body.date_received),
          sectionData: json(p.object(body.section_data)),
          itemCount: count,
          assignedToId: body.assigned_to || null,
          dueAt: checkedDate(body.due_date),
          createdById: actor.userId,
        },
      });
      await this.projectItems(tx, r);
      await this.log(
        tx,
        actor,
        r.id,
        body.assigned_to ? "assigned" : "started",
      );
      return { inspection: p.inspection(r) };
    });
  }
  async update(actor: Actor, id: string, body: Row) {
    return this.db.tx(async (tx) => {
      await this.db.lockRow(tx, "incoming_inspections", id);
      const before = await tx.incomingInspection.findUnique({ where: { id } });
      if (!before || before.status === "ARCHIVED")
        throw new NotFoundError("Inspection");
      if (body.status === "complete")
        throw new BusinessRuleError(
          "Use the Complete action to close an inspection",
        );
      let fireRing = false;
      if (before.status === "COMPLETE") {
        const keys = Object.keys(body);
        const assignment =
          keys.every((k) => ["assigned_to", "due_date"].includes(k)) &&
          actor.permissions.has("inspection:reopen");
        fireRing =
          keys.length === 1 &&
          keys[0] === "section_data" &&
          this.fireRingAmendment(before, body.section_data);
        if (!assignment && !fireRing)
          throw new ConflictError(
            "Reopen the completed inspection with a reason before editing it",
          );
      }
      const header = { ...p.object(before.header), ...pick(body, scalar) };
      const data: Prisma.IncomingInspectionUncheckedUpdateInput = {
        header: json(header),
        version: { increment: 1 },
      };
      if (body.status !== undefined) {
        const status = p.statusIn(body.status);
        if (!status) throw new BusinessRuleError("Invalid status");
        data.status = status as any;
        header.__qms_status = body.status;
      }
      if (body.disposition !== undefined)
        data.disposition = body.disposition || null;
      if (body.section_data !== undefined) {
        if (
          !body.section_data ||
          typeof body.section_data !== "object" ||
          Array.isArray(body.section_data)
        )
          throw new BusinessRuleError("section_data must be an object");
        data.sectionData = json(body.section_data);
      }
      if (body.part_number !== undefined) {
        data.originalPartNumber = body.part_number || null;
        data.internalPartId =
          (
            await tx.internalPart.findUnique({
              where: { partNumber: body.part_number || "" },
            })
          )?.id || null;
      }
      if (body.supplier !== undefined)
        data.originalSupplier = body.supplier || null;
      if (body.date_received !== undefined)
        data.receivedDate = checkedDate(body.date_received);
      if (body.item_count !== undefined)
        data.itemCount = Math.min(
          100,
          Math.max(1, parseInt(body.item_count) || 1),
        );
      if (body.assigned_to !== undefined) {
        data.assignedToId = body.assigned_to || null;
        header.assigned_at = body.assigned_to ? new Date().toISOString() : null;
        header.assigned_by = body.assigned_to ? actor.userId : null;
      }
      if (body.due_date !== undefined) data.dueAt = checkedDate(body.due_date);
      const result = await tx.incomingInspection.update({
        where: { id },
        data,
      });
      await this.projectItems(tx, result);
      await this.log(
        tx,
        actor,
        id,
        fireRing
          ? "fire_ring_added"
          : body.assigned_to !== undefined
            ? body.assigned_to
              ? "assigned"
              : "unassigned"
            : "edited",
        fireRing
          ? "Add Fire Ring Protrusion to the completed cylinder-head report"
          : undefined,
      );
      return { inspection: p.inspection(result) };
    });
  }
  fireRingAmendment(before: Row, next: Row) {
    const original = p.object(before.sectionData),
      plan = p.object(before.planSnapshot);
    if (
      plan.component_type !== "cylinder_head" ||
      !next ||
      typeof next !== "object"
    )
      return false;
    const sections = original.__admin_sections || plan.sections || {},
      groove = Object.keys(sections).find(
        (k) => sections[k]?.section_type === "groove_specs",
      );
    if (!groove) return false;
    const items = (data: Row) =>
      Array.isArray(data.__items) && data.__items.length
        ? data.__items
        : [
            Object.fromEntries(
              Object.entries(data).filter(([k]) => !k.startsWith("__")),
            ),
          ];
    const ids = (sections[groove].items || [])
      .filter(
        (i: Row) =>
          i.entry === true ||
          (i.entry === undefined &&
            /wire protrusion/i.test(i.measurement || "")),
      )
      .map((i: Row) => i.id);
    if (
      items(original).some((i: Row) =>
        (i[groove]?.measurements || []).some(
          (m: Row) =>
            ids.includes(m.id) &&
            m.cylinders?.some((v: any) => String(v ?? "").trim() !== ""),
        ),
      )
    )
      return false;
    const strip = (data: Row) => ({
      shared: Object.fromEntries(
        Object.entries(data).filter(
          ([k]) => k.startsWith("__") && k !== "__items",
        ),
      ),
      items: items(data).map((i: Row) =>
        Object.fromEntries(Object.entries(i).filter(([k]) => k !== groove)),
      ),
    });
    return isDeepStrictEqual(strip(original), strip(next));
  }
  async complete(actor: Actor, id: string, body: Row) {
    return this.db.tx(async (tx) => {
      await this.db.lockRow(tx, "incoming_inspections", id);
      const before = await tx.incomingInspection.findUnique({ where: { id } });
      if (!before || before.status === "ARCHIVED")
        throw new NotFoundError("Inspection");
      if (before.status === "COMPLETE")
        throw new BusinessRuleError("Inspection already complete");
      const disposition = body.disposition || before.disposition;
      const r = await tx.incomingInspection.update({
        where: { id },
        data: {
          status: "COMPLETE",
          completedAt: new Date(),
          completedById: actor.userId,
          disposition,
          version: { increment: 1 },
        },
      });
      await this.log(tx, actor, id, "completed");
      if (
        /fail|reject/i.test(disposition || "") &&
        !(await tx.operationalAlert.findFirst({
          where: { inspectionId: id, acknowledgedAt: null },
        }))
      )
        await tx.operationalAlert.create({
          data: {
            inspectionId: id,
            originalPartNumber: r.originalPartNumber,
            originalSupplier: r.originalSupplier,
            completionVersion: r.version,
            type: "inspection_failure",
            triggeredById: actor.userId,
          },
        });
      return { inspection: p.inspection(r) };
    });
  }
  async reopen(actor: Actor, id: string, body: Row) {
    const reason = String(body.reason || "").trim();
    if (!reason || reason.length > 500)
      throw new BusinessRuleError(
        "A reason of 1–500 characters is required to reopen an inspection",
      );
    return this.db.tx(async (tx) => {
      await this.db.lockRow(tx, "incoming_inspections", id);
      const r = await tx.incomingInspection.findUnique({ where: { id } });
      if (!r || r.status !== "COMPLETE")
        throw new BusinessRuleError(
          "Only a completed inspection can be reopened",
        );
      const result = await tx.incomingInspection.update({
        where: { id },
        data: { status: "DRAFT", completedAt: null, version: { increment: 1 } },
      });
      await this.log(tx, actor, id, "reopened", reason);
      return { inspection: p.inspection(result) };
    });
  }
  async remove(actor: Actor, id: string) {
    await this.db.tx(async (tx) => {
      await this.db.lockRow(tx, "incoming_inspections", id);
      const before = await tx.incomingInspection.findUniqueOrThrow({
        where: { id },
      });
      if (
        before.status === "COMPLETE" &&
        !actor.permissions.has("inspection:reopen")
      )
        throw new ForbiddenError(
          "Completed inspection deletion requires Quality authority",
        );
      await tx.incomingInspection.update({
        where: { id },
        data: { status: "ARCHIVED", version: { increment: 1 } },
      });
      await this.log(tx, actor, id, "deleted");
    });
    return { ok: true };
  }
  async pdf(actor: Actor, id: string) {
    const { inspection, template } = await this.detail(id);
    return this.evidence.render(actor, "INCOMING_INSPECTION", id, (images) =>
      generateInspectionPdf(inspection, template, images),
    );
  }
  async specs(q: Row) {
    const revisionId = q.template_id
      ? await this.revisionId(q.template_id)
      : null;
    const bindings = await this.db.client.operationalTemplate.findMany();
    const rows = await this.db.client.partInspectionSpecification.findMany({
      where: {
        ...(revisionId ? { planRevisionId: revisionId } : {}),
        ...(q.part_number
          ? { internalPart: { partNumber: q.part_number } }
          : {}),
      },
      include: {
        internalPart: true,
        planRevision: { include: { plan: true } },
      },
      orderBy: { internalPart: { partNumber: "asc" } },
    });
    return {
      specs: rows.map((r) => ({
        id: r.id,
        template_id:
          bindings.find((b) => b.currentRevisionId === r.planRevisionId)?.id ||
          r.planRevisionId,
        part_number: r.internalPart.partNumber,
        description: r.internalPart.description,
        spec_data: r.data,
        form_no: p.template(r.planRevision).form_no,
        template_title: p.template(r.planRevision).title,
        component_type: p.template(r.planRevision).component_type,
        created_at: p.iso(r.updatedAt),
        updated_at: p.iso(r.updatedAt),
      })),
    };
  }
  async saveSpec(actor: Actor, id: string | null, body: Row) {
    const before = id
      ? await this.db.client.partInspectionSpecification.findUniqueOrThrow({
          where: { id },
          include: { internalPart: true },
        })
      : null;
    const templateId =
        body.template_id ||
        (before
          ? (
              await this.db.client.operationalTemplate.findUnique({
                where: { currentRevisionId: before.planRevisionId },
              })
            )?.id || before.planRevisionId
          : null),
      number = body.part_number || before?.internalPart.partNumber;
    if (!templateId || !number)
      throw new BusinessRuleError("template_id and part_number are required");
    const t = await this.template(templateId);
    await this.db.tx(async (tx) => {
      const part = await tx.internalPart.upsert({
        where: { partNumber: number },
        create: {
          partNumber: number,
          description: body.description || number,
          createdById: actor.userId,
        },
        update:
          body.description !== undefined
            ? { description: body.description || number }
            : {},
      });
      const currentRevisionId = await this.revisionId(templateId);
      const key = {
        internalPartId: part.id,
        planRevisionId: currentRevisionId,
      };
      if (
        id &&
        before &&
        (before.internalPartId !== part.id ||
          before.planRevisionId !== currentRevisionId)
      )
        await tx.partInspectionSpecification.delete({ where: { id } });
      await tx.partInspectionSpecification.upsert({
        where: { internalPartId_planRevisionId: key },
        create: { ...key, data: json(body.spec_data ?? before?.data ?? {}) },
        update: {
          data: json(body.spec_data ?? before?.data ?? {}),
          version: { increment: 1 },
        },
      });
      await this.audit.record(
        {
          eventType: "qms.part_spec.saved",
          entityType: "INTERNAL_PART",
          entityId: part.id,
          metadata: { form: t.form_no },
        },
        tx,
      );
    });
    return {
      spec: (await this.specs({ template_id: templateId, part_number: number }))
        .specs[0],
    };
  }
  async lookup(q: Row) {
    const rows = (await this.specs(q)).specs;
    return {
      results: rows
        .filter(
          (r) =>
            !q.q ||
            [r.part_number, r.description].some((v) =>
              String(v || "")
                .toLowerCase()
                .includes(String(q.q).trim().toLowerCase()),
            ),
        )
        .slice(0, Math.min(100, parseInt(q.limit) || 25))
        .map((r) => ({ ...r, source: "catalogue" })),
    };
  }
}
