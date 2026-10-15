import { Injectable } from "@nestjs/common";
import type { BaselineType, ConfigRevisionStatus, ConfigurationType, Prisma } from "@sqms/db";
import { revisionLabel } from "@sqms/shared";
import type { Actor } from "../../common/auth/actor";
import { AccessScope } from "../../common/auth/access-scope";
import { ActivityService } from "../../common/audit/activity.service";
import { AuditService, diffControlled } from "../../common/audit/audit.service";
import { DbService, type Tx } from "../../common/db/db.service";
import { BusinessRuleError, ConflictError, NotFoundError, StaleVersionError } from "../../common/errors/app-errors";
import { NumberingService } from "../../common/services/numbering.service";
import type {
  AcknowledgeRequirementDto,
  BaselineDto,
  CharacteristicDto,
  CreateConfigurationDto,
  RequirementDto,
  UpdateBaselineDto,
  UpdateCharacteristicDto,
  UpdateRequirementDto,
  UpdateRevisionDto,
  VerifyRequirementDto,
} from "./configurations.dto";

/** Revision statuses whose content may still be edited. Everything else is controlled. */
export const EDITABLE_REVISION_STATUSES: ConfigRevisionStatus[] = ["DRAFT", "PROPOSED"];

export const DEFAULT_BASELINE_TYPE: Record<ConfigurationType, BaselineType> = {
  CUSTOMER_DESIGN: "CUSTOMER_CONTROLLED_DESIGN",
  SUPPLIER_STANDARD: "SUPPLIER_PRODUCT_BASELINE",
  SUPPLIER_MODIFIED: "SUPPLIER_BASELINE_WITH_DELTA",
};

const BASELINE_FIELDS = [
  "baselineType", "designOwnership", "drawingNumber", "drawingRevision", "specificationNumber", "specificationRevision", "material", "materialSpecification", "coating",
  "coatingSpecification", "heatTreatment", "surfaceFinish", "generalTolerances", "keyDimensions", "performanceRequirements", "operatingRequirements", "guaranteedCharacteristics",
  "reverseEngineeringSource", "notes",
] as const;

const REVISION_INCLUDE = {
  configuration: {
    include: {
      supplierProduct: {
        include: {
          internalPart: { select: { id: true, partNumber: true, description: true, criticality: true } },
          supplier: { select: { id: true, name: true, supplierNumber: true, status: true } },
          supplierPart: { select: { id: true, supplierPartNumber: true, isCustom: true } },
          site: { select: { id: true, siteCode: true, name: true, status: true } },
        },
      },
      baseConfiguration: { select: { id: true, configCode: true, name: true, currentApprovedRevisionId: true } },
    },
  },
  baseline: true,
  requirements: { orderBy: [{ sortOrder: "asc" }, { code: "asc" }] },
  characteristics: { orderBy: [{ sortOrder: "asc" }, { charNumber: "asc" }] },
  derivedFrom: { select: { id: true, revisionLabel: true, status: true } },
  supersededBy: { select: { id: true, revisionLabel: true } },
  supersedes: { select: { id: true, revisionLabel: true } },
  productApproval: { select: { id: true, number: true, status: true, approvedAt: true, approvalPackageId: true } },
  qualifications: { select: { id: true, number: true, status: true, createdAt: true } },
  changeRequestsProposed: { select: { id: true, number: true, status: true } },
  changeRequestsCurrent: { select: { id: true, number: true, status: true } },
} satisfies Prisma.ConfigurationRevisionInclude;

