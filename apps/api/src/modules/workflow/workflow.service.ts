import { Injectable, Logger } from "@nestjs/common";
import type { EntityType, Prisma, WorkflowInstance, WorkflowSubjectType } from "@sqms/db";
import { evaluateCondition, type ApplicabilityContext, type ConditionNode } from "@sqms/shared";
import type { Actor } from "../../common/auth/actor";
import { ActivityService } from "../../common/audit/activity.service";
import { AuditService } from "../../common/audit/audit.service";
import { DbService, type AfterCommit, type Tx } from "../../common/db/db.service";
import { BusinessRuleError, ConflictError, ForbiddenError, NotFoundError, StaleVersionError } from "../../common/errors/app-errors";
import { NotificationService } from "../../common/services/notification.service";
import { SettingsService } from "../../common/services/settings.service";

export interface WorkflowSubjectHandler {
  readonly subjectType: WorkflowSubjectType;
  onApproved(tx: Tx, after: AfterCommit, instance: WorkflowInstance): Promise<void>;
  onRejected(tx: Tx, after: AfterCommit, instance: WorkflowInstance, comment: string): Promise<void>;
  onInfoRequested(tx: Tx, after: AfterCommit, instance: WorkflowInstance, comment: string): Promise<void>;
}

export interface StartWorkflowInput {
  definitionKey: string;
  subjectType: WorkflowSubjectType;
  subjectId: string;
  subjectLabel: string;
  /** Exact version/hash of the subject being approved; decisions record this reference. */
  subjectVersionRef?: string;
  /** Application path for links in tasks/notifications, e.g. /documents/123 */
  link: string;
  /** Values for step conditions (e.g. riskLevel) and RECORD_OWNER resolution (ownerUserId). */
  context?: Record<string, unknown>;
  startedById: string;
}

export type Decision = "APPROVE" | "REJECT" | "REQUEST_INFO";

export const SUBJECT_ENTITY: Record<WorkflowSubjectType, EntityType> = {
  DOCUMENT_REVISION: "DOCUMENT_REVISION",
  PRODUCT_QUALIFICATION: "PRODUCT_QUALIFICATION",
  CHANGE_REQUEST: "CHANGE_REQUEST",
  SUPPLIER_QUALIFICATION: "SUPPLIER_QUALIFICATION",
  DEVIATION: "DEVIATION",
  SOURCING_PROJECT: "SOURCING_PROJECT",
  NCR_DISPOSITION: "NCR",
  SCAR_CLOSURE: "SCAR",
};

const addDays = (d: Date, days: number | null | undefined) => (days ? new Date(d.getTime() + days * 86_400_000) : null);

/**
 * Reusable workflow & approval engine. Steps with the same stepOrder run in parallel; groups run sequentially.
 * Every decision locks the workflow instance row, so concurrent decisions are serialized and state transitions
 * remain consistent. Subject modules react through registered handlers inside the same transaction, so a handler
 * failure (e.g. an approval gate) rolls back the decision.
 */
