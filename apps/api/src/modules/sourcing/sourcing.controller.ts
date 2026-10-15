import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { PERMISSIONS as P } from "@sqms/shared";
import type { Response } from "express";
import type { Actor } from "../../common/auth/actor";
import { CurrentActor, RequirePermissions } from "../../common/auth/decorators";
import { AuditService } from "../../common/audit/audit.service";
import { sendCsv, toCsv } from "../../common/http/csv";
import {
  AddRequirementDto,
  CreateRequirementDocumentDto,
  CreateSourcingProjectDto,
  LinkRequirementDocumentDto,
  MemberDto,
  PreviewChecklistDto,
  ProjectListQuery,
  ProjectReasonDto,
  ProjectVersionDto,
  ReassessRiskDto,
  UpdateProjectDto,
  UpdateRequirementAssignmentDto,
  WaiveRequirementDto,
} from "./sourcing.dto";
import { SourcingService } from "./sourcing.service";

@ApiTags("sourcing-projects")
@Controller("sourcing-projects")
export class SourcingController {
  constructor(
    private readonly projects: SourcingService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions(P.PROJECT_READ)
  list(@CurrentActor() actor: Actor, @Query() q: ProjectListQuery) {
    return this.projects.list(actor, q);
  }

  @Get("export.csv")
  @RequirePermissions(P.PROJECT_READ, P.REPORT_EXPORT)
  async export(@CurrentActor() actor: Actor, @Query() q: ProjectListQuery, @Res() res: Response) {
    const rows = await this.projects.exportRows(actor, q);
    await this.audit.record({ eventType: "export.sourcing_projects", metadata: { rows: rows.length } });
    sendCsv(
      res,
      "sourcing-projects.csv",
      toCsv(rows, [
        { header: "Project", value: (r) => r.projectNumber },
        { header: "Title", value: (r) => r.title },
        { header: "Pathway", value: (r) => r.pathway },
        { header: "Status", value: (r) => r.status },
        { header: "Stage", value: (r) => r.stage },
        { header: "Part", value: (r) => r.internalPart.partNumber },
        { header: "Supplier", value: (r) => r.supplier.name },
        { header: "Owner", value: (r) => r.owner.displayName },
        { header: "Risk", value: (r) => r.riskAssessments[0]?.level },
        { header: "Checklist complete %", value: (r) => this.projects.summarize(r.requiredDocuments).percent },
        { header: "Target date", value: (r) => r.targetDate?.toISOString().slice(0, 10) },
      ]),
    );
  }

  @Post("preview")
  @RequirePermissions(P.PROJECT_WRITE)
  @ApiOperation({ summary: "Wizard step 7 preview: computed risk and generated document requirements (not persisted)" })
  preview(@CurrentActor() actor: Actor, @Body() dto: PreviewChecklistDto) {
    return this.projects.preview(actor, dto);
  }

  @Post()
  @RequirePermissions(P.PROJECT_WRITE)
  @ApiOperation({ summary: "Create a sourcing project from the 9-step wizard (Pathway A, B or C)" })
  create(@CurrentActor() actor: Actor, @Body() dto: CreateSourcingProjectDto) {
    return this.projects.create(actor, dto);
  }

  @Get(":id")
  @RequirePermissions(P.PROJECT_READ)
  get(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.projects.get(actor, id);
  }

  @Patch(":id")
  @RequirePermissions(P.PROJECT_WRITE)
  update(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateProjectDto) {
    return this.projects.update(actor, id, dto);
  }

  @Post(":id/members")
  @RequirePermissions(P.PROJECT_WRITE)
  addMember(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: MemberDto) {
    return this.projects.addMember(actor, id, dto);
  }

  @Delete(":id/members/:memberId")
  @HttpCode(204)
  @RequirePermissions(P.PROJECT_WRITE)
  removeMember(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Param("memberId", ParseUUIDPipe) memberId: string) {
    return this.projects.removeMember(actor, id, memberId);
  }

  @Post(":id/risk-assessment")
  @RequirePermissions(P.PROJECT_WRITE)
  @ApiOperation({ summary: "Re-assess risk and regenerate the checklist against the active policy version" })
  reassess(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ReassessRiskDto) {
    return this.projects.reassessRisk(actor, id, dto);
  }

  @Post(":id/submit")
  @RequirePermissions(P.PROJECT_WRITE)
  @ApiOperation({ summary: "Submit the project for intake review (wizard step 9)" })
  submit(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ProjectVersionDto) {
    return this.projects.submit(actor, id, dto.expectedVersion);
  }

  @Post(":id/hold")
  @RequirePermissions(P.PROJECT_WRITE)
  hold(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ProjectReasonDto) {
    return this.projects.hold(actor, id, dto.expectedVersion, dto.reason);
  }

  @Post(":id/resume")
  @RequirePermissions(P.PROJECT_WRITE)
  resume(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ProjectVersionDto) {
    return this.projects.resume(actor, id, dto.expectedVersion);
  }

  @Post(":id/cancel")
  @RequirePermissions(P.PROJECT_WRITE)
  cancel(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ProjectReasonDto) {
    return this.projects.cancel(actor, id, dto.expectedVersion, dto.reason);
  }

  @Post(":id/close")
  @RequirePermissions(P.PROJECT_WRITE)
  close(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ProjectVersionDto) {
    return this.projects.close(actor, id, dto.expectedVersion);
  }

  @Get(":id/requirements")
  @RequirePermissions(P.PROJECT_READ)
  requirements(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.projects.get(actor, id).then((p) => p.requirements);
  }

  @Post(":id/requirements")
  @RequirePermissions(P.PROJECT_WRITE)
  @ApiOperation({ summary: "Add an additional document requirement to the checklist" })
  addRequirement(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: AddRequirementDto) {
    return this.projects.addRequirement(actor, id, dto);
  }
}

@ApiTags("sourcing-projects")
@Controller("required-documents")
export class RequiredDocumentsController {
  constructor(private readonly projects: SourcingService) {}

  @Patch(":id")
  @RequirePermissions(P.PROJECT_WRITE)
  update(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateRequirementAssignmentDto) {
    return this.projects.updateRequirement(actor, id, dto);
  }

  @Post(":id/waive")
  @ApiOperation({ summary: "Waive a requirement with justification (mandatory controls need project:waive_mandatory)" })
  @RequirePermissions(P.PROJECT_WRITE)
  waive(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: WaiveRequirementDto) {
    return this.projects.waive(actor, id, dto.justification);
  }

  @Post(":id/reinstate")
  @RequirePermissions(P.PROJECT_WRITE)
  reinstate(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.projects.reinstate(actor, id);
  }

  @Post(":id/link-document")
  @RequirePermissions(P.PROJECT_WRITE)
  link(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: LinkRequirementDocumentDto) {
    return this.projects.linkDocument(actor, id, dto.documentId);
  }

  @Post(":id/create-document")
  @RequirePermissions(P.DOCUMENT_WRITE)
  @ApiOperation({ summary: "Create the document fulfilling this requirement (native form or upload)" })
  createDocument(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: CreateRequirementDocumentDto) {
    return this.projects.createDocument(actor, id, dto);
  }
}