@Injectable()
export class ConfigurationsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
    private readonly numbering: NumberingService,
  ) {}

  // ------------------------------------------------------------------ helpers

  /** Locks the revision row and verifies its content is still editable. */
  async lockEditableRevision(tx: Tx, revisionId: string, expectedVersion?: number) {
    await this.db.lockRow(tx, "configuration_revisions", revisionId);
    const rev = await tx.configurationRevision.findUnique({ where: { id: revisionId }, include: { configuration: true, baseline: true } });
    if (!rev) throw new NotFoundError("Configuration revision");
    if (!EDITABLE_REVISION_STATUSES.includes(rev.status)) {
      throw new ConflictError(
        `Revision ${rev.revisionLabel} of ${rev.configuration.configCode} is ${rev.status} and controlled. Create a new revision or a change request to modify it.`,
        "CONTROLLED_RECORD",
      );
    }
    if (expectedVersion !== undefined && rev.version !== expectedVersion) throw new StaleVersionError("Configuration revision");
    return rev;
  }

  private async bump(tx: Tx, revisionId: string) {
    await tx.configurationRevision.update({ where: { id: revisionId }, data: { version: { increment: 1 } } });
  }

  private label(rev: { revisionLabel: string; configuration: { configCode: string } }) {
    return `${rev.configuration.configCode} rev ${rev.revisionLabel}`;
  }

  // ------------------------------------------------------------------ configurations

  async createConfiguration(actor: Actor, dto: CreateConfigurationDto, txIn?: Tx) {
    const run = async (tx: Tx) => {
      const sp = await tx.supplierProduct.findFirst({ where: { id: dto.supplierProductId, archivedAt: null }, include: { internalPart: true, supplierPart: true } });
      if (!sp) throw new NotFoundError("Supplier product");
      if (dto.configurationType === "SUPPLIER_MODIFIED" && !dto.baseConfigurationId) {
        throw new BusinessRuleError("A modified supplier configuration (Path C) must reference the original supplier configuration");
      }
      if (dto.baseConfigurationId) {
        const base = await tx.productConfiguration.findUnique({ where: { id: dto.baseConfigurationId } });
        if (!base || base.supplierId !== sp.supplierId) throw new BusinessRuleError("The base configuration must belong to the same supplier");
      }
      const configCode = await this.numbering.next(tx, "CONFIGURATION");
      const config = await tx.productConfiguration.create({
        data: {
          configCode,
          supplierProductId: sp.id,
          supplierId: sp.supplierId,
          name: dto.name,
          configurationType: dto.configurationType,
          baseConfigurationId: dto.baseConfigurationId ?? null,
          customPartNumber: dto.customPartNumber ?? null,
          description: dto.description ?? null,
          createdById: actor.userId,
        },
      });
      const baselineType = dto.baseline?.baselineType ?? DEFAULT_BASELINE_TYPE[dto.configurationType];
      const rev = await tx.configurationRevision.create({
        data: {
          configurationId: config.id,
          revisionNumber: 1,
          revisionLabel: revisionLabel(1),
          status: "DRAFT",
          supplierProductRevision: dto.supplierProductRevision ?? null,
          description: dto.description ?? null,
          changeSummary: "Initial configuration",
          createdById: actor.userId,
          baseline: {
            create: {
              ...(dto.baseline ?? {}),
              baselineType,
              designOwnership: dto.baseline?.designOwnership ?? (dto.configurationType === "CUSTOMER_DESIGN" ? "COMPANY" : dto.configurationType === "SUPPLIER_MODIFIED" ? "SHARED" : "SUPPLIER"),
            },
          },
        },
      });
      await this.audit.record({ eventType: "configuration.created", entityType: "PRODUCT_CONFIGURATION", entityId: config.id, entityLabel: configCode, metadata: { supplierProductId: sp.id, configurationType: dto.configurationType, baselineType, revisionId: rev.id } }, tx);
      await this.activity.record(tx, {
        entityType: "INTERNAL_PART",
        entityId: sp.internalPartId,
        entityLabel: sp.internalPart.partNumber,
        verb: "configuration_created",
        summary: `Configuration ${configCode} "${dto.name}" (${dto.configurationType}) created for ${sp.supplierPart.supplierPartNumber}`,
        internalPartId: sp.internalPartId,
        supplierId: sp.supplierId,
      });
      return { configuration: config, revision: rev };
    };
    return txIn ? run(txIn) : this.db.tx(run);
  }

  async getConfiguration(actor: Actor, id: string) {
    const c = await this.db.client.productConfiguration.findUnique({
      where: { id },
      include: {
        supplierProduct: { include: { internalPart: { select: { id: true, partNumber: true, description: true } }, supplierPart: true, site: true, supplier: { select: { id: true, name: true } } } },
        baseConfiguration: { select: { id: true, configCode: true, name: true } },
        derivedConfigurations: { select: { id: true, configCode: true, name: true } },
        revisions: { orderBy: { revisionNumber: "desc" }, include: { productApproval: { select: { number: true, status: true } } } },
      },
    });
    if (!c) throw new NotFoundError("Configuration");
    AccessScope.of(actor).assertSupplier(c.supplierId, "Configuration");
    return c;
  }

  async getRevision(actor: Actor, revisionId: string) {
    const rev = await this.db.client.configurationRevision.findUnique({ where: { id: revisionId }, include: REVISION_INCLUDE });
    if (!rev) throw new NotFoundError("Configuration revision");
    const scope = AccessScope.of(actor);
    scope.assertSupplier(rev.configuration.supplierId, "Configuration revision");
    return rev;
  }

  async updateRevision(actor: Actor, revisionId: string, dto: UpdateRevisionDto) {
    const { expectedVersion, ...data } = dto;
    return this.db.tx(async (tx) => {
      const before = await this.lockEditableRevision(tx, revisionId, expectedVersion);
      const after = await tx.configurationRevision.update({ where: { id: revisionId }, data: { ...data, version: { increment: 1 } } });
      await this.audit.record({ eventType: "configuration_revision.updated", entityType: "CONFIGURATION_REVISION", entityId: revisionId, entityLabel: this.label(before), changes: diffControlled(before, after, ["description", "changeSummary", "supplierProductRevision"]) }, tx);
      return after;
    });
  }

  async updateBaseline(actor: Actor, revisionId: string, dto: UpdateBaselineDto) {
    const { expectedVersion, ...data } = dto;
    return this.db.tx(async (tx) => {
      const rev = await this.lockEditableRevision(tx, revisionId, expectedVersion);
      const before = rev.baseline;
      const values = data as BaselineDto;
      // Any change to an accepted definition returns it to DRAFT and requires renewed acceptance.
      const saved = before
        ? await tx.engineeringBaseline.update({ where: { id: before.id }, data: { ...values, status: "DRAFT", acceptedAt: null, acceptedById: null } })
        : await tx.engineeringBaseline.create({
            data: { ...values, configurationRevisionId: revisionId, baselineType: values.baselineType ?? DEFAULT_BASELINE_TYPE[rev.configuration.configurationType], designOwnership: values.designOwnership ?? "SUPPLIER" },
          });
      await this.bump(tx, revisionId);
      const changes = diffControlled(before ?? {}, saved, [...BASELINE_FIELDS, "status"]);
      await this.audit.record({ eventType: "baseline.updated", entityType: "CONFIGURATION_REVISION", entityId: revisionId, entityLabel: this.label(rev), changes }, tx);
      if (before?.status === "ACCEPTED") {
        await this.activity.record(tx, { entityType: "CONFIGURATION_REVISION", entityId: revisionId, entityLabel: this.label(rev), verb: "baseline_reopened", summary: "Baseline edited; acceptance withdrawn pending renewed engineering acceptance", supplierId: rev.configuration.supplierId });
      }
      return saved;
    });
  }

  /** Checks the definition is complete for its baseline type. Returns a list of problems. */
  baselineProblems(baseline: { baselineType: BaselineType } & Record<string, unknown>, requirementCount: number): string[] {
    const p: string[] = [];
    const has = (k: string) => typeof baseline[k] === "string" && (baseline[k] as string).trim().length > 0;
    switch (baseline.baselineType) {
      case "CUSTOMER_CONTROLLED_DESIGN":
        if (!has("drawingNumber") || !has("drawingRevision")) p.push("A controlled drawing number and revision are required");
        break;
      case "PRELIMINARY_REVERSE_ENGINEERED":
        if (!has("drawingNumber") || !has("drawingRevision")) p.push("The supplier-proposed definition must identify its drawing number and revision");
        if (!has("reverseEngineeringSource")) p.push("Identify the physical sample used for reverse engineering");
        break;
      case "SUPPLIER_PRODUCT_BASELINE":
      case "SUPPLIER_BASELINE_WITH_DELTA":
        if (!has("specificationNumber") && !has("drawingNumber")) p.push("Identify the supplier product specification or drawing");
        if (!has("guaranteedCharacteristics") && !has("performanceRequirements")) p.push("Record guaranteed characteristics or performance requirements");
        if (baseline.baselineType === "SUPPLIER_BASELINE_WITH_DELTA" && requirementCount === 0) p.push("At least one customer-specific (delta) requirement is required");
        break;
    }
    return p;
  }

  /**
   * Engineering acceptance of the product definition. A preliminary reverse-engineered definition requires the
   * Reverse Engineering Intake and Design Review & Engineering Release documents to be accepted first; on acceptance it
   * becomes the company-controlled design.
   */
  async acceptBaseline(actor: Actor, revisionId: string, expectedVersion: number) {
    return this.db.tx(async (tx) => {
      const rev = await this.lockEditableRevision(tx, revisionId, expectedVersion);
      if (!rev.baseline) throw new BusinessRuleError("No engineering baseline has been recorded");
      if (rev.baseline.status === "ACCEPTED") throw new BusinessRuleError("The baseline is already accepted");
      const reqCount = await tx.customerRequirement.count({ where: { configurationRevisionId: revisionId } });
      const problems = this.baselineProblems(rev.baseline as unknown as { baselineType: BaselineType } & Record<string, unknown>, reqCount);
      let baselineType = rev.baseline.baselineType;
      if (rev.baseline.baselineType === "PRELIMINARY_REVERSE_ENGINEERED") {
        const reviews = await tx.requiredDocument.findMany({
          where: { project: { configurationId: rev.configurationId }, documentType: { code: { in: ["ENG-02", "ENG-03"] } } },
          include: { documentType: { select: { code: true } } },
        });
        for (const code of ["ENG-03", "ENG-02"]) {
          const ok = reviews.some((r) => r.documentType.code === code && (r.status === "ACCEPTED" || r.status === "WAIVED"));
          if (!ok) problems.push(`${code === "ENG-02" ? "Design Review & Engineering Release (ENG-02)" : "Reverse Engineering Intake (ENG-03)"} must be accepted before the proposed definition can be accepted`);
        }
        baselineType = "CUSTOMER_CONTROLLED_DESIGN";
      }
      if (problems.length) throw new BusinessRuleError("The engineering baseline is incomplete", { problems });
      const saved = await tx.engineeringBaseline.update({ where: { id: rev.baseline.id }, data: { status: "ACCEPTED", acceptedAt: new Date(), acceptedById: actor.userId, baselineType, ...(baselineType !== rev.baseline.baselineType ? { designOwnership: "COMPANY" } : {}) } });
      await this.bump(tx, revisionId);
      await this.audit.record({ eventType: "baseline.accepted", entityType: "CONFIGURATION_REVISION", entityId: revisionId, entityLabel: this.label(rev), changes: diffControlled(rev.baseline, saved, ["status", "baselineType", "designOwnership"]) }, tx);
      await this.activity.record(tx, {
        entityType: "CONFIGURATION_REVISION",
        entityId: revisionId,
        entityLabel: this.label(rev),
        verb: "baseline_accepted",
        summary: baselineType !== rev.baseline.baselineType ? "Reverse-engineered definition accepted and released as the company-controlled design" : `Engineering baseline (${baselineType}) accepted`,
        supplierId: rev.configuration.supplierId,
      });
      // Advance projects waiting on the engineering definition.
      await tx.sourcingProject.updateMany({ where: { configurationId: rev.configurationId, stage: { in: ["ENGINEERING_DEFINITION", "REVERSE_ENGINEERING", "SUPPLIER_ONBOARDING"] }, status: "IN_PROGRESS" }, data: { stage: "VALIDATION" } });
      return saved;
    });
  }

  async createRevision(actor: Actor, configurationId: string, changeSummary: string) {
    return this.db.tx(async (tx) => {
      await this.db.lockRow(tx, "product_configurations", configurationId);
      const config = await tx.productConfiguration.findUnique({ where: { id: configurationId } });
      if (!config) throw new NotFoundError("Configuration");
      const open = await tx.configurationRevision.findFirst({ where: { configurationId, status: { in: ["DRAFT", "PROPOSED", "IN_REVIEW"] } } });
      if (open) throw new ConflictError(`Revision ${open.revisionLabel} is already open for this configuration`, "OPEN_REVISION_EXISTS");
      const source = config.currentApprovedRevisionId ?? (await tx.configurationRevision.findFirst({ where: { configurationId }, orderBy: { revisionNumber: "desc" } }))?.id;
      if (!source) throw new BusinessRuleError("The configuration has no revision to derive from");
      const rev = await this.copyRevision(tx, source, { status: "DRAFT", changeSummary, createdById: actor.userId });
      await this.audit.record({ eventType: "configuration_revision.created", entityType: "CONFIGURATION_REVISION", entityId: rev.id, entityLabel: `${config.configCode} rev ${rev.revisionLabel}`, metadata: { derivedFrom: source }, reason: changeSummary }, tx);
      return rev;
    });
  }

  /**
   * Copies a revision's definition (baseline, requirements, characteristics) into a new revision of the same or another
   * configuration. The source revision is never modified, preserving the approved configuration and its history.
   */
  async copyRevision(tx: Tx, sourceRevisionId: string, opts: { status: "DRAFT" | "PROPOSED"; changeSummary: string; createdById: string; targetConfigurationId?: string }) {
    const src = await tx.configurationRevision.findUniqueOrThrow({ where: { id: sourceRevisionId }, include: { baseline: true, requirements: true, characteristics: true } });
    const configurationId = opts.targetConfigurationId ?? src.configurationId;
    const last = await tx.configurationRevision.findFirst({ where: { configurationId }, orderBy: { revisionNumber: "desc" } });
    const n = (last?.revisionNumber ?? 0) + 1;
    const rev = await tx.configurationRevision.create({
      data: {
        configurationId,
        revisionNumber: n,
        revisionLabel: revisionLabel(n),
        status: opts.status,
        description: src.description,
        changeSummary: opts.changeSummary,
        supplierProductRevision: src.supplierProductRevision,
        derivedFromRevisionId: src.id,
        createdById: opts.createdById,
      },
    });
    if (src.baseline) {
      const { id: _id, configurationRevisionId: _r, createdAt: _c, updatedAt: _u, additionalData, ...b } = src.baseline;
      await tx.engineeringBaseline.create({ data: { ...b, additionalData: (additionalData ?? undefined) as Prisma.InputJsonValue | undefined, configurationRevisionId: rev.id } });
    }
    const reqMap = new Map<string, string>();
    for (const r of src.requirements) {
      const { id, configurationRevisionId: _r, createdAt: _c, updatedAt: _u, ...data } = r;
      const created = await tx.customerRequirement.create({ data: { ...data, configurationRevisionId: rev.id } });
      reqMap.set(id, created.id);
    }
    for (const c of src.characteristics) {
      const { id: _id, configurationRevisionId: _r, createdAt: _c, updatedAt: _u, customerRequirementId, ...data } = c;
      await tx.criticalCharacteristic.create({ data: { ...data, configurationRevisionId: rev.id, customerRequirementId: customerRequirementId ? reqMap.get(customerRequirementId) ?? null : null } });
    }
    return rev;
  }

  /**
   * Location change: copies a revision into a new configuration owned by the supplier product at another site. The
   * source configuration (and its approval at the current site) is left untouched until the change is approved.
   */
  async cloneForSupplierProduct(tx: Tx, actorId: string, sourceRevisionId: string, supplierProductId: string, changeSummary: string) {
    const src = await tx.configurationRevision.findUniqueOrThrow({ where: { id: sourceRevisionId }, include: { configuration: true } });
    const sp = await tx.supplierProduct.findUniqueOrThrow({ where: { id: supplierProductId } });
    if (sp.supplierId !== src.configuration.supplierId) throw new BusinessRuleError("The target supplier product belongs to another supplier");
    const configCode = await this.numbering.next(tx, "CONFIGURATION");
    const configuration = await tx.productConfiguration.create({
      data: {
        configCode,
        supplierProductId: sp.id,
        supplierId: sp.supplierId,
        name: src.configuration.name,
        configurationType: src.configuration.configurationType,
        baseConfigurationId: src.configuration.baseConfigurationId,
        customPartNumber: src.configuration.customPartNumber,
        description: src.configuration.description,
        createdById: actorId,
      },
    });
    const revision = await this.copyRevision(tx, sourceRevisionId, { status: "PROPOSED", changeSummary, createdById: actorId, targetConfigurationId: configuration.id });
    await this.audit.record({ eventType: "configuration.created", entityType: "PRODUCT_CONFIGURATION", entityId: configuration.id, entityLabel: configCode, metadata: { supplierProductId: sp.id, derivedFromRevisionId: sourceRevisionId, reason: changeSummary } }, tx);
    return { configuration, revision };
  }

  async withdrawRevision(actor: Actor, revisionId: string, reason: string) {
    return this.db.tx(async (tx) => {
      const rev = await this.lockEditableRevision(tx, revisionId);
      const active = await tx.changeRequest.findFirst({ where: { proposedRevisionId: revisionId, status: { notIn: ["REJECTED", "WITHDRAWN", "CLOSED"] } } });
      if (active) throw new BusinessRuleError(`Revision is proposed by change request ${active.number}; withdraw the change request instead`);
      await tx.configurationRevision.update({ where: { id: revisionId }, data: { status: "WITHDRAWN", version: { increment: 1 } } });
      await this.audit.record({ eventType: "configuration_revision.withdrawn", entityType: "CONFIGURATION_REVISION", entityId: revisionId, entityLabel: this.label(rev), reason, changes: { status: { before: rev.status, after: "WITHDRAWN" } } }, tx);
    });
  }

  // ------------------------------------------------------------------ requirements (delta)

  private async nextCode(tx: Tx, revisionId: string, prefix: string, model: "requirement" | "characteristic"): Promise<string> {
    const rows = model === "requirement"
      ? await tx.customerRequirement.findMany({ where: { configurationRevisionId: revisionId }, select: { code: true } })
      : (await tx.criticalCharacteristic.findMany({ where: { configurationRevisionId: revisionId }, select: { charNumber: true } })).map((r) => ({ code: r.charNumber }));
    const max = rows.reduce((m, r) => {
      const n = Number(/(\d+)$/.exec(r.code)?.[1] ?? 0);
      return Math.max(m, n);
    }, 0);
    return `${prefix}${String(max + 1).padStart(model === "requirement" ? 3 : 2, "0")}`;
  }

  async addRequirement(actor: Actor, revisionId: string, dto: RequirementDto) {
    return this.db.tx(async (tx) => {
      const rev = await this.lockEditableRevision(tx, revisionId);
      const code = dto.code?.trim().toUpperCase() ?? (await this.nextCode(tx, revisionId, "REQ-", "requirement"));
      const req = await tx.customerRequirement.create({ data: { ...dto, code, configurationRevisionId: revisionId, isModification: dto.isModification ?? true } });
      if (rev.baseline?.status === "ACCEPTED") await tx.engineeringBaseline.update({ where: { id: rev.baseline.id }, data: { status: "DRAFT", acceptedAt: null, acceptedById: null } });
      await this.bump(tx, revisionId);
      await this.audit.record({ eventType: "requirement.added", entityType: "CONFIGURATION_REVISION", entityId: revisionId, entityLabel: this.label(rev), metadata: { requirementId: req.id, code, title: req.title, requiredValue: req.requiredValue, acceptanceCriteria: req.acceptanceCriteria } }, tx);
      await this.activity.record(tx, { entityType: "CONFIGURATION_REVISION", entityId: revisionId, entityLabel: this.label(rev), verb: "requirement_added", summary: `Requirement ${code} "${req.title}" added`, supplierId: rev.configuration.supplierId });
      return req;
    });
  }

  async updateRequirement(actor: Actor, requirementId: string, dto: UpdateRequirementDto) {
    return this.db.tx(async (tx) => {
      const existing = await tx.customerRequirement.findUnique({ where: { id: requirementId } });
      if (!existing) throw new NotFoundError("Requirement");
      const rev = await this.lockEditableRevision(tx, existing.configurationRevisionId);
      const contentChanged = ["category", "title", "baselineValue", "requiredValue", "acceptanceCriteria", "isModification"].some((k) => k in dto && (dto as Record<string, unknown>)[k] !== (existing as Record<string, unknown>)[k]);
      const after = await tx.customerRequirement.update({
        where: { id: requirementId },
        // Content changes invalidate prior supplier acknowledgment and verification.
        data: { ...dto, ...(contentChanged ? { ackStatus: "PENDING", ackAt: null, ackByName: null, ackByUserId: null, verificationStatus: "PENDING", verifiedAt: null, verifiedById: null } : {}) },
      });
      if (contentChanged && rev.baseline?.status === "ACCEPTED") await tx.engineeringBaseline.update({ where: { id: rev.baseline.id }, data: { status: "DRAFT", acceptedAt: null, acceptedById: null } });
      await this.bump(tx, rev.id);
      await this.audit.record({ eventType: "requirement.updated", entityType: "CONFIGURATION_REVISION", entityId: rev.id, entityLabel: this.label(rev), changes: diffControlled(existing, after, ["category", "title", "baselineValue", "requiredValue", "acceptanceCriteria", "ackStatus", "verificationStatus"]), metadata: { requirementId, code: existing.code } }, tx);
      return after;
    });
  }

  async deleteRequirement(actor: Actor, requirementId: string) {
    return this.db.tx(async (tx) => {
      const existing = await tx.customerRequirement.findUnique({ where: { id: requirementId } });
      if (!existing) throw new NotFoundError("Requirement");
      const rev = await this.lockEditableRevision(tx, existing.configurationRevisionId);
      await tx.criticalCharacteristic.updateMany({ where: { customerRequirementId: requirementId }, data: { customerRequirementId: null } });
      await tx.customerRequirement.delete({ where: { id: requirementId } });
      await this.bump(tx, rev.id);
      await this.audit.record({ eventType: "requirement.removed", entityType: "CONFIGURATION_REVISION", entityId: rev.id, entityLabel: this.label(rev), metadata: { requirementId, code: existing.code, title: existing.title } }, tx);
    });
  }

  /** Records supplier acknowledgment of a requirement (internal on behalf of the supplier, or via the portal). */
  async acknowledgeRequirement(actor: Actor, requirementId: string, dto: AcknowledgeRequirementDto) {
    return this.db.tx(async (tx) => {
      const existing = await tx.customerRequirement.findUnique({ where: { id: requirementId }, include: { configurationRevision: { include: { configuration: true } } } });
      if (!existing) throw new NotFoundError("Requirement");
      AccessScope.of(actor).assertSupplier(existing.configurationRevision.configuration.supplierId, "Requirement");
      const rev = await this.lockEditableRevision(tx, existing.configurationRevisionId);
      const after = await tx.customerRequirement.update({
        where: { id: requirementId },
        data: { ackStatus: dto.status, ackAt: new Date(), ackByName: dto.acknowledgedByName, ackByUserId: actor.userType === "EXTERNAL" ? actor.userId : null, ackNote: dto.note ?? null },
      });
      await this.bump(tx, rev.id);
      await this.audit.record({ eventType: "requirement.acknowledged", entityType: "CONFIGURATION_REVISION", entityId: rev.id, entityLabel: this.label(rev), changes: { ackStatus: { before: existing.ackStatus, after: dto.status } }, metadata: { requirementId, code: existing.code, by: dto.acknowledgedByName, recordedBy: actor.userType } }, tx);
      await this.activity.record(tx, { entityType: "CONFIGURATION_REVISION", entityId: rev.id, entityLabel: this.label(rev), verb: "requirement_acknowledged", summary: `Supplier ${dto.status === "ACKNOWLEDGED" ? "acknowledged" : "declined"} ${existing.code} (${dto.acknowledgedByName})`, visibility: "SUPPLIER", supplierId: rev.configuration.supplierId });
      return after;
    });
  }

  async verifyRequirement(actor: Actor, requirementId: string, dto: VerifyRequirementDto) {
    return this.db.tx(async (tx) => {
      const existing = await tx.customerRequirement.findUnique({ where: { id: requirementId } });
      if (!existing) throw new NotFoundError("Requirement");
      const rev = await this.lockEditableRevision(tx, existing.configurationRevisionId);
      if (dto.status === "VERIFIED" && existing.ackStatus !== "ACKNOWLEDGED") throw new BusinessRuleError("The supplier must acknowledge the requirement before it can be verified");
      const after = await tx.customerRequirement.update({ where: { id: requirementId }, data: { verificationStatus: dto.status, verificationNote: dto.note, verifiedById: actor.userId, verifiedAt: new Date() } });
      await this.bump(tx, rev.id);
      await this.audit.record({ eventType: "requirement.verified", entityType: "CONFIGURATION_REVISION", entityId: rev.id, entityLabel: this.label(rev), changes: { verificationStatus: { before: existing.verificationStatus, after: dto.status } }, metadata: { requirementId, code: existing.code }, reason: dto.note }, tx);
      return after;
    });
  }

  // ------------------------------------------------------------------ characteristics

  async addCharacteristic(actor: Actor, revisionId: string, dto: CharacteristicDto) {
    return this.db.tx(async (tx) => {
      const rev = await this.lockEditableRevision(tx, revisionId);
      if (dto.customerRequirementId) {
        const req = await tx.customerRequirement.findFirst({ where: { id: dto.customerRequirementId, configurationRevisionId: revisionId } });
        if (!req) throw new BusinessRuleError("The linked requirement does not belong to this revision");
      }
      const charNumber = dto.charNumber?.trim().toUpperCase() ?? (await this.nextCode(tx, revisionId, "C-", "characteristic"));
      const c = await tx.criticalCharacteristic.create({ data: { ...dto, charNumber, configurationRevisionId: revisionId, source: dto.source ?? (dto.customerRequirementId ? "DELTA" : "BASELINE") } });
      await this.bump(tx, revisionId);
      await this.audit.record({ eventType: "characteristic.added", entityType: "CONFIGURATION_REVISION", entityId: revisionId, entityLabel: this.label(rev), metadata: { characteristicId: c.id, charNumber, name: c.name, classification: c.classification } }, tx);
      return c;
    });
  }

  async updateCharacteristic(actor: Actor, characteristicId: string, dto: UpdateCharacteristicDto) {
    return this.db.tx(async (tx) => {
      const existing = await tx.criticalCharacteristic.findUnique({ where: { id: characteristicId } });
      if (!existing) throw new NotFoundError("Characteristic");
      const rev = await this.lockEditableRevision(tx, existing.configurationRevisionId);
      const after = await tx.criticalCharacteristic.update({ where: { id: characteristicId }, data: dto });
      await this.bump(tx, rev.id);
      await this.audit.record({ eventType: "characteristic.updated", entityType: "CONFIGURATION_REVISION", entityId: rev.id, entityLabel: this.label(rev), changes: diffControlled(existing, after, ["name", "classification", "nominal", "tolerancePlus", "toleranceMinus", "unit", "specification", "measurementMethod", "acceptanceCriteria"]), metadata: { characteristicId, charNumber: existing.charNumber } }, tx);
      return after;
    });
  }

  async deleteCharacteristic(actor: Actor, characteristicId: string) {
    return this.db.tx(async (tx) => {
      const existing = await tx.criticalCharacteristic.findUnique({ where: { id: characteristicId } });
      if (!existing) throw new NotFoundError("Characteristic");
      const rev = await this.lockEditableRevision(tx, existing.configurationRevisionId);
      const refs = await tx.inspectionResult.count({ where: { characteristicId } });
      if (refs) throw new BusinessRuleError("The characteristic has recorded inspection results and cannot be removed");
      await tx.inspectionRequirement.deleteMany({ where: { characteristicId } });
      await tx.criticalCharacteristic.delete({ where: { id: characteristicId } });
      await this.bump(tx, rev.id);
      await this.audit.record({ eventType: "characteristic.removed", entityType: "CONFIGURATION_REVISION", entityId: rev.id, entityLabel: this.label(rev), metadata: { characteristicId, charNumber: existing.charNumber } }, tx);
    });
  }
}
