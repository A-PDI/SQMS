import { dailyInjectorSheet } from "./injector-sheet";
import type { MaintenanceJobName } from "@sqms/server-core";
import { createNotifications, writeSystemAudit } from "@sqms/server-core";
import type { WorkerContext } from "../context";

const DAY = 86_400_000;
const startOfUtcDay = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

async function notify(ctx: WorkerContext, input: Parameters<typeof createNotifications>[1]): Promise<void> {
  const ids = await ctx.prisma.$transaction((tx) => createNotifications(tx, input, { portalEnabled: ctx.env.SUPPLIER_PORTAL_ENABLED, mailEnabled: ctx.env.MAIL_TRANSPORT !== "disabled" }));
  await Promise.all(ids.map((id) => ctx.queues.enqueueEmail(id)));
}

async function setting<T>(ctx: WorkerContext, key: string, fallback: T): Promise<T> {
  const row = await ctx.prisma.systemSetting.findUnique({ where: { key } });
  return row ? (row.value as T) : fallback;
}

/** Re-enqueues email deliveries left PENDING (e.g. enqueue failed after commit). Idempotent via job ids. */
export async function sweepPendingDeliveries(ctx: WorkerContext): Promise<number> {
  const rows = await ctx.prisma.notificationDelivery.findMany({ where: { status: "PENDING", createdAt: { lt: new Date(Date.now() - 60_000) } }, select: { id: true }, take: 500 });
  await Promise.all(rows.map((r) => ctx.queues.enqueueEmail(r.id)));
  return rows.length;
}

/** Re-enqueues quarantined files that were never scanned (e.g. enqueue failed after commit). */
export async function sweepPendingScans(ctx: WorkerContext): Promise<number> {
  const rows = await ctx.prisma.fileObject.findMany({ where: { status: "QUARANTINED", scanAttempts: 0, createdAt: { lt: new Date(Date.now() - 120_000) } }, select: { id: true }, take: 500 });
  await Promise.all(rows.map((r) => ctx.queues.enqueueFileScan(r.id)));
  return rows.length;
}

/** Due-date reminders and overdue notices for open tasks (each sent once). */
export async function taskReminders(ctx: WorkerContext): Promise<number> {
  const leadHours = Number(await setting(ctx, "tasks.reminderLeadHours", 24));
  const now = new Date();
  const dueSoon = await ctx.prisma.task.findMany({
    where: { status: { in: ["OPEN", "IN_PROGRESS"] }, dueAt: { gt: now, lte: new Date(now.getTime() + leadHours * 3600_000) }, lastReminderAt: null },
    take: 500,
  });
  const overdue = await ctx.prisma.task.findMany({
    where: { status: { in: ["OPEN", "IN_PROGRESS"] }, dueAt: { lte: now }, OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: ctx.prisma.task.fields.dueAt } }] },
    take: 500,
  });
  for (const t of [...dueSoon.map((t) => ({ t, overdue: false })), ...overdue.map((t) => ({ t, overdue: true }))]) {
    await notify(ctx, {
      eventType: t.overdue ? "task.overdue" : "task.due_soon",
      title: `${t.overdue ? "Overdue" : "Due soon"}: ${t.t.title}`,
      body: `Due ${t.t.dueAt?.toISOString().slice(0, 16).replace("T", " ")} UTC`,
      entityType: t.t.entityType ?? undefined,
      entityId: t.t.entityId ?? undefined,
      link: "/approvals",
      userIds: t.t.assigneeUserId ? [t.t.assigneeUserId] : [],
      roleKeys: !t.t.assigneeUserId && t.t.assigneeRoleKey ? [t.t.assigneeRoleKey] : [],
      organizationId: t.t.assigneeOrganizationId ?? undefined,
    });
    await ctx.prisma.task.update({ where: { id: t.t.id }, data: { lastReminderAt: now } });
  }
  return dueSoon.length + overdue.length;
}

