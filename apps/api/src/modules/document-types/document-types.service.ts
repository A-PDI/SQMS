import { Injectable } from "@nestjs/common";
import type { Prisma } from "@sqms/db";
import { validateFormSchema } from "@sqms/shared";
import type { Actor } from "../../common/auth/actor";
import { AccessScope } from "../../common/auth/access-scope";
import { AuditService, diffControlled } from "../../common/audit/audit.service";
import { DbService, type Tx } from "../../common/db/db.service";
import { BusinessRuleError, ConflictError, InvalidTransitionError, NotFoundError, StaleVersionError } from "../../common/errors/app-errors";
import { toDate } from "../../common/http/dto-helpers";
import { pageArgs, sortArg, trimQ } from "../../common/http/pagination";
import { revisionLabel } from "@sqms/shared";
import { FilesService } from "../files/files.service";
import type {
  CreateDocumentTypeDto,
  CreateFormVersionDto,
  CreateTemplateDto,
  CreateTemplateRevisionDto,
  DocumentTypeListQuery,
  DocumentTypeStatusDto,
  UpdateDocumentTypeDto,
} from "./document-types.dto";

const TYPE_CONTROLLED = [
  "name", "acronym", "category", "origin", "externalStandardRef", "description", "purpose", "responsibleDepartment", "typicalPreparer", "workflowKey", "applicablePathways",
  "applicabilityConditions", "riskRuleSummary", "ownerRoleKey", "ownerUserId", "approvalRequirements", "approverRoleKeys", "retentionPolicyId", "supplierVisibility", "status", "instructions",
  "allowUpload", "nativeFormKey",
] as const;

