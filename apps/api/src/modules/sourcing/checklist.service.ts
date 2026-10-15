import { Injectable } from "@nestjs/common";
import type { Prisma, SourcingProject } from "@sqms/db";
import { deriveNewSupplier, evaluateApplicability, type ApplicabilityContext, type ConditionNode, type RuleInput } from "@sqms/shared";
import { AuditService } from "../../common/audit/audit.service";
import type { Tx } from "../../common/db/db.service";
import { BusinessRuleError } from "../../common/errors/app-errors";

const ROLE_TO_MEMBER: Record<string, string> = { SOURCING: "PURCHASING", ENGINEERING: "ENGINEERING", SUPPLIER_QUALITY: "SUPPLIER_QUALITY", APPROVER: "APPROVER" };

export interface ChecklistResult {
  policyVersionId: string;
  policyVersion: number;
  added: number;
  updated: number;
  notApplicable: number;
}

@Injectable()
export class ChecklistService {
  constructor(private readonly audit: AuditService) {}

  async activePolicy(tx: Tx) {
    const version = await tx.applicabilityPolicyVersion.findFirst({
      where: { status: "ACTIVE", policy: { key: "sourcing-document-requirements" } },
      orderBy: { version: "desc" },
      include: { rules: { include: { documentType: { select: { id: true, code: true, status: true } } } } },
    });
    if (!version) throw new BusinessRuleError("No active document applicability policy is configured");
    return version;
  }

  toRuleInputs(rules: { id: string; outcome: RuleInput["outcome"]; priority: number; conditions: Prisma.JsonValue; reason: string; dueOffsetDays: number | null; defaultAssigneeRoleKey: string | null; documentType: { code: string; status: string } }[]): RuleInput[] {
    return rules
      .filter((r) => r.documentType.status === "ACTIVE")
      .map((r) => ({
        id: r.id,
        documentTypeCode: r.documentType.code,
        outcome: r.outcome,
        priority: r.priority,
        conditions: (r.conditions ?? {}) as ConditionNode,
        reason: r.reason,
        dueOffsetDays: r.dueOffsetDays,
        defaultAssigneeRoleKey: r.defaultAssigneeRoleKey,
      }));
  }

  buildContext(input: {
    pathway: "A" | "B" | "C";
    riskLevel: ApplicabilityContext["riskLevel"];
    criticality: ApplicabilityContext["criticality"];
    supplierStatus: ApplicabilityContext["supplierStatus"];
    engineeringOwnership: ApplicabilityContext["engineeringOwnership"];
    reverseEngineering: boolean;
    specialProcesses: boolean;
    customerRequirements: boolean;
  }): ApplicabilityContext {
    return { ...input, newSupplier: deriveNewSupplier(input.supplierStatus) };
  }

  /**
   * Generates (or regenerates) the project's document checklist. Regeneration adds newly applicable requirements and
   * updates levels, marks open policy items that no longer apply as NOT_APPLICABLE, and never touches manual
   * additions or items that already carry submitted/accepted/waived evidence.
   */
  async generate(tx: Tx, project: SourcingProject & { members: { userId: string; role: string; dueDate: Date | null }[] }, ctx: ApplicabilityContext, actorId: string): Promise<ChecklistResult> {
    const policy = await this.activePolicy(tx);
    const evaluated = evaluateApplicability(this.toRuleInputs(policy.rules), ctx).filter((e) => e.level !== "NOT_APPLICABLE");
    const typeIds = new Map(policy.rules.map((r) => [r.documentType.code, r.documentType.id]));
    const existing = await tx.requiredDocument.findMany({ where: { projectId: project.id, source: "POLICY" }, include: { documentType: { select: { code: true } } } });
    const base = project.createdAt ?? new Date();
    let added = 0;
    let updated = 0;
    let notApplicable = 0;
    for (const e of evaluated) {
      const member = e.defaultAssigneeRoleKey ? project.members.find((m) => m.role === ROLE_TO_MEMBER[e.defaultAssigneeRoleKey!]) : undefined;
      const dueDate = e.dueOffsetDays !== null && e.dueOffsetDays !== undefined ? new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + e.dueOffsetDays)) : null;
      const current = existing.find((x) => x.documentType.code === e.documentTypeCode);
      if (!current) {
        await tx.requiredDocument.create({
          data: {
            projectId: project.id,
            documentTypeId: typeIds.get(e.documentTypeCode)!,
            level: e.level,
            status: "OPEN",
            source: "POLICY",
            ruleId: e.ruleId ?? null,
            reason: e.reason,
            dueDate: member?.dueDate ?? dueDate,
            assignedToId: member?.userId ?? null,
            assignedRoleKey: member ? null : e.defaultAssigneeRoleKey ?? null,
            addedById: actorId,
          },
        });
        added++;
      } else if (current.level !== e.level || current.status === "NOT_APPLICABLE" || current.ruleId !== (e.ruleId ?? null)) {
        await tx.requiredDocument.update({
          where: { id: current.id },
          data: { level: e.level, reason: e.reason, ruleId: e.ruleId ?? null, ...(current.status === "NOT_APPLICABLE" ? { status: "OPEN" } : {}), version: { increment: 1 } },
        });
        updated++;
      }
    }
    const applicable = new Set(evaluated.map((e) => e.documentTypeCode));
    for (const x of existing) {
      if (!applicable.has(x.documentType.code) && x.status === "OPEN" && !x.documentId) {
        await tx.requiredDocument.update({ where: { id: x.id }, data: { status: "NOT_APPLICABLE", reason: `No longer required by policy v${policy.version}`, version: { increment: 1 } } });
        notApplicable++;
      }
    }
    await tx.sourcingProject.update({
      where: { id: project.id },
      data: { applicabilityPolicyVersionId: policy.id, applicabilityContext: ctx as unknown as Prisma.InputJsonValue, checklistGeneratedAt: new Date() },
    });
    await this.audit.record(
      {
        eventType: existing.length ? "checklist.regenerated" : "checklist.generated",
        entityType: "SOURCING_PROJECT",
        entityId: project.id,
        entityLabel: project.projectNumber,
        metadata: { policyVersionId: policy.id, policyVersion: policy.version, context: ctx, added, updated, notApplicable },
      },
      tx,
    );
    return { policyVersionId: policy.id, policyVersion: policy.version, added, updated, notApplicable };
  }
}
