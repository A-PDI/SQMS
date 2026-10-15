import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { PERMISSIONS as P } from "@sqms/shared";
import type { Response } from "express";
import type { Actor } from "../../common/auth/actor";
import { AudienceScope, CurrentActor, RequirePermissions } from "../../common/auth/decorators";
import { AuditService } from "../../common/audit/audit.service";
import { sendCsv, toCsv } from "../../common/http/csv";
import {
  AcknowledgmentDto,
  AttachRevisionFileDto,
  CreateDocumentDto,
  DocumentLinkDto,
  DocumentListQuery,
  GenerateDocumentDto,
  NewDocumentRevisionDto,
  ReasonDto,
  ReleaseRevisionDto,
  RevisionVersionDto,
  ShareDto,
  SupersedeDto,
  UpdateDocumentDto,
  UpdateRevisionDraftDto,
} from "./documents.dto";
import { DocumentsService } from "./documents.service";

@ApiTags("documents")
@Controller("documents")
export class DocumentsController {
  constructor(
    private readonly docs: DocumentsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @AudienceScope("any")
  @RequirePermissions(P.DOCUMENT_READ)
  @ApiOperation({ summary: "Search document records (type, status, supplier, linked record, revision, dates)" })
  list(@CurrentActor() actor: Actor, @Query() q: DocumentListQuery) {
    return this.docs.list(actor, q);
  }

  @Get("export.csv")
  @RequirePermissions(P.DOCUMENT_READ, P.REPORT_EXPORT)
  async export(@CurrentActor() actor: Actor, @Query() q: DocumentListQuery, @Res() res: Response) {
    const rows = await this.docs.exportRows(actor, q);
    await this.audit.record({ eventType: "export.documents", metadata: { rows: rows.length } });
    sendCsv(
      res,
      "documents.csv",
      toCsv(rows, [
        { header: "Document", value: (r) => r.docNumber },
        { header: "Type", value: (r) => r.documentType.code },
        { header: "Title", value: (r) => r.title },
        { header: "Status", value: (r) => r.status },
        { header: "Latest revision", value: (r) => r.latestRevision?.revisionLabel },
        { header: "Latest revision status", value: (r) => r.latestRevision?.status },
        { header: "Released revision", value: (r) => r.releasedRevision?.revisionLabel },
        { header: "Released", value: (r) => r.releasedRevision?.releasedAt },
        { header: "Supplier", value: (r) => r.supplier?.name },
        { header: "Updated", value: (r) => r.updatedAt },
      ]),
    );
  }

  @Post()
  @AudienceScope("any")
  @RequirePermissions(P.DOCUMENT_WRITE)
  @ApiOperation({ summary: "Create a document record (native form or uploaded submission) linked to its type and template revision" })
  create(@CurrentActor() actor: Actor, @Body() dto: CreateDocumentDto) {
    return this.docs.create(actor, dto);
  }

  @Post("generate")
  @RequirePermissions(P.DOCUMENT_WRITE, P.CONFIGURATION_WRITE)
  @ApiOperation({ summary: "Generate a native ENG-04 / ENG-06 / ENG-08 document from a configuration revision" })
  generate(@CurrentActor() actor: Actor, @Body() dto: GenerateDocumentDto) {
    return this.docs.generateFromConfiguration(actor, dto);
  }

  @Get(":id")
  @AudienceScope("any")
  @RequirePermissions(P.DOCUMENT_READ)
  get(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.docs.get(actor, id);
  }

  @Patch(":id")
  @AudienceScope("any")
  @RequirePermissions(P.DOCUMENT_WRITE)
  update(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateDocumentDto) {
    return this.docs.updateDocument(actor, id, dto);
  }

  @Post(":id/revisions")
  @AudienceScope("any")
  @RequirePermissions(P.DOCUMENT_WRITE)
  @ApiOperation({ summary: "Open a new revision of a released document (previous release is preserved)" })
  newRevision(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: NewDocumentRevisionDto) {
    return this.docs.newRevision(actor, id, dto.changeSummary);
  }

  @Patch(":id/revisions/:revId")
  @AudienceScope("any")
  @RequirePermissions(P.DOCUMENT_WRITE)
  @ApiOperation({ summary: "Edit a draft revision (native form data / change summary)" })
  updateDraft(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Param("revId", ParseUUIDPipe) revId: string, @Body() dto: UpdateRevisionDraftDto) {
    return this.docs.updateDraft(actor, id, revId, dto);
  }

  @Post(":id/revisions/:revId/files")
  @AudienceScope("any")
  @RequirePermissions(P.DOCUMENT_WRITE)
  attachFile(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Param("revId", ParseUUIDPipe) revId: string, @Body() dto: AttachRevisionFileDto) {
    return this.docs.attachFile(actor, id, revId, dto);
  }

  @Delete(":id/revisions/:revId/files/:linkId")
  @AudienceScope("any")
  @HttpCode(204)
  @RequirePermissions(P.DOCUMENT_WRITE)
  removeFile(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Param("revId", ParseUUIDPipe) revId: string, @Param("linkId", ParseUUIDPipe) linkId: string) {
    return this.docs.removeFile(actor, id, revId, linkId);
  }

  @Post(":id/revisions/:revId/submit")
  @AudienceScope("any")
  @RequirePermissions(P.DOCUMENT_WRITE)
  @ApiOperation({ summary: "Submit a draft revision for review (content is hashed and frozen)" })
  submit(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Param("revId", ParseUUIDPipe) revId: string, @Body() dto: RevisionVersionDto) {
    return this.docs.submit(actor, id, revId, dto.expectedVersion);
  }

  @Post(":id/revisions/:revId/withdraw")
  @AudienceScope("any")
  @RequirePermissions(P.DOCUMENT_WRITE)
  withdraw(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Param("revId", ParseUUIDPipe) revId: string, @Body() dto: ReasonDto) {
    return this.docs.withdraw(actor, id, revId, dto.reason);
  }

  @Post(":id/revisions/:revId/reopen")
  @AudienceScope("any")
  @RequirePermissions(P.DOCUMENT_WRITE)
  @ApiOperation({ summary: "Return a rejected revision to draft for revision and resubmission" })
  reopen(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Param("revId", ParseUUIDPipe) revId: string, @Body() dto: RevisionVersionDto) {
    return this.docs.reopen(actor, id, revId, dto.expectedVersion);
  }

  @Post(":id/revisions/:revId/release")
  @RequirePermissions(P.DOCUMENT_RELEASE)
  @ApiOperation({ summary: "Release an approved revision (previous release becomes superseded)" })
  release(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Param("revId", ParseUUIDPipe) revId: string, @Body() dto: ReleaseRevisionDto) {
    return this.docs.release(actor, id, revId, dto);
  }

  @Post(":id/revisions/:revId/acknowledgments")
  @AudienceScope("any")
  @RequirePermissions(P.DOCUMENT_WRITE)
  @ApiOperation({ summary: "Record a supplier acknowledgment of a released revision" })
  acknowledge(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Param("revId", ParseUUIDPipe) revId: string, @Body() dto: AcknowledgmentDto) {
    return this.docs.acknowledge(actor, id, revId, dto);
  }

  @Post(":id/obsolete")
  @RequirePermissions(P.DOCUMENT_RELEASE)
  obsolete(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.docs.obsolete(actor, id, dto.reason);
  }

  @Post(":id/supersede")
  @RequirePermissions(P.DOCUMENT_RELEASE)
  supersede(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: SupersedeDto) {
    return this.docs.supersede(actor, id, dto.supersedingDocumentId, dto.reason);
  }

  @Post(":id/links")
  @RequirePermissions(P.DOCUMENT_WRITE)
  addLink(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: DocumentLinkDto) {
    return this.docs.addLink(actor, id, dto);
  }

  @Delete(":id/links/:linkId")
  @HttpCode(204)
  @RequirePermissions(P.DOCUMENT_WRITE)
  removeLink(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Param("linkId", ParseUUIDPipe) linkId: string) {
    return this.docs.removeLink(actor, id, linkId);
  }

  @Post(":id/shares")
  @RequirePermissions(P.DOCUMENT_SHARE)
  @ApiOperation({ summary: "Authorize a supplier to access the released revision" })
  share(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ShareDto) {
    return this.docs.share(actor, id, dto.supplierId, dto.note);
  }

  @Delete(":id/shares/:shareId")
  @HttpCode(204)
  @RequirePermissions(P.DOCUMENT_SHARE)
  revokeShare(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Param("shareId", ParseUUIDPipe) shareId: string) {
    return this.docs.revokeShare(actor, id, shareId);
  }
}
