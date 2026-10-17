import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";
import type { Response } from "express";
import type { Actor } from "../../common/auth/actor";
import { CurrentActor, RequirePermissions } from "../../common/auth/decorators";
import { PageQueryDto } from "../../common/http/pagination";
import { EvidenceService } from "./evidence.service";
import { IncomingService } from "./incoming.service";
import { InjectorService } from "./injector.service";
import { CarbonZappService } from "./carbonzapp.service";
import { IsDateOnly } from "../../common/http/dto-helpers";
import {
  InjectorSelectionDto,
  NewIncomingDto,
  NewRepairDto,
  OperationsQuery,
  OperationsReasonDto,
  OperationsVersionDto,
  PlanDto,
  PlanRevisionDto,
  RecordedSyncDto,
  RepairAttemptDto,
  RepairStatusDto,
  RetestDto,
  UpdateIncomingDto,
  QuickRepairDto,
} from "./operations.dto";

class InjectorQuery extends PageQueryDto {
  @IsDateOnly(true) dateFrom?: string;
  @IsDateOnly(true) dateTo?: string;
  @IsOptional() @IsIn(["pass", "fail", "dnf", "unknown"]) outcome?: string;
  @IsOptional() @IsString() @MaxLength(200) partNumber?: string;
  @IsOptional() @IsString() @MaxLength(200) serialNumber?: string;
  @IsOptional() @IsString() @MaxLength(1000) stepCodes?: string;
  @IsOptional()
  @IsIn(["pass", "fail", "dnf", "unknown", "skip"])
  stepStatus?: string;
  @IsOptional() @IsIn(["any", "all"]) stepMatch?: string;
}
class BenchSyncDto {
  @IsDateOnly(true) dateFrom?: string;
}
class AlertQuery extends OperationsQuery {
  @IsOptional() @IsIn(["true", "false"]) acknowledged?: string;
}
class InjectorInspectionDto extends InjectorSelectionDto {
  @IsUUID() planRevisionId: string;
}
class AnalyticsQuery {
  @IsDateOnly(true) date_from?: string;
  @IsDateOnly(true) date_to?: string;
  @IsOptional() @IsIn(["day", "week", "month"]) interval?: string;
  @IsOptional() @IsString() @MaxLength(200) part_number?: string;
}
@Controller("inspection-plans")
export class PlansController {
  constructor(private readonly incoming: IncomingService) {}
  @Get() @RequirePermissions("inspection:read") list() {
    return this.incoming.plans();
  }
  @Post() @RequirePermissions("inspection_plan:manage") create(
    @CurrentActor() a: Actor,
    @Body() d: PlanDto,
  ) {
    return this.incoming.createPlan(a, d);
  }
  @Post("install-standard")
  @RequirePermissions("inspection_plan:manage")
  install(@CurrentActor() a: Actor) {
    return this.incoming.installStandards(a);
  }
  @Post(":id/revisions") @RequirePermissions("inspection_plan:manage") revise(
    @CurrentActor() a: Actor,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() d: PlanRevisionDto,
  ) {
    return this.incoming.revisePlan(a, id, d.definition);
  }
  @Post("revisions/:id/release")
  @RequirePermissions("inspection_plan:manage")
  release(@CurrentActor() a: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.incoming.releasePlan(a, id);
  }
}
@Controller("incoming-inspections")
export class IncomingController {
  constructor(private readonly incoming: IncomingService) {}
  @Get() @RequirePermissions("inspection:read") list(
    @Query() q: OperationsQuery,
  ) {
    return this.incoming.list(q);
  }
  @Get("alerts") @RequirePermissions("inspection:read") alerts() {
    return this.incoming.alerts();
  }
  @Post("alerts/:id/acknowledge")
  @RequirePermissions("inspection:write")
  acknowledge(
    @CurrentActor() a: Actor,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.incoming.acknowledge(a, id);
  }
  @Post() @RequirePermissions("inspection:write") create(
    @CurrentActor() a: Actor,
    @Body() d: NewIncomingDto,
  ) {
    return this.incoming.create(a, d);
  }
  @Get(":id") @RequirePermissions("inspection:read") get(
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.incoming.get(id);
  }
  @Get(":id/legacy-history") @RequirePermissions("inspection:read") history(
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.incoming.legacyHistory(id);
  }
  @Patch(":id") @RequirePermissions("inspection:write") update(
    @CurrentActor() a: Actor,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() d: UpdateIncomingDto,
  ) {
    return this.incoming.update(a, id, d);
  }
  @Post(":id/complete") @RequirePermissions("inspection:complete") complete(
    @CurrentActor() a: Actor,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() d: OperationsVersionDto,
  ) {
    return this.incoming.complete(a, id, d.expectedVersion);
  }
  @Post(":id/reopen") @RequirePermissions("inspection:reopen") reopen(
    @CurrentActor() a: Actor,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() d: OperationsReasonDto,
  ) {
    return this.incoming.reopen(a, id, d.expectedVersion, d.reason);
  }
  @Get(":id/pdf") @RequirePermissions("inspection:read") async pdf(
    @CurrentActor() a: Actor,
    @Param("id", ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const buffer = await this.incoming.pdf(a, id);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Inspection-${id}.pdf"`,
      "Cache-Control": "private, no-store",
    });
    res.send(buffer);
  }
}
@Controller("injector-tests")
export class InjectorController {
  constructor(
    private readonly injectors: InjectorService,
    private readonly bench: CarbonZappService,
    private readonly incoming: IncomingService,
  ) {}
  @Get() @RequirePermissions("injector:read") list(@Query() q: InjectorQuery) {
    return this.injectors.list(q);
  }
  @Get("analytics") @RequirePermissions("injector:read") analytics() {
    return this.injectors.analytics();
  }
  @Get("analytics/detail") @RequirePermissions("injector:read") detail(
    @Query() q: AnalyticsQuery,
  ) {
    return this.injectors.detailedAnalytics(q);
  }
  @Get("analytics/export.xlsx")
  @RequirePermissions("injector:read", "report:export")
  async analyticsExport(@Query() q: AnalyticsQuery, @Res() res: Response) {
    const buffer = await this.injectors.detailedAnalytics(q, true);
    res.set({
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="InjectorAnalytics.xlsx"',
      "Cache-Control": "private, no-store",
    });
    res.send(buffer);
  }
  @Post("sync-recorded") @RequirePermissions("injector:sync") sync(
    @CurrentActor() a: Actor,
    @Body() d: RecordedSyncDto,
  ) {
    return this.injectors.syncRecorded(a, d.reports);
  }
  @Post("sync") @RequirePermissions("injector:sync") syncBench(
    @CurrentActor() a: Actor,
    @Body() d: BenchSyncDto,
  ) {
    return this.bench.sync(a, d.dateFrom);
  }
  @Post("inspection")
  @RequirePermissions("injector:read", "inspection:write")
  inspection(@CurrentActor() a: Actor, @Body() d: InjectorInspectionDto) {
    return this.incoming.fromInjectorTests(a, d.ids, d.planRevisionId);
  }
  @Post("report-preview") @RequirePermissions("injector:read") preview(
    @Body() d: InjectorSelectionDto,
  ) {
    return this.injectors.preview(d.ids);
  }
  @Post("reports")
  @RequirePermissions("injector:read", "report:export")
  async report(
    @CurrentActor() a: Actor,
    @Body() d: InjectorSelectionDto,
    @Res() res: Response,
  ) {
    const r = await this.injectors.report(a, d);
    res.set({
      "Content-Type": r.contentType,
      "Content-Disposition": `attachment; filename="${r.filename.replace(/["\\\r\n]/g, "_")}"`,
      "Cache-Control": "private, no-store",
    });
    res.send(r.buffer);
  }
  @Get(":id") @RequirePermissions("injector:read") get(
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.injectors.get(id);
  }
  @Get(":id/quick-entry")
  @RequirePermissions("injector:read", "repair:write")
  quick(@Param("id", ParseUUIDPipe) id: string) {
    return this.injectors.quickContext(id);
  }
  @Post(":id/quick-entry")
  @RequirePermissions("injector:read", "repair:write")
  saveQuick(
    @CurrentActor() a: Actor,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() d: QuickRepairDto,
  ) {
    return this.injectors.quickRepair(a, id, d);
  }
}
@Controller("injector-repairs")
export class RepairsController {
  constructor(private readonly injectors: InjectorService) {}
  @Get() @RequirePermissions("injector:read") list(@Query() q: PageQueryDto) {
    return this.injectors.repairs(q);
  }
  @Post() @RequirePermissions("repair:write") create(
    @CurrentActor() a: Actor,
    @Body() d: NewRepairDto,
  ) {
    return this.injectors.openRepair(a, d);
  }
  @Get(":id") @RequirePermissions("injector:read") get(
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.injectors.repair(id);
  }
  @Post(":id/attempts") @RequirePermissions("repair:write") attempt(
    @CurrentActor() a: Actor,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() d: RepairAttemptDto,
  ) {
    return this.injectors.addAttempt(a, id, d);
  }
  @Post("attempts/:id/retest") @RequirePermissions("repair:write") retest(
    @CurrentActor() a: Actor,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() d: RetestDto,
  ) {
    return this.injectors.retest(a, id, d);
  }
  @Post(":id/status") @RequirePermissions("repair:write") status(
    @CurrentActor() a: Actor,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() d: RepairStatusDto,
  ) {
    return this.injectors.setStatus(
      a,
      id,
      d.expectedVersion,
      d.status,
      d.reason,
    );
  }
}
@Controller("quality-alerts")
export class OperationalAlertsController {
  constructor(private readonly incoming: IncomingService) {}
  @Get() @RequirePermissions("inspection:read") list(@Query() q: AlertQuery) {
    return this.incoming.alertPage(q);
  }
  @Post(":id/acknowledge") @RequirePermissions("inspection:write") acknowledge(
    @CurrentActor() actor: Actor,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.incoming.acknowledge(actor, id);
  }
}
@Module({
  controllers: [
    PlansController,
    IncomingController,
    InjectorController,
    RepairsController,
    OperationalAlertsController,
  ],
  providers: [
    IncomingService,
    InjectorService,
    EvidenceService,
    CarbonZappService,
  ],
  exports: [IncomingService, InjectorService, EvidenceService, CarbonZappService],
})
export class OperationsModule {}
