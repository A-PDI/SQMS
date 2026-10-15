import { createHash } from "node:crypto";
import { Injectable, OnModuleInit } from "@nestjs/common";
import type { DocumentRecord, DocumentRevision, DocumentStatus, DocumentType, EntityType, Prisma, RequiredDocStatus, WorkflowInstance } from "@sqms/db";
import { canonicalJson, revisionLabel, validateFormData, type FormSchema } from "@sqms/shared";
import type { Actor } from "../../common/auth/actor";
import { AccessScope } from "../../common/auth/access-scope";
import { ActivityService } from "../../common/audit/activity.service";
import { AuditService, diffControlled } from "../../common/audit/audit.service";
import { RequestContext } from "../../common/context/request-context";
import { DbService, type AfterCommit, type Tx } from "../../common/db/db.service";
import { BusinessRuleError, ConflictError, ForbiddenError, InvalidTransitionError, NotFoundError, StaleVersionError } from "../../common/errors/app-errors";
import { toDate } from "../../common/http/dto-helpers";
import { pageArgs, sortArg, trimQ, type Page } from "../../common/http/pagination";
import { NotificationService } from "../../common/services/notification.service";
import { NumberingService } from "../../common/services/numbering.service";
import { OutboxService } from "../../common/services/outbox.service";
import { DocumentTypesService } from "../document-types/document-types.service";
import { EntityAccessService } from "../entity/entity-access.service";
import { FilesService, publicFile } from "../files/files.service";
import { WorkflowService, type WorkflowSubjectHandler } from "../workflow/workflow.service";
import type { CreateDocumentDto, DocumentLinkDto, DocumentListQuery, GenerateDocumentDto } from "./documents.dto";

type DocWithType = DocumentRecord & { documentType: DocumentType };

const REVISION_INCLUDE = {
  files: { include: { file: true }, orderBy: [{ role: "asc" }, { sortOrder: "asc" }, { addedAt: "asc" }] },
  release: true,
  templateRevision: { select: { id: true, revisionLabel: true, template: { select: { id: true, name: true } } } },
  formDefinitionVersion: { select: { id: true, version: true, schema: true, formDefinition: { select: { key: true, name: true } } } },
  acknowledgments: { include: { organization: { select: { id: true, name: true } } } },
} satisfies Prisma.DocumentRevisionInclude;

function serializeRevision(r: Prisma.DocumentRevisionGetPayload<{ include: typeof REVISION_INCLUDE }>) {
  return { ...r, files: r.files.map((f) => ({ id: f.id, role: f.role, description: f.description, addedAt: f.addedAt, file: publicFile(f.file) })) };
}

/**
 * Controlled document lifecycle: Draft -> In Review -> Approved -> Released -> Superseded / Obsolete, with rejection,
 * revision and resubmission. Released revisions are never modified; changes always create a new revision.
 */