@Injectable()
export class DocumentTypesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
  ) {}

  async list(actor: Actor, q: DocumentTypeListQuery) {
    const scope = AccessScope.of(actor);
    const { skip, take, page, pageSize } = pageArgs({ ...q, pageSize: q.pageSize ?? 100 });
    const term = trimQ(q.q);
    const where: Prisma.DocumentTypeWhereInput = {
      ...(scope.isInternal ? {} : { supplierVisibility: { not: "INTERNAL_ONLY" }, status: "ACTIVE" }),
      ...(q.category?.length ? { category: { in: q.category as never } } : {}),
      ...(q.status?.length ? { status: { in: q.status as never } } : {}),
      ...(q.origin ? { origin: q.origin as never } : {}),
      ...(term ? { OR: [{ code: { contains: term } }, { name: { contains: term } }, { acronym: { contains: term } }, { description: { contains: term } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      this.db.client.documentType.count({ where }),
      this.db.client.documentType.findMany({
        where,
        skip,
        take,
        orderBy: q.sort ? sortArg(q, ["code", "name", "category", "updatedAt"] as const, "code", "asc") : [{ sortOrder: "asc" }, { code: "asc" }],
        include: {
          retentionPolicy: { select: { id: true, code: true, name: true, retentionMonths: true } },
          templates: { where: { status: "ACTIVE" }, include: { revisions: { where: { status: "EFFECTIVE" }, include: { file: { select: { id: true, safeFilename: true, status: true } } } } } },
          _count: { select: { documents: { where: { archivedAt: null } } } },
        },
      }),
    ]);
    const items = rows
      .filter((t) => !q.pathway || (t.applicablePathways as string[]).includes(q.pathway))
      .map(({ templates, _count, ...t }) => {
        const effective = templates.flatMap((tp) => tp.revisions)[0] ?? null;
        return {
          ...t,
          documentCount: _count.documents,
          currentTemplateRevision: effective && { id: effective.id, revisionLabel: effective.revisionLabel, effectiveDate: effective.effectiveDate, file: effective.file, hasNativeForm: !!effective.formDefinitionVersionId },
        };
      });
    return { total, page, pageSize, items };
  }

  async get(actor: Actor, id: string) {
    const scope = AccessScope.of(actor);
    const t = await this.db.client.documentType.findUnique({
      where: { id },
      include: {
        retentionPolicy: true,
        supersededByType: { select: { id: true, code: true, name: true } },
        templates: {
          orderBy: { createdAt: "asc" },
          include: { revisions: { orderBy: { revisionNumber: "desc" }, include: { file: { select: { id: true, safeFilename: true, status: true, sizeBytes: true, contentType: true } }, formDefinitionVersion: { select: { id: true, version: true, formDefinition: { select: { key: true } } } } } } },
        },
        formDefinitions: { include: { versions: { orderBy: { version: "desc" }, select: { id: true, version: true, status: true, publishedAt: true, changeSummary: true } } } },
      },
    });
    if (!t) throw new NotFoundError("Document type");
    if (!scope.isInternal && (t.supplierVisibility === "INTERNAL_ONLY" || t.status !== "ACTIVE")) throw new NotFoundError("Document type");
    const activeRules = await this.db.client.applicabilityRule.findMany({
      where: { documentTypeId: id, policyVersion: { status: "ACTIVE" } },
      orderBy: { priority: "desc" },
      include: { policyVersion: { select: { version: true, policy: { select: { key: true, name: true } } } } },
    });
    const documentCounts = await this.db.client.documentRecord.groupBy({ by: ["status"], where: { documentTypeId: id, archivedAt: null }, _count: { _all: true } });
    const templates = t.templates.map((tp) => ({ ...tp, revisions: tp.revisions.map((r) => ({ ...r, file: r.file && { ...r.file, sizeBytes: Number(r.file.sizeBytes) } })) }));
    return { ...t, templates, rules: scope.isInternal ? activeRules : [], documentCounts: scope.isInternal ? documentCounts.map((d) => ({ status: d.status, count: d._count._all })) : [] };
  }

  private async validateReferences(tx: Tx, dto: Partial<CreateDocumentTypeDto>) {
    if (dto.workflowKey) {
      const wf = await tx.workflowDefinition.findFirst({ where: { key: dto.workflowKey, isActive: true, subjectType: "DOCUMENT_REVISION" } });
      if (!wf) throw new BusinessRuleError(`Workflow "${dto.workflowKey}" is not an active document workflow`);
    }
    if (dto.retentionPolicyId && !(await tx.retentionPolicy.findUnique({ where: { id: dto.retentionPolicyId } }))) throw new BusinessRuleError("Retention policy not found");
    if (dto.nativeFormKey && !(await tx.formDefinition.findUnique({ where: { key: dto.nativeFormKey } }))) throw new BusinessRuleError(`Form definition "${dto.nativeFormKey}" not found`);
    const roleKeys = [...(dto.approverRoleKeys ?? []), ...(dto.ownerRoleKey ? [dto.ownerRoleKey] : [])];
    if (roleKeys.length) {
      const found = await tx.role.count({ where: { key: { in: roleKeys }, scope: "INTERNAL" } });
      if (found !== new Set(roleKeys).size) throw new BusinessRuleError("Approver/owner roles must be existing internal roles");
    }
    if (dto.origin && dto.origin !== "COMPANY_DEFINED" && !dto.externalStandardRef?.trim()) {
      throw new BusinessRuleError("Externally standardized or standard-aligned types must cite the external reference");
    }
  }

  async create(actor: Actor, dto: CreateDocumentTypeDto) {
    return this.db.tx(async (tx) => {
      await this.validateReferences(tx, dto);
      const maxSort = await tx.documentType.aggregate({ _max: { sortOrder: true } });
      const created = await tx.documentType.create({
        data: { ...dto, applicablePathways: dto.applicablePathways, approverRoleKeys: dto.approverRoleKeys, allowUpload: dto.allowUpload ?? true, sortOrder: (maxSort._max.sortOrder ?? 0) + 1 },
      });
      await tx.documentTemplate.create({ data: { documentTypeId: created.id, name: `${dto.acronym ?? dto.code} template`, description: `Controlled template for ${dto.name}.` } });
      await this.audit.record({ eventType: "document_type.created", entityType: "DOCUMENT_TYPE", entityId: created.id, entityLabel: `${created.code} ${created.name}`, changes: diffControlled({}, created, [...TYPE_CONTROLLED]) }, tx);
      return created;
    });
  }

  async update(actor: Actor, id: string, dto: UpdateDocumentTypeDto) {
    const { expectedVersion, ...changes } = dto;
    return this.db.tx(async (tx) => {
      const before = await tx.documentType.findUnique({ where: { id } });
      if (!before) throw new NotFoundError("Document type");
      await this.validateReferences(tx, { origin: changes.origin ?? before.origin, externalStandardRef: changes.externalStandardRef !== undefined ? changes.externalStandardRef : before.externalStandardRef, ...changes } as Partial<CreateDocumentTypeDto>);
      const res = await tx.documentType.updateMany({ where: { id, version: expectedVersion }, data: { ...(changes as Prisma.DocumentTypeUpdateManyMutationInput), version: { increment: 1 } } });
      if (res.count !== 1) throw new StaleVersionError("Document type");
      const after = await tx.documentType.findUniqueOrThrow({ where: { id } });
      await this.audit.record({ eventType: "document_type.updated", entityType: "DOCUMENT_TYPE", entityId: id, entityLabel: `${after.code} ${after.name}`, changes: diffControlled(before, after, [...TYPE_CONTROLLED]) }, tx);
      return after;
    });
  }

  async changeStatus(actor: Actor, id: string, dto: DocumentTypeStatusDto) {
    return this.db.tx(async (tx) => {
      const before = await tx.documentType.findUnique({ where: { id } });
      if (!before) throw new NotFoundError("Document type");
      if (dto.status === "SUPERSEDED") {
        if (!dto.supersededByTypeId || dto.supersededByTypeId === id) throw new BusinessRuleError("A superseding document type is required");
        const target = await tx.documentType.findUnique({ where: { id: dto.supersededByTypeId } });
        if (!target || target.status !== "ACTIVE") throw new BusinessRuleError("The superseding document type must be active");
      }
      const after = await tx.documentType.update({ where: { id }, data: { status: dto.status, supersededByTypeId: dto.status === "SUPERSEDED" ? dto.supersededByTypeId : null, version: { increment: 1 } } });
      await this.audit.record({ eventType: "document_type.status_changed", entityType: "DOCUMENT_TYPE", entityId: id, entityLabel: `${after.code} ${after.name}`, changes: diffControlled(before, after, ["status", "supersededByTypeId"]), reason: dto.reason }, tx);
      return after;
    });
  }

  // ------------------------------------------------------------------ templates

  async createTemplate(actor: Actor, typeId: string, dto: CreateTemplateDto) {
    return this.db.tx(async (tx) => {
      const t = await tx.documentType.findUnique({ where: { id: typeId } });
      if (!t) throw new NotFoundError("Document type");
      const tpl = await tx.documentTemplate.create({ data: { documentTypeId: typeId, name: dto.name, description: dto.description ?? null, ownerUserId: actor.userId } });
      await this.audit.record({ eventType: "template.created", entityType: "DOCUMENT_TEMPLATE", entityId: tpl.id, entityLabel: `${t.code} ${tpl.name}` }, tx);
      return tpl;
    });
  }

  async createTemplateRevision(actor: Actor, templateId: string, dto: CreateTemplateRevisionDto) {
    return this.db.tx(async (tx) => {
      const tpl = await tx.documentTemplate.findUnique({ where: { id: templateId }, include: { documentType: true } });
      if (!tpl) throw new NotFoundError("Template");
      const draft = await tx.templateRevision.findFirst({ where: { templateId, status: "DRAFT" } });
      if (draft) throw new ConflictError(`Draft revision ${draft.revisionLabel} already exists for this template`, "OPEN_REVISION_EXISTS");
      if (dto.fileId) await this.files.assertAttachable(tx, actor, [dto.fileId]);
      if (dto.formDefinitionVersionId) {
        const fv = await tx.formDefinitionVersion.findUnique({ where: { id: dto.formDefinitionVersionId } });
        if (!fv || fv.status !== "PUBLISHED") throw new BusinessRuleError("The form definition version must be published");
      }
      const last = await tx.templateRevision.findFirst({ where: { templateId }, orderBy: { revisionNumber: "desc" } });
      const n = (last?.revisionNumber ?? 0) + 1;
      const rev = await tx.templateRevision.create({
        data: {
          templateId,
          revisionNumber: n,
          revisionLabel: revisionLabel(n),
          status: "DRAFT",
          changeSummary: dto.changeSummary,
          instructions: dto.instructions ?? last?.instructions ?? null,
          fileObjectId: dto.fileId ?? null,
          formDefinitionVersionId: dto.formDefinitionVersionId ?? last?.formDefinitionVersionId ?? null,
          createdById: actor.userId,
        },
      });
      await this.audit.record({ eventType: "template_revision.created", entityType: "TEMPLATE_REVISION", entityId: rev.id, entityLabel: `${tpl.documentType.code} template rev ${rev.revisionLabel}`, reason: dto.changeSummary }, tx);
      return rev;
    });
  }

  async attachTemplateFile(actor: Actor, revisionId: string, fileId: string) {
    return this.db.tx(async (tx) => {
      const rev = await tx.templateRevision.findUnique({ where: { id: revisionId } });
      if (!rev) throw new NotFoundError("Template revision");
      if (rev.status !== "DRAFT") throw new InvalidTransitionError("Template revision", rev.status, "modified");
      await this.files.assertAttachable(tx, actor, [fileId]);
      const after = await tx.templateRevision.update({ where: { id: revisionId }, data: { fileObjectId: fileId } });
      await this.audit.record({ eventType: "template_revision.file_attached", entityType: "TEMPLATE_REVISION", entityId: revisionId, metadata: { fileId } }, tx);
      return after;
    });
  }

  /** Publishes a template revision; the previously effective revision becomes SUPERSEDED (kept for history). */
  async publishTemplateRevision(actor: Actor, revisionId: string, effectiveDate: string) {
    return this.db.tx(async (tx) => {
      const rev = await tx.templateRevision.findUnique({ where: { id: revisionId }, include: { file: true, template: { include: { documentType: true } } } });
      if (!rev) throw new NotFoundError("Template revision");
      if (rev.status !== "DRAFT") throw new InvalidTransitionError("Template revision", rev.status, "published");
      if (!rev.fileObjectId && !rev.formDefinitionVersionId) throw new BusinessRuleError("A template revision needs a template file or a native form version");
      if (rev.file && rev.file.status !== "CLEAN") throw new BusinessRuleError("The template file has not passed malware scanning yet");
      const previous = await tx.templateRevision.findMany({ where: { templateId: rev.templateId, status: "EFFECTIVE" } });
      await tx.templateRevision.updateMany({ where: { templateId: rev.templateId, status: "EFFECTIVE" }, data: { status: "SUPERSEDED" } });
      const after = await tx.templateRevision.update({ where: { id: revisionId }, data: { status: "EFFECTIVE", effectiveDate: toDate(effectiveDate), approvedById: actor.userId, approvedAt: new Date() } });
      await this.audit.record(
        { eventType: "template_revision.published", entityType: "TEMPLATE_REVISION", entityId: revisionId, entityLabel: `${rev.template.documentType.code} template rev ${rev.revisionLabel}`, metadata: { effectiveDate, superseded: previous.map((p) => p.revisionLabel) } },
        tx,
      );
      return after;
    });
  }

  async obsoleteTemplateRevision(actor: Actor, revisionId: string, reason: string) {
    return this.db.tx(async (tx) => {
      const rev = await tx.templateRevision.findUnique({ where: { id: revisionId } });
      if (!rev) throw new NotFoundError("Template revision");
      if (rev.status === "OBSOLETE") throw new InvalidTransitionError("Template revision", rev.status, "obsoleted");
      const after = await tx.templateRevision.update({ where: { id: revisionId }, data: { status: "OBSOLETE" } });
      await this.audit.record({ eventType: "template_revision.obsoleted", entityType: "TEMPLATE_REVISION", entityId: revisionId, reason, changes: { status: { before: rev.status, after: "OBSOLETE" } } }, tx);
      return after;
    });
  }

  /** Effective template revision governing new documents of a type. */
  async effectiveTemplateRevision(tx: Tx, documentTypeId: string) {
    return tx.templateRevision.findFirst({
      where: { status: "EFFECTIVE", template: { documentTypeId, status: "ACTIVE" } },
      orderBy: [{ effectiveDate: "desc" }, { revisionNumber: "desc" }],
      include: { formDefinitionVersion: true },
    });
  }

  // ------------------------------------------------------------------ native form definitions

  async listForms() {
    return this.db.client.formDefinition.findMany({
      orderBy: { key: "asc" },
      include: { documentType: { select: { id: true, code: true, name: true } }, versions: { orderBy: { version: "desc" }, select: { id: true, version: true, status: true, publishedAt: true, changeSummary: true } } },
    });
  }

  async getFormVersion(id: string) {
    const v = await this.db.client.formDefinitionVersion.findUnique({ where: { id }, include: { formDefinition: true } });
    if (!v) throw new NotFoundError("Form version");
    return v;
  }

  async latestPublishedForm(key: string) {
    const v = await this.db.client.formDefinitionVersion.findFirst({ where: { status: "PUBLISHED", formDefinition: { key } }, orderBy: { version: "desc" }, include: { formDefinition: true } });
    if (!v) throw new NotFoundError("Form");
    return v;
  }

  async createFormVersion(actor: Actor, key: string, dto: CreateFormVersionDto) {
    const problems = validateFormSchema(dto.schema);
    if (problems.length) throw new BusinessRuleError("The form schema is invalid", { problems });
    return this.db.tx(async (tx) => {
      const def = await tx.formDefinition.findUnique({ where: { key } });
      if (!def) throw new NotFoundError("Form definition");
      const last = await tx.formDefinitionVersion.findFirst({ where: { formDefinitionId: def.id }, orderBy: { version: "desc" } });
      const v = await tx.formDefinitionVersion.create({
        data: { formDefinitionId: def.id, version: (last?.version ?? 0) + 1, status: "DRAFT", schema: dto.schema as Prisma.InputJsonValue, changeSummary: dto.changeSummary, createdById: actor.userId },
      });
      await this.audit.record({ eventType: "form_version.created", entityType: "DOCUMENT_TYPE", entityId: def.documentTypeId ?? def.id, entityLabel: `${key} v${v.version}`, reason: dto.changeSummary }, tx);
      return v;
    });
  }

  async publishFormVersion(actor: Actor, id: string) {
    return this.db.tx(async (tx) => {
      const v = await tx.formDefinitionVersion.findUnique({ where: { id }, include: { formDefinition: true } });
      if (!v) throw new NotFoundError("Form version");
      if (v.status !== "DRAFT") throw new InvalidTransitionError("Form version", v.status, "published");
      // Existing submissions keep referencing their version; older published versions are retired for new use.
      await tx.formDefinitionVersion.updateMany({ where: { formDefinitionId: v.formDefinitionId, status: "PUBLISHED" }, data: { status: "RETIRED" } });
      const after = await tx.formDefinitionVersion.update({ where: { id }, data: { status: "PUBLISHED", publishedAt: new Date() } });
      await this.audit.record({ eventType: "form_version.published", entityType: "DOCUMENT_TYPE", entityId: v.formDefinition.documentTypeId ?? v.formDefinitionId, entityLabel: `${v.formDefinition.key} v${v.version}` }, tx);
      return after;
    });
  }

  async retentionPolicies() {
    return this.db.client.retentionPolicy.findMany({ orderBy: { code: "asc" }, include: { _count: { select: { documentTypes: true } } } });
  }
}
