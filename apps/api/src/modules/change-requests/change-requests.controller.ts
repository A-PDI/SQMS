import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { PERMISSIONS as P } from "@sqms/shared";
import type { Response } from "express";
import type { Actor } from "../../common/auth/actor";
import { AudienceScope, CurrentActor, RequirePermissions } from "../../common/auth/decorators";
import { AuditService } from "../../common/audit/audit.service";
import { sendCsv, toCsv } from "../../common/http/csv";
import {
  ChangeReasonDto,
  ChangeRequestListQuery,
  ChangeVersionDto,
  CreateChangeRequestDto,
  ImpactAssessmentDto,
  RequalificationDecisionDto,
  SubmitChangeForApprovalDto,
  UpdateChangeRequestDto,
  VerifyImplementationDto,
} from "./change-requests.dto";
import { ChangeRequestsService } from "./change-requests.service";

@ApiTags("change-requests")
@Controller("change-requests")
export class ChangeRequestsController {
  constructor(
    private readonly changes: ChangeRequestsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @AudienceScope("any")
  @RequirePermissions(P.CHANGE_READ)
  list(@CurrentActor() actor: Actor, @Query() q: ChangeRequestListQuery) {
    return this.changes.list(actor, q);
  }

  @Get("export.csv")
  @RequirePermissions(P.CHANGE_READ, P.REPORT_EXPORT)
  async export(@CurrentActor() actor: Actor, @Query() q: ChangeRequestListQuery, @Res() res: Response) {
    const rows = await this.changes.exportRows(actor, q);
    await this.audit.record({ eventType: "export.change_requests", metadata: { rows: rows.length } });
    sendCsv(
      res,
      "change-requests.csv",
      toCsv(rows, [
        { header: "Number", value: (r) => r.number },
        { header: "Title", value: (r) => r.title },
        { header: "Status", value: (r) => r.status },
        { header: "Categories", value: (r) => r.categories.map((c) => c.category).join(" ") },
        { header: "Supplier", value: (r) => r.supplier.name },
        { header: "Part", value: (r) => r.internalPart.partNumber },
        { header: "Current site", value: (r) => r.currentSite.siteCode },
        { header: "Proposed site", value: (r) => r.proposedSite?.siteCode },
        { header: "Risk", value: (r) => r.riskLevel },
        { header: "Disposition", value: (r) => r.disposition },
        { header: "Submitted", value: (r) => r.submittedAt?.toISOString() },
        { header: "Decided", value: (r) => r.decidedAt?.toISOString() },
      ]),
    );
  }

  @Post()
  @AudienceScope("any")
  @RequirePermissions(P.CHANGE_SUBMIT)
  @ApiOperation({ summary: "Create a supplier change request / PCN against an approved configuration (proposed revision is created separately)" })
  create(@CurrentActor() actor: Actor, @Body() dto: CreateChangeRequestDto) {
    return this.changes.create(actor, dto);
  }

  @Get(":id")
  @AudienceScope("any")
  @RequirePermissions(P.CHANGE_READ)
  @ApiOperation({ summary: "Change request with authorized vs proposed configuration comparison" })
  get(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.changes.get(actor, id);
  }

  @Patch(":id")
  @AudienceScope("any")
  @RequirePermissions(P.CHANGE_SUBMIT)
  update(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateChangeRequestDto) {
    return this.changes.update(actor, id, dto);
  }

  @Post(":id/submit")
  @AudienceScope("any")
  @RequirePermissions(P.CHANGE_SUBMIT)
  submit(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ChangeVersionDto) {
    return this.changes.submit(actor, id, dto.expectedVersion);
  }

  @Post(":id/withdraw")
  @AudienceScope("any")
  @RequirePermissions(P.CHANGE_SUBMIT)
  withdraw(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ChangeReasonDto) {
    return this.changes.withdraw(actor, id, dto.expectedVersion, dto.reason);
  }

  @Post(":id/request-information")
  @RequirePermissions(P.CHANGE_REVIEW)
  requestInformation(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ChangeReasonDto) {
    return this.changes.requestInformation(actor, id, dto.expectedVersion, dto.reason);
  }

  @Post(":id/impact-assessments")
  @RequirePermissions(P.CHANGE_REVIEW)
  @ApiOperation({ summary: "Record a discipline's impact assessment (CIRD input)" })
  assess(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ImpactAssessmentDto) {
    return this.changes.recordAssessment(actor, id, dto);
  }

  @Post(":id/requalification-decision")
  @RequirePermissions(P.CHANGE_REVIEW)
  @ApiOperation({ summary: "Change Impact & Requalification Decision: required validation evidence and requalification" })
  decide(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: RequalificationDecisionDto) {
    return this.changes.decideRequalification(actor, id, dto);
  }

  @Post(":id/submit-for-approval")
  @RequirePermissions(P.CHANGE_REVIEW)
  @ApiOperation({ summary: "Start the change approval workflow; blocked until the requalification gate passes" })
  submitForApproval(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: SubmitChangeForApprovalDto) {
    return this.changes.submitForApproval(actor, id, dto.expectedVersion, dto.dispositionConditions);
  }

  @Post(":id/verify-implementation")
  @RequirePermissions(P.CHANGE_REVIEW)
  @ApiOperation({ summary: "Verify implementation of an approved change; authorizes shipment of changed product" })
  verify(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: VerifyImplementationDto) {
    return this.changes.verifyImplementation(actor, id, dto.expectedVersion, dto.implementationNotes);
  }

  @Post(":id/close")
  @RequirePermissions(P.CHANGE_REVIEW)
  close(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ChangeVersionDto) {
    return this.changes.close(actor, id, dto.expectedVersion);
  }
}
