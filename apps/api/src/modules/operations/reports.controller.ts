import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";
import type { Response } from "express";
import { Prisma } from "@sqms/db";
import {
  inspectionSummaryWorkbook,
  inspectionSummaryPdf,
} from "@sqms/legacy-domain";
import { RequirePermissions } from "../../common/auth/decorators";
import { IsDateOnly } from "../../common/http/dto-helpers";
import { AuditService } from "../../common/audit/audit.service";
import { DbService } from "../../common/db/db.service";
import { BusinessRuleError } from "../../common/errors/app-errors";
import { object, type JsonObject } from "./operations.rules";

export class InspectionReportQuery {
  @IsDateOnly(true) dateFrom?: string;
  @IsDateOnly(true) dateTo?: string;
  @IsOptional()
  @IsIn(["DRAFT", "IN_PROGRESS", "COMPLETE", "ARCHIVED"])
  status?: "DRAFT" | "IN_PROGRESS" | "COMPLETE" | "ARCHIVED";
  @IsOptional() @IsIn(["PASS", "FAIL", "ACCEPTED"]) disposition?: string;
  @IsOptional() @IsUUID() planId?: string;
  @IsOptional() @IsUUID() assignedToId?: string;
  @IsOptional() @IsString() @MaxLength(120) componentType?: string;
  @IsOptional()
  @IsIn([
    "all",
    "component",
    "disposition",
    "status",
    "month",
    "week",
    "assignee",
  ])
  groupBy?: string;
  @IsOptional() @IsIn(["xlsx", "pdf"]) format?: string;
}
@Injectable()
export class OperationalReportsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}
  async report(q: InspectionReportQuery) {
    if (q.dateFrom && q.dateTo && q.dateFrom > q.dateTo)
      throw new BusinessRuleError("Start date must precede end date");
    const end = q.dateTo
      ? new Date(new Date(q.dateTo).getTime() + 86_400_000)
      : null;
    const where: Prisma.IncomingInspectionWhereInput = {
      ...(q.dateFrom || q.dateTo ? { createdAtKnown: true } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.disposition ? { disposition: q.disposition } : {}),
      ...(q.assignedToId ? { assignedToId: q.assignedToId } : {}),
      ...(q.planId ? { planRevision: { planId: q.planId } } : {}),
      ...(q.dateFrom || end
        ? {
            createdAt: {
              ...(q.dateFrom ? { gte: new Date(q.dateFrom) } : {}),
              ...(end ? { lt: end } : {}),
            },
          }
        : {}),
      ...(q.componentType
        ? {
            planSnapshot: { path: "$.component_type", equals: q.componentType },
          }
        : {}),
    };
    if ((await this.db.client.incomingInspection.count({ where })) > 50000)
      throw new BusinessRuleError(
        "Limit the report date range to 50,000 inspections",
      );
    const rows = await this.db.client.incomingInspection.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        number: true,
        originalPartNumber: true,
        originalSupplier: true,
        status: true,
        disposition: true,
        createdAt: true,
        createdAtKnown: true,
        completedAt: true,
        dueAt: true,
        header: true,
        planSnapshot: true,
        assignedTo: { select: { displayName: true } },
        planRevision: {
          select: {
            revision: true,
            plan: { select: { code: true, title: true } },
          },
        },
      },
    });
    const blank = (label: string) => ({
      label,
      count: 0,
      complete: 0,
      draft: 0,
      pass: 0,
      fail: 0,
      accepted: 0,
    });
    const groups = new Map<string, ReturnType<typeof blank>>();
    const totals = blank("All");
    for (const r of rows) {
      const week = new Date(r.createdAt);
      week.setUTCDate(week.getUTCDate() - ((week.getUTCDay() + 6) % 7));
      const label =
        q.groupBy === "component"
          ? String(
              object(r.planSnapshot).component_type ||
                r.planRevision.plan.title,
            )
          : q.groupBy === "disposition"
            ? r.disposition || "Pending"
            : q.groupBy === "status"
              ? r.status
              : q.groupBy === "month"
                ? r.createdAtKnown
                  ? r.createdAt.toISOString().slice(0, 7)
                  : "Legacy timestamp unresolved"
                : q.groupBy === "week"
                  ? r.createdAtKnown
                    ? week.toISOString().slice(0, 10)
                    : "Legacy timestamp unresolved"
                  : q.groupBy === "assignee"
                    ? r.assignedTo?.displayName || "Unassigned"
                    : "All";
      const group = groups.get(label) ?? blank(label);
      for (const g of [group, totals]) {
        g.count++;
        if (r.status === "COMPLETE") g.complete++;
        else g.draft++;
        if (r.disposition === "PASS") g.pass++;
        if (r.disposition === "FAIL") g.fail++;
        if (r.disposition === "ACCEPTED") g.accepted++;
      }
      groups.set(label, group);
    }
    return {
      filters: q,
      generatedAt: new Date().toISOString(),
      totals,
      groups: [...groups.values()].sort((a, b) =>
        a.label.localeCompare(b.label),
      ),
      details: rows.map((r) => ({
        id: r.id,
        number: r.number,
        form: r.planRevision.plan.code,
        revision: r.planRevision.revision,
        part: r.originalPartNumber,
        supplier: r.originalSupplier,
        purchaseOrder: object(r.header).po_number || "",
        inspector: object(r.header).inspector_name || "",
        status: r.status,
        disposition: r.disposition,
        assignedTo: r.assignedTo?.displayName || "",
        dueAt: r.dueAt?.toISOString(),
        createdAt: r.createdAtKnown ? r.createdAt.toISOString() : null,
        originalCreatedAt: object(r.header).created_at || "",
        createdAtKnown: r.createdAtKnown,
        completedAt: r.completedAt?.toISOString(),
      })),
    };
  }
  async export(q: InspectionReportQuery) {
    const r = await this.report(q);
    await this.audit.record({
      eventType: "incoming.report_exported",
      entityType: "SYSTEM",
      metadata: { filters: q as JsonObject, count: r.totals.count },
    });
    return q.format === "pdf"
      ? inspectionSummaryPdf(r)
      : inspectionSummaryWorkbook(r);
  }
}
@Controller("inspection-reports")
class OperationalReportsController {
  constructor(private readonly reports: OperationalReportsService) {}
  @Get() @RequirePermissions("inspection:read", "report:read") report(
    @Query() q: InspectionReportQuery,
  ) {
    return this.reports.report(q);
  }
  @Post("export")
  @RequirePermissions("inspection:read", "report:read", "report:export")
  async export(@Body() q: InspectionReportQuery, @Res() res: Response) {
    const buffer = await this.reports.export(q);
    res.set({
      "Content-Type":
        q.format === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="InspectionReport.${q.format === "pdf" ? "pdf" : "xlsx"}"`,
      "Cache-Control": "private, no-store",
    });
    res.send(buffer);
  }
}
@Module({
  controllers: [OperationalReportsController],
  providers: [OperationalReportsService],
})
export class OperationalReportsModule {}