/** Escalates approvals pending longer than their step's escalation threshold. */
export async function approvalEscalation(ctx: WorkerContext): Promise<number> {
  const pending = await ctx.prisma.approvalAssignment.findMany({
    where: { status: "PENDING", escalatedAt: null, step: { status: "ACTIVE", stepDefinition: { escalateAfterDays: { not: null } } } },
    include: { step: { include: { stepDefinition: true, instance: true } } },
    take: 500,
  });
  let count = 0;
  for (const a of pending) {
    const days = a.step.stepDefinition.escalateAfterDays!;
    const activated = a.step.activatedAt ?? a.createdAt;
    if (activated.getTime() + days * DAY > Date.now()) continue;
    await ctx.prisma.$transaction(async (tx) => {
      const res = await tx.approvalAssignment.updateMany({ where: { id: a.id, status: "PENDING", escalatedAt: null }, data: { escalatedAt: new Date(), escalationLevel: { increment: 1 } } });
      if (!res.count) return;
      await writeSystemAudit(tx, { eventType: "approval.escalated", entityType: "APPROVAL_ASSIGNMENT", entityId: a.id, entityLabel: a.step.instance.subjectLabel, metadata: { step: a.step.name, afterDays: days, escalateTo: a.step.stepDefinition.escalateToRoleKey } });
    });
    await notify(ctx, {
      eventType: "approval.escalated",
      title: `Escalation: approval pending ${days}+ days - ${a.step.instance.subjectLabel}`,
      body: `Step "${a.step.name}" has not been decided.`,
      link: "/approvals",
      userIds: a.assigneeUserId ? [a.assigneeUserId] : [],
      roleKeys: [...(a.step.stepDefinition.escalateToRoleKey ? [a.step.stepDefinition.escalateToRoleKey] : []), ...(!a.assigneeUserId && a.assigneeRoleKey ? [a.assigneeRoleKey] : [])],
    });
    count++;
  }
  return count;
}

/** Escalates overdue supplier corrective-action responses by configurable day thresholds. */
export async function scarEscalation(ctx: WorkerContext): Promise<number> {
  const thresholds = (await setting<number[]>(ctx, "scar.escalationDays", [0, 7, 14])).map(Number).sort((a, b) => a - b);
  const today = startOfUtcDay();
  const overdue = await ctx.prisma.correctiveAction.findMany({
    where: { status: { in: ["ISSUED", "RESPONSE_REJECTED"] }, responseDueDate: { lt: today } },
    include: { supplier: { select: { name: true, organizationId: true } } },
    take: 500,
  });
  let count = 0;
  for (const s of overdue) {
    const daysOverdue = Math.floor((today.getTime() - s.responseDueDate.getTime()) / DAY);
    const level = thresholds.filter((t) => daysOverdue >= t).length;
    if (level <= s.escalationLevel) continue;
    await ctx.prisma.$transaction(async (tx) => {
      await tx.correctiveAction.update({ where: { id: s.id }, data: { escalationLevel: level, lastEscalatedAt: new Date() } });
      await writeSystemAudit(tx, { eventType: "scar.escalated", entityType: "SCAR", entityId: s.id, entityLabel: s.number, changes: { escalationLevel: { before: s.escalationLevel, after: level } }, metadata: { daysOverdue } });
      await tx.activityEvent.create({ data: { entityType: "SCAR", entityId: s.id, entityLabel: s.number, actorName: "System", verb: "escalated", summary: `Supplier response overdue by ${daysOverdue} day(s); escalated to level ${level}`, supplierId: s.supplierId } });
    });
    await notify(ctx, {
      eventType: "scar.overdue",
      title: `SCAR ${s.number} response overdue (${daysOverdue} days) - ${s.supplier.name}`,
      body: `Escalation level ${level}.`,
      entityType: "SCAR",
      entityId: s.id,
      link: `/quality/scars/${s.id}`,
      userIds: s.issuedById ? [s.issuedById] : [],
      roleKeys: level >= 2 ? ["SUPPLIER_QUALITY", "APPROVER"] : ["SUPPLIER_QUALITY"],
      organizationId: s.supplier.organizationId,
    });
    count++;
  }
  return count;
}

