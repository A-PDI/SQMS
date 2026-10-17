import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@sqms/db";
import {
  buildExportRows,
  unmappedPartsIn,
  zonedDayRange,
  currentZonedDay,
  previousDay,
} from "@sqms/legacy-domain";
import type { AppEnv } from "./config";

export function injectorSheetDay(env: AppEnv, now = new Date()) {
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: env.INJECTOR_SHEET_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return clock >= env.INJECTOR_SHEET_DAILY_TIME
    ? previousDay(currentZonedDay(now, env.INJECTOR_SHEET_TIMEZONE))
    : null;
}
export async function injectorSheetPreview(
  db: PrismaClient,
  env: AppEnv,
  day: string,
) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    new Date(day).toISOString().slice(0, 10) !== day
  )
    throw new Error("Choose a valid calendar day");
  const range = zonedDayRange(day, env.INJECTOR_SHEET_TIMEZONE);
  const tests = await db.injectorTest.findMany({
    where: {
      testAt: { gte: new Date(range.from), lt: new Date(range.to) },
      outcome: "pass",
    },
    orderBy: [
      { testAt: "asc" },
      { reportExternalId: "asc" },
      { slotPosition: "asc" },
    ],
  });
  const eligible = tests.filter(
    (t) =>
      !/^R/i.test(t.serialNumber?.trim() ?? "") &&
      !/RMA/i.test(
        String((t.report as Record<string, unknown>).job_number ?? ""),
      ),
  );
  const rows = eligible.map((t) => ({
    id: t.id,
    part_number: t.partNumber,
    serial_number: t.serialNumber,
    test_datetime: t.testAt?.toISOString(),
    result_status: t.outcome,
    overall_pass: 1,
  }));
  return {
    day,
    timeZone: env.INJECTOR_SHEET_TIMEZONE,
    columns: ["Test Date", "Part Number", "Serial Number"],
    rows: buildExportRows(rows, env.INJECTOR_SHEET_TIMEZONE),
    sourceIds: eligible.map((t) => t.id),
    unmappedParts: unmappedPartsIn(rows),
  };
}
/** A day is reserved once, and its immutable delivery payload commits with the reservation. */
export async function queueInjectorSheetDay(
  db: PrismaClient,
  env: AppEnv,
  day: string,
  actorId?: string,
): Promise<
  Awaited<ReturnType<typeof injectorSheetPreview>> & {
    queued: boolean;
    eventId?: string;
    reservation?: unknown;
    reason?: string;
  }
> {
  if (env.INJECTOR_SHEET_MODE === "disabled")
    throw new Error(
      "Sheet delivery is disabled; preview and download remain available",
    );
  const preview = await injectorSheetPreview(db, env, day);
  try {
    return await db.$transaction(async (tx) => {
      const key = `injector.sheet.day.${day}`;
      const existing = await tx.systemSetting.findUnique({ where: { key } });
      if (existing)
        return { ...preview, queued: false, reservation: existing.value };
      const eventId = randomUUID();
      await tx.systemSetting.create({
        data: {
          key,
          value: { eventId, day, sourceIds: preview.sourceIds },
          description:
            "Immutable daily sheet reservation; late results require reviewed reconciliation",
        },
      });
      await tx.outboxEvent.create({
        data: {
          id: eventId,
          eventType: "injector.sheet_export.requested",
          aggregateType: "SYSTEM",
          aggregateId: eventId,
          payload: {
            ...preview,
            mode: env.INJECTOR_SHEET_MODE,
            sheetId: env.GOOGLE_SHEET_ID ?? null,
            tab: env.GOOGLE_SHEET_TAB,
          } as Prisma.InputJsonValue,
        },
      });
      if (actorId)
        await tx.auditEvent.create({
          data: {
            eventType: "injector.sheet_export_queued",
            actorType: "USER",
            actorUserId: actorId,
            entityType: "SYSTEM",
            entityId: eventId,
            metadata: {
              day,
              rows: preview.rows.length,
              mode: env.INJECTOR_SHEET_MODE,
            },
          },
        });
      return { ...preview, eventId, queued: true };
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002")
      return {
        ...preview,
        queued: false,
        reason: "Day already reserved by another run",
      };
    throw error;
  }
}
