import { createHash, randomUUID } from "node:crypto";
import { PassThrough, type Readable } from "node:stream";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { EntityType, FileObject } from "@sqms/db";
import { fileExtension, sanitizeFilename, signatureMatches } from "@sqms/shared";
import { ObjectStorage, QueueRegistry } from "@sqms/server-core";
import busboy from "busboy";
import type { Request } from "express";
import { QUEUES, STORAGE } from "../../infra/tokens";
import type { Actor } from "../../common/auth/actor";
import { AccessScope } from "../../common/auth/access-scope";
import { AuditService } from "../../common/audit/audit.service";
import { ActivityService } from "../../common/audit/activity.service";
import { DbService, type Tx } from "../../common/db/db.service";
import { AppError, BusinessRuleError, ConflictError, ForbiddenError, NotFoundError, StaleVersionError } from "../../common/errors/app-errors";
import { SettingsService } from "../../common/services/settings.service";
import { EntityAccessService } from "../entity/entity-access.service";

const MB = 1024 * 1024;

/** Permissions that allow uploading files (each upload must still be attached to a record the user may edit). */
export const UPLOAD_PERMISSIONS = [
  "inspection:write",
  "repair:write",
  "document:write",
  "document_type:manage",
  "ncr:write",
  "scar:write",
  "scar:respond",
  "change:submit",
  "change:review",
  "qualification:write",
  "supplier:write",
  "deviation:write",
  "configuration:write",
];

class UploadRejected extends AppError {}

function publicFile(f: FileObject) {
  return {
    id: f.id,
    originalFilename: f.originalFilename,
    safeFilename: f.safeFilename,
    extension: f.extension,
    contentType: f.contentType,
    category: f.category,
    sizeBytes: Number(f.sizeBytes),
    sha256: f.sha256,
    status: f.status,
    scanEngine: f.scanEngine,
    scannedAt: f.scannedAt,
    description: f.description,
    uploadedById: f.uploadedById,
    createdAt: f.createdAt,
  };
}
export type PublicFile = ReturnType<typeof publicFile>;
export { publicFile };