/** Certification expiry alerts at configured thresholds; expired certificates are marked EXPIRED. */
export async function certificationExpiry(ctx: WorkerContext): Promise<number> {
  const thresholds = (await setting<number[]>(ctx, "certifications.expiryAlertDays", [60, 30, 7])).map(Number).sort((a, b) => b - a);
  const today = startOfUtcDay();
  const horizon = new Date(today.getTime() + (thresholds[0] ?? 60) * DAY);
  const certs = await ctx.prisma.supplierCertification.findMany({
    where: { archivedAt: null, status: { in: ["VALID", "PENDING_VERIFICATION"] }, expiresAt: { not: null, lte: horizon } },
    include: { supplier: { select: { id: true, name: true } } },
    take: 1000,
  });
  let count = 0;
  for (const c of certs) {
    const expires = c.expiresAt!;
    const daysLeft = Math.ceil((expires.getTime() - today.getTime()) / DAY);
    if (daysLeft < 0) {
      await ctx.prisma.$transaction(async (tx) => {
        await tx.supplierCertification.update({ where: { id: c.id }, data: { status: "EXPIRED", lastExpiryAlertAt: new Date() } });
        await writeSystemAudit(tx, { eventType: "certification.expired", entityType: "SUPPLIER_CERTIFICATION", entityId: c.id, entityLabel: `${c.supplier.name} ${c.standard}`, changes: { status: { before: c.status, after: "EXPIRED" } } });
      });
      await notify(ctx, { eventType: "certification.expired", title: `Certification expired: ${c.supplier.name} ${c.standard}`, entityType: "SUPPLIER", entityId: c.supplierId, link: `/suppliers/${c.supplierId}?tab=certifications`, roleKeys: ["SUPPLIER_QUALITY"] });
      count++;
      continue;
    }
    // Alert once per threshold window.
    const threshold = [...thresholds].reverse().find((t) => daysLeft <= t);
    if (threshold === undefined) continue;
    const windowStart = new Date(expires.getTime() - threshold * DAY);
    if (c.lastExpiryAlertAt && c.lastExpiryAlertAt >= windowStart) continue;
    await ctx.prisma.supplierCertification.update({ where: { id: c.id }, data: { lastExpiryAlertAt: new Date() } });
    await notify(ctx, {
      eventType: "certification.expiring",
      title: `Certification expiring in ${daysLeft} days: ${c.supplier.name} ${c.standard}`,
      body: `Expires ${expires.toISOString().slice(0, 10)}.`,
      entityType: "SUPPLIER",
      entityId: c.supplierId,
      link: `/suppliers/${c.supplierId}?tab=certifications`,
      roleKeys: ["SUPPLIER_QUALITY"],
    });
    count++;
  }
  return count;
}

/** Expires approved deviations/concessions past their end date. */
export async function deviationExpiry(ctx: WorkerContext): Promise<number> {
  const today = startOfUtcDay();
  const rows = await ctx.prisma.deviation.findMany({ where: { status: "APPROVED", endDate: { lt: today } }, take: 500 });
  for (const d of rows) {
    await ctx.prisma.$transaction(async (tx) => {
      await tx.deviation.update({ where: { id: d.id }, data: { status: "EXPIRED", version: { increment: 1 } } });
      await writeSystemAudit(tx, { eventType: "deviation.expired", entityType: "DEVIATION", entityId: d.id, entityLabel: d.number, changes: { status: { before: "APPROVED", after: "EXPIRED" } } });
    });
    await notify(ctx, { eventType: "deviation.expired", title: `Deviation ${d.number} expired`, entityType: "DEVIATION", entityId: d.id, link: `/quality/deviations/${d.id}`, roleKeys: ["SUPPLIER_QUALITY"] });
  }
  return rows.length;
}

