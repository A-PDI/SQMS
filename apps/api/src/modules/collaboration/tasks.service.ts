import { Injectable } from "@nestjs/common";
import type { Prisma, TaskStatus, TaskType } from "@sqms/db";
import type { Actor } from "../../common/auth/actor";
import { AccessScope } from "../../common/auth/access-scope";
import { AuditService, diffControlled } from "../../common/audit/audit.service";
import { DbService } from "../../common/db/db.service";
import { BusinessRuleError, ConflictError, ForbiddenError, NotFoundError } from "../../common/errors/app-errors";
import { pageArgs, sortArg, trimQ, type Page } from "../../common/http/pagination";
import { NotificationService } from "../../common/services/notification.service";
import { EntityAccessService } from "../entity/entity-access.service";
import type { CreateTaskDto, TaskListQuery, UpdateTaskDto } from "./collaboration.dto";

const OPEN: TaskStatus[] = ["OPEN", "IN_PROGRESS"];

const INCLUDE = {
  assignee: { select: { id: true, displayName: true, email: true } },
  createdBy: { select: { id: true, displayName: true } },
} satisfies Prisma.TaskInclude;

@Injectable()
export class TasksService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly entities: EntityAccessService,
  ) {}

  /** Tasks the actor is responsible for: assigned to them, or to one of their roles while unclaimed. */
  private mine(actor: Actor): Prisma.TaskWhereInput {
    const scope = AccessScope.of(actor);
    if (!scope.isInternal) return { assigneeOrganizationId: actor.organizationId };
    return { OR: [{ assigneeUserId: actor.userId }, { assigneeUserId: null, assigneeRoleKey: { in: actor.roles } }] };
  }

  async list(actor: Actor, q: TaskListQuery): Promise<Page<unknown>> {
    const scope = AccessScope.of(actor);
    const { skip, take, page, pageSize } = pageArgs(q);
    const term = trimQ(q.q);
    const base: Prisma.TaskWhereInput = !scope.isInternal ? this.mine(actor) : q.scope === "all" ? {} : q.scope === "created" ? { createdById: actor.userId } : this.mine(actor);
    const now = new Date();
    const where: Prisma.TaskWhereInput = {
      AND: [
        base,
        { status: { in: (q.status?.length ? q.status : OPEN) as TaskStatus[] } },
        ...(q.type?.length ? [{ type: { in: q.type as TaskType[] } }] : []),
        ...(q.overdue ? [{ dueAt: { lt: now }, status: { in: OPEN } }] : []),
        ...(q.entityType ? [{ entityType: q.entityType }] : []),
        ...(q.entityId ? [{ entityId: q.entityId }] : []),
        ...(term ? [{ OR: [{ title: { contains: term } }, { entityLabel: { contains: term } }] }] : []),
      ],
    };
    const [total, items] = await Promise.all([
      this.db.client.task.count({ where }),
      this.db.client.task.findMany({ where, skip, take, orderBy: q.sort ? sortArg(q, ["dueAt", "createdAt", "priority", "title", "status"] as const, "dueAt", "asc") : [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }], include: INCLUDE }),
    ]);
    return { total, page, pageSize, items: items.map((t) => ({ ...t, overdue: !!t.dueAt && t.dueAt < now && OPEN.includes(t.status) })) };
  }

  async summary(actor: Actor) {
    const now = new Date();
    const where = { AND: [this.mine(actor), { status: { in: OPEN } }] };
    const [open, overdue, approvals] = await Promise.all([
      this.db.client.task.count({ where }),
      this.db.client.task.count({ where: { AND: [where, { dueAt: { lt: now } }] } }),
      this.db.client.task.count({ where: { AND: [where, { type: "APPROVAL" }] } }),
    ]);
    return { open, overdue, approvals };
  }

  private async assertAssignee(userId: string, organizationId?: string | null) {
    const user = await this.db.client.user.findFirst({ where: { id: userId, status: "ACTIVE" }, include: { memberships: { where: { status: "ACTIVE" }, select: { organizationId: true } } } });
    if (!user) throw new BusinessRuleError("The assignee must be an active user");
    if (organizationId ? !user.memberships.some((m) => m.organizationId === organizationId) : user.userType !== "INTERNAL") {
      throw new BusinessRuleError(organizationId ? "The assignee must belong to the task's organization" : "The assignee must be an internal user");
    }
    return user;
  }

  async create(actor: Actor, dto: CreateTaskDto) {
    if (!!dto.entityType !== !!dto.entityId) throw new BusinessRuleError("Provide both entityType and entityId, or neither");
    if (!dto.assigneeUserId && !dto.assigneeRoleKey) throw new BusinessRuleError("Assign the task to a user or a role");
    const ref = dto.entityType && dto.entityId ? await this.entities.assertReadable(actor, dto.entityType, dto.entityId) : null;
    if (dto.assigneeUserId) await this.assertAssignee(dto.assigneeUserId);
    if (dto.assigneeRoleKey) {
      const role = await this.db.client.role.findUnique({ where: { key: dto.assigneeRoleKey } });
      if (!role || role.scope !== "INTERNAL") throw new BusinessRuleError("Unknown internal role");
    }
    const dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
    return this.db.tx(async (tx, after) => {
      const task = await tx.task.create({
        data: {
          title: dto.title,
          description: dto.description ?? null,
          type: dto.type,
          priority: dto.priority ?? "NORMAL",
          assigneeUserId: dto.assigneeUserId ?? null,
          assigneeRoleKey: dto.assigneeUserId ? null : dto.assigneeRoleKey ?? null,
          dueAt,
          entityType: ref?.entityType ?? null,
          entityId: ref?.entityId ?? null,
          entityLabel: ref?.label?.slice(0, 200) ?? null,
          createdById: actor.userId,
        },
        include: INCLUDE,
      });
      await this.audit.record({ eventType: "task.created", entityType: "TASK", entityId: task.id, entityLabel: task.title, metadata: { assigneeUserId: task.assigneeUserId, assigneeRoleKey: task.assigneeRoleKey, entityType: task.entityType, entityId: task.entityId } }, tx);
      await this.notifications.notify(tx, after, {
        eventType: "task.assigned",
        title: `Task assigned: ${task.title}`,
        body: dueAt ? `Due ${dueAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : null,
        entityType: task.entityType ?? undefined,
        entityId: task.entityId ?? undefined,
        link: "/tasks",
        userIds: task.assigneeUserId ? [task.assigneeUserId] : [],
        roleKeys: task.assigneeRoleKey ? [task.assigneeRoleKey] : [],
        excludeUserIds: [actor.userId],
      });
      return task;
    });
  }

  async update(actor: Actor, id: string, dto: UpdateTaskDto) {
    const scope = AccessScope.of(actor);
    return this.db.tx(async (tx, after) => {
      const t = await tx.task.findUnique({ where: { id }, include: { approvalAssignment: true } });
      if (!t) throw new NotFoundError("Task");
      const isAssignee = scope.isInternal ? t.assigneeUserId === actor.userId || (!t.assigneeUserId && !!t.assigneeRoleKey && actor.roles.includes(t.assigneeRoleKey)) : t.assigneeOrganizationId === actor.organizationId;
      const canManage = scope.isInternal && (t.createdById === actor.userId || actor.permissions.has("approval:reassign"));
      if (!isAssignee && !canManage) {
        if (!scope.isInternal) throw new NotFoundError("Task");
        throw new ForbiddenError("Only the assignee, the creator or a coordinator can update this task");
      }
      if (!OPEN.includes(t.status) && dto.status !== "OPEN") throw new ConflictError(`The task is ${t.status}`, "TASK_CLOSED");
      if (t.type === "APPROVAL" && (dto.status || dto.assigneeUserId !== undefined)) {
        throw new ConflictError("Approval tasks follow their approval; decide or reassign the approval instead", "APPROVAL_TASK");
      }
      if (dto.status === "DONE" && t.type === "DOCUMENT_SUBMISSION" && t.requiredDocumentId) {
        const req = await tx.requiredDocument.findUnique({ where: { id: t.requiredDocumentId } });
        if (req && !["ACCEPTED", "WAIVED", "NOT_APPLICABLE"].includes(req.status)) throw new BusinessRuleError("The required document has not been accepted yet");
      }
      if (dto.assigneeUserId) {
        if (!canManage && !(isAssignee && dto.assigneeUserId === actor.userId)) throw new ForbiddenError("Only a coordinator can reassign tasks to someone else");
        await this.assertAssignee(dto.assigneeUserId, t.assigneeOrganizationId);
      }
      const data: Prisma.TaskUpdateInput = {
        ...(dto.priority ? { priority: dto.priority } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.dueAt !== undefined ? { dueAt: dto.dueAt ? new Date(dto.dueAt) : null, lastReminderAt: null } : {}),
        ...(dto.assigneeUserId !== undefined ? { assignee: dto.assigneeUserId ? { connect: { id: dto.assigneeUserId } } : { disconnect: true } } : {}),
        ...(dto.status ? { status: dto.status, ...(dto.status === "DONE" ? { completedAt: new Date(), completedById: actor.userId } : { completedAt: null, completedById: null }) } : {}),
        version: { increment: 1 },
      };
      const updated = await tx.task.update({ where: { id }, data, include: INCLUDE });
      await this.audit.record({ eventType: "task.updated", entityType: "TASK", entityId: id, entityLabel: t.title, changes: diffControlled(t, updated, ["status", "priority", "assigneeUserId", "dueAt"]) }, tx);
      if (dto.assigneeUserId && dto.assigneeUserId !== actor.userId && dto.assigneeUserId !== t.assigneeUserId) {
        await this.notifications.notify(tx, after, { eventType: "task.assigned", title: `Task assigned: ${t.title}`, entityType: t.entityType ?? undefined, entityId: t.entityId ?? undefined, link: "/tasks", userIds: [dto.assigneeUserId] });
      }
      return updated;
    });
  }
}
