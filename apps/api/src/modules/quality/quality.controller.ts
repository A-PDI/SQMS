import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { PERMISSIONS as P } from "@sqms/shared";
import type { Response } from "express";
import type { Actor } from "../../common/auth/actor";
import { AudienceScope, CurrentActor, RequireAnyPermission, RequirePermissions } from "../../common/auth/decorators";
import { AuditService } from "../../common/audit/audit.service";
import { sendCsv, toCsv } from "../../common/http/csv";
import { DeviationsService } from "./deviations.service";
import { NcrService } from "./ncr.service";
import {
  CloseDto,
  ContainmentDto,
  CreateDeviationDto,
  CreateNcrDto,
  CreateScarDto,
  DeviationListQuery,
  DispositionDto,
  EffectivenessDto,
  GenerateScarDto,
  NcrListQuery,
  QualityReasonDto,
  QualityVersionDto,
  ResponseReviewDto,
  ScarListQuery,
  ScarResponseDto,
  UpdateDeviationDto,
  UpdateNcrDto,
  UpdateScarDto,
} from "./quality.dto";
import { ScarService } from "./scar.service";

@ApiTags("deviations")
@Controller("deviations")
export class DeviationsController {
  constructor(private readonly deviations: DeviationsService) {}

  @Get()
  @AudienceScope("any")
  @RequirePermissions(P.DEVIATION_READ)
  list(@CurrentActor() actor: Actor, @Query() q: DeviationListQuery) {
    return this.deviations.list(actor, q);
  }

  @Post()
  @AudienceScope("any")
  @RequirePermissions(P.DEVIATION_WRITE)
  @ApiOperation({ summary: "Request a temporary deviation or a concession (DCR, OPS-05)" })
  create(@CurrentActor() actor: Actor, @Body() dto: CreateDeviationDto) {
    return this.deviations.create(actor, dto);
  }

  @Get(":id")
  @AudienceScope("any")
  @RequirePermissions(P.DEVIATION_READ)
  get(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.deviations.get(actor, id);
  }

  @Patch(":id")
  @AudienceScope("any")
  @RequirePermissions(P.DEVIATION_WRITE)
  update(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateDeviationDto) {
    return this.deviations.update(actor, id, dto);
  }

  @Post(":id/submit")
  @AudienceScope("any")
  @RequirePermissions(P.DEVIATION_WRITE)
  submit(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: QualityVersionDto) {
    return this.deviations.submit(actor, id, dto.expectedVersion);
  }

  @Post(":id/withdraw")
  @AudienceScope("any")
  @RequirePermissions(P.DEVIATION_WRITE)
  withdraw(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: QualityReasonDto) {
    return this.deviations.withdraw(actor, id, dto.expectedVersion, dto.reason);
  }

  @Post(":id/close")
  @RequirePermissions(P.DEVIATION_WRITE, P.NCR_DISPOSITION)
  close(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: QualityReasonDto) {
    return this.deviations.close(actor, id, dto.expectedVersion, dto.reason);
  }
}

