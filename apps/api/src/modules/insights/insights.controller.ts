import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { PERMISSIONS as P } from "@sqms/shared";
import type { Response } from "express";
import type { Actor } from "../../common/auth/actor";
import { AudienceScope, CurrentActor, RequirePermissions } from "../../common/auth/decorators";
import { AuditService } from "../../common/audit/audit.service";
import { sendCsv, toCsv } from "../../common/http/csv";
import { ReportQuery, SearchQuery } from "./insights.dto";
import { InsightsService } from "./insights.service";

@ApiTags("dashboard")
@Controller()
export class InsightsController {
  constructor(
    private readonly insights: InsightsService,
    private readonly audit: AuditService,
  ) {}

  @Get("dashboard")
  @RequirePermissions(P.REPORT_READ)
  @ApiOperation({ summary: "Operational dashboard counts for the current user" })
  dashboard(@CurrentActor() actor: Actor) {
    return this.insights.dashboard(actor);
  }

  @Get("search")
  @AudienceScope("any")
  @ApiOperation({ summary: "Global search across records the user may access" })
  search(@CurrentActor() actor: Actor, @Query() q: SearchQuery) {
    return this.insights.search(actor, q);
  }

  @Get("reports")
  @RequirePermissions(P.REPORT_READ)
  reports() {
    return this.insights.list();
  }

  @Get("reports/:key")
  @RequirePermissions(P.REPORT_READ)
  run(@CurrentActor() actor: Actor, @Param("key") key: string, @Query() q: ReportQuery) {
    return this.insights.run(actor, key, q);
  }

  @Get("reports/:key/export.csv")
  @RequirePermissions(P.REPORT_READ, P.REPORT_EXPORT)
  async export(@CurrentActor() actor: Actor, @Param("key") key: string, @Query() q: ReportQuery, @Res() res: Response) {
    const report = await this.insights.run(actor, key, q);
    await this.audit.record({ eventType: "export.report", entityLabel: key, metadata: { rows: report.rows.length, filters: { ...q } } });
    sendCsv(res, `${key}-${report.generatedAt.slice(0, 10)}.csv`, toCsv(report.rows, report.columns.map((c) => ({ header: c.header, value: (r: Record<string, unknown>) => r[c.key] }))));
  }
}