/** Calculates monthly supplier performance metrics (OPS-09 scorecard inputs). */
export async function supplierMetrics(ctx: WorkerContext, now = new Date()): Promise<number> {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const nextMonth = new Date(periodEnd.getTime() + DAY);
  const suppliers = await ctx.prisma.supplier.findMany({ where: { archivedAt: null, status: { in: ["APPROVED", "CONDITIONALLY_APPROVED", "SUSPENDED"] } }, select: { id: true } });
  for (const s of suppliers) {
    const [ncrs, criticalNcrs, scarsIssued, scarsOnTime, openScars, closed] = await Promise.all([
      ctx.prisma.nonconformance.count({ where: { supplierId: s.id, dateIdentified: { gte: periodStart, lt: nextMonth }, status: { not: "CANCELLED" } } }),
      ctx.prisma.nonconformance.count({ where: { supplierId: s.id, dateIdentified: { gte: periodStart, lt: nextMonth }, severity: "CRITICAL", status: { not: "CANCELLED" } } }),
      ctx.prisma.correctiveAction.count({ where: { supplierId: s.id, issuedAt: { gte: periodStart, lt: nextMonth } } }),
      ctx.prisma.correctiveActionResponse.count({ where: { scar: { supplierId: s.id, issuedAt: { gte: periodStart, lt: nextMonth } }, revisionNumber: 1, submittedAt: { not: null } } }),
      ctx.prisma.correctiveAction.count({ where: { supplierId: s.id, status: { in: ["ISSUED", "RESPONSE_SUBMITTED", "RESPONSE_REJECTED", "ACCEPTED", "VERIFICATION"] } } }),
      ctx.prisma.correctiveAction.findMany({ where: { supplierId: s.id, closedAt: { gte: periodStart, lt: nextMonth }, issuedAt: { not: null } }, select: { issuedAt: true, closedAt: true } }),
    ]);
    const avgClose = closed.length ? closed.reduce((sum, c) => sum + (c.closedAt!.getTime() - c.issuedAt!.getTime()) / DAY, 0) / closed.length : null;
    const metrics: { key: string; value: number; unit?: string }[] = [
      { key: "ncr_count", value: ncrs },
      { key: "critical_ncr_count", value: criticalNcrs },
      { key: "scar_issued", value: scarsIssued },
      { key: "scar_responses_submitted", value: scarsOnTime },
      { key: "open_scars", value: openScars },
      ...(avgClose !== null ? [{ key: "avg_scar_closure_days", value: Math.round(avgClose * 10) / 10, unit: "days" }] : []),
    ];
    for (const m of metrics) {
      await ctx.prisma.supplierPerformanceMetric.upsert({
        where: { supplierId_metricKey_periodStart_periodEnd: { supplierId: s.id, metricKey: m.key, periodStart, periodEnd } },
        update: { value: m.value, computedAt: new Date(), unit: m.unit ?? null },
        create: { supplierId: s.id, metricKey: m.key, periodStart, periodEnd, value: m.value, unit: m.unit ?? null, source: "CALCULATED" },
      });
    }
  }
  return suppliers.length;
}

export const MAINTENANCE_HANDLERS: Record<MaintenanceJobName, (ctx: WorkerContext) => Promise<number>> = {
  "injector-sheet": dailyInjectorSheet,
  "sweep-pending-deliveries": sweepPendingDeliveries,
  "sweep-pending-scans": sweepPendingScans,
  "task-reminders": taskReminders,
  "approval-escalation": approvalEscalation,
  "scar-escalation": scarEscalation,
  "certification-expiry": certificationExpiry,
  "deviation-expiry": deviationExpiry,
  "supplier-metrics": (ctx) => supplierMetrics(ctx),
};

/** Recurring schedules (BullMQ job schedulers). */
export const MAINTENANCE_SCHEDULES: { name: MaintenanceJobName; every?: number; pattern?: string }[] = [
  { name: "injector-sheet", every: 60_000 },
  { name: "sweep-pending-deliveries", every: 60_000 },
  { name: "sweep-pending-scans", every: 120_000 },
  { name: "task-reminders", every: 15 * 60_000 },
  { name: "approval-escalation", every: 60 * 60_000 },
  { name: "scar-escalation", every: 60 * 60_000 },
  { name: "certification-expiry", pattern: "15 6 * * *" },
  { name: "deviation-expiry", pattern: "20 6 * * *" },
  { name: "supplier-metrics", pattern: "30 6 * * *" },
];
