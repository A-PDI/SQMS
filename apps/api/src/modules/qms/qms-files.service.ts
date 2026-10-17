import { Injectable } from "@nestjs/common";
import { Prisma } from "@sqms/db";
import type { Request, Response } from "express";
import type { Actor } from "../../common/auth/actor";
import {
  BusinessRuleError,
  NotFoundError,
  ConflictError,
} from "../../common/errors/app-errors";
import { FilesService } from "../files/files.service";
import { QmsService } from "./qms.service";
import * as p from "./qms-presenters";
import type { Row } from "./qms-presenters";
const json = (v: any) => v as Prisma.InputJsonValue;
@Injectable()
export class QmsFilesService {
  constructor(
    readonly qms: QmsService,
    readonly files: FilesService,
  ) {}
  async upload(
    actor: Actor,
    req: Request,
    type: "INCOMING_INSPECTION" | "NCR",
    id: string,
  ) {
    if (type === "INCOMING_INSPECTION") {
      const detail = await this.qms.detail(id);
      if (detail.inspection.status === "complete")
        throw new ConflictError(
          "Reopen the completed inspection before changing evidence",
        );
    } else if (
      !(await this.qms.db.client.nonconformance.findFirst({
        where: { id, archivedAt: null },
      }))
    )
      throw new NotFoundError("NCR");
    if (type === "NCR") {
      const parent = await this.qms.db.client.nonconformance.findUniqueOrThrow({
        where: { id },
        select: { qmsFields: true, legacyException: true },
      });
      if (!parent.qmsFields && !parent.legacyException)
        throw new BusinessRuleError(
          "Use the structured quality workflow to update this NCR",
        );
    }
    const fields: Record<string, string> = {};
    const file = await this.files.upload(actor, req, { fields });
    if (
      type === "NCR" &&
      !["image/jpeg", "image/png"].includes(file.contentType)
    )
      throw new BusinessRuleError("Only JPEG and PNG images are supported");
    const context = {
      sectionKey: fields.section_key || null,
      rowId: fields.item_id || null,
    };
    const a = await this.qms.db.tx(async (tx) => {
      await this.files.assertAttachable(tx, actor, [file.id]);
      const r = await tx.recordAttachment.create({
        data: {
          entityType: type,
          entityId: id,
          fileObjectId: file.id,
          context: json(context),
          description: fields.caption || null,
          visibility: "INTERNAL",
          addedById: actor.userId,
        },
        include: { file: true },
      });
      await this.qms.audit.record(
        {
          eventType: "qms.attachment.added",
          entityType: type,
          entityId: id,
          metadata: { attachmentId: r.id },
        },
        tx,
      );
      return r;
    });
    return type === "NCR"
      ? { image: p.attachment(a) }
      : { attachment: p.attachment(a) };
  }
  async list(actor: Actor, id: string) {
    return {
      attachments: (
        await this.files.listAttachments(actor, "INCOMING_INSPECTION", id)
      ).map((r) =>
        p.attachment({
          ...r,
          file: { ...r.file, sizeBytes: r.file.sizeBytes },
        }),
      ),
    };
  }
  async openWhenClean(
    actor: Actor,
    fileId: string,
    mode: "preview" | "download",
  ) {
    for (let n = 0; n < 40; n++) {
      const file = await this.qms.db.client.fileObject.findUniqueOrThrow({
        where: { id: fileId },
        select: { status: true },
      });
      if (!["QUARANTINED", "SCANNING"].includes(file.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return this.files.open(actor, fileId, mode);
  }
  async download(actor: Actor, id: string, res: Response, inline = false) {
    const a = await this.qms.db.client.recordAttachment.findFirst({
      where: { id, removedAt: null },
    });
    if (!a) throw new NotFoundError("Attachment");
    const { file, body } = await this.openWhenClean(
      actor,
      a.fileObjectId,
      inline ? "preview" : "download",
    );
    res.set({
      "Content-Type": file.contentType,
      "Content-Length": String(file.sizeBytes),
      "Cache-Control": "private, no-store",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${file.safeFilename.replace(/["\\\r\n]/g, "_")}"`,
    });
    body.on("error", () => res.destroy());
    body.pipe(res);
  }
  async remove(
    actor: Actor,
    id: string,
    type: "INCOMING_INSPECTION" | "INTERNAL_PART",
  ) {
    const a = await this.qms.db.client.recordAttachment.findFirst({
      where: { id, removedAt: null },
    });
    if (
      !a ||
      a.entityType !== type ||
      (type === "INTERNAL_PART" && p.object(a.context).kind !== "QMS_DRAWING")
    )
      throw new NotFoundError("Attachment");
    if (
      type === "INCOMING_INSPECTION" &&
      (await this.qms.detail(a.entityId)).inspection.status === "complete"
    )
      throw new ConflictError(
        "Reopen the completed inspection before changing evidence",
      );
    await this.qms.db.tx(async (tx) => {
      await tx.recordAttachment.update({
        where: { id },
        data: { removedAt: new Date(), removedById: actor.userId },
      });
      await this.qms.audit.record(
        {
          eventType: "qms.attachment.removed",
          entityType: a.entityType,
          entityId: a.entityId,
          metadata: { attachmentId: id },
        },
        tx,
      );
    });
    return { ok: true };
  }
  async drawings(q: Row) {
    const rows = await this.qms.db.client.recordAttachment.findMany({
      where: {
        entityType: "INTERNAL_PART",
        removedAt: null,
        context: { path: "$.kind", equals: "QMS_DRAWING" },
      },
      include: { file: true },
      orderBy: { addedAt: "desc" },
    });
    const parts = await this.qms.db.client.internalPart.findMany({
      where: { id: { in: rows.map((r) => r.entityId) } },
    });
    return {
      drawings: rows
        .map((r) => ({
          ...p.attachment(r),
          part_number: parts.find((part) => part.id === r.entityId)?.partNumber,
          version: p.object(r.context).version,
          notes: r.description,
          is_current: p.object(r.context).is_current ? 1 : 0,
          uploaded_by: r.addedById,
        }))
        .filter((r) => !q.part_number || r.part_number === q.part_number),
    };
  }
  async uploadDrawing(actor: Actor, req: Request) {
    const fields: Record<string, string> = {},
      file = await this.files.upload(actor, req, {
        fileField: "drawing",
        fields,
      });
    if (!fields.part_number || !fields.version)
      throw new BusinessRuleError(
        "Part number, version, and file are required",
      );
    const result = await this.qms.db.tx(async (tx) => {
      const part = await tx.internalPart.upsert({
        where: { partNumber: fields.part_number },
        create: {
          partNumber: fields.part_number,
          description: fields.part_number,
          createdById: actor.userId,
        },
        update: {},
      });
      const existing = await tx.recordAttachment.findMany({
        where: {
          entityType: "INTERNAL_PART",
          entityId: part.id,
          removedAt: null,
          context: { path: "$.kind", equals: "QMS_DRAWING" },
        },
      });
      for (const a of existing)
        await tx.recordAttachment.update({
          where: { id: a.id },
          data: {
            context: json({ ...p.object(a.context), is_current: false }),
          },
        });
      const result = await tx.recordAttachment.create({
        data: {
          entityType: "INTERNAL_PART",
          entityId: part.id,
          fileObjectId: file.id,
          context: json({
            kind: "QMS_DRAWING",
            version: fields.version,
            is_current: true,
          }),
          description: fields.notes || null,
          addedById: actor.userId,
          visibility: "INTERNAL",
        },
        include: { file: true },
      });
      await this.qms.audit.record(
        {
          eventType: "qms.drawing.uploaded",
          entityType: "INTERNAL_PART",
          entityId: part.id,
          metadata: { attachmentId: result.id },
        },
        tx,
      );
      return result;
    });
    return {
      drawing: {
        ...p.attachment(result),
        part_number: fields.part_number,
        version: fields.version,
        is_current: 1,
      },
    };
  }
  async currentDrawing(actor: Actor, id: string) {
    await this.qms.db.tx(async (tx) => {
      const row = await tx.recordAttachment.findFirst({
        where: {
          id,
          removedAt: null,
          entityType: "INTERNAL_PART",
          context: { path: "$.kind", equals: "QMS_DRAWING" },
        },
      });
      if (!row) throw new NotFoundError("Drawing");
      for (const r of await tx.recordAttachment.findMany({
        where: {
          entityType: "INTERNAL_PART",
          entityId: row.entityId,
          removedAt: null,
          context: { path: "$.kind", equals: "QMS_DRAWING" },
        },
      }))
        await tx.recordAttachment.update({
          where: { id: r.id },
          data: {
            context: json({ ...p.object(r.context), is_current: r.id === id }),
          },
        });
      await this.qms.audit.record(
        {
          eventType: "qms.drawing.current_set",
          entityType: "INTERNAL_PART",
          entityId: row.entityId,
          metadata: { drawingId: id },
        },
        tx,
      );
    });
    return { ok: true };
  }
}