@Injectable()
export class WorkflowService {
  private readonly logger = new Logger("Workflow");
  private readonly handlers = new Map<WorkflowSubjectType, WorkflowSubjectHandler>();

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationService,
    private readonly settings: SettingsService,
  ) {}

  registerHandler(handler: WorkflowSubjectHandler): void {
    this.handlers.set(handler.subjectType, handler);
  }

  private handler(subjectType: WorkflowSubjectType): WorkflowSubjectHandler {
    const h = this.handlers.get(subjectType);
    if (!h) throw new Error(`No workflow handler registered for ${subjectType}`);
    return h;
  }

  async latestDefinition(tx: Tx, key: string) {
    const def = await tx.workflowDefinition.findFirst({ where: { key, isActive: true }, orderBy: { version: "desc" }, include: { steps: { orderBy: [{ stepOrder: "asc" }, { key: "asc" }] } } });
    if (!def) throw new BusinessRuleError(`Workflow definition "${key}" is not configured`);
    return def;
  }

  async start(tx: Tx, after: AfterCommit, input: StartWorkflowInput): Promise<WorkflowInstance> {
    const active = await tx.workflowInstance.findFirst({ where: { subjectType: input.subjectType, subjectId: input.subjectId, status: "ACTIVE" } });
    if (active) throw new ConflictError("An approval workflow is already in progress for this record", "WORKFLOW_ACTIVE");
    const def = await this.latestDefinition(tx, input.definitionKey);
    const context = { ...(input.context ?? {}), link: input.link };
    const instance = await tx.workflowInstance.create({
      data: {
        definitionId: def.id,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        subjectLabel: input.subjectLabel.slice(0, 200),
        subjectVersionRef: input.subjectVersionRef ?? null,
        context: context as Prisma.InputJsonValue,
        startedById: input.startedById,
      },
    });
    for (const s of def.steps) {
      const applies = !s.condition || evaluateCondition(s.condition as unknown as ConditionNode, context as unknown as ApplicabilityContext);
      await tx.workflowStep.create({
        data: { instanceId: instance.id, stepDefinitionId: s.id, stepOrder: s.stepOrder, name: s.name, status: applies ? "WAITING" : "SKIPPED", requiredApprovals: s.requiredApprovals },
      });
    }
    await this.audit.record({ eventType: "workflow.started", entityType: SUBJECT_ENTITY[input.subjectType], entityId: input.subjectId, entityLabel: input.subjectLabel, metadata: { instanceId: instance.id, definition: `${def.key}@v${def.version}`, subjectVersionRef: input.subjectVersionRef } }, tx);
    const result = await this.activateNextGroup(tx, after, instance.id);
    return result;
  }

  /** Activates the next WAITING step group, or completes the workflow when none remain. */
  private async activateNextGroup(tx: Tx, after: AfterCommit, instanceId: string): Promise<WorkflowInstance> {
    const instance = await tx.workflowInstance.findUniqueOrThrow({ where: { id: instanceId } });
    const waiting = await tx.workflowStep.findMany({ where: { instanceId, status: "WAITING" }, orderBy: { stepOrder: "asc" }, include: { stepDefinition: true } });
    if (!waiting.length) {
      const done = await tx.workflowInstance.update({ where: { id: instanceId }, data: { status: "APPROVED", completedAt: new Date(), currentStepOrder: null, version: { increment: 1 } } });
      await this.audit.record({ eventType: "workflow.approved", entityType: SUBJECT_ENTITY[instance.subjectType], entityId: instance.subjectId, entityLabel: instance.subjectLabel, metadata: { instanceId, subjectVersionRef: instance.subjectVersionRef } }, tx);
      await this.handler(instance.subjectType).onApproved(tx, after, done);
      await this.notifications.notify(tx, after, {
        eventType: "workflow.approved",
        title: `Approved: ${instance.subjectLabel}`,
        entityType: SUBJECT_ENTITY[instance.subjectType],
        entityId: instance.subjectId,
        link: this.link(instance),
        userIds: [instance.startedById],
      });
      return done;
    }
    const order = waiting[0].stepOrder;
    const now = new Date();
    const ctx = (instance.context ?? {}) as Record<string, unknown>;
    for (const step of waiting.filter((s) => s.stepOrder === order)) {
      const def = step.stepDefinition;
      const dueAt = addDays(now, def.dueInDays);
      await tx.workflowStep.update({ where: { id: step.id }, data: { status: "ACTIVE", activatedAt: now, dueAt } });
      let assigneeUserId: string | null = null;
      let assigneeRoleKey: string | null = null;
      if (def.approverType === "USER") assigneeUserId = def.approverUserId;
      else if (def.approverType === "RECORD_OWNER") assigneeUserId = typeof ctx.ownerUserId === "string" ? ctx.ownerUserId : null;
      else assigneeRoleKey = def.approverRoleKey;
      if (!assigneeUserId && !assigneeRoleKey) throw new BusinessRuleError(`Workflow step "${step.name}" has no resolvable approver`);
      await this.createAssignment(tx, after, instance, step.id, step.name, { assigneeUserId, assigneeRoleKey, dueAt });
    }
    return tx.workflowInstance.update({ where: { id: instanceId }, data: { currentStepOrder: order, version: { increment: 1 } } });
  }

  private link(instance: WorkflowInstance): string | undefined {
    const ctx = (instance.context ?? {}) as Record<string, unknown>;
    return typeof ctx.link === "string" ? ctx.link : undefined;
  }

  private async createAssignment(
    tx: Tx,
    after: AfterCommit,
    instance: WorkflowInstance,
    stepId: string,
    stepName: string,
    a: { assigneeUserId: string | null; assigneeRoleKey: string | null; dueAt: Date | null; reassignedFromId?: string; reassignedById?: string; reassignReason?: string },
  ) {
    const assignment = await tx.approvalAssignment.create({
      data: {
        stepId,
        assigneeUserId: a.assigneeUserId,
        assigneeRoleKey: a.assigneeRoleKey,
        dueAt: a.dueAt,
        reassignedFromId: a.reassignedFromId ?? null,
        reassignedById: a.reassignedById ?? null,
        reassignReason: a.reassignReason ?? null,
      },
    });
    await tx.task.create({
      data: {
        title: `Approval required: ${instance.subjectLabel} - ${stepName}`.slice(0, 300),
        type: "APPROVAL",
        assigneeUserId: a.assigneeUserId,
        assigneeRoleKey: a.assigneeRoleKey,
        dueAt: a.dueAt,
        entityType: SUBJECT_ENTITY[instance.subjectType],
        entityId: instance.subjectId,
        entityLabel: instance.subjectLabel,
        approvalAssignmentId: assignment.id,
        createdById: instance.startedById,
      },
    });
    await this.notifications.notify(tx, after, {
      eventType: "approval.requested",
      title: `Approval requested: ${instance.subjectLabel}`,
      body: `Step: ${stepName}${a.dueAt ? ` (due ${a.dueAt.toISOString().slice(0, 10)})` : ""}`,
      entityType: SUBJECT_ENTITY[instance.subjectType],
      entityId: instance.subjectId,
      link: "/approvals",
      userIds: a.assigneeUserId ? [a.assigneeUserId] : [],
      roleKeys: a.assigneeRoleKey ? [a.assigneeRoleKey] : [],
    });
    return assignment;
  }

  /** Eligibility of an actor for a pending assignment (also used to flag items in approval inboxes). */
  async eligibility(tx: Tx, actor: Actor, assignment: { assigneeUserId: string | null; assigneeRoleKey: string | null; step: { instanceId: string; instance: { startedById: string } } }): Promise<{ eligible: boolean; reason?: string }> {
    if (!actor.permissions.has("approval:decide")) return { eligible: false, reason: "Missing permission approval:decide" };
    if (assignment.assigneeUserId && assignment.assigneeUserId !== actor.userId) return { eligible: false, reason: "Assigned to another user" };
    if (!assignment.assigneeUserId && assignment.assigneeRoleKey && !actor.roles.includes(assignment.assigneeRoleKey)) {
      return { eligible: false, reason: `Requires role ${assignment.assigneeRoleKey}` };
    }
    if ((await this.settings.get("workflow.preventSelfApproval", true)) && assignment.step.instance.startedById === actor.userId) {
      return { eligible: false, reason: "You submitted this record and cannot approve it" };
    }
    const prior = await tx.approvalAssignment.findFirst({ where: { decidedById: actor.userId, status: "APPROVED", step: { instanceId: assignment.step.instanceId } } });
    if (prior) return { eligible: false, reason: "You have already approved another step of this workflow" };
    return { eligible: true };
  }

  async decide(actor: Actor, assignmentId: string, decision: Decision, comment: string | undefined, expectedVersion?: number) {
    if ((decision === "REJECT" || decision === "REQUEST_INFO") && !comment?.trim()) {
      throw new BusinessRuleError("A comment is required to reject or request information");
    }
    return this.db.tx(async (tx, after) => {
      const initial = await tx.approvalAssignment.findUnique({ where: { id: assignmentId }, select: { step: { select: { instanceId: true } } } });
      if (!initial) throw new NotFoundError("Approval");
      // Serialize all decisions on the same workflow instance.
      await this.db.lockRow(tx, "workflow_instances", initial.step.instanceId);
      const a = await tx.approvalAssignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { step: { include: { instance: true, stepDefinition: true } } } });
      if (expectedVersion !== undefined && a.version !== expectedVersion) throw new StaleVersionError("Approval");
      if (a.status !== "PENDING") throw new ConflictError("This approval has already been decided", "ALREADY_DECIDED");
      const instance = a.step.instance;
      if (instance.status !== "ACTIVE" || a.step.status !== "ACTIVE") throw new ConflictError("This workflow is no longer awaiting this decision", "WORKFLOW_NOT_ACTIVE");
      const elig = await this.eligibility(tx, actor, a);
      if (!elig.eligible) throw new ForbiddenError(elig.reason);

      const status = decision === "APPROVE" ? "APPROVED" : decision === "REJECT" ? "REJECTED" : "INFO_REQUESTED";
      const updated = await tx.approvalAssignment.updateMany({
        where: { id: a.id, status: "PENDING", version: a.version },
        data: { status, comment: comment?.trim() || null, decidedById: actor.userId, decidedAt: new Date(), decidedSubjectRef: instance.subjectVersionRef, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new StaleVersionError("Approval");
      await tx.task.updateMany({ where: { approvalAssignmentId: a.id, status: { in: ["OPEN", "IN_PROGRESS"] } }, data: { status: "DONE", completedAt: new Date(), completedById: actor.userId } });

      const entityType = SUBJECT_ENTITY[instance.subjectType];
      await this.audit.record(
        {
          eventType: `approval.${decision.toLowerCase()}`,
          entityType,
          entityId: instance.subjectId,
          entityLabel: instance.subjectLabel,
          reason: comment ?? null,
          metadata: { instanceId: instance.id, step: a.step.name, assignmentId: a.id, subjectVersionRef: instance.subjectVersionRef },
        },
        tx,
      );
      await this.activity.record(tx, {
        entityType,
        entityId: instance.subjectId,
        entityLabel: instance.subjectLabel,
        verb: decision === "APPROVE" ? "approved" : decision === "REJECT" ? "rejected" : "requested_information",
        summary: `${actor.displayName} ${decision === "APPROVE" ? "approved" : decision === "REJECT" ? "rejected" : "requested more information on"} step "${a.step.name}"${comment ? `: ${comment}` : ""}`,
      });

      if (decision === "APPROVE") {
        const approvals = await tx.approvalAssignment.count({ where: { stepId: a.stepId, status: "APPROVED" } });
        if (approvals >= a.step.requiredApprovals) {
          await tx.workflowStep.update({ where: { id: a.stepId }, data: { status: "APPROVED", completedAt: new Date() } });
          const openInGroup = await tx.workflowStep.count({ where: { instanceId: instance.id, stepOrder: a.step.stepOrder, status: "ACTIVE" } });
          if (openInGroup === 0) await this.activateNextGroup(tx, after, instance.id);
          else await tx.workflowInstance.update({ where: { id: instance.id }, data: { version: { increment: 1 } } });
        } else {
          await this.createAssignment(tx, after, instance, a.stepId, a.step.name, { assigneeUserId: null, assigneeRoleKey: a.assigneeRoleKey, dueAt: a.dueAt });
          await tx.workflowInstance.update({ where: { id: instance.id }, data: { version: { increment: 1 } } });
        }
      } else {
        await this.closeOpenItems(tx, instance.id);
        await tx.workflowStep.update({ where: { id: a.stepId }, data: { status: decision === "REJECT" ? "REJECTED" : "CANCELLED", completedAt: new Date() } });
        const done = await tx.workflowInstance.update({
          where: { id: instance.id },
          data: { status: decision === "REJECT" ? "REJECTED" : "INFO_REQUESTED", completedAt: new Date(), outcomeComment: comment ?? null, version: { increment: 1 } },
        });
        if (decision === "REJECT") await this.handler(instance.subjectType).onRejected(tx, after, done, comment!);
        else await this.handler(instance.subjectType).onInfoRequested(tx, after, done, comment!);
        await this.notifications.notify(tx, after, {
          eventType: decision === "REJECT" ? "workflow.rejected" : "workflow.info_requested",
          title: `${decision === "REJECT" ? "Rejected" : "Information requested"}: ${instance.subjectLabel}`,
          body: comment,
          entityType,
          entityId: instance.subjectId,
          link: this.link(instance),
          userIds: [instance.startedById],
        });
      }
      return tx.workflowInstance.findUniqueOrThrow({ where: { id: instance.id }, include: { steps: { include: { assignments: true }, orderBy: { stepOrder: "asc" } } } });
    });
  }

  /** Cancels pending assignments/tasks and waiting steps of an instance. */
  private async closeOpenItems(tx: Tx, instanceId: string): Promise<void> {
    const pending = await tx.approvalAssignment.findMany({ where: { status: "PENDING", step: { instanceId } }, select: { id: true } });
    if (pending.length) {
      await tx.approvalAssignment.updateMany({ where: { id: { in: pending.map((p) => p.id) } }, data: { status: "CANCELLED", version: { increment: 1 } } });
      await tx.task.updateMany({ where: { approvalAssignmentId: { in: pending.map((p) => p.id) }, status: { in: ["OPEN", "IN_PROGRESS"] } }, data: { status: "CANCELLED" } });
    }
    await tx.workflowStep.updateMany({ where: { instanceId, status: { in: ["WAITING", "ACTIVE"] } }, data: { status: "CANCELLED" } });
  }

  /** Cancels the active workflow of a subject (e.g. record withdrawn). */
  async cancelForSubject(tx: Tx, subjectType: WorkflowSubjectType, subjectId: string, reason: string): Promise<boolean> {
    const active = await tx.workflowInstance.findFirst({ where: { subjectType, subjectId, status: "ACTIVE" } });
    if (!active) return false;
    await this.db.lockRow(tx, "workflow_instances", active.id);
    await this.closeOpenItems(tx, active.id);
    await tx.workflowInstance.update({ where: { id: active.id }, data: { status: "CANCELLED", completedAt: new Date(), outcomeComment: reason, version: { increment: 1 } } });
    await this.audit.record({ eventType: "workflow.cancelled", entityType: SUBJECT_ENTITY[subjectType], entityId: subjectId, reason, metadata: { instanceId: active.id } }, tx);
    return true;
  }

  async reassign(actor: Actor, assignmentId: string, toUserId: string, reason: string) {
    return this.db.tx(async (tx, after) => {
      const initial = await tx.approvalAssignment.findUnique({ where: { id: assignmentId }, select: { step: { select: { instanceId: true } } } });
      if (!initial) throw new NotFoundError("Approval");
      await this.db.lockRow(tx, "workflow_instances", initial.step.instanceId);
      const a = await tx.approvalAssignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { step: { include: { instance: true, stepDefinition: true } } } });
      if (a.status !== "PENDING") throw new ConflictError("Only pending approvals can be reassigned", "ALREADY_DECIDED");
      const isAssignee = a.assigneeUserId === actor.userId || (!a.assigneeUserId && !!a.assigneeRoleKey && actor.roles.includes(a.assigneeRoleKey));
      const canAdmin = actor.permissions.has("approval:reassign");
      if (!canAdmin && !(isAssignee && a.step.stepDefinition.allowDelegation)) throw new ForbiddenError("You are not allowed to reassign this approval");
      const target = await tx.user.findUnique({
        where: { id: toUserId },
        include: { memberships: { where: { status: "ACTIVE", organization: { type: "INTERNAL" } }, include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } } },
      });
      if (!target || target.status !== "ACTIVE" || target.userType !== "INTERNAL") throw new BusinessRuleError("Approvals can only be reassigned to active internal users");
      const targetPerms = new Set(target.memberships.flatMap((m) => m.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.key))));
      if (!targetPerms.has("approval:decide")) throw new BusinessRuleError("The selected user is not permitted to record approval decisions");
      await tx.approvalAssignment.update({ where: { id: a.id }, data: { status: "REASSIGNED", reassignedById: actor.userId, reassignReason: reason, version: { increment: 1 } } });
      await tx.task.updateMany({ where: { approvalAssignmentId: a.id, status: { in: ["OPEN", "IN_PROGRESS"] } }, data: { status: "CANCELLED" } });
      const created = await this.createAssignment(tx, after, a.step.instance, a.stepId, a.step.name, {
        assigneeUserId: target.id,
        assigneeRoleKey: null,
        dueAt: a.dueAt,
        reassignedFromId: a.id,
        reassignedById: actor.userId,
        reassignReason: reason,
      });
      await this.audit.record(
        { eventType: "approval.reassigned", entityType: SUBJECT_ENTITY[a.step.instance.subjectType], entityId: a.step.instance.subjectId, entityLabel: a.step.instance.subjectLabel, reason, metadata: { fromAssignmentId: a.id, toAssignmentId: created.id, toUserId: target.id } },
        tx,
      );
      return created;
    });
  }

  /** Approval history for a subject (all instances, steps, decisions). */
  async history(subjectType: WorkflowSubjectType, subjectId: string) {
    const instances = await this.db.client.workflowInstance.findMany({
      where: { subjectType, subjectId },
      orderBy: { startedAt: "desc" },
      include: {
        definition: { select: { key: true, version: true, name: true } },
        steps: {
          orderBy: [{ stepOrder: "asc" }, { name: "asc" }],
          include: { assignments: { orderBy: { createdAt: "asc" }, include: { assignee: { select: { id: true, displayName: true } }, decidedBy: { select: { id: true, displayName: true } } } } },
        },
      },
    });
    const starters = await this.db.client.user.findMany({ where: { id: { in: [...new Set(instances.map((i) => i.startedById))] } }, select: { id: true, displayName: true } });
    return instances.map((i) => ({ ...i, startedBy: starters.find((s) => s.id === i.startedById) ?? null }));
  }

  /** Pending approvals visible to the actor (assigned directly or to one of their roles). */
  async inbox(actor: Actor, filter: { overdue?: boolean }) {
    const now = new Date();
    const rows = await this.db.client.approvalAssignment.findMany({
      where: {
        status: "PENDING",
        step: { status: "ACTIVE", instance: { status: "ACTIVE" } },
        OR: [{ assigneeUserId: actor.userId }, { assigneeUserId: null, assigneeRoleKey: { in: actor.roles } }],
        ...(filter.overdue ? { dueAt: { lt: now } } : {}),
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      take: 200,
      include: { step: { include: { instance: { include: { definition: { select: { name: true } } } } } } },
    });
    const out = [];
    for (const r of rows) {
      const elig = await this.eligibility(this.db.client as unknown as Tx, actor, r);
      out.push({
        id: r.id,
        version: r.version,
        stepName: r.step.name,
        assigneeRoleKey: r.assigneeRoleKey,
        assigneeUserId: r.assigneeUserId,
        dueAt: r.dueAt,
        overdue: !!r.dueAt && r.dueAt < now,
        escalationLevel: r.escalationLevel,
        createdAt: r.createdAt,
        workflowName: r.step.instance.definition.name,
        subjectType: r.step.instance.subjectType,
        subjectId: r.step.instance.subjectId,
        subjectLabel: r.step.instance.subjectLabel,
        subjectVersionRef: r.step.instance.subjectVersionRef,
        link: this.link(r.step.instance),
        canDecide: elig.eligible,
        ineligibleReason: elig.reason ?? null,
      });
    }
    return out;
  }

  async recentDecisions(actor: Actor) {
    return this.db.client.approvalAssignment.findMany({
      where: { decidedById: actor.userId },
      orderBy: { decidedAt: "desc" },
      take: 50,
      include: { step: { select: { name: true, instance: { select: { subjectType: true, subjectId: true, subjectLabel: true, context: true } } } } },
    });
  }
}