@ApiTags("ncrs")
@Controller("ncrs")
export class NcrController {
  constructor(
    private readonly ncrs: NcrService,
    private readonly scars: ScarService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @AudienceScope("any")
  @RequirePermissions(P.NCR_READ)
  list(@CurrentActor() actor: Actor, @Query() q: NcrListQuery) {
    return this.ncrs.list(actor, q);
  }

  @Get("export.csv")
  @RequirePermissions(P.NCR_READ, P.REPORT_EXPORT)
  async export(@CurrentActor() actor: Actor, @Query() q: NcrListQuery, @Res() res: Response) {
    const rows = await this.ncrs.exportRows(actor, q);
    await this.audit.record({ eventType: "export.ncrs", metadata: { rows: rows.length } });
    sendCsv(
      res,
      "ncrs.csv",
      toCsv(rows, [
        { header: "NCR", value: (r) => r.number },
        { header: "Title", value: (r) => r.title },
        { header: "Identified", value: (r) => r.dateIdentified.toISOString().slice(0, 10) },
        { header: "Source", value: (r) => r.source },
        { header: "Severity", value: (r) => r.severity },
        { header: "Status", value: (r) => r.status },
        { header: "Disposition", value: (r) => r.disposition },
        { header: "Supplier", value: (r) => r.supplier?.name ?? "Unattributed" },
        { header: "Part", value: (r) => r.internalPart?.partNumber ?? "Unresolved" },
        { header: "Lot", value: (r) => r.lotNumber },
        { header: "Qty affected", value: (r) => r.quantityAffected },
        { header: "Owner", value: (r) => r.owner?.displayName ?? "Unknown" },
        { header: "Closed", value: (r) => r.closedAt?.toISOString().slice(0, 10) },
      ]),
    );
  }

  @Post()
  @RequirePermissions(P.NCR_WRITE)
  @ApiOperation({ summary: "Raise a nonconformance report (OPS-06)" })
  create(@CurrentActor() actor: Actor, @Body() dto: CreateNcrDto) {
    return this.ncrs.create(actor, dto);
  }

  @Get(":id")
  @AudienceScope("any")
  @RequirePermissions(P.NCR_READ)
  get(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.ncrs.get(actor, id);
  }

  @Patch(":id")
  @RequirePermissions(P.NCR_WRITE)
  update(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateNcrDto) {
    return this.ncrs.update(actor, id, dto);
  }

  @Post(":id/containment")
  @RequirePermissions(P.NCR_WRITE)
  contain(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ContainmentDto) {
    return this.ncrs.contain(actor, id, dto.expectedVersion, dto.containmentAction, dto.completed ?? false);
  }

  @Post(":id/investigate")
  @RequirePermissions(P.NCR_WRITE)
  investigate(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: QualityVersionDto) {
    return this.ncrs.investigate(actor, id, dto.expectedVersion);
  }

  @Post(":id/disposition")
  @RequirePermissions(P.NCR_DISPOSITION)
  @ApiOperation({ summary: "Material review disposition (use-as-is / repair require an approved concession)" })
  disposition(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: DispositionDto) {
    return this.ncrs.disposition(actor, id, dto);
  }

  @Post(":id/close")
  @RequirePermissions(P.NCR_DISPOSITION)
  close(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: CloseDto) {
    return this.ncrs.close(actor, id, dto.expectedVersion, dto.comment);
  }

  @Post(":id/cancel")
  @RequirePermissions(P.NCR_DISPOSITION)
  cancel(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: QualityReasonDto) {
    return this.ncrs.cancel(actor, id, dto.expectedVersion, dto.reason);
  }

  @Post(":id/scar")
  @RequirePermissions(P.SCAR_WRITE)
  @ApiOperation({ summary: "Generate a draft SCAR from this NCR" })
  async generateScar(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: GenerateScarDto) {
    const ncr = await this.ncrs.get(actor, id);
    return this.scars.create(actor, {
      title: dto.title ?? `Corrective action for ${ncr.number}: ${ncr.title}`.slice(0, 250),
      ncrId: id,
      problemDescription: dto.problemDescription ?? ncr.defectDescription,
      requirements: dto.requirements ?? ncr.expectedSpecification ?? undefined,
      severity: dto.severity,
      containmentDueDate: dto.containmentDueDate,
      responseDueDate: dto.responseDueDate,
      effectivenessDueDate: dto.effectivenessDueDate,
    });
  }
}

@ApiTags("scars")
@Controller("scars")
export class ScarController {
  constructor(
    private readonly scars: ScarService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @AudienceScope("any")
  @RequirePermissions(P.SCAR_READ)
  list(@CurrentActor() actor: Actor, @Query() q: ScarListQuery) {
    return this.scars.list(actor, q);
  }

  @Get("export.csv")
  @RequirePermissions(P.SCAR_READ, P.REPORT_EXPORT)
  async export(@CurrentActor() actor: Actor, @Query() q: ScarListQuery, @Res() res: Response) {
    const rows = await this.scars.exportRows(actor, q);
    await this.audit.record({ eventType: "export.scars", metadata: { rows: rows.length } });
    sendCsv(
      res,
      "scars.csv",
      toCsv(rows, [
        { header: "SCAR", value: (r) => r.number },
        { header: "Title", value: (r) => r.title },
        { header: "Supplier", value: (r) => r.supplier?.name ?? "Unattributed" },
        { header: "NCR", value: (r) => r.ncr?.number },
        { header: "Severity", value: (r) => r.severity },
        { header: "Status", value: (r) => r.status },
        { header: "Issued", value: (r) => r.issuedAt?.toISOString().slice(0, 10) },
        { header: "Response due", value: (r) => r.responseDueDate.toISOString().slice(0, 10) },
        { header: "Overdue", value: (r) => (r.overdue ? "yes" : "no") },
        { header: "Escalation level", value: (r) => r.escalationLevel },
        { header: "Effectiveness", value: (r) => r.effectivenessResult },
        { header: "Closed", value: (r) => r.closedAt?.toISOString().slice(0, 10) },
      ]),
    );
  }

  @Post()
  @RequirePermissions(P.SCAR_WRITE)
  @ApiOperation({ summary: "Draft a supplier corrective action request (OPS-07)" })
  create(@CurrentActor() actor: Actor, @Body() dto: CreateScarDto) {
    return this.scars.create(actor, dto);
  }

  @Get(":id")
  @AudienceScope("any")
  @RequirePermissions(P.SCAR_READ)
  get(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.scars.get(actor, id);
  }

  @Patch(":id")
  @RequirePermissions(P.SCAR_WRITE)
  update(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateScarDto) {
    return this.scars.update(actor, id, dto);
  }

  @Post(":id/issue")
  @RequirePermissions(P.SCAR_WRITE)
  issue(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: QualityVersionDto) {
    return this.scars.issue(actor, id, dto.expectedVersion);
  }

  @Post(":id/responses")
  @AudienceScope("any")
  @RequireAnyPermission(P.SCAR_RESPOND, P.SCAR_WRITE)
  @ApiOperation({ summary: "Save the draft 8D response (OPS-08); internal users enter it on the supplier's behalf" })
  saveResponse(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ScarResponseDto) {
    return this.scars.saveResponse(actor, id, dto);
  }

  @Post(":id/responses/:responseId/submit")
  @AudienceScope("any")
  @RequireAnyPermission(P.SCAR_RESPOND, P.SCAR_WRITE)
  submitResponse(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Param("responseId", ParseUUIDPipe) responseId: string) {
    return this.scars.submitResponse(actor, id, responseId);
  }

  @Post(":id/responses/:responseId/review")
  @RequirePermissions(P.SCAR_CLOSE)
  review(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Param("responseId", ParseUUIDPipe) responseId: string, @Body() dto: ResponseReviewDto) {
    return this.scars.reviewResponse(actor, id, responseId, dto.decision, dto.comment, dto.effectivenessDueDate);
  }

  @Post(":id/effectiveness")
  @RequirePermissions(P.SCAR_CLOSE)
  effectiveness(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: EffectivenessDto) {
    return this.scars.verifyEffectiveness(actor, id, dto.expectedVersion, dto.result, dto.notes);
  }

  @Post(":id/close")
  @RequirePermissions(P.SCAR_CLOSE)
  close(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: CloseDto) {
    return this.scars.close(actor, id, dto.expectedVersion, dto.comment);
  }

  @Post(":id/cancel")
  @RequirePermissions(P.SCAR_WRITE)
  cancel(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: QualityReasonDto) {
    return this.scars.cancel(actor, id, dto.expectedVersion, dto.reason);
  }
}
