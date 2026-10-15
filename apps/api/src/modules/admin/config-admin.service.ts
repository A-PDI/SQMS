import { Injectable } from "@nestjs/common";
import type { AuditOutcome, EntityType, Prisma } from "@sqms/db";
import {
  CONTEXT_FIELDS,
  evaluateApplicability,
  isSettingKey,
  validateCondition,
  validateNumberingPattern,
  validateSetting,
  type ApplicabilityContext,
} from "@sqms/shared";
import type { Actor } from "../../common/auth/actor";
import { AuditService } from "../../common/audit/audit.service";
import { DbService, type Tx } from "../../common/db/db.service";
import { BusinessRuleError, ConflictError, NotFoundError } from "../../common/errors/app-errors";
import { toDate } from "../../common/http/dto-helpers";
import { pageArgs, type Page } from "../../common/http/pagination";
import { SettingsService } from "../../common/services/settings.service";
import { ChecklistService } from "../sourcing/checklist.service";
import type { AuditQuery, PolicyRuleInputDto, PublishWorkflowDto, UpdateFileTypeDto, UpdateNumberingDto, UpdateRetentionPolicyDto } from "./admin.dto";

@Injectable()
export class ConfigAdminService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly checklist: ChecklistService,
  ) {}

  // ------------------------------------------------------------------ settings

  listSettings() {
    return this.db.client.systemSetting.findMany({ orderBy: { key: "asc" } });
  }

  async updateSetting(actor: Actor, key: string, value: unknown) {
    if (!isSettingKey(key)) throw new NotFoundError("Setting");
    const result = validateSetting(key, value);
    if (!result.ok) throw new BusinessRuleError("Invalid setting value", { issues: result.issues });
    if (key === "qualification.workflowMatrix") {
      const keys = new Set(Object.values(result.value as Record<string, Record<string, string>>).flatMap((m) => Object.values(m)));
      const defs = await this.db.client.workflowDefinition.findMany({ where: { key: { in: [...keys] }, subjectType: "PRODUCT_QUALIFICATION", isActive: true }, select: { key: true } });
      const missing = [...keys].filter((k) => !defs.some((d) => d.key === k));
      if (missing.length) throw new BusinessRuleError(`Unknown product approval workflows: ${missing.join(", ")}`);
    }
    if (key === "branding" && (result.value as { logoFileId: string | null }).logoFileId) {
      const f = await this.db.client.fileObject.findUnique({ where: { id: (result.value as { logoFileId: string }).logoFileId } });
      if (!f || f.status !== "CLEAN" || f.category !== "IMAGE") throw new BusinessRuleError("The logo must be a clean, scanned image file");
    }
    const saved = await this.db.tx(async (tx) => {
      const before = await tx.systemSetting.findUnique({ where: { key } });
      const row = await tx.systemSetting.upsert({
        where: { key },
        update: { value: result.value as Prisma.InputJsonValue, updatedById: actor.userId },
        create: { key, value: result.value as Prisma.InputJsonValue, updatedById: actor.userId },
      });
      await this.audit.record({ eventType: "admin.setting.updated", entityType: "SYSTEM", entityLabel: key, changes: { [key]: { before: before?.value ?? null, after: result.value } } }, tx);
      return row;
    });
    this.settings.invalidate(key);
    return saved;
  }

  // ------------------------------------------------------------------ numbering

  listNumbering() {
    return this.db.client.numberingSequence.findMany({ orderBy: { key: "asc" } });
  }

  async updateNumbering(actor: Actor, key: string, dto: UpdateNumberingDto) {
    if (dto.pattern !== undefined) {
      const problem = validateNumberingPattern(dto.pattern);
      if (problem) throw new BusinessRuleError(problem);
    }
    return this.db.tx(async (tx) => {
      const before = await tx.numberingSequence.findUnique({ where: { key } });
      if (!before) throw new NotFoundError("Numbering sequence");
      // The next value is never reset from the UI, so existing identifiers cannot be reissued.
      const after = await tx.numberingSequence.update({ where: { key }, data: dto });
      await this.audit.record({ eventType: "admin.numbering.updated", entityType: "SYSTEM", entityLabel: key, changes: { prefix: { before: before.prefix, after: after.prefix }, pattern: { before: before.pattern, after: after.pattern }, padding: { before: before.padding, after: after.padding } } }, tx);
      return after;
    });
  }

  // ------------------------------------------------------------------ file types

  listFileTypes() {
    return this.db.client.allowedFileType.findMany({ orderBy: [{ category: "asc" }, { extension: "asc" }] });
  }

  /** Only enablement and size limits are editable; signature-verified types are defined in code and seeded. */
  async updateFileType(actor: Actor, id: string, dto: UpdateFileTypeDto) {
    return this.db.tx(async (tx) => {
      const before = await tx.allowedFileType.findUnique({ where: { id } });
      if (!before) throw new NotFoundError("File type");
      const after = await tx.allowedFileType.update({ where: { id }, data: dto });
      await this.audit.record({ eventType: "admin.file_type.updated", entityType: "SYSTEM", entityLabel: before.extension, changes: { enabled: { before: before.enabled, after: after.enabled }, maxSizeMb: { before: before.maxSizeMb, after: after.maxSizeMb } } }, tx);
      return after;
    });
  }

  // ------------------------------------------------------------------ retention policies

  listRetentionPolicies() {
    return this.db.client.retentionPolicy.findMany({ orderBy: { code: "asc" }, include: { documentTypes: { select: { code: true, name: true } } } });
  }

  async updateRetentionPolicy(actor: Actor, id: string, dto: UpdateRetentionPolicyDto) {
    const { reason, ...data } = dto;
    return this.db.tx(async (tx) => {
      const before = await tx.retentionPolicy.findUnique({ where: { id } });
      if (!before) throw new NotFoundError("Retention policy");
      const trigger = data.trigger ?? before.trigger;
      const months = data.retentionMonths !== undefined ? data.retentionMonths : before.retentionMonths;
      if (months !== null && trigger === "UNDEFINED") throw new BusinessRuleError("Select the event that starts the retention period");
      const after = await tx.retentionPolicy.update({ where: { id }, data: { ...data, updatedById: actor.userId } });
      await this.audit.record(
        { eventType: "admin.retention_policy.updated", entityType: "SYSTEM", entityLabel: before.code, reason, changes: { trigger: { before: before.trigger, after: after.trigger }, retentionMonths: { before: before.retentionMonths, after: after.retentionMonths }, dispositionAction: { before: before.dispositionAction, after: after.dispositionAction } } },
        tx,
      );
      return after;
    });
  }

  // ------------------------------------------------------------------ workflow definitions

  async listWorkflows() {
    const defs = await this.db.client.workflowDefinition.findMany({ orderBy: [{ key: "asc" }, { version: "desc" }], include: { steps: { orderBy: [{ stepOrder: "asc" }, { key: "asc" }] }, _count: { select: { instances: true } } } });
    const byKey = new Map<string, (typeof defs)[number][]>();
    for (const d of defs) byKey.set(d.key, [...(byKey.get(d.key) ?? []), d]);
    return [...byKey.entries()].map(([key, versions]) => ({ key, current: versions.find((v) => v.isActive) ?? versions[0], versions: versions.map((v) => ({ id: v.id, version: v.version, isActive: v.isActive, createdAt: v.createdAt, instances: v._count.instances })) }));
  }

  /**
   * Publishes a new version of a workflow definition. Running instances keep the version they started with; new
   * submissions use the new version.
   */
  async publishWorkflow(actor: Actor, key: string, dto: PublishWorkflowDto) {
    const current = await this.db.client.workflowDefinition.findFirst({ where: { key }, orderBy: { version: "desc" } });
    if (!current) throw new NotFoundError("Workflow definition");
    const problems: string[] = [];
    const keys = new Set<string>();
    const roleKeys = new Set<string>();
    for (const s of dto.steps) {
      if (keys.has(s.key)) problems.push(`Duplicate step key ${s.key}`);
      keys.add(s.key);
      if (s.approverType === "ROLE" && !s.approverRoleKey) problems.push(`Step ${s.key}: approver role is required`);
      if (s.approverType === "USER" && !s.approverUserId) problems.push(`Step ${s.key}: approver user is required`);
      if (s.approverType !== "ROLE" && (s.requiredApprovals ?? 1) > 1) problems.push(`Step ${s.key}: multiple approvals require a role pool`);
      if (s.approverRoleKey) roleKeys.add(s.approverRoleKey);
      if (s.escalateToRoleKey) roleKeys.add(s.escalateToRoleKey);
      if (s.condition) problems.push(...validateCondition(s.condition, `${s.key}.condition`));
    }
    const orders = [...new Set(dto.steps.map((s) => s.stepOrder))].sort((a, b) => a - b);
    if (orders.some((o, i) => o !== i + 1)) problems.push("Step orders must be consecutive starting at 1 (steps with the same order run in parallel)");
    const roles = await this.db.client.role.findMany({ where: { key: { in: [...roleKeys] }, scope: "INTERNAL" } });
    for (const r of roleKeys) if (!roles.some((x) => x.key === r)) problems.push(`Unknown internal role ${r}`);
    const userIds = dto.steps.map((s) => s.approverUserId).filter((x): x is string => !!x);
    if (userIds.length) {
      const users = await this.db.client.user.count({ where: { id: { in: userIds }, userType: "INTERNAL", status: "ACTIVE" } });
      if (users !== new Set(userIds).size) problems.push("Approver users must be active internal users");
    }
    if (problems.length) throw new BusinessRuleError("The workflow definition is invalid", { problems });
    return this.db.tx(async (tx) => {
      const latest = await tx.workflowDefinition.findFirstOrThrow({ where: { key }, orderBy: { version: "desc" } });
      await tx.workflowDefinition.updateMany({ where: { key, isActive: true }, data: { isActive: false } });
      const def = await tx.workflowDefinition.create({
        data: {
          key,
          version: latest.version + 1,
          name: dto.name,
          description: dto.description ?? latest.description,
          subjectType: latest.subjectType,
          isActive: true,
          createdById: actor.userId,
          steps: {
            create: dto.steps.map((s) => ({
              stepOrder: s.stepOrder,
              key: s.key,
              name: s.name,
              approverType: s.approverType,
              approverRoleKey: s.approverType === "ROLE" ? s.approverRoleKey! : null,
              approverUserId: s.approverType === "USER" ? s.approverUserId! : null,
              requiredApprovals: s.requiredApprovals ?? 1,
              dueInDays: s.dueInDays ?? null,
              escalateAfterDays: s.escalateAfterDays ?? null,
              escalateToRoleKey: s.escalateToRoleKey ?? null,
              allowDelegation: s.allowDelegation ?? true,
              condition: (s.condition ?? undefined) as Prisma.InputJsonValue | undefined,
            })),
          },
        },
        include: { steps: { orderBy: [{ stepOrder: "asc" }, { key: "asc" }] } },
      });
      await this.audit.record({ eventType: "admin.workflow.published", entityType: "SYSTEM", entityLabel: `${key}@v${def.version}`, metadata: { previousVersion: latest.version, steps: dto.steps.map((s) => ({ order: s.stepOrder, key: s.key, approver: s.approverRoleKey ?? s.approverUserId ?? s.approverType })) } }, tx);
      return def;
    });
  }

  // ------------------------------------------------------------------ applicability policies

  async listPolicies() {
    return this.db.client.applicabilityPolicy.findMany({
      orderBy: { key: "asc" },
      include: { versions: { orderBy: { version: "desc" }, select: { id: true, version: true, status: true, notes: true, activatedAt: true, retiredAt: true, createdAt: true, _count: { select: { rules: true, projects: true } } } } },
    });
  }

  async getPolicyVersion(id: string) {
    const v = await this.db.client.applicabilityPolicyVersion.findUnique({
      where: { id },
      include: { policy: true, rules: { orderBy: [{ documentType: { code: "asc" } }, { priority: "asc" }], include: { documentType: { select: { id: true, code: true, name: true, status: true } } } } },
    });
    if (!v) throw new NotFoundError("Policy version");
    return { ...v, contextFields: CONTEXT_FIELDS };
  }

  async createPolicyVersion(actor: Actor, policyId: string, fromVersionId: string | undefined, notes?: string) {
    // Re-read after commit: the response must reflect the committed version.
    const id = await this.db.tx(async (tx) => {
      const policy = await tx.applicabilityPolicy.findUnique({ where: { id: policyId } });
      if (!policy) throw new NotFoundError("Policy");
      const draft = await tx.applicabilityPolicyVersion.findFirst({ where: { policyId, status: "DRAFT" } });
      if (draft) throw new ConflictError(`Draft version ${draft.version} already exists`, "DRAFT_EXISTS");
      const source = fromVersionId
        ? await tx.applicabilityPolicyVersion.findFirst({ where: { id: fromVersionId, policyId }, include: { rules: true } })
        : await tx.applicabilityPolicyVersion.findFirst({ where: { policyId, status: "ACTIVE" }, include: { rules: true } });
      const latest = await tx.applicabilityPolicyVersion.findFirst({ where: { policyId }, orderBy: { version: "desc" } });
      const v = await tx.applicabilityPolicyVersion.create({
        data: {
          policyId,
          version: (latest?.version ?? 0) + 1,
          status: "DRAFT",
          notes: notes ?? null,
          createdById: actor.userId,
          rules: { create: (source?.rules ?? []).map((r) => ({ documentTypeId: r.documentTypeId, outcome: r.outcome, priority: r.priority, conditions: r.conditions as Prisma.InputJsonValue, reason: r.reason, dueOffsetDays: r.dueOffsetDays, defaultAssigneeRoleKey: r.defaultAssigneeRoleKey })) },
        },
      });
      await this.audit.record({ eventType: "admin.policy.version_created", entityType: "APPLICABILITY_POLICY", entityId: policyId, entityLabel: `${policy.key} v${v.version}`, metadata: { versionId: v.id, copiedFrom: source?.id ?? null } }, tx);
      return v.id;
    });
    return this.getPolicyVersion(id);
  }

  private async validateRules(tx: Tx, rules: PolicyRuleInputDto[]) {
    const problems: string[] = [];
    const codes = [...new Set(rules.map((r) => r.documentTypeCode))];
    const types = await tx.documentType.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } });
    for (const c of codes) if (!types.some((t) => t.code === c)) problems.push(`Unknown document type ${c}`);
    const roleKeys = [...new Set(rules.map((r) => r.defaultAssigneeRoleKey).filter((x): x is string => !!x))];
    const roles = await tx.role.findMany({ where: { key: { in: roleKeys }, scope: "INTERNAL" }, select: { key: true } });
    for (const k of roleKeys) if (!roles.some((r) => r.key === k)) problems.push(`Unknown internal role ${k}`);
    rules.forEach((r, i) => problems.push(...validateCondition(r.conditions, `rules[${i}].conditions`)));
    if (problems.length) throw new BusinessRuleError("The policy rules are invalid", { problems });
    return new Map(types.map((t) => [t.code, t.id]));
  }

  /** Replaces all rules of a DRAFT version. Active and retired versions are immutable. */
  async replaceRules(actor: Actor, versionId: string, rules: PolicyRuleInputDto[], notes?: string) {
    await this.db.tx(async (tx) => {
      const v = await tx.applicabilityPolicyVersion.findUnique({ where: { id: versionId }, include: { policy: true } });
      if (!v) throw new NotFoundError("Policy version");
      if (v.status !== "DRAFT") throw new ConflictError(`Version ${v.version} is ${v.status} and cannot be edited; create a new draft version`, "CONTROLLED_RECORD");
      const typeIds = await this.validateRules(tx, rules);
      await tx.applicabilityRule.deleteMany({ where: { policyVersionId: versionId } });
      await tx.applicabilityRule.createMany({
        data: rules.map((r) => ({ policyVersionId: versionId, documentTypeId: typeIds.get(r.documentTypeCode)!, outcome: r.outcome, priority: r.priority, conditions: r.conditions as Prisma.InputJsonValue, reason: r.reason, dueOffsetDays: r.dueOffsetDays ?? null, defaultAssigneeRoleKey: r.defaultAssigneeRoleKey ?? null })),
      });
      if (notes !== undefined) await tx.applicabilityPolicyVersion.update({ where: { id: versionId }, data: { notes } });
      await this.audit.record({ eventType: "admin.policy.rules_replaced", entityType: "APPLICABILITY_POLICY", entityId: v.policyId, entityLabel: `${v.policy.key} v${v.version}`, metadata: { versionId, rules: rules.length } }, tx);
    });
    return this.getPolicyVersion(versionId);
  }

  /** Activates a draft; the previously active version is retired (kept for projects that recorded it). */
  async activatePolicyVersion(actor: Actor, versionId: string, reason: string) {
    await this.db.tx(async (tx) => {
      const v = await tx.applicabilityPolicyVersion.findUnique({ where: { id: versionId }, include: { policy: true, _count: { select: { rules: true } } } });
      if (!v) throw new NotFoundError("Policy version");
      if (v.status !== "DRAFT") throw new ConflictError(`Version ${v.version} is ${v.status}`, "CONTROLLED_RECORD");
      if (!v._count.rules) throw new BusinessRuleError("A policy version needs at least one rule");
      const now = new Date();
      const previous = await tx.applicabilityPolicyVersion.findFirst({ where: { policyId: v.policyId, status: "ACTIVE" } });
      await tx.applicabilityPolicyVersion.updateMany({ where: { policyId: v.policyId, status: "ACTIVE" }, data: { status: "RETIRED", retiredAt: now } });
      await tx.applicabilityPolicyVersion.update({ where: { id: versionId }, data: { status: "ACTIVE", activatedAt: now, activatedById: actor.userId } });
      await this.audit.record({ eventType: "admin.policy.activated", entityType: "APPLICABILITY_POLICY", entityId: v.policyId, entityLabel: `${v.policy.key} v${v.version}`, reason, changes: { activeVersion: { before: previous?.version ?? null, after: v.version } } }, tx);
    });
    return this.getPolicyVersion(versionId);
  }

  /** Previews the requirements a version generates for a context (what-if analysis before activation). */
  async evaluatePolicy(versionId: string | undefined, context: Record<string, unknown>) {
    const problems: string[] = [];
    for (const [k, def] of Object.entries(CONTEXT_FIELDS)) {
      const v = context[k];
      if (v === undefined) {
        problems.push(`${k} is required`);
        continue;
      }
      if (def.type === "boolean" ? typeof v !== "boolean" : !def.values?.includes(String(v))) problems.push(`${k} has an invalid value`);
    }
    if (problems.length) throw new BusinessRuleError("Invalid context", { problems });
    const version = versionId
      ? await this.db.client.applicabilityPolicyVersion.findUnique({ where: { id: versionId }, include: { rules: { include: { documentType: { select: { id: true, code: true, status: true } } } } } })
      : await this.checklist.activePolicy(this.db.client as unknown as Tx);
    if (!version) throw new NotFoundError("Policy version");
    const evaluated = evaluateApplicability(this.checklist.toRuleInputs(version.rules), context as unknown as ApplicabilityContext);
    return { versionId: version.id, version: version.version, requirements: evaluated };
  }

  // ------------------------------------------------------------------ audit trail (read-only)

  private auditWhere(q: AuditQuery): Prisma.AuditEventWhereInput {
    const from = toDate(q.from);
    const to = toDate(q.to);
    return {
      ...(q.entityType ? { entityType: q.entityType as EntityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
      ...(q.outcome ? { outcome: q.outcome as AuditOutcome } : {}),
      ...(q.eventType ? (q.eventType.endsWith(".") ? { eventType: { startsWith: q.eventType } } : { eventType: q.eventType }) : {}),
      ...(from || to ? { occurredAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: new Date(to.getTime() + 86_400_000) } : {}) } } : {}),
      ...(q.q ? { OR: [{ entityLabel: { contains: q.q } }, { actorEmail: { contains: q.q } }] } : {}),
    };
  }

  async auditEvents(q: AuditQuery): Promise<Page<unknown>> {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where = this.auditWhere(q);
    const [total, items] = await Promise.all([this.db.client.auditEvent.count({ where }), this.db.client.auditEvent.findMany({ where, orderBy: { occurredAt: "desc" }, skip, take })]);
    return { total, page, pageSize, items };
  }

  auditExportRows(q: AuditQuery) {
    return this.db.client.auditEvent.findMany({ where: this.auditWhere(q), orderBy: { occurredAt: "asc" }, take: 50_000 });
  }

  /** Validates the entity type filter so arbitrary strings are rejected cleanly. */
  assertEntityType(value: string | undefined, allowed: readonly string[]) {
    if (value && !allowed.includes(value)) throw new BusinessRuleError(`Unknown entity type ${value}`);
  }
}
