import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma } from "@sqms/db";
import { generateNcrPdf } from "@sqms/legacy-domain";
import type { Actor } from "../../common/auth/actor";
import {
  BusinessRuleError,
  NotFoundError,
  ConflictError,
} from "../../common/errors/app-errors";
import { NumberingService } from "../../common/services/numbering.service";
import { QmsService } from "./qms.service";
import * as p from "./qms-presenters";
import type { Row } from "./qms-presenters";
const include = {
  internalPart: true,
  supplier: true,
  incomingInspection: true,
  reportSections: {
    where: { archivedAt: null },
    orderBy: { sortOrder: "asc" as const },
  },
};
const json = (v: any) => v as Prisma.InputJsonValue;
@Injectable()
export class QmsQualityService {
  constructor(
    readonly qms: QmsService,
    readonly numbering: NumberingService,
  ) {}
  async nextNumber(tx: Prisma.TransactionClient) {
    await tx.numberingSequence.upsert({
      where: { key: "qms-ncr" },
      create: {
        key: "qms-ncr",
        prefix: "NCR",
        pattern: "{prefix}-{seq}",
        padding: 4,
        resetPolicy: "NEVER",
      },
      update: {},
    });
    let number: string;
    do {
      number = await this.numbering.next(tx, "qms-ncr");
    } while (await tx.nonconformance.findUnique({ where: { number } }));
    return number;
  }
  async list(q: Row) {
    const rows = (
      await this.qms.db.client.nonconformance.findMany({
        where: { archivedAt: null },
        include,
        orderBy: { createdAt: "desc" },
      })
    )
      .map(p.ncr)
      .filter(
        (r) =>
          (!q.status || r.status === q.status) &&
          (!q.severity || r.severity === q.severity) &&
          (!q.search ||
            [
              r.ncr_number,
              r.part_number,
              r.supplier,
              r.description_of_defect,
            ].some((v) =>
              String(v || "")
                .toLowerCase()
                .includes(String(q.search).toLowerCase()),
            )),
      );
    const page = p.paginate(rows, q);
    return {
      ncrs: page.rows,
      total: page.total,
      page: page.page,
      limit: page.limit,
    };
  }
  async get(id: string): Promise<Row> {
    const r = await this.qms.db.client.nonconformance.findUnique({
      where: { id },
      include,
    });
    if (!r || r.archivedAt) throw new NotFoundError("NCR");
    const images = (
      await this.qms.db.client.recordAttachment.findMany({
        where: { entityType: "NCR", entityId: id, removedAt: null },
        include: { file: true },
        orderBy: { addedAt: "asc" },
      })
    ).map(p.attachment);
    return {
      ...p.ncr(r),
      sections: r.reportSections.map((s) => ({
        id: s.id,
        title: s.title,
        body: s.body,
        sort_order: s.sortOrder,
        images: images
          .filter((i) => i.section_id === s.id)
          .sort((a, b) => a.sort_order - b.sort_order),
      })),
      photos: images
        .filter(
          (i) =>
            !i.section_id ||
            !r.reportSections.some((s) => s.id === i.section_id),
        )
        .sort((a, b) => a.sort_order - b.sort_order),
    };
  }
  fields(body: Row) {
    const out: Row = {};
    for (const key of [
      "part_number",
      "supplier",
      "po_number",
      "corrective_action_due_date",
    ])
      if (body[key] !== undefined)
        out[key] = body[key] == null ? null : String(body[key]).trim() || null;
    if (body.description_of_defect !== undefined)
      out.description_of_defect = String(
        body.description_of_defect ?? "",
      ).trim();
    if (body.quantity_affected !== undefined) {
      const raw = body.quantity_affected;
      const n = raw === null || String(raw).trim() === "" ? null : Number(raw);
      if (n !== null && (!Number.isInteger(n) || n < 0))
        throw new BusinessRuleError("Quantity affected must be a whole number");
      out.quantity_affected = n;
    }
    if (body.corrective_action_required !== undefined)
      out.corrective_action_required = [true, 1, "1", "true"].includes(
        body.corrective_action_required,
      )
        ? 1
        : 0;
    for (const [key, allowed] of Object.entries({
      status: ["open", "in_progress", "closed"],
      severity: ["minor", "major", "critical"],
      ncr_disposition: [
        "pending",
        "accepted_as_is",
        "rework",
        "return_to_supplier",
        "scrap",
        "use_as_is",
        "other",
      ],
    })) {
      if (body[key] !== undefined) {
        if (!allowed.includes(body[key]))
          throw new BusinessRuleError(`Invalid ${key.replace(/_/g, " ")}`);
        out[key] = body[key];
      }
    }
    return out;
  }
  async save(actor: Actor, id: string | null, body: Row) {
    const fields = this.fields(body);
    if (
      (!id || fields.description_of_defect !== undefined) &&
      !fields.description_of_defect
    )
      throw new BusinessRuleError("description_of_defect is required");
    const result = await this.qms.db.tx(async (tx) => {
      if (id) await this.qms.db.lockRow(tx, "nonconformances", id);
      const before = id
        ? await tx.nonconformance.findUniqueOrThrow({ where: { id } })
        : null;
      if (before?.archivedAt) throw new NotFoundError("NCR");
      if (before && !before.qmsFields && !before.legacyException)
        throw new BusinessRuleError(
          "Use the structured quality workflow to update this NCR",
        );
      const d = { ...p.object(before?.qmsFields), ...fields };
      if (!before) d.created_by_name = actor.displayName;
      const data: Row = { qmsFields: json(d), version: { increment: 1 } };
      if (fields.description_of_defect !== undefined) {
        data.defectDescription = fields.description_of_defect;
        data.title = fields.description_of_defect.slice(0, 250);
      }
      if (fields.quantity_affected !== undefined)
        data.quantityAffected = fields.quantity_affected;
      if (fields.po_number !== undefined) data.purchaseOrder = fields.po_number;
      if (fields.severity !== undefined)
        data.severity = fields.severity.toUpperCase();
      if (fields.status !== undefined) {
        data.status = {
          open: "OPEN",
          in_progress: "UNDER_INVESTIGATION",
          closed: "CLOSED",
        }[fields.status as string];
        data.closedAt =
          fields.status === "closed" ? before?.closedAt || new Date() : null;
        data.closedById = fields.status === "closed" ? actor.userId : null;
      }
      if (fields.ncr_disposition !== undefined)
        data.disposition =
          (
            {
              rework: "REWORK",
              return_to_supplier: "RETURN_TO_SUPPLIER",
              scrap: "SCRAP",
              accepted_as_is: "USE_AS_IS_CONCESSION",
              use_as_is: "USE_AS_IS_CONCESSION",
            } as Row
          )[fields.ncr_disposition] || null;
      if (fields.part_number !== undefined)
        data.internalPartId =
          (
            await tx.internalPart.findUnique({
              where: { partNumber: fields.part_number || "" },
            })
          )?.id || null;
      const r = before
        ? await tx.nonconformance.update({ where: { id: id! }, data })
        : await tx.nonconformance.create({
            data: {
              ...data,
              version: 0,
              number: await this.nextNumber(tx),
              title: fields.description_of_defect.slice(0, 250),
              dateIdentified: new Date(),
              source: body.inspection_id ? "INCOMING_INSPECTION" : "OTHER",
              incomingInspectionId: body.inspection_id || null,
              defectDescription: fields.description_of_defect,
              severity: data.severity || "MINOR",
              createdById: actor.userId,
              supplierVisible: false,
              blocksApproval: false,
            } as Prisma.NonconformanceUncheckedCreateInput,
          });
      await this.qms.audit.record(
        {
          eventType: before ? "qms.ncr.updated" : "qms.ncr.created",
          entityType: "NCR",
          entityId: r.id,
        },
        tx,
      );
      return r.id;
    });
    return { ncr: await this.get(result) };
  }
  async content(actor: Actor, id: string, body: Row) {
    const record = await this.qms.db.client.nonconformance.findUniqueOrThrow({
      where: { id },
      select: { qmsFields: true, legacyException: true },
    });
    if (!record.qmsFields && !record.legacyException)
      throw new BusinessRuleError(
        "Use the structured quality workflow to update this NCR",
      );
    const before = await this.get(id);
    if (!Array.isArray(body.sections) || body.sections.length > 50)
      throw new BusinessRuleError("At most 50 report sections are allowed");
    const ownedImages = new Set(
      [...before.photos, ...before.sections.flatMap((s: any) => s.images)].map(
        (i: any) => i.id,
      ),
    );
    const sections: Row[] = [],
      refs: Row[] = [],
      claimed = new Set<string>();
    const readText = (v: any, max: number) => {
      if (v == null) return "";
      if (typeof v !== "string" || v.length > max)
        throw new BusinessRuleError("Report text exceeds its limit");
      return v;
    };
    const claim = (images: any, sectionId: string | null) => {
      if (images == null) return;
      if (!Array.isArray(images))
        throw new BusinessRuleError("Photos must be a list");
      images.forEach((i: any, order: number) => {
        if (!ownedImages.has(i.id) || claimed.has(i.id))
          throw new BusinessRuleError(
            "Photo does not belong to this report or was used twice",
          );
        claimed.add(i.id);
        refs.push({
          id: i.id,
          sectionId,
          order,
          caption: readText(i.caption, 500).trim(),
        });
      });
    };
    const sectionIds = new Set<string>();
    body.sections.forEach((s: any, order: number) => {
      const sid = s.id || randomUUID();
      if (sectionIds.has(sid)) throw new BusinessRuleError("Duplicate section");
      sectionIds.add(sid);
      if (s.id && !before.sections.some((old: any) => old.id === s.id))
        throw new BusinessRuleError("Section does not belong to this report");
      sections.push({
        id: sid,
        title: readText(s.title, 200).trim(),
        body: readText(s.body, 20000),
        sortOrder: order,
      });
      claim(s.images, sid);
    });
    claim(body.photos, null);
    const removed: string[] = body.removed_image_ids || [];
    if (
      !Array.isArray(removed) ||
      removed.some((v) => !ownedImages.has(v) || claimed.has(v))
    )
      throw new BusinessRuleError("Invalid removed photo");
    await this.qms.db.tx(async (tx) => {
      await this.qms.db.lockRow(tx, "nonconformances", id);
      await tx.ncrReportSection.updateMany({
        where: { ncrId: id, id: { notIn: [...sectionIds] } },
        data: { archivedAt: new Date() },
      });
      for (const s of sections)
        await tx.ncrReportSection.upsert({
          where: { id: s.id },
          create: {
            id: s.id,
            title: s.title,
            body: s.body,
            sortOrder: s.sortOrder,
            ncrId: id,
          },
          update: { title: s.title, body: s.body, sortOrder: s.sortOrder },
        });
      for (const image of refs) {
        const old = await tx.recordAttachment.findUniqueOrThrow({
          where: { id: image.id },
        });
        await tx.recordAttachment.update({
          where: { id: image.id },
          data: {
            description: image.caption,
            context: json({
              ...p.object(old.context),
              reportSectionId: image.sectionId,
              sortOrder: image.order,
            }),
            version: { increment: 1 },
          },
        });
      }
      // Unmentioned concurrent uploads survive; photos from deleted sections return to the general block.
      for (const imageId of ownedImages)
        if (!claimed.has(imageId) && !removed.includes(imageId)) {
          const old = await tx.recordAttachment.findUniqueOrThrow({
            where: { id: imageId },
          });
          const c = p.object(old.context);
          if (c.reportSectionId && !sectionIds.has(c.reportSectionId))
            await tx.recordAttachment.update({
              where: { id: imageId },
              data: { context: json({ ...c, reportSectionId: null }) },
            });
        }
      await tx.recordAttachment.updateMany({
        where: { id: { in: removed }, entityType: "NCR", entityId: id },
        data: { removedAt: new Date(), removedById: actor.userId },
      });
      await this.qms.audit.record(
        { eventType: "qms.ncr.content_saved", entityType: "NCR", entityId: id },
        tx,
      );
    });
    const r = await this.get(id);
    return { sections: r.sections, photos: r.photos };
  }
  async pdf(actor: Actor, id: string) {
    const ncr = await this.get(id);
    return this.qms.evidence.render(actor, "NCR", id, (images) =>
      generateNcrPdf(ncr, {
        sections: ncr.sections.map((s: any) => ({
          ...s,
          images: images.filter((i) => i.section_id === s.id),
        })),
        photos: images.filter((i) => !i.section_id),
      }),
    );
  }
  async remove(actor: Actor, id: string) {
    const before = await this.qms.db.client.nonconformance.findUnique({
      where: { id },
    });
    if (!before || before.archivedAt) throw new NotFoundError("NCR");
    if (!before.qmsFields && !before.legacyException)
      throw new BusinessRuleError(
        "Use the structured quality workflow to update this NCR",
      );
    await this.qms.db.tx(async (tx) => {
      await tx.nonconformance.update({
        where: { id },
        data: { archivedAt: new Date(), blocksApproval: false },
      });
      await this.qms.audit.record(
        {
          eventType: "qms.ncr.deleted",
          entityType: "NCR",
          entityId: id,
          changes: {
            blocksApproval: { before: before.blocksApproval, after: false },
          },
          reason: "Deleted through the original NCR confirmation",
        },
        tx,
      );
    });
    return { ok: true };
  }
}