@Injectable()
export class FilesService {
  private readonly logger = new Logger("Files");

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
    private readonly settings: SettingsService,
    private readonly entities: EntityAccessService,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
    @Inject(QUEUES) private readonly queues: QueueRegistry,
  ) {}

  /**
   * Streams a single multipart file part ("file") to object storage. The file is stored under an opaque key,
   * hashed (SHA-256) server-side, size-limited per type, checked against its declared extension's signature and
   * placed in QUARANTINED status until the malware scanner reports it clean.
   */
  async upload(actor: Actor, req: Request): Promise<PublicFile> {
    if (!UPLOAD_PERMISSIONS.some((p) => actor.permissions.has(p))) throw new ForbiddenError("You are not permitted to upload files");
    const contentType = req.headers["content-type"] ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) throw new BusinessRuleError("Uploads must use multipart/form-data", undefined, "UNSUPPORTED_MEDIA_TYPE");
    const globalMaxMb = Number(await this.settings.get<number>("files.maxUploadMb", 250));
    const declaredLength = Number(req.headers["content-length"] ?? 0);
    if (declaredLength > (globalMaxMb + 1) * MB) throw new UploadRejected(413, "PAYLOAD_TOO_LARGE", `Files may not exceed ${globalMaxMb} MB`);

    return new Promise<PublicFile>((resolve, reject) => {
      let bb: busboy.Busboy;
      try {
        bb = busboy({ headers: req.headers, limits: { files: 1, fields: 10, fieldSize: 4096, fileSize: globalMaxMb * MB + 1 } });
      } catch {
        reject(new BusinessRuleError("Malformed multipart request"));
        return;
      }
      const fields: Record<string, string> = {};
      let fileSeen = false;
      let stored: PublicFile | null = null;
      let parserClosed = false;
      let settled = false;
      const fail = (err: unknown) => {
        if (settled) return;
        settled = true;
        // Stop parsing but keep draining the request so the connection can deliver the error response.
        req.unpipe(bb);
        req.resume();
        reject(err);
      };
      const finish = async () => {
        if (settled || !parserClosed || !stored) return;
        settled = true;
        try {
          if (fields.description) {
            await this.db.client.fileObject.update({ where: { id: stored.id }, data: { description: fields.description } });
            stored.description = fields.description;
          }
          resolve(stored);
        } catch (err) {
          reject(err);
        }
      };
      bb.on("field", (name, value) => {
        if (name === "description") fields.description = value.slice(0, 500);
      });
      bb.on("file", (name, stream, info) => {
        if (name !== "file" || fileSeen) {
          stream.resume();
          return;
        }
        fileSeen = true;
        this.storeStream(actor, stream, info.filename ?? "", info.mimeType, globalMaxMb).then(
          (file) => {
            stored = file;
            void finish();
          },
          fail,
        );
      });
      bb.on("error", (err) => fail(new BusinessRuleError(`Malformed multipart request: ${err instanceof Error ? err.message : String(err)}`)));
      bb.on("close", () => {
        parserClosed = true;
        if (!fileSeen) fail(new BusinessRuleError('No file was provided (expected multipart field "file")'));
        else void finish();
      });
      req.on("aborted", () => fail(new BusinessRuleError("The upload was aborted by the client")));
      req.pipe(bb);
    });
  }

  private async storeStream(actor: Actor, source: Readable, filename: string, declaredType: string, globalMaxMb: number): Promise<PublicFile> {
    const ext = fileExtension(filename);
    const type = ext ? await this.db.client.allowedFileType.findUnique({ where: { extension: ext } }) : null;
    if (!type || !type.enabled) {
      source.resume();
      await this.audit.record({ eventType: "file.upload_rejected", outcome: "DENIED", metadata: { filename: filename.slice(0, 200), reason: "type_not_allowed", extension: ext } });
      throw new UploadRejected(415, "FILE_TYPE_NOT_ALLOWED", ext ? `Files of type .${ext} are not permitted` : "Files must have an extension");
    }
    const maxBytes = Math.min(type.maxSizeMb ?? globalMaxMb, globalMaxMb) * MB;
    const hash = createHash("sha256");
    const now = new Date();
    const storageKey = `objects/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}`;
    const contentType = (type.mimeTypes as string[])[0] ?? "application/octet-stream";
    const body = new PassThrough();
    const abort = new AbortController();
    let size = 0;
    let head = Buffer.alloc(0);
    let signatureChecked = false;
    let rejection: UploadRejected | null = null;

    const reject = (err: UploadRejected) => {
      if (rejection) return;
      rejection = err;
      // Abort the storage upload; keep draining the source so the multipart parser can complete.
      abort.abort();
      body.destroy(err);
    };
    const inspected = new Promise<void>((resolveInspection, rejectInspection) => {
      source.on("data", (chunk: Buffer) => {
        if (rejection) return; // draining
        size += chunk.length;
        if (size > maxBytes) return reject(new UploadRejected(413, "PAYLOAD_TOO_LARGE", `Files of type .${ext} may not exceed ${maxBytes / MB} MB`));
        hash.update(chunk);
        if (!signatureChecked) {
          head = Buffer.concat([head, chunk]).subarray(0, 4096);
          if (head.length >= 4096) {
            signatureChecked = true;
            if (!signatureMatches(ext, head)) return reject(new UploadRejected(422, "FILE_SIGNATURE_MISMATCH", `The file content does not match the .${ext} file type`));
          }
        }
        if (!body.write(chunk)) {
          source.pause();
          body.once("drain", () => source.resume());
        }
      });
      source.on("end", () => {
        if (!rejection) {
          if ((source as Readable & { truncated?: boolean }).truncated) reject(new UploadRejected(413, "PAYLOAD_TOO_LARGE", `Files may not exceed ${globalMaxMb} MB`));
          else if (size === 0) reject(new UploadRejected(422, "EMPTY_FILE", "The file is empty"));
          else if (!signatureChecked && !signatureMatches(ext, head)) reject(new UploadRejected(422, "FILE_SIGNATURE_MISMATCH", `The file content does not match the .${ext} file type`));
          else body.end();
        }
        resolveInspection();
      });
      source.on("error", (err) => {
        body.destroy(err);
        rejectInspection(err);
      });
    });
    const uploading = this.storage.putStream(storageKey, body, contentType, abort);
    const [inspectResult, uploadResult] = await Promise.allSettled([inspected, uploading]);
    const failure = rejection as UploadRejected | null;
    if (failure || inspectResult.status === "rejected" || uploadResult.status === "rejected") {
      await this.storage.delete(storageKey).catch(() => undefined);
      if (failure) {
        await this.audit.record({ eventType: "file.upload_rejected", outcome: "DENIED", metadata: { filename: filename.slice(0, 200), reason: failure.code, size } });
        throw failure;
      }
      const cause = inspectResult.status === "rejected" ? inspectResult.reason : uploadResult.status === "rejected" ? uploadResult.reason : null;
      this.logger.error(`Upload to object storage failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      throw new UploadRejected(502, "STORAGE_UNAVAILABLE", "The file could not be stored. Please try again.");
    }
    const file = await this.db.tx(async (tx, after) => {
      const created = await tx.fileObject.create({
        data: {
          bucket: this.storage.bucket,
          storageKey,
          originalFilename: filename.slice(0, 255),
          safeFilename: sanitizeFilename(filename),
          extension: ext,
          declaredContentType: declaredType?.slice(0, 160) || null,
          contentType,
          category: type.category,
          sizeBytes: BigInt(size),
          sha256: hash.digest("hex"),
          status: "QUARANTINED",
          uploadedById: actor.userId,
          ownerOrganizationId: actor.organizationId,
        },
      });
      await this.audit.record({ eventType: "file.uploaded", entityType: "FILE", entityId: created.id, entityLabel: created.safeFilename, metadata: { sha256: created.sha256, sizeBytes: size, contentType } }, tx);
      after.add(() => this.queues.enqueueFileScan(created.id));
      return created;
    });
    return publicFile(file);
  }

  // ------------------------------------------------------------------ authorization

  /** Determines whether the actor may read a file; throws NotFound otherwise. */
  async assertReadable(actor: Actor, fileId: string): Promise<FileObject> {
    const file = await this.db.client.fileObject.findUnique({ where: { id: fileId } });
    if (!file || file.deletedAt) throw new NotFoundError("File");
    const scope = AccessScope.of(actor);
    if (file.uploadedById === actor.userId) return file;

    // External (supplier) users.
    if (!scope.isInternal && file.ownerOrganizationId === actor.organizationId) return file;
    const revisionLinks = await this.db.client.documentRevisionFile.findMany({
      where: { fileObjectId: fileId },
      include: { revision: { include: { document: { include: { documentType: true, shares: { where: { organizationId: actor.organizationId, revokedAt: null } } } } } } },
    });
    for (const link of revisionLinks) {
      const doc = link.revision.document;
      if (scope.isInternal) {
        if (actor.permissions.has("document:read")) {
          await this.entities.assertReadable(actor, "DOCUMENT", doc.id);
          return file;
        }
        continue;
      }
      if (doc.ownerOrganizationId === actor.organizationId) return file;
      const sharedReleased =
        doc.shares.length > 0 && doc.documentType.supplierVisibility !== "INTERNAL_ONLY" && link.revision.status === "RELEASED" && doc.releasedRevisionId === link.revisionId;
      if (sharedReleased) return file;
    }
    const attachments = await this.db.client.recordAttachment.findMany({ where: { fileObjectId: fileId, ...(scope.isInternal ? {} : { visibility: "SUPPLIER" as const }), removedAt: null } });
    for (const a of attachments) {
      try {
        await this.entities.assertReadable(actor, a.entityType, a.entityId);
        return file;
      } catch {
        /* not readable; continue */
      }
    }
    const template = await this.db.client.templateRevision.findFirst({
      where: { fileObjectId: fileId, status: "EFFECTIVE", template: { status: "ACTIVE", documentType: { supplierVisibility: { not: "INTERNAL_ONLY" }, status: "ACTIVE" } } },
    });
    if (template && actor.permissions.has("document:read")) return file;
    throw new NotFoundError("File");
  }

  async metadata(actor: Actor, fileId: string): Promise<PublicFile> {
    return publicFile(await this.assertReadable(actor, fileId));
  }

  /** Opens a CLEAN file for streaming to the client. */
  async open(actor: Actor, fileId: string, mode: "download" | "preview") {
    const file = await this.assertReadable(actor, fileId);
    if (file.status !== "CLEAN") {
      throw new ConflictError(
        file.status === "QUARANTINED" ? "The file is being scanned for malware and is not yet available" : `The file is not available (${file.status})`,
        "FILE_NOT_AVAILABLE",
      );
    }
    if (mode === "preview") {
      const type = await this.db.client.allowedFileType.findUnique({ where: { extension: file.extension } });
      if (!type?.previewable) throw new BusinessRuleError("Inline preview is not supported for this file type; download it instead");
    }
    const { body } = await this.storage.getStream(file.storageKey);
    await this.audit.record({ eventType: mode === "preview" ? "file.previewed" : "file.downloaded", entityType: "FILE", entityId: file.id, entityLabel: file.safeFilename });
    return { file, body };
  }

  /** Validates that files can be attached to a controlled record by this actor. */
  async assertAttachable(tx: Tx, actor: Actor, fileIds: string[]): Promise<FileObject[]> {
    if (!fileIds.length) return [];
    const files = await tx.fileObject.findMany({ where: { id: { in: fileIds }, deletedAt: null } });
    if (files.length !== new Set(fileIds).size) throw new BusinessRuleError("One or more files do not exist");
    for (const f of files) {
      if (f.status === "INFECTED" || f.status === "REJECTED" || f.status === "SCAN_FAILED") throw new BusinessRuleError(`File ${f.safeFilename} failed security checks and cannot be attached`);
      if (f.uploadedById !== actor.userId && f.ownerOrganizationId !== actor.organizationId) throw new BusinessRuleError(`File ${f.safeFilename} cannot be attached by this user`);
    }
    return files;
  }

  // ------------------------------------------------------------------ record attachments (evidence on operational records)

  private async assertWritable(tx: Tx, actor: Actor, type: EntityType, id: string) {
    const permissions: Partial<Record<EntityType, string>> = {
      INCOMING_INSPECTION: "inspection:write", INJECTOR_TEST: "injector:sync", INJECTOR_REPAIR: "repair:write",
      SUPPLIER: "supplier:write", SUPPLIER_SITE: "supplier:write", INTERNAL_PART: "product:write", SUPPLIER_PRODUCT: "product:write",
      CONFIGURATION_REVISION: "configuration:write", SOURCING_PROJECT: "project:write", PRODUCT_QUALIFICATION: "qualification:write",
      FIRST_ARTICLE_INSPECTION: "qualification:write", CHANGE_REQUEST: "change:submit", DEVIATION: "deviation:write", NCR: "ncr:write", SCAR: actor.userType === "EXTERNAL" ? "scar:respond" : "scar:write",
    };
    const permission = permissions[type];
    const documentEvidence = actor.userType === "INTERNAL" && ["SUPPLIER", "SUPPLIER_SITE", "INTERNAL_PART", "SUPPLIER_PRODUCT"].includes(type) && actor.permissions.has("document:write");
    if (!permission || !actor.permissions.has(permission) && !documentEvidence) throw new ForbiddenError("Editing this record's evidence requires write permission");
    await this.entities.assertReadable(actor, type, id, tx);
    if (type === "INCOMING_INSPECTION") {
      await this.db.lockRow(tx, "incoming_inspections", id);
      const r = await tx.incomingInspection.findUniqueOrThrow({ where: { id } });
      if (!["DRAFT", "IN_PROGRESS"].includes(r.status)) throw new ConflictError("Reopen the inspection with a reason before changing evidence");
    }
    if (type === "NCR") {
      await this.db.lockRow(tx, "nonconformances", id);
      const r = await tx.nonconformance.findUniqueOrThrow({ where: { id } });
      if (!["OPEN", "CONTAINED", "UNDER_INVESTIGATION"].includes(r.status)) throw new ConflictError("Controlled NCR evidence cannot be changed after disposition or closure");
    }
    if (type === "CONFIGURATION_REVISION") {
      await this.db.lockRow(tx, "configuration_revisions", id);
      const r = await tx.configurationRevision.findUniqueOrThrow({ where: { id } });
      if (r.status !== "DRAFT" && r.status !== "PROPOSED") throw new ConflictError("Controlled configuration evidence is immutable");
    }
    if (type === "INJECTOR_REPAIR") {
      await this.db.lockRow(tx, "injector_repair_cases", id); const r = await tx.injectorRepairCase.findUniqueOrThrow({ where: { id } });
      if (!["OPEN", "HOLD", "ENGINEERING_REVIEW"].includes(r.status)) throw new ConflictError("Completed repair evidence is controlled history");
    }
    if (type === "PRODUCT_QUALIFICATION") {
      await this.db.lockRow(tx, "product_qualifications", id); const r = await tx.productQualification.findUniqueOrThrow({ where: { id } });
      if (["APPROVED", "REJECTED"].includes(r.status)) throw new ConflictError("Completed qualification evidence is controlled history");
    }
    if (type === "FIRST_ARTICLE_INSPECTION") {
      const first = await tx.firstArticleInspection.findUniqueOrThrow({ where: { id } });
      await this.db.lockRow(tx, "product_qualifications", first.qualificationId);
      const r = await tx.firstArticleInspection.findUniqueOrThrow({ where: { id } });
      if (["ACCEPTED", "REJECTED"].includes(r.status)) throw new ConflictError("Reviewed FAI evidence is controlled history");
    }
    if (type === "SCAR") {
      await this.db.lockRow(tx, "corrective_actions", id); const r = await tx.correctiveAction.findUniqueOrThrow({ where: { id } });
      if (["CLOSED", "CANCELLED"].includes(r.status)) throw new ConflictError("Closed corrective-action evidence is controlled history");
    }
  }

  private async attachmentContext(tx: Tx, type: EntityType, id: string, context?: Record<string, unknown>) {
    if (!context) return undefined;
    if (JSON.stringify(context).length > 5000) throw new BusinessRuleError("Attachment context is too large");
    const allowed = new Set(["sectionKey", "rowId", "itemPosition", "reportSectionId"]);
    if (Object.keys(context).some(k => !allowed.has(k))) throw new BusinessRuleError("Unsupported attachment context field");
    if (type === "INCOMING_INSPECTION" && context.itemPosition != null) {
      const r = await tx.incomingInspection.findUniqueOrThrow({ where: { id } }); const position = context.itemPosition;
      if (typeof position !== "number" || !Number.isInteger(position) || position < 0 || position >= r.itemCount) throw new BusinessRuleError("Photo item position is outside this inspection");
    }
    if (context.reportSectionId) {
      if (type !== "NCR" || typeof context.reportSectionId !== "string" || !await tx.ncrReportSection.findFirst({ where: { id: context.reportSectionId, ncrId: id, archivedAt: null } })) throw new BusinessRuleError("Photo section does not belong to this NCR report");
    }
    for (const key of ["sectionKey", "rowId"]) if (context[key] != null && (typeof context[key] !== "string" || String(context[key]).length > 100)) throw new BusinessRuleError("Invalid photo section or row identifier");
    return context as import("@sqms/db").Prisma.InputJsonValue;
  }

  async listAttachments(actor: Actor, entityType: EntityType, entityId: string) {
    await this.entities.assertReadable(actor, entityType, entityId);
    const scope = AccessScope.of(actor);
    const rows = await this.db.client.recordAttachment.findMany({
      where: { entityType, entityId, removedAt: null, ...(scope.isInternal ? {} : { visibility: "SUPPLIER" }) },
      orderBy: { addedAt: "asc" },
      include: { file: true },
    });
    return rows.map((r) => ({ id: r.id, version: r.version, description: r.description, context: r.context, visibility: r.visibility, addedAt: r.addedAt, addedById: r.addedById, file: publicFile(r.file) }));
  }

  async addAttachment(actor: Actor, input: { entityType: EntityType; entityId: string; fileId: string; description?: string; visibility?: "INTERNAL" | "SUPPLIER"; context?: Record<string, unknown> }) {
    const ref = await this.entities.assertReadable(actor, input.entityType, input.entityId);
    const scope = AccessScope.of(actor);
    const visibility = scope.isInternal ? input.visibility ?? "INTERNAL" : "SUPPLIER";
    return this.db.tx(async (tx) => {
      await this.assertWritable(tx, actor, input.entityType, input.entityId);
      const context = await this.attachmentContext(tx, input.entityType, input.entityId, input.context);
      await this.assertAttachable(tx, actor, [input.fileId]);
      const att = await tx.recordAttachment.create({ data: { entityType: input.entityType, entityId: input.entityId, fileObjectId: input.fileId, description: input.description ?? null, visibility, context, addedById: actor.userId } });
      await this.audit.record({ eventType: "attachment.added", entityType: input.entityType, entityId: input.entityId, entityLabel: ref.label, metadata: { fileId: input.fileId, visibility } }, tx);
      await this.activity.record(tx, { entityType: input.entityType, entityId: input.entityId, entityLabel: ref.label, verb: "attachment_added", summary: `Attachment added${input.description ? `: ${input.description}` : ""}`, visibility, supplierId: ref.supplierId });
      return att;
    });
  }

  async removeAttachment(actor: Actor, attachmentId: string) {
    const att = await this.db.client.recordAttachment.findUnique({ where: { id: attachmentId } });
    if (!att || att.removedAt) throw new NotFoundError("Attachment");
    const ref = await this.entities.assertReadable(actor, att.entityType, att.entityId);
    if (!AccessScope.of(actor).isInternal && att.addedById !== actor.userId) throw new NotFoundError("Attachment");
    return this.db.tx(async (tx) => {
      await this.assertWritable(tx, actor, att.entityType, att.entityId);
      await tx.recordAttachment.update({ where: { id: attachmentId }, data: { removedAt: new Date(), removedById: actor.userId } });
      await this.audit.record({ eventType: "attachment.removed", entityType: att.entityType, entityId: att.entityId, entityLabel: ref.label, metadata: { fileId: att.fileObjectId } }, tx);
    });
  }
  async editAttachment(actor: Actor, id: string, input: { expectedVersion: number; description?: string; context?: Record<string, unknown> }) {
    return this.db.tx(async tx => {
      const a = await tx.recordAttachment.findUnique({ where: { id } }); if (!a || a.removedAt) throw new NotFoundError("Attachment");
      await this.assertWritable(tx, actor, a.entityType, a.entityId);
      const context = await this.attachmentContext(tx, a.entityType, a.entityId, input.context);
      const changed = await tx.recordAttachment.updateMany({ where: { id, version: input.expectedVersion, removedAt: null }, data: { description: input.description, context, version: { increment: 1 } } });
      if (!changed.count) throw new StaleVersionError("Attachment");
      await this.audit.record({ eventType: "attachment.caption_updated", entityType: a.entityType, entityId: a.entityId, metadata: { attachmentId: id, previous: { description: a.description, context: a.context } } }, tx);
      return tx.recordAttachment.findUniqueOrThrow({ where: { id } });
    });
  }
}
