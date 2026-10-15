import { Injectable } from "@nestjs/common";
import type { EntityType, Prisma } from "@sqms/db";
import { NOTIFICATION_EVENT_TYPES, NOTIFICATION_EVENTS } from "@sqms/shared";
import type { Actor } from "../../common/auth/actor";
import { AccessScope } from "../../common/auth/access-scope";
import { AuditService } from "../../common/audit/audit.service";
import { DbService } from "../../common/db/db.service";
import { BusinessRuleError, ForbiddenError, NotFoundError } from "../../common/errors/app-errors";
import { pageArgs, type Page } from "../../common/http/pagination";
import { EntityAccessService } from "../entity/entity-access.service";
import type { CollabEntityType, CreateCommentDto, CreateSavedViewDto, NotificationListQuery, PreferenceItemDto, UpdateSavedViewDto } from "./collaboration.dto";

@Injectable()
export class CollaborationService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly entities: EntityAccessService,
  ) {}

  private canSeeInternal(actor: Actor) {
    return AccessScope.of(actor).isInternal && actor.permissions.has("comment:internal");
  }

  // ------------------------------------------------------------------ comments

  async comments(actor: Actor, entityType: CollabEntityType, entityId: string) {
    await this.entities.assertReadable(actor, entityType, entityId);
    const rows = await this.db.client.comment.findMany({
      where: { entityType, entityId, ...(this.canSeeInternal(actor) ? {} : { visibility: "SUPPLIER" }) },
      orderBy: { createdAt: "asc" },
      include: { author: { select: { id: true, displayName: true, userType: true } } },
    });
    return rows.map((c) => ({ ...c, body: c.deletedAt ? null : c.body, deleted: !!c.deletedAt, mine: c.authorId === actor.userId }));
  }

  async addComment(actor: Actor, dto: CreateCommentDto) {
    const scope = AccessScope.of(actor);
    const ref = await this.entities.assertReadable(actor, dto.entityType, dto.entityId);
    const visibility = scope.isInternal ? dto.visibility ?? "INTERNAL" : "SUPPLIER";
    if (!scope.isInternal && dto.visibility === "INTERNAL") throw new ForbiddenError("Supplier users cannot post internal comments");
    if (visibility === "INTERNAL" && !actor.permissions.has("comment:internal")) throw new ForbiddenError("Posting internal comments requires comment:internal");
    if (visibility === "SUPPLIER" && !ref.supplierVisible && ref.supplierId === null) throw new BusinessRuleError("This record is not shared with suppliers; use an internal comment");
    if (dto.parentId) {
      const parent = await this.db.client.comment.findFirst({ where: { id: dto.parentId, entityType: dto.entityType, entityId: dto.entityId, deletedAt: null } });
      if (!parent || (parent.visibility === "INTERNAL" && !this.canSeeInternal(actor))) throw new NotFoundError("Parent comment");
      // Replies inside an internal thread stay internal.
      if (parent.visibility === "INTERNAL" && visibility !== "INTERNAL") throw new BusinessRuleError("Replies to internal comments must be internal");
    }
    return this.db.tx(async (tx) => {
      const c = await tx.comment.create({ data: { entityType: dto.entityType, entityId: dto.entityId, authorId: actor.userId, body: dto.body.trim(), visibility, parentId: dto.parentId ?? null }, include: { author: { select: { id: true, displayName: true, userType: true } } } });
      await this.audit.record({ eventType: "comment.created", entityType: dto.entityType, entityId: dto.entityId, entityLabel: ref.label, metadata: { commentId: c.id, visibility } }, tx);
      return c;
    });
  }

  async editComment(actor: Actor, id: string, body: string) {
    const c = await this.db.client.comment.findUnique({ where: { id } });
    if (!c || c.deletedAt) throw new NotFoundError("Comment");
    await this.entities.assertReadable(actor, c.entityType, c.entityId);
    if (c.authorId !== actor.userId) throw new ForbiddenError("Only the author can edit a comment");
    return this.db.tx(async (tx) => {
      const updated = await tx.comment.update({ where: { id }, data: { body: body.trim(), editedAt: new Date() } });
      // The previous text is retained in the audit trail.
      await this.audit.record({ eventType: "comment.edited", entityType: c.entityType, entityId: c.entityId, changes: { body: { before: c.body, after: updated.body } }, metadata: { commentId: id } }, tx);
      return updated;
    });
  }

  async deleteComment(actor: Actor, id: string) {
    const c = await this.db.client.comment.findUnique({ where: { id } });
    if (!c || c.deletedAt) throw new NotFoundError("Comment");
    await this.entities.assertReadable(actor, c.entityType, c.entityId);
    if (c.authorId !== actor.userId && !actor.permissions.has("admin:users")) throw new ForbiddenError("Only the author or an administrator can delete a comment");
    await this.db.tx(async (tx) => {
      await tx.comment.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record({ eventType: "comment.deleted", entityType: c.entityType, entityId: c.entityId, changes: { body: { before: c.body, after: null } }, metadata: { commentId: id } }, tx);
    });
  }

  // ------------------------------------------------------------------ activity timelines

  /**
   * Record timeline. Supplier, part and project timelines aggregate related records through context columns.
   * Supplier users only see SUPPLIER-visibility events of their own supplier.
   */
  async activity(actor: Actor, entityType: CollabEntityType, entityId: string, q: { page?: number; pageSize?: number }): Promise<Page<unknown>> {
    await this.entities.assertReadable(actor, entityType, entityId);
    const scope = AccessScope.of(actor);
    const { skip, take, page, pageSize } = pageArgs(q);
    const context: Prisma.ActivityEventWhereInput[] = [{ entityType: entityType as EntityType, entityId }];
    if (entityType === "SUPPLIER") context.push({ supplierId: entityId });
    if (entityType === "INTERNAL_PART") context.push({ internalPartId: entityId });
    if (entityType === "SOURCING_PROJECT") context.push({ projectId: entityId });
    const where: Prisma.ActivityEventWhereInput = { OR: context, ...(scope.isInternal ? {} : { visibility: "SUPPLIER", supplierId: scope.supplierId ?? "__none__" }) };
    const [total, items] = await Promise.all([
      this.db.client.activityEvent.count({ where }),
      this.db.client.activityEvent.findMany({ where, orderBy: { occurredAt: "desc" }, skip, take }),
    ]);
    return { total, page, pageSize, items };
  }

  // ------------------------------------------------------------------ notifications

  async notifications(actor: Actor, q: NotificationListQuery): Promise<Page<unknown>> {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where: Prisma.NotificationWhereInput = { userId: actor.userId, ...(q.unread ? { readAt: null } : {}) };
    const [total, unread, items] = await Promise.all([
      this.db.client.notification.count({ where }),
      this.db.client.notification.count({ where: { userId: actor.userId, readAt: null } }),
      this.db.client.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
    ]);
    return { total, page, pageSize, items, unread } as Page<unknown> & { unread: number };
  }

  async unreadCount(actor: Actor) {
    return { unread: await this.db.client.notification.count({ where: { userId: actor.userId, readAt: null } }) };
  }

  async markRead(actor: Actor, id: string) {
    const res = await this.db.client.notification.updateMany({ where: { id, userId: actor.userId, readAt: null }, data: { readAt: new Date() } });
    if (!res.count && !(await this.db.client.notification.findFirst({ where: { id, userId: actor.userId } }))) throw new NotFoundError("Notification");
    return { ok: true };
  }

  async markAllRead(actor: Actor) {
    const res = await this.db.client.notification.updateMany({ where: { userId: actor.userId, readAt: null }, data: { readAt: new Date() } });
    return { updated: res.count };
  }

  async preferences(actor: Actor) {
    const rows = await this.db.client.notificationPreference.findMany({ where: { userId: actor.userId } });
    const value = (eventType: string, channel: "IN_APP" | "EMAIL") => rows.find((r) => r.eventType === eventType && r.channel === channel)?.enabled;
    return {
      all: { IN_APP: value("*", "IN_APP") ?? true, EMAIL: value("*", "EMAIL") ?? true },
      events: NOTIFICATION_EVENTS.map((e) => ({ ...e, IN_APP: value(e.eventType, "IN_APP") ?? null, EMAIL: value(e.eventType, "EMAIL") ?? null })),
    };
  }

  async updatePreferences(actor: Actor, items: PreferenceItemDto[]) {
    for (const i of items) if (i.eventType !== "*" && !NOTIFICATION_EVENT_TYPES.has(i.eventType)) throw new BusinessRuleError(`Unknown notification event type ${i.eventType}`);
    await this.db.tx(async (tx) => {
      for (const i of items) {
        await tx.notificationPreference.upsert({
          where: { userId_eventType_channel: { userId: actor.userId, eventType: i.eventType, channel: i.channel } },
          update: { enabled: i.enabled },
          create: { userId: actor.userId, eventType: i.eventType, channel: i.channel, enabled: i.enabled },
        });
      }
      await this.audit.record({ eventType: "notification_preferences.updated", entityType: "USER", entityId: actor.userId, metadata: { items: items.length } }, tx);
    });
    return this.preferences(actor);
  }

  // ------------------------------------------------------------------ saved views (saved filters)

  async savedViews(actor: Actor, module: string) {
    const scope = AccessScope.of(actor);
    return this.db.client.savedView.findMany({
      where: { module, OR: [{ userId: actor.userId }, ...(scope.isInternal ? [{ isShared: true, user: { userType: "INTERNAL" as const } }] : [])] },
      orderBy: [{ name: "asc" }],
      include: { user: { select: { id: true, displayName: true } } },
    });
  }

  async createSavedView(actor: Actor, dto: CreateSavedViewDto) {
    const scope = AccessScope.of(actor);
    if (dto.isShared && !scope.isInternal) throw new ForbiddenError("Supplier users cannot share views");
    if (JSON.stringify(dto.filters).length > 10_000) throw new BusinessRuleError("The saved filters are too large");
    return this.db.client.savedView.create({ data: { userId: actor.userId, module: dto.module, name: dto.name.trim(), filters: dto.filters as Prisma.InputJsonValue, sort: dto.sort ?? null, isShared: dto.isShared ?? false } });
  }

  async updateSavedView(actor: Actor, id: string, dto: UpdateSavedViewDto) {
    const v = await this.db.client.savedView.findFirst({ where: { id, userId: actor.userId } });
    if (!v) throw new NotFoundError("Saved view");
    if (dto.isShared && !AccessScope.of(actor).isInternal) throw new ForbiddenError("Supplier users cannot share views");
    return this.db.client.savedView.update({ where: { id }, data: { ...(dto.name ? { name: dto.name.trim() } : {}), ...(dto.filters ? { filters: dto.filters as Prisma.InputJsonValue } : {}), ...(dto.sort !== undefined ? { sort: dto.sort } : {}), ...(dto.isShared !== undefined ? { isShared: dto.isShared } : {}) } });
  }

  async deleteSavedView(actor: Actor, id: string) {
    const res = await this.db.client.savedView.deleteMany({ where: { id, userId: actor.userId } });
    if (!res.count) throw new NotFoundError("Saved view");
  }
}
