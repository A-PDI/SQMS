import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { PERMISSIONS as P } from "@sqms/shared";
import type { Actor } from "../../common/auth/actor";
import { CurrentActor, RequirePermissions } from "../../common/auth/decorators";
import { DbService, type Tx } from "../../common/db/db.service";
import {
  CreateQualificationDto,
  EvidenceReviewDto,
  FaiDto,
  InspectionResultDto,
  QualificationListQuery,
  QualificationStatusDto,
  QualificationVersionDto,
  TestDto,
  TestResultDto,
  UpdateQualificationDto,
} from "./qualifications.dto";
import { QualificationsService } from "./qualifications.service";

@ApiTags("qualifications")
@Controller("qualifications")
export class QualificationsController {
  constructor(
    private readonly quals: QualificationsService,
    private readonly db: DbService,
  ) {}

  @Get()
  @RequirePermissions(P.QUALIFICATION_READ)
  list(@CurrentActor() actor: Actor, @Query() q: QualificationListQuery) {
    return this.quals.list(actor, q);
  }

  @Post()
  @RequirePermissions(P.QUALIFICATION_WRITE)
  @ApiOperation({ summary: "Open a product qualification for a configuration revision (usually from a sourcing project)" })
  create(@CurrentActor() actor: Actor, @Body() dto: CreateQualificationDto) {
    return this.quals.create(actor, dto);
  }

  @Get(":id")
  @RequirePermissions(P.QUALIFICATION_READ)
  get(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.quals.get(actor, id);
  }

  @Get(":id/gate")
  @RequirePermissions(P.QUALIFICATION_READ)
  @ApiOperation({ summary: "Evaluate the product approval gate (baseline, configuration/site, documentation, validation, NCR/deviation)" })
  gate(@Param("id", ParseUUIDPipe) id: string) {
    return this.quals.evaluateGate(this.db.client as unknown as Tx, id);
  }

  @Get(":id/approval-package")
  @RequirePermissions(P.QUALIFICATION_READ)
  @ApiOperation({ summary: "Release snapshot of the exact document and configuration revisions used for approval (with integrity check)" })
  approvalPackage(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.quals.approvalPackage(actor, id);
  }

  @Patch(":id")
  @RequirePermissions(P.QUALIFICATION_WRITE)
  update(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateQualificationDto) {
    return this.quals.update(actor, id, dto);
  }

  @Post(":id/status")
  @RequirePermissions(P.QUALIFICATION_WRITE)
  @ApiOperation({ summary: "Move between documentation / evaluation / validation stages or put on hold (approval only via submit)" })
  status(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: QualificationStatusDto) {
    return this.quals.changeStatus(actor, id, dto.expectedVersion, dto.status, dto.reason);
  }

  @Post(":id/submit")
  @RequirePermissions(P.QUALIFICATION_WRITE)
  @ApiOperation({ summary: "Submit for product approval; blocked unless every approval gate check passes" })
  submit(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: QualificationVersionDto) {
    return this.quals.submitForApproval(actor, id, dto.expectedVersion);
  }

  @Post(":id/tests")
  @RequirePermissions(P.QUALIFICATION_WRITE)
  addTest(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: TestDto) {
    return this.quals.addTest(actor, id, dto);
  }

  @Post("tests/:testId/result")
  @RequirePermissions(P.QUALIFICATION_WRITE)
  testResult(@CurrentActor() actor: Actor, @Param("testId", ParseUUIDPipe) testId: string, @Body() dto: TestResultDto) {
    return this.quals.recordTestResult(actor, testId, dto);
  }

  @Post("tests/:testId/review")
  @RequirePermissions(P.QUALIFICATION_WRITE)
  reviewTest(@CurrentActor() actor: Actor, @Param("testId", ParseUUIDPipe) testId: string, @Body() dto: EvidenceReviewDto) {
    return this.quals.reviewTest(actor, testId, dto.decision, dto.comment);
  }

  @Post(":id/first-articles")
  @RequirePermissions(P.QUALIFICATION_WRITE)
  addFai(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: FaiDto) {
    return this.quals.addFai(actor, id, dto);
  }

  @Post("first-articles/:faiId/review")
  @RequirePermissions(P.QUALIFICATION_WRITE)
  reviewFai(@CurrentActor() actor: Actor, @Param("faiId", ParseUUIDPipe) faiId: string, @Body() dto: EvidenceReviewDto) {
    return this.quals.reviewFai(actor, faiId, dto.decision, dto.comment);
  }

  @Post(":id/inspection-results")
  @RequirePermissions(P.QUALIFICATION_WRITE)
  inspection(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: InspectionResultDto) {
    return this.quals.addInspectionResult(actor, id, dto);
  }
}
