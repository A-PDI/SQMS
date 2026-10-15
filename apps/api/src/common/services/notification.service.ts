import { Inject, Injectable } from "@nestjs/common";
import type { EntityType } from "@sqms/db";
import { QueueRegistry, type AppEnv } from "@sqms/server-core";
import { APP_ENV, QUEUES } from "../../infra/tokens";
import type { AfterCommit, Tx } from "../db/db.service";

export interface NotifyInput {
  eventType: string;
  title: string;
  body?: string;
  entityType?: EntityType;
  entityId?: string;
  /** Relative application path, e.g. /suppliers/123 */
  link?: string;
  userIds?: string[];
  /** Internal role keys whose active members are notified. */
  roleKeys?: string[];
  /** External organization whose active members are notified (only when the supplier portal is enabled). */
  organizationId?: string;
  excludeUserIds?: string[];
  /** Whether to send email (subject to user preferences). Defaults to true. */
  email?: boolean;
}

/**
 * Creates in-app notifications and email deliveries inside the business transaction. Email jobs are enqueued
 * after commit; the worker also sweeps PENDING deliveries, so a failed enqueue is retried automatically.
 */
@Injectable()
export class NotificationService {
  constructor(
    @Inject(QUEUES) private readonly queues: QueueRegistry,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async resolveRecipients(tx: Tx, input: Pick<NotifyInput, "userIds" | "roleKeys" | "organizationId" | "excludeUserIds">): Promise<{ id: string; email: string; userType: string }[]> {
    const ids = new Set(input.userIds ?? []);
    if (input.roleKeys?.length) {
      const members = await tx.organizationMembership.findMany({
        where: { status: "ACTIVE", organization: { type: "INTERNAL", isActive: true }, roles: { some: { role: { key: { in: input.roleKeys } } } } },
        select: { userId: true },
      });
      members.forEach((m) => ids.add(m.userId));
    }
    if (input.organizationId && this.env.SUPPLIER_PORTAL_ENABLED) {
      const members = await tx.organizationMembership.findMany({ where: { status: "ACTIVE", organizationId: input.organizationId }, select: { userId: true } });
      members.forEach((m) => ids.add(m.userId));
    }
    for (const ex of input.excludeUserIds ?? []) ids.delete(ex);
    if (!ids.size) return [];
    const users = await tx.user.findMany({ where: { id: { in: [...ids] }, status: "ACTIVE" }, select: { id: true, email: true, userType: true } });
    // External users only receive notifications when the supplier portal is enabled.
    return users.filter((u) => u.userType === "INTERNAL" || this.env.SUPPLIER_PORTAL_ENABLED);
  }

  async notify(tx: Tx, after: AfterCommit, input: NotifyInput): Promise<number> {
    const recipients = await this.resolveRecipients(tx, input);
    if (!recipients.length) return 0;
    const prefs = await tx.notificationPreference.findMany({
      where: { userId: { in: recipients.map((r) => r.id) }, eventType: { in: [input.eventType, "*"] } },
    });
    const enabled = (userId: string, channel: "IN_APP" | "EMAIL") => {
      const specific = prefs.find((p) => p.userId === userId && p.channel === channel && p.eventType === input.eventType);
      if (specific) return specific.enabled;
      const wildcard = prefs.find((p) => p.userId === userId && p.channel === channel && p.eventType === "*");
      return wildcard ? wildcard.enabled : true;
    };
    const deliveryIds: string[] = [];
    for (const r of recipients) {
      const notification = await tx.notification.create({
        data: {
          userId: r.id,
          eventType: input.eventType,
          title: input.title.slice(0, 300),
          body: input.body ?? null,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          link: input.link ?? null,
          readAt: enabled(r.id, "IN_APP") ? null : new Date(),
        },
      });
      if (input.email !== false && enabled(r.id, "EMAIL") && this.env.MAIL_TRANSPORT !== "disabled") {
        const d = await tx.notificationDelivery.create({ data: { kind: "NOTIFICATION", notificationId: notification.id, channel: "EMAIL", recipient: r.email } });
        deliveryIds.push(d.id);
      }
    }
    after.add(() => Promise.all(deliveryIds.map((id) => this.queues.enqueueEmail(id))));
    return recipients.length;
  }

  /** Transactional email not tied to an in-app notification (password reset, invitations). Body is purged after send. */
  async sendDirectEmail(tx: Tx, after: AfterCommit, input: { to: string; subject: string; body: string }): Promise<void> {
    if (this.env.MAIL_TRANSPORT === "disabled") return;
    const d = await tx.notificationDelivery.create({
      data: { kind: "DIRECT", channel: "EMAIL", recipient: input.to, subject: input.subject.slice(0, 300), body: input.body },
    });
    after.add(() => this.queues.enqueueEmail(d.id));
  }
}
