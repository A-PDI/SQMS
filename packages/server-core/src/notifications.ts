/**
 * Notification fan-out shared by the API and the worker: resolves recipients (users, internal roles, supplier
 * organization members), applies user preferences and creates in-app notifications plus email delivery records.
 * Callers enqueue the returned delivery ids after their transaction commits.
 */
import type { EntityType, Prisma } from "@sqms/db";

type Tx = Prisma.TransactionClient;

export interface NotificationInput {
  eventType: string;
  title: string;
  body?: string | null;
  entityType?: EntityType;
  entityId?: string;
  link?: string;
  userIds?: string[];
  roleKeys?: string[];
  organizationId?: string;
  excludeUserIds?: string[];
  email?: boolean;
}

export interface NotificationOptions {
  portalEnabled: boolean;
  mailEnabled: boolean;
}

export async function resolveRecipients(tx: Tx, input: Pick<NotificationInput, "userIds" | "roleKeys" | "organizationId" | "excludeUserIds">, opts: NotificationOptions) {
  const ids = new Set(input.userIds ?? []);
  if (input.roleKeys?.length) {
    const members = await tx.organizationMembership.findMany({
      where: { status: "ACTIVE", organization: { type: "INTERNAL", isActive: true }, roles: { some: { role: { key: { in: input.roleKeys } } } } },
      select: { userId: true },
    });
    members.forEach((m) => ids.add(m.userId));
  }
  if (input.organizationId && opts.portalEnabled) {
    const members = await tx.organizationMembership.findMany({ where: { status: "ACTIVE", organizationId: input.organizationId }, select: { userId: true } });
    members.forEach((m) => ids.add(m.userId));
  }
  for (const ex of input.excludeUserIds ?? []) ids.delete(ex);
  if (!ids.size) return [];
  const users = await tx.user.findMany({ where: { id: { in: [...ids] }, status: "ACTIVE" }, select: { id: true, email: true, userType: true } });
  return users.filter((u) => u.userType === "INTERNAL" || opts.portalEnabled);
}

/** Creates notifications and email deliveries. Returns delivery ids to enqueue after commit. */
export async function createNotifications(tx: Tx, input: NotificationInput, opts: NotificationOptions): Promise<string[]> {
  const recipients = await resolveRecipients(tx, input, opts);
  if (!recipients.length) return [];
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
    if (input.email !== false && opts.mailEnabled && enabled(r.id, "EMAIL")) {
      const d = await tx.notificationDelivery.create({ data: { kind: "NOTIFICATION", notificationId: notification.id, channel: "EMAIL", recipient: r.email } });
      deliveryIds.push(d.id);
    }
  }
  return deliveryIds;
}

/** Writes an audit event attributed to the system (background jobs). */
export async function writeSystemAudit(
  tx: Tx,
  input: { eventType: string; entityType?: EntityType; entityId?: string; entityLabel?: string; changes?: Record<string, { before: unknown; after: unknown }>; metadata?: Record<string, unknown>; reason?: string; outcome?: "SUCCESS" | "FAILURE" | "DENIED" },
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      actorType: "SYSTEM",
      eventType: input.eventType,
      outcome: input.outcome ?? "SUCCESS",
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      entityLabel: input.entityLabel?.slice(0, 200) ?? null,
      changes: (input.changes ?? undefined) as Prisma.InputJsonValue | undefined,
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      reason: input.reason ?? null,
    },
  });
}