@Injectable()
export class DocumentsService implements OnModuleInit, WorkflowSubjectHandler {
  readonly subjectType = "DOCUMENT_REVISION" as const;

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
    private readonly numbering: NumberingService,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationService,
    private readonly workflow: WorkflowService,
    private readonly files: FilesService,
    private readonly types: DocumentTypesService,
    private readonly entities: EntityAccessService,
  ) {}

  onModuleInit(): void {
    this.workflow.registerHandler(this);
  }

  // ------------------------------------------------------------------ access control

  /** Supplier users may see their own organization's documents, and released revisions explicitly shared with them. */
  private externalAccess(actor: Actor, doc: DocWithType & { shares: { organizationId: string; revokedAt: Date | null }[] }): "owner" | "shared" | null {
    if (doc.ownerOrganizationId === actor.organizationId) return "owner";
    const shared = doc.shares.some((s) => s.organizationId === actor.organizationId && !s.revokedAt);
    if (shared && doc.documentType.supplierVisibility !== "INTERNAL_ONLY" && doc.releasedRevisionId && doc.status !== "OBSOLETE") return "shared";
    return null;
  }

  async loadForActor(actor: Actor, id: string, tx?: Tx) {
    const client = tx ?? this.db.client;
    const doc = await client.documentRecord.findFirst({ where: { id, archivedAt: null }, include: { documentType: true, shares: true } });
    if (!doc) throw new NotFoundError("Document");
    const scope = AccessScope.of(actor);
    const access = scope.isInternal ? "internal" : this.externalAccess(actor, doc);
    if (!access) throw new NotFoundError("Document");
    return { doc, access };
  }

  private assertCanEdit(actor: Actor, access: string, doc: DocWithType) {
    if (!actor.permissions.has("document:write")) throw new ForbiddenError();
    if (access === "shared") throw new NotFoundError("Document");
    if (access === "owner" && doc.documentType.supplierVisibility !== "SUPPLIER_CONTRIBUTE") throw new ForbiddenError("Suppliers cannot author documents of this type");
  }

  // ------------------------------------------------------------------ queries

  private listWhere(actor: Actor, q: DocumentListQuery): Prisma.DocumentRecordWhereInput {
    const scope = AccessScope.of(actor);
    const term = trimQ(q.q);
    const ext = scope.isInternal
      ? {}
      : {
          OR: [
            { ownerOrganizationId: actor.organizationId },
            { shares: { some: { organizationId: actor.organizationId, revokedAt: null } }, releasedRevisionId: { not: null }, documentType: { supplierVisibility: { not: "INTERNAL_ONLY" as const } }, status: { not: "OBSOLETE" as const } },
          ],
        };
    return {
      archivedAt: null,
      AND: [
        ext,
        q.documentTypeId ? { documentTypeId: q.documentTypeId } : {},
        q.typeCode ? { documentType: { code: q.typeCode } } : {},
        q.status?.length ? { status: { in: q.status as DocumentStatus[] } } : {},
        q.supplierId ? { supplierId: q.supplierId } : {},
        q.entityType && q.entityId ? { links: { some: { entityType: q.entityType, entityId: q.entityId } } } : {},
        q.revision ? { revisions: { some: { revisionLabel: q.revision } } } : {},
        q.createdById ? { createdById: q.createdById } : {},
        q.updatedFrom ? { updatedAt: { gte: toDate(q.updatedFrom)! } } : {},
        q.updatedTo ? { updatedAt: { lt: new Date(toDate(q.updatedTo)!.getTime() + 86_400_000) } } : {},
        term ? { OR: [{ docNumber: { contains: term } }, { title: { contains: term } }, { documentType: { code: { contains: term } } }] } : {},
      ],
    };
  }

  async list(actor: Actor, q: DocumentListQuery): Promise<Page<unknown>> {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where = this.listWhere(actor, q);
    const [total, rows] = await Promise.all([
      this.db.client.documentRecord.count({ where }),
      this.db.client.documentRecord.findMany({
        where,
        skip,
        take,
        orderBy: sortArg(q, ["docNumber", "title", "status", "updatedAt", "createdAt"] as const, "updatedAt"),
        include: {
          documentType: { select: { id: true, code: true, name: true, acronym: true, category: true } },
          supplier: { select: { id: true, name: true, supplierNumber: true } },
          latestRevision: { select: { id: true, revisionLabel: true, status: true, submissionMethod: true, updatedAt: true } },
          releasedRevision: { select: { id: true, revisionLabel: true, releasedAt: true } },
        },
      }),
    ]);
    return { total, page, pageSize, items: rows };
  }

  async exportRows(actor: Actor, q: DocumentListQuery) {
    return this.db.client.documentRecord.findMany({
      where: this.listWhere(actor, q),
      orderBy: { docNumber: "asc" },
      take: 10_000,
      include: { documentType: { select: { code: true, name: true } }, supplier: { select: { name: true } }, latestRevision: { select: { revisionLabel: true, status: true } }, releasedRevision: { select: { revisionLabel: true, releasedAt: true } } },
    });
  }

  async get(actor: Actor, id: string) {
    const { doc, access } = await this.loadForActor(actor, id);
    const revisions = await this.db.client.documentRevision.findMany({
      where: { documentId: id, ...(access === "shared" ? { id: doc.releasedRevisionId! } : {}) },
      orderBy: { revisionNumber: "desc" },
      include: REVISION_INCLUDE,
    });
    const [links, shares, supersededBy, supersedes, supplier, createdBy] = await Promise.all([
      access === "internal" ? this.db.client.documentLink.findMany({ where: { documentId: id }, orderBy: { createdAt: "asc" } }) : Promise.resolve([]),
      access === "internal" ? this.db.client.documentShare.findMany({ where: { documentId: id }, include: { organization: { select: { id: true, name: true, supplier: { select: { id: true } } } } } }) : Promise.resolve([]),
      this.db.client.documentSupersession.findMany({ where: { supersededDocumentId: id }, include: { supersedingDocument: { select: { id: true, docNumber: true, title: true } } } }),
      this.db.client.documentSupersession.findMany({ where: { supersedingDocumentId: id }, include: { supersededDocument: { select: { id: true, docNumber: true, title: true } } } }),
      doc.supplierId ? this.db.client.supplier.findUnique({ where: { id: doc.supplierId }, select: { id: true, name: true, supplierNumber: true } }) : Promise.resolve(null),
      this.db.client.user.findUnique({ where: { id: doc.createdById }, select: { id: true, displayName: true } }),
    ]);
    const resolvedLinks = [];
    for (const l of links) {
      let label = l.entityId;
      try {
        label = (await this.entities.assertReadable(actor, l.entityType, l.entityId)).label;
      } catch {
        /* keep id */
      }
      resolvedLinks.push({ ...l, label });
    }
    const { shares: _s, ...rest } = doc;
    return { ...rest, access, supplier, createdBy, revisions: revisions.map(serializeRevision), links: resolvedLinks, shares, supersededBy, supersedes };
  }

  // ------------------------------------------------------------------ create & edit drafts

  private async validateLinks(actor: Actor, links: DocumentLinkDto[], tx?: Tx) {
    for (const l of links) await this.entities.assertReadable(actor, l.entityType, l.entityId, tx);
  }

  async create(actor: Actor, dto: CreateDocumentDto, txIn?: Tx) {
    const scope = AccessScope.of(actor);
    if (dto.links?.length) await this.validateLinks(actor, dto.links, txIn);
    const run = async (tx: Tx) => {
      const type = await tx.documentType.findUnique({ where: { id: dto.documentTypeId } });
      if (!type || type.status !== "ACTIVE") throw new BusinessRuleError("The document type is not active");
      if (!scope.isInternal && type.supplierVisibility !== "SUPPLIER_CONTRIBUTE") throw new ForbiddenError("Suppliers cannot author documents of this type");
      if (dto.submissionMethod === "UPLOAD" && !type.allowUpload) throw new BusinessRuleError("This document type does not accept uploaded submissions");
      const template = await this.types.effectiveTemplateRevision(tx, type.id);
      if (!template) throw new BusinessRuleError(`No effective template revision is configured for ${type.code}`);
      let formVersionId: string | null = null;
      let formData: Record<string, unknown> | null = null;
      if (dto.submissionMethod === "NATIVE_FORM") {
        const version = template.formDefinitionVersion ?? (type.nativeFormKey ? await tx.formDefinitionVersion.findFirst({ where: { status: "PUBLISHED", formDefinition: { key: type.nativeFormKey } }, orderBy: { version: "desc" } }) : null);
        if (!version) throw new BusinessRuleError(`${type.code} has no native web form; submit an uploaded document instead`);
        formVersionId = version.id;
        const result = validateFormData(version.schema as unknown as FormSchema, dto.formData ?? {}, "draft");
        if (!result.valid) throw new BusinessRuleError("Form data is invalid", { issues: result.issues });
        formData = result.data;
      }
      const supplierId = scope.isInternal ? dto.supplierId ?? null : actor.supplierId;
      if (supplierId && scope.isInternal && !(await tx.supplier.findUnique({ where: { id: supplierId } }))) throw new NotFoundError("Supplier");
      const docNumber = await this.numbering.next(tx, "DOCUMENT");
      const doc = await tx.documentRecord.create({
        data: { docNumber, documentTypeId: type.id, title: dto.title, description: dto.description ?? null, ownerOrganizationId: actor.organizationId, supplierId, createdById: actor.userId, status: "DRAFT" },
      });
      const rev = await tx.documentRevision.create({
        data: {
          documentId: doc.id,
          revisionNumber: 1,
          revisionLabel: revisionLabel(1),
          status: "DRAFT",
          submissionMethod: dto.submissionMethod,
          templateRevisionId: template.id,
          formDefinitionVersionId: formVersionId,
          formData: (formData ?? undefined) as Prisma.InputJsonValue | undefined,
          changeSummary: "Initial revision",
          createdById: actor.userId,
        },
      });
      await tx.documentRecord.update({ where: { id: doc.id }, data: { latestRevisionId: rev.id } });
      if (dto.fileIds?.length) {
        await this.files.assertAttachable(tx, actor, dto.fileIds);
        await tx.documentRevisionFile.createMany({ data: dto.fileIds.map((fileObjectId, i) => ({ revisionId: rev.id, fileObjectId, role: i === 0 ? "PRIMARY" : "SUPPORTING", addedById: actor.userId, sortOrder: i })) });
      }
      for (const l of dto.links ?? []) {
        await tx.documentLink.create({ data: { documentId: doc.id, entityType: l.entityType, entityId: l.entityId, linkRole: l.linkRole ?? "REFERENCE", revisionId: l.revisionId ?? null, note: l.note ?? null, createdById: actor.userId } });
      }
      if (dto.requiredDocumentId) await this.attachToRequirement(tx, actor, dto.requiredDocumentId, doc.id, type.id);
      await this.audit.record({ eventType: "document.created", entityType: "DOCUMENT", entityId: doc.id, entityLabel: `${docNumber} ${dto.title}`, metadata: { documentType: type.code, submissionMethod: dto.submissionMethod, templateRevisionId: template.id, formDefinitionVersionId: formVersionId } }, tx);
      await this.activity.record(tx, { entityType: "DOCUMENT", entityId: doc.id, entityLabel: `${docNumber} ${dto.title}`, verb: "created", summary: `${type.code} ${dto.title} created (rev A draft, ${dto.submissionMethod === "NATIVE_FORM" ? "native form" : "uploaded document"})`, supplierId, visibility: scope.isInternal ? "INTERNAL" : "SUPPLIER" });
      return { document: { ...doc, latestRevisionId: rev.id }, revision: rev };
    };
    return txIn ? run(txIn) : this.db.tx(run);
  }

  /** Links a document to a checklist requirement of the same type. */
  async attachToRequirement(tx: Tx, actor: Actor, requiredDocumentId: string, documentId: string, documentTypeId: string) {
    const req = await tx.requiredDocument.findUnique({ where: { id: requiredDocumentId }, include: { project: true, changeRequest: true, qualification: true } });
    if (!req) throw new NotFoundError("Required document");
    const supplierId = req.project?.supplierId ?? req.changeRequest?.supplierId ?? req.qualification?.supplierId ?? null;
    AccessScope.of(actor).assertSupplier(supplierId, "Required document");
    if (req.documentTypeId !== documentTypeId) throw new BusinessRuleError("The document type does not match the requirement");
    if (["ACCEPTED", "WAIVED", "NOT_APPLICABLE"].includes(req.status)) throw new BusinessRuleError(`The requirement is already ${req.status}`);
    await tx.requiredDocument.update({ where: { id: req.id }, data: { documentId, status: "OPEN", version: { increment: 1 } } });
    const entity: { entityType: EntityType; entityId: string } | null = req.projectId
      ? { entityType: "SOURCING_PROJECT", entityId: req.projectId }
      : req.changeRequestId
        ? { entityType: "CHANGE_REQUEST", entityId: req.changeRequestId }
        : req.qualificationId
          ? { entityType: "PRODUCT_QUALIFICATION", entityId: req.qualificationId }
          : null;
    if (entity) {
      await tx.documentLink.upsert({
        where: { documentId_entityType_entityId_linkRole: { documentId, entityType: entity.entityType, entityId: entity.entityId, linkRole: "REQUIREMENT" } },
        update: {},
        create: { documentId, entityType: entity.entityType, entityId: entity.entityId, linkRole: "REQUIREMENT", createdById: actor.userId },
      });
    }
    await this.audit.record({ eventType: "requirement.document_linked", entityType: "REQUIRED_DOCUMENT", entityId: req.id, metadata: { documentId } }, tx);
  }

  private async lockRevision(tx: Tx, documentId: string, revisionId: string, expectedVersion?: number) {
    await this.db.lockRow(tx, "document_revisions", revisionId);
    const rev = await tx.documentRevision.findFirst({ where: { id: revisionId, documentId } });
    if (!rev) throw new NotFoundError("Document revision");
    if (expectedVersion !== undefined && rev.version !== expectedVersion) throw new StaleVersionError("Document revision");
    return rev;
  }

  private assertDraft(rev: DocumentRevision, doc: DocumentRecord) {
    if (rev.status !== "DRAFT") {
      throw new ConflictError(
        `${doc.docNumber} revision ${rev.revisionLabel} is ${rev.status}. Controlled revisions cannot be modified; create a new revision instead.`,
        "CONTROLLED_RECORD",
      );
    }
  }

  async updateDocument(actor: Actor, id: string, dto: { expectedVersion: number; title?: string; description?: string }) {
    return this.db.tx(async (tx) => {
      const { doc, access } = await this.loadForActor(actor, id, tx);
      this.assertCanEdit(actor, access, doc);
      if (doc.releasedRevisionId) throw new ConflictError("Title and description of a released document change only through a new revision", "CONTROLLED_RECORD");
      const res = await tx.documentRecord.updateMany({ where: { id, version: dto.expectedVersion }, data: { title: dto.title, description: dto.description, version: { increment: 1 } } });
      if (res.count !== 1) throw new StaleVersionError("Document");
      const after = await tx.documentRecord.findUniqueOrThrow({ where: { id } });
      await this.audit.record({ eventType: "document.updated", entityType: "DOCUMENT", entityId: id, entityLabel: after.docNumber, changes: diffControlled(doc, after, ["title", "description"]) }, tx);
      return after;
    });
  }

  async updateDraft(actor: Actor, documentId: string, revisionId: string, dto: { expectedVersion: number; formData?: Record<string, unknown>; changeSummary?: string }) {
    return this.db.tx(async (tx) => {
      const { doc, access } = await this.loadForActor(actor, documentId, tx);
      this.assertCanEdit(actor, access, doc);
      const rev = await this.lockRevision(tx, documentId, revisionId, dto.expectedVersion);
      this.assertDraft(rev, doc);
      let formData: Prisma.InputJsonValue | undefined;
      if (dto.formData !== undefined) {
        if (rev.submissionMethod !== "NATIVE_FORM" || !rev.formDefinitionVersionId) throw new BusinessRuleError("This revision is not a native form submission");
        const version = await tx.formDefinitionVersion.findUniqueOrThrow({ where: { id: rev.formDefinitionVersionId } });
        const result = validateFormData(version.schema as unknown as FormSchema, dto.formData, "draft");
        if (!result.valid) throw new BusinessRuleError("Form data is invalid", { issues: result.issues });
        formData = result.data as Prisma.InputJsonValue;
      }
      const after = await tx.documentRevision.update({ where: { id: revisionId }, data: { ...(formData !== undefined ? { formData } : {}), ...(dto.changeSummary !== undefined ? { changeSummary: dto.changeSummary } : {}), version: { increment: 1 } } });
      await this.audit.record({ eventType: "document_revision.draft_updated", entityType: "DOCUMENT_REVISION", entityId: revisionId, entityLabel: `${doc.docNumber} rev ${rev.revisionLabel}`, metadata: { formDataChanged: formData !== undefined } }, tx);
      return after;
    });
  }

  async attachFile(actor: Actor, documentId: string, revisionId: string, dto: { fileId: string; role?: "PRIMARY" | "SUPPORTING"; description?: string }) {
    return this.db.tx(async (tx) => {
      const { doc, access } = await this.loadForActor(actor, documentId, tx);
      this.assertCanEdit(actor, access, doc);
      const rev = await this.lockRevision(tx, documentId, revisionId);
      this.assertDraft(rev, doc);
      const [file] = await this.files.assertAttachable(tx, actor, [dto.fileId]);
      const role = dto.role ?? ((await tx.documentRevisionFile.count({ where: { revisionId, role: "PRIMARY" } })) === 0 ? "PRIMARY" : "SUPPORTING");
      const link = await tx.documentRevisionFile.create({ data: { revisionId, fileObjectId: file.id, role, description: dto.description ?? null, addedById: actor.userId } });
      await tx.documentRevision.update({ where: { id: revisionId }, data: { version: { increment: 1 } } });
      await this.audit.record({ eventType: "document_revision.file_attached", entityType: "DOCUMENT_REVISION", entityId: revisionId, entityLabel: `${doc.docNumber} rev ${rev.revisionLabel}`, metadata: { fileId: file.id, sha256: file.sha256, role } }, tx);
      return link;
    });
  }

  async removeFile(actor: Actor, documentId: string, revisionId: string, linkId: string) {
    return this.db.tx(async (tx) => {
      const { doc, access } = await this.loadForActor(actor, documentId, tx);
      this.assertCanEdit(actor, access, doc);
      const rev = await this.lockRevision(tx, documentId, revisionId);
      this.assertDraft(rev, doc);
      const link = await tx.documentRevisionFile.findFirst({ where: { id: linkId, revisionId } });
      if (!link) throw new NotFoundError("Attached file");
      await tx.documentRevisionFile.delete({ where: { id: linkId } });
      await tx.documentRevision.update({ where: { id: revisionId }, data: { version: { increment: 1 } } });
      await this.audit.record({ eventType: "document_revision.file_removed", entityType: "DOCUMENT_REVISION", entityId: revisionId, entityLabel: `${doc.docNumber} rev ${rev.revisionLabel}`, metadata: { fileId: link.fileObjectId } }, tx);
    });
  }

  // ------------------------------------------------------------------ lifecycle

  private contentHash(title: string, formData: unknown, files: { sha256: string; role: string }[]): string {
    const canonical = canonicalJson({ title, formData: formData ?? null, files: [...files].sort((a, b) => (a.sha256 + a.role).localeCompare(b.sha256 + b.role)) });
    return createHash("sha256").update(canonical).digest("hex");
  }

  async syncRequirements(tx: Tx, documentId: string, revisionId: string, status: RequiredDocStatus) {
    // Waived / not-applicable / previously accepted requirements are never changed by later revisions.
    const where: Prisma.RequiredDocumentWhereInput = { documentId, status: { in: ["OPEN", "SUBMITTED", "REJECTED"] } };
    const affected = await tx.requiredDocument.findMany({ where, select: { id: true, projectId: true } });
    if (!affected.length) return;
    await tx.requiredDocument.updateMany({
      where: { id: { in: affected.map((a) => a.id) } },
      data: { status, ...(status === "ACCEPTED" ? { acceptedRevisionId: revisionId, acceptedAt: new Date() } : {}), version: { increment: 1 } },
    });
    // Submission tasks follow the requirement: in progress while under review, done once accepted, reopened on rejection.
    const taskStatus = status === "ACCEPTED" ? "DONE" : status === "SUBMITTED" ? "IN_PROGRESS" : "OPEN";
    await tx.task.updateMany({
      where: { requiredDocumentId: { in: affected.map((a) => a.id) }, type: "DOCUMENT_SUBMISSION", status: { in: ["OPEN", "IN_PROGRESS"] } },
      data: { status: taskStatus, ...(taskStatus === "DONE" ? { completedAt: new Date(), completedById: RequestContext.get()?.actor?.userId ?? null } : {}), version: { increment: 1 } },
    });
  }

  async submit(actor: Actor, documentId: string, revisionId: string, expectedVersion: number) {
    return this.db.tx(async (tx, after) => {
      const { doc, access } = await this.loadForActor(actor, documentId, tx);
      this.assertCanEdit(actor, access, doc);
      const rev = await this.lockRevision(tx, documentId, revisionId, expectedVersion);
      this.assertDraft(rev, doc);
      let formData = rev.formData;
      if (rev.submissionMethod === "NATIVE_FORM") {
        const version = await tx.formDefinitionVersion.findUniqueOrThrow({ where: { id: rev.formDefinitionVersionId! } });
        const result = validateFormData(version.schema as unknown as FormSchema, rev.formData ?? {}, "submit");
        if (!result.valid) throw new BusinessRuleError("The form is incomplete", { issues: result.issues });
        formData = result.data as Prisma.JsonValue;
        // Files referenced by attachment fields become part of the controlled revision.
        if (result.attachmentIds.length) {
          await this.files.assertAttachable(tx, actor, result.attachmentIds);
          const existing = new Set((await tx.documentRevisionFile.findMany({ where: { revisionId } })).map((f) => f.fileObjectId));
          const toAdd = result.attachmentIds.filter((id) => !existing.has(id));
          if (toAdd.length) await tx.documentRevisionFile.createMany({ data: toAdd.map((fileObjectId) => ({ revisionId, fileObjectId, role: "SUPPORTING", addedById: actor.userId })) });
        }
      }
      const files = await tx.documentRevisionFile.findMany({ where: { revisionId }, include: { file: true } });
      if (rev.submissionMethod === "UPLOAD" && !files.some((f) => f.role === "PRIMARY")) throw new BusinessRuleError("Attach the completed document (primary file) before submitting");
      const notClean = files.filter((f) => f.file.status !== "CLEAN");
      if (notClean.length) {
        throw new BusinessRuleError("All files must pass malware scanning before submission", { files: notClean.map((f) => ({ id: f.file.id, filename: f.file.safeFilename, status: f.file.status })) });
      }
      const contentHash = this.contentHash(doc.title, formData, files.map((f) => ({ sha256: f.file.sha256, role: f.role })));
      const res = await tx.documentRevision.updateMany({
        where: { id: revisionId, status: "DRAFT", version: rev.version },
        data: { status: "IN_REVIEW", contentHash, submittedAt: new Date(), submittedById: actor.userId, formData: (formData ?? undefined) as Prisma.InputJsonValue | undefined, version: { increment: 1 } },
      });
      if (res.count !== 1) throw new StaleVersionError("Document revision");
      await tx.documentRecord.update({ where: { id: documentId }, data: { status: "IN_REVIEW", version: { increment: 1 } } });
      await this.syncRequirements(tx, documentId, revisionId, "SUBMITTED");
      await this.workflow.start(tx, after, {
        definitionKey: doc.documentType.workflowKey ?? "document-review-standard",
        subjectType: "DOCUMENT_REVISION",
        subjectId: revisionId,
        subjectLabel: `${doc.docNumber} rev ${rev.revisionLabel} - ${doc.documentType.code} ${doc.title}`,
        subjectVersionRef: contentHash,
        link: `/documents/${documentId}`,
        startedById: actor.userId,
      });
      await this.audit.record({ eventType: "document_revision.submitted", entityType: "DOCUMENT_REVISION", entityId: revisionId, entityLabel: `${doc.docNumber} rev ${rev.revisionLabel}`, metadata: { contentHash, files: files.length } }, tx);
      await this.activity.record(tx, { entityType: "DOCUMENT", entityId: documentId, entityLabel: doc.docNumber, verb: "submitted", summary: `Revision ${rev.revisionLabel} submitted for review`, supplierId: doc.supplierId, visibility: "SUPPLIER" });
      return tx.documentRevision.findUniqueOrThrow({ where: { id: revisionId } });
    });
  }

  async withdraw(actor: Actor, documentId: string, revisionId: string, reason: string) {
    return this.db.tx(async (tx) => {
      const { doc, access } = await this.loadForActor(actor, documentId, tx);
      this.assertCanEdit(actor, access, doc);
      const rev = await this.lockRevision(tx, documentId, revisionId);
      if (rev.status !== "IN_REVIEW") throw new InvalidTransitionError("Document revision", rev.status, "withdrawn from review");
      if (rev.submittedById !== actor.userId && !actor.permissions.has("document:release")) throw new ForbiddenError("Only the submitter or a document controller can withdraw a revision");
      await this.workflow.cancelForSubject(tx, "DOCUMENT_REVISION", revisionId, reason);
      await tx.documentRevision.update({ where: { id: revisionId }, data: { status: "DRAFT", contentHash: null, version: { increment: 1 } } });
      await tx.documentRecord.update({ where: { id: documentId }, data: { status: doc.releasedRevisionId ? "RELEASED" : "DRAFT", version: { increment: 1 } } });
      await this.syncRequirements(tx, documentId, revisionId, "OPEN");
      await this.audit.record({ eventType: "document_revision.withdrawn", entityType: "DOCUMENT_REVISION", entityId: revisionId, entityLabel: `${doc.docNumber} rev ${rev.revisionLabel}`, reason }, tx);
    });
  }

  /** A rejected (never approved) revision returns to draft for revision and resubmission. */
  async reopen(actor: Actor, documentId: string, revisionId: string, expectedVersion: number) {
    return this.db.tx(async (tx) => {
      const { doc, access } = await this.loadForActor(actor, documentId, tx);
      this.assertCanEdit(actor, access, doc);
      const rev = await this.lockRevision(tx, documentId, revisionId, expectedVersion);
      if (rev.status !== "REJECTED") throw new InvalidTransitionError("Document revision", rev.status, "reopened");
      await tx.documentRevision.update({ where: { id: revisionId }, data: { status: "DRAFT", contentHash: null, version: { increment: 1 } } });
      await tx.documentRecord.update({ where: { id: documentId }, data: { status: doc.releasedRevisionId ? "RELEASED" : "DRAFT", version: { increment: 1 } } });
      await tx.requiredDocument.updateMany({ where: { documentId, status: "REJECTED" }, data: { status: "OPEN", version: { increment: 1 } } });
      await this.audit.record({ eventType: "document_revision.reopened", entityType: "DOCUMENT_REVISION", entityId: revisionId, entityLabel: `${doc.docNumber} rev ${rev.revisionLabel}` }, tx);
      return tx.documentRevision.findUniqueOrThrow({ where: { id: revisionId } });
    });
  }

  async release(actor: Actor, documentId: string, revisionId: string, dto: { expectedVersion: number; effectiveDate: string; releaseNotes?: string }) {
    return this.db.tx(async (tx, after) => {
      await this.db.lockRow(tx, "document_records", documentId);
      const { doc } = await this.loadForActor(actor, documentId, tx);
      const rev = await this.lockRevision(tx, documentId, revisionId, dto.expectedVersion);
      if (rev.status !== "APPROVED") throw new InvalidTransitionError("Document revision", rev.status, "released");
      const now = new Date();
      if (doc.releasedRevisionId && doc.releasedRevisionId !== revisionId) {
        await tx.documentRevision.update({ where: { id: doc.releasedRevisionId }, data: { status: "SUPERSEDED", supersededAt: now, supersededByRevisionId: revisionId, version: { increment: 1 } } });
      }
      const res = await tx.documentRevision.updateMany({ where: { id: revisionId, status: "APPROVED", version: rev.version }, data: { status: "RELEASED", releasedAt: now, releasedById: actor.userId, version: { increment: 1 } } });
      if (res.count !== 1) throw new StaleVersionError("Document revision");
      await tx.documentRecord.update({ where: { id: documentId }, data: { status: "RELEASED", releasedRevisionId: revisionId, version: { increment: 1 } } });
      const releaseNumber = await this.numbering.next(tx, "DOCUMENT_RELEASE");
      await tx.documentRelease.create({ data: { releaseNumber, revisionId, releasedById: actor.userId, effectiveDate: toDate(dto.effectiveDate)!, releaseNotes: dto.releaseNotes ?? null } });
      await this.audit.record(
        { eventType: "document_revision.released", entityType: "DOCUMENT_REVISION", entityId: revisionId, entityLabel: `${doc.docNumber} rev ${rev.revisionLabel}`, metadata: { releaseNumber, effectiveDate: dto.effectiveDate, supersededRevisionId: doc.releasedRevisionId, contentHash: rev.contentHash } },
        tx,
      );
      await this.activity.record(tx, { entityType: "DOCUMENT", entityId: documentId, entityLabel: doc.docNumber, verb: "released", summary: `Revision ${rev.revisionLabel} released (${releaseNumber}, effective ${dto.effectiveDate})`, supplierId: doc.supplierId, visibility: "SUPPLIER" });
      await this.outbox.publish(tx, "document.released", "DOCUMENT", documentId, { docNumber: doc.docNumber, revision: rev.revisionLabel, releaseNumber, documentType: doc.documentType.code });
      const shares = await tx.documentShare.findMany({ where: { documentId, revokedAt: null } });
      await this.notifications.notify(tx, after, { eventType: "document.released", title: `Released: ${doc.docNumber} rev ${rev.revisionLabel} ${doc.title}`, entityType: "DOCUMENT", entityId: documentId, link: `/documents/${documentId}`, userIds: [doc.createdById], excludeUserIds: [actor.userId] });
      for (const s of shares) await this.notifications.notify(tx, after, { eventType: "document.released", title: `New release: ${doc.docNumber} rev ${rev.revisionLabel} ${doc.title}`, entityType: "DOCUMENT", entityId: documentId, link: `/portal/documents/${documentId}`, organizationId: s.organizationId });
      return tx.documentRevision.findUniqueOrThrow({ where: { id: revisionId } });
    });
  }

  async newRevision(actor: Actor, documentId: string, changeSummary: string) {
    return this.db.tx(async (tx) => {
      await this.db.lockRow(tx, "document_records", documentId);
      const { doc, access } = await this.loadForActor(actor, documentId, tx);
      this.assertCanEdit(actor, access, doc);
      const latest = await tx.documentRevision.findFirst({ where: { documentId }, orderBy: { revisionNumber: "desc" }, include: { files: true } });
      if (!latest) throw new NotFoundError("Document revision");
      if (latest.status !== "RELEASED") throw new ConflictError(`Revision ${latest.revisionLabel} is ${latest.status}; only a released document can be revised`, "OPEN_REVISION_EXISTS");
      const template = await this.types.effectiveTemplateRevision(tx, doc.documentTypeId);
      const n = latest.revisionNumber + 1;
      const rev = await tx.documentRevision.create({
        data: {
          documentId,
          revisionNumber: n,
          revisionLabel: revisionLabel(n),
          status: "DRAFT",
          submissionMethod: latest.submissionMethod,
          templateRevisionId: template?.id ?? latest.templateRevisionId,
          formDefinitionVersionId: latest.submissionMethod === "NATIVE_FORM" ? template?.formDefinitionVersionId ?? latest.formDefinitionVersionId : null,
          formData: (latest.formData ?? undefined) as Prisma.InputJsonValue | undefined,
          changeSummary,
          createdById: actor.userId,
        },
      });
      if (latest.files.length) {
        await tx.documentRevisionFile.createMany({ data: latest.files.map((f) => ({ revisionId: rev.id, fileObjectId: f.fileObjectId, role: f.role, description: f.description, sortOrder: f.sortOrder, addedById: actor.userId })) });
      }
      await tx.documentRecord.update({ where: { id: documentId }, data: { latestRevisionId: rev.id, version: { increment: 1 } } });
      await this.audit.record({ eventType: "document_revision.created", entityType: "DOCUMENT_REVISION", entityId: rev.id, entityLabel: `${doc.docNumber} rev ${rev.revisionLabel}`, reason: changeSummary, metadata: { derivedFrom: latest.id } }, tx);
      await this.activity.record(tx, { entityType: "DOCUMENT", entityId: documentId, entityLabel: doc.docNumber, verb: "revised", summary: `Revision ${rev.revisionLabel} opened: ${changeSummary}`, supplierId: doc.supplierId });
      return rev;
    });
  }

  async obsolete(actor: Actor, documentId: string, reason: string) {
    return this.db.tx(async (tx) => {
      await this.db.lockRow(tx, "document_records", documentId);
      const { doc } = await this.loadForActor(actor, documentId, tx);
      if (!doc.releasedRevisionId || doc.status === "OBSOLETE") throw new InvalidTransitionError("Document", doc.status, "made obsolete");
      await tx.documentRevision.update({ where: { id: doc.releasedRevisionId }, data: { status: "OBSOLETE", obsoletedAt: new Date(), version: { increment: 1 } } });
      await tx.documentRecord.update({ where: { id: documentId }, data: { status: "OBSOLETE", version: { increment: 1 } } });
      await this.audit.record({ eventType: "document.obsoleted", entityType: "DOCUMENT", entityId: documentId, entityLabel: doc.docNumber, reason, changes: { status: { before: doc.status, after: "OBSOLETE" } } }, tx);
      await this.outbox.publish(tx, "document.obsoleted", "DOCUMENT", documentId, { docNumber: doc.docNumber });
    });
  }

  async supersede(actor: Actor, documentId: string, supersedingId: string, reason: string) {
    if (documentId === supersedingId) throw new BusinessRuleError("A document cannot supersede itself");
    return this.db.tx(async (tx) => {
      await this.db.lockRow(tx, "document_records", documentId);
      const { doc } = await this.loadForActor(actor, documentId, tx);
      const { doc: newer } = await this.loadForActor(actor, supersedingId, tx);
      if (!newer.releasedRevisionId) throw new BusinessRuleError("The superseding document must have a released revision");
      if (!doc.releasedRevisionId || doc.status !== "RELEASED") throw new InvalidTransitionError("Document", doc.status, "superseded");
      await tx.documentSupersession.create({ data: { supersededDocumentId: documentId, supersedingDocumentId: supersedingId, reason, createdById: actor.userId } });
      await tx.documentRevision.update({ where: { id: doc.releasedRevisionId }, data: { status: "SUPERSEDED", supersededAt: new Date(), version: { increment: 1 } } });
      await tx.documentRecord.update({ where: { id: documentId }, data: { status: "SUPERSEDED", version: { increment: 1 } } });
      await this.audit.record({ eventType: "document.superseded", entityType: "DOCUMENT", entityId: documentId, entityLabel: doc.docNumber, reason, metadata: { supersededBy: newer.docNumber } }, tx);
    });
  }

  // ------------------------------------------------------------------ links, shares, acknowledgments

  async addLink(actor: Actor, documentId: string, dto: DocumentLinkDto) {
    await this.validateLinks(actor, [dto]);
    return this.db.tx(async (tx) => {
      const { doc, access } = await this.loadForActor(actor, documentId, tx);
      if (access !== "internal") throw new NotFoundError("Document");
      if (dto.revisionId && !(await tx.documentRevision.findFirst({ where: { id: dto.revisionId, documentId } }))) throw new BusinessRuleError("The pinned revision does not belong to this document");
      const link = await tx.documentLink.create({ data: { documentId, entityType: dto.entityType, entityId: dto.entityId, linkRole: dto.linkRole ?? "REFERENCE", revisionId: dto.revisionId ?? null, note: dto.note ?? null, createdById: actor.userId } });
      await this.audit.record({ eventType: "document.linked", entityType: "DOCUMENT", entityId: documentId, entityLabel: doc.docNumber, metadata: { entityType: dto.entityType, entityId: dto.entityId, linkRole: link.linkRole, revisionId: dto.revisionId } }, tx);
      return link;
    });
  }

  async removeLink(actor: Actor, documentId: string, linkId: string) {
    return this.db.tx(async (tx) => {
      const { doc, access } = await this.loadForActor(actor, documentId, tx);
      if (access !== "internal") throw new NotFoundError("Document");
      const link = await tx.documentLink.findFirst({ where: { id: linkId, documentId } });
      if (!link) throw new NotFoundError("Link");
      if (link.linkRole === "REQUIREMENT") throw new BusinessRuleError("Requirement links are managed from the checklist");
      await tx.documentLink.delete({ where: { id: linkId } });
      await this.audit.record({ eventType: "document.unlinked", entityType: "DOCUMENT", entityId: documentId, entityLabel: doc.docNumber, metadata: { entityType: link.entityType, entityId: link.entityId } }, tx);
    });
  }

  async share(actor: Actor, documentId: string, supplierId: string, note?: string) {
    return this.db.tx(async (tx) => {
      const { doc, access } = await this.loadForActor(actor, documentId, tx);
      if (access !== "internal") throw new NotFoundError("Document");
      if (doc.documentType.supplierVisibility === "INTERNAL_ONLY") throw new BusinessRuleError(`${doc.documentType.code} documents are internal-only and cannot be shared with suppliers`);
      const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
      if (!supplier) throw new NotFoundError("Supplier");
      const share = await tx.documentShare.upsert({
        where: { documentId_organizationId: { documentId, organizationId: supplier.organizationId } },
        update: { revokedAt: null, grantedById: actor.userId, grantedAt: new Date(), note: note ?? null },
        create: { documentId, organizationId: supplier.organizationId, grantedById: actor.userId, note: note ?? null },
      });
      await this.audit.record({ eventType: "document.shared", entityType: "DOCUMENT", entityId: documentId, entityLabel: doc.docNumber, metadata: { supplierId, organizationId: supplier.organizationId } }, tx);
      await this.activity.record(tx, { entityType: "DOCUMENT", entityId: documentId, entityLabel: doc.docNumber, verb: "shared", summary: `Shared with supplier ${supplier.name}`, supplierId });
      return share;
    });
  }

  async revokeShare(actor: Actor, documentId: string, shareId: string) {
    return this.db.tx(async (tx) => {
      const { doc, access } = await this.loadForActor(actor, documentId, tx);
      if (access !== "internal") throw new NotFoundError("Document");
      const share = await tx.documentShare.findFirst({ where: { id: shareId, documentId, revokedAt: null } });
      if (!share) throw new NotFoundError("Share");
      await tx.documentShare.update({ where: { id: shareId }, data: { revokedAt: new Date() } });
      await this.audit.record({ eventType: "document.share_revoked", entityType: "DOCUMENT", entityId: documentId, entityLabel: doc.docNumber, metadata: { organizationId: share.organizationId } }, tx);
    });
  }

  async acknowledge(actor: Actor, documentId: string, revisionId: string, dto: { supplierId?: string; acknowledgedByName: string; comment?: string }) {
    return this.db.tx(async (tx) => {
      const { doc, access } = await this.loadForActor(actor, documentId, tx);
      const rev = await tx.documentRevision.findFirst({ where: { id: revisionId, documentId } });
      if (!rev) throw new NotFoundError("Document revision");
      if (rev.status !== "RELEASED") throw new BusinessRuleError("Only released revisions can be acknowledged");
      let organizationId = actor.organizationId;
      if (access === "internal") {
        const supplier = dto.supplierId ? await tx.supplier.findUnique({ where: { id: dto.supplierId } }) : null;
        if (!supplier) throw new BusinessRuleError("Select the supplier whose acknowledgment is being recorded");
        organizationId = supplier.organizationId;
      }
      const ack = await tx.documentAcknowledgment.create({ data: { revisionId, organizationId, userId: access === "internal" ? null : actor.userId, acknowledgedByName: dto.acknowledgedByName, comment: dto.comment ?? null } });
      await this.audit.record({ eventType: "document.acknowledged", entityType: "DOCUMENT_REVISION", entityId: revisionId, entityLabel: `${doc.docNumber} rev ${rev.revisionLabel}`, metadata: { organizationId, by: dto.acknowledgedByName } }, tx);
      await this.activity.record(tx, { entityType: "DOCUMENT", entityId: documentId, entityLabel: doc.docNumber, verb: "acknowledged", summary: `Revision ${rev.revisionLabel} acknowledged by ${dto.acknowledgedByName}`, supplierId: doc.supplierId, visibility: "SUPPLIER" });
      return ack;
    });
  }

  // ------------------------------------------------------------------ generated native documents from structured data

  async generateFromConfiguration(actor: Actor, dto: GenerateDocumentDto) {
    const codes = { SBPS: "ENG-04", DELTA_SPEC: "ENG-06", CCM: "ENG-08" } as const;
    const code = codes[dto.kind];
    return this.db.tx(async (tx) => {
      const rev = await tx.configurationRevision.findUnique({
        where: { id: dto.configurationRevisionId },
        include: {
          baseline: true,
          requirements: { orderBy: [{ sortOrder: "asc" }, { code: "asc" }] },
          characteristics: { orderBy: [{ sortOrder: "asc" }, { charNumber: "asc" }] },
          configuration: { include: { baseConfiguration: true, supplierProduct: { include: { internalPart: true, supplier: true, supplierPart: true, site: true } } } },
        },
      });
      if (!rev) throw new NotFoundError("Configuration revision");
      const type = await tx.documentType.findUniqueOrThrow({ where: { code } });
      const sp = rev.configuration.supplierProduct;
      const configRef = `${rev.configuration.configCode} rev ${rev.revisionLabel}`;
      let formData: Record<string, unknown>;
      if (dto.kind === "SBPS") {
        const b = rev.baseline;
        formData = {
          internalPartNumber: sp.internalPart.partNumber,
          supplierName: sp.supplier.name,
          supplierPartNumber: rev.configuration.customPartNumber ?? sp.supplierPart.supplierPartNumber,
          supplierProductRevision: rev.supplierProductRevision ?? "",
          manufacturingSite: `${sp.site.siteCode} ${sp.site.name}`,
          configurationRef: configRef,
          baselineType: b?.baselineType ?? "",
          drawingNumber: b?.drawingNumber ?? b?.specificationNumber ?? "",
          drawingRevision: b?.drawingRevision ?? b?.specificationRevision ?? "",
          material: b?.material ?? "",
          coating: b?.coating ?? "",
          heatTreatment: b?.heatTreatment ?? "",
          keyDimensions: b?.keyDimensions ?? "",
          performanceRequirements: b?.performanceRequirements ?? "",
          operatingRequirements: b?.operatingRequirements ?? "",
          guaranteedCharacteristics: (b?.guaranteedCharacteristics ?? "")
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l) => ({ characteristic: l.split(":")[0].slice(0, 250), specification: (l.split(":").slice(1).join(":").trim() || l).slice(0, 500), method: "" })),
          notes: b?.notes ?? "",
        };
      } else if (dto.kind === "DELTA_SPEC") {
        if (!rev.requirements.length) throw new BusinessRuleError("The configuration revision has no delta requirements");
        formData = {
          internalPartNumber: sp.internalPart.partNumber,
          supplierName: sp.supplier.name,
          baseConfiguration: rev.configuration.baseConfiguration ? `${rev.configuration.baseConfiguration.configCode} ${rev.configuration.baseConfiguration.name}` : "Supplier standard configuration",
          customConfiguration: `${configRef}${rev.configuration.customPartNumber ? ` (${rev.configuration.customPartNumber})` : ""}`,
          requirements: rev.requirements.map((r) => ({ code: r.code, category: r.category, title: r.title, baselineValue: r.baselineValue ?? "", requiredValue: r.requiredValue, acceptanceCriteria: r.acceptanceCriteria, ackStatus: r.ackStatus })),
        };
      } else {
        if (!rev.characteristics.length) throw new BusinessRuleError("The configuration revision has no critical characteristics");
        formData = {
          internalPartNumber: sp.internalPart.partNumber,
          configurationRef: configRef,
          characteristics: rev.characteristics.map((c) => ({
            charNumber: c.charNumber,
            name: c.name,
            classification: c.classification,
            specification: c.specification ?? (c.nominal !== null ? `${c.nominal.toString()} +${c.tolerancePlus?.toString() ?? "0"}/-${c.toleranceMinus?.toString() ?? "0"} ${c.unit ?? ""}`.trim() : ""),
            measurementMethod: c.measurementMethod ?? "",
            inspectionFrequency: c.inspectionFrequency ?? "",
            acceptanceCriteria: c.acceptanceCriteria ?? "",
          })),
        };
      }
      // Reuse the document already generated for this revision, if any.
      const existing = await tx.documentRecord.findFirst({
        where: { documentTypeId: type.id, archivedAt: null, links: { some: { entityType: "CONFIGURATION_REVISION", entityId: rev.id, linkRole: "GENERATED_FROM" } } },
        include: { latestRevision: true },
      });
      if (existing?.latestRevision) {
        const latest = existing.latestRevision;
        if (latest.status === "DRAFT") {
          await tx.documentRevision.update({ where: { id: latest.id }, data: { formData: formData as Prisma.InputJsonValue, version: { increment: 1 } } });
          await this.audit.record({ eventType: "document_revision.regenerated", entityType: "DOCUMENT_REVISION", entityId: latest.id, entityLabel: `${existing.docNumber} rev ${latest.revisionLabel}`, metadata: { source: configRef } }, tx);
          if (dto.requiredDocumentId) await this.attachToRequirement(tx, actor, dto.requiredDocumentId, existing.id, type.id).catch((e) => { if (!(e instanceof BusinessRuleError)) throw e; });
          return { documentId: existing.id, revisionId: latest.id, created: false };
        }
        throw new ConflictError(`${existing.docNumber} revision ${latest.revisionLabel} is ${latest.status}; open a new document revision to regenerate`, "CONTROLLED_RECORD");
      }
      const created = await this.create(
        actor,
        {
          documentTypeId: type.id,
          title: `${type.acronym ?? type.code} - ${sp.internalPart.partNumber} ${configRef}`,
          description: `Generated from configuration ${configRef}`,
          supplierId: sp.supplierId,
          submissionMethod: "NATIVE_FORM",
          formData,
          requiredDocumentId: dto.requiredDocumentId,
          links: [
            { entityType: "CONFIGURATION_REVISION", entityId: rev.id, linkRole: "GENERATED_FROM" },
            { entityType: "INTERNAL_PART", entityId: sp.internalPartId, linkRole: "REFERENCE" },
            { entityType: "SUPPLIER", entityId: sp.supplierId, linkRole: "REFERENCE" },
          ],
        },
        tx,
      );
      return { documentId: created.document.id, revisionId: created.revision.id, created: true };
    });
  }

  // ------------------------------------------------------------------ workflow handler

  async onApproved(tx: Tx, after: AfterCommit, instance: WorkflowInstance): Promise<void> {
    const rev = await tx.documentRevision.findUniqueOrThrow({ where: { id: instance.subjectId }, include: { document: true } });
    // The workflow approved this exact content; reject if it changed in the meantime (defense in depth).
    if (instance.subjectVersionRef && rev.contentHash !== instance.subjectVersionRef) throw new ConflictError("The document content changed after it was submitted", "CONTENT_CHANGED");
    await tx.documentRevision.update({ where: { id: rev.id }, data: { status: "APPROVED", approvedAt: new Date(), version: { increment: 1 } } });
    await tx.documentRecord.update({ where: { id: rev.documentId }, data: { status: "APPROVED", version: { increment: 1 } } });
    await this.syncRequirements(tx, rev.documentId, rev.id, "ACCEPTED");
    await this.activity.record(tx, { entityType: "DOCUMENT", entityId: rev.documentId, entityLabel: rev.document.docNumber, verb: "approved", summary: `Revision ${rev.revisionLabel} approved`, supplierId: rev.document.supplierId, visibility: "SUPPLIER" });
  }

  async onRejected(tx: Tx, _after: AfterCommit, instance: WorkflowInstance, comment: string): Promise<void> {
    const rev = await tx.documentRevision.findUniqueOrThrow({ where: { id: instance.subjectId }, include: { document: true } });
    await tx.documentRevision.update({ where: { id: rev.id }, data: { status: "REJECTED", rejectedAt: new Date(), rejectionReason: comment, version: { increment: 1 } } });
    await tx.documentRecord.update({ where: { id: rev.documentId }, data: { status: rev.document.releasedRevisionId ? "RELEASED" : "REJECTED", version: { increment: 1 } } });
    await this.syncRequirements(tx, rev.documentId, rev.id, "REJECTED");
    await this.activity.record(tx, { entityType: "DOCUMENT", entityId: rev.documentId, entityLabel: rev.document.docNumber, verb: "rejected", summary: `Revision ${rev.revisionLabel} rejected: ${comment}`, supplierId: rev.document.supplierId, visibility: "SUPPLIER" });
  }

  async onInfoRequested(tx: Tx, _after: AfterCommit, instance: WorkflowInstance, comment: string): Promise<void> {
    const rev = await tx.documentRevision.findUniqueOrThrow({ where: { id: instance.subjectId }, include: { document: true } });
    await tx.documentRevision.update({ where: { id: rev.id }, data: { status: "DRAFT", contentHash: null, version: { increment: 1 } } });
    await tx.documentRecord.update({ where: { id: rev.documentId }, data: { status: rev.document.releasedRevisionId ? "RELEASED" : "DRAFT", version: { increment: 1 } } });
    await this.syncRequirements(tx, rev.documentId, rev.id, "OPEN");
    await this.activity.record(tx, { entityType: "DOCUMENT", entityId: rev.documentId, entityLabel: rev.document.docNumber, verb: "returned", summary: `Revision ${rev.revisionLabel} returned for more information: ${comment}`, supplierId: rev.document.supplierId, visibility: "SUPPLIER" });
  }
}
