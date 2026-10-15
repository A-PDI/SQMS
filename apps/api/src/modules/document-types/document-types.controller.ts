import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiProperty, ApiTags } from "@nestjs/swagger";
import { PERMISSIONS as P } from "@sqms/shared";
import { IsString, IsUUID, MaxLength, MinLength } from "class-validator";
import type { Actor } from "../../common/auth/actor";
import { CurrentActor, RequirePermissions } from "../../common/auth/decorators";
import {
  CreateDocumentTypeDto,
  CreateFormVersionDto,
  CreateTemplateDto,
  CreateTemplateRevisionDto,
  DocumentTypeListQuery,
  DocumentTypeStatusDto,
  PublishTemplateRevisionDto,
  UpdateDocumentTypeDto,
} from "./document-types.dto";
import { DocumentTypesService } from "./document-types.service";

class FileRefDto {
  @ApiProperty() @IsUUID() fileId: string;
}
class ReasonDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(2000) reason: string;
}

@ApiTags("document-types")
@Controller("document-types")
export class DocumentTypesController {
  constructor(private readonly types: DocumentTypesService) {}

  @Get()
  @RequirePermissions(P.DOCUMENT_READ)
  @ApiOperation({ summary: "Document library catalog (37 seeded types plus administrator-defined types)" })
  list(@CurrentActor() actor: Actor, @Query() q: DocumentTypeListQuery) {
    return this.types.list(actor, q);
  }

  @Get(":id")
  @RequirePermissions(P.DOCUMENT_READ)
  @ApiOperation({ summary: "Document type governance detail: templates, revisions, forms, applicability rules" })
  get(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.types.get(actor, id);
  }

  @Post()
  @RequirePermissions(P.DOCUMENT_TYPE_MANAGE)
  create(@CurrentActor() actor: Actor, @Body() dto: CreateDocumentTypeDto) {
    return this.types.create(actor, dto);
  }

  @Patch(":id")
  @RequirePermissions(P.DOCUMENT_TYPE_MANAGE)
  update(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateDocumentTypeDto) {
    return this.types.update(actor, id, dto);
  }

  @Post(":id/status")
  @RequirePermissions(P.DOCUMENT_TYPE_MANAGE)
  @ApiOperation({ summary: "Activate, obsolete or supersede a document type" })
  status(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: DocumentTypeStatusDto) {
    return this.types.changeStatus(actor, id, dto);
  }

  @Post(":id/templates")
  @RequirePermissions(P.DOCUMENT_TYPE_MANAGE)
  createTemplate(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: CreateTemplateDto) {
    return this.types.createTemplate(actor, id, dto);
  }
}

@ApiTags("document-templates")
@Controller()
export class TemplatesController {
  constructor(private readonly types: DocumentTypesService) {}

  @Post("document-templates/:id/revisions")
  @RequirePermissions(P.DOCUMENT_TYPE_MANAGE)
  @ApiOperation({ summary: "Create a draft template revision (attach the controlled DOCX/XLSX/PDF template)" })
  createRevision(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: CreateTemplateRevisionDto) {
    return this.types.createTemplateRevision(actor, id, dto);
  }

  @Post("template-revisions/:id/attach-file")
  @RequirePermissions(P.DOCUMENT_TYPE_MANAGE)
  attach(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: FileRefDto) {
    return this.types.attachTemplateFile(actor, id, dto.fileId);
  }

  @Post("template-revisions/:id/publish")
  @RequirePermissions(P.DOCUMENT_TYPE_MANAGE)
  @ApiOperation({ summary: "Make a template revision effective (previous effective revision is superseded)" })
  publish(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: PublishTemplateRevisionDto) {
    return this.types.publishTemplateRevision(actor, id, dto.effectiveDate);
  }

  @Post("template-revisions/:id/obsolete")
  @RequirePermissions(P.DOCUMENT_TYPE_MANAGE)
  obsolete(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.types.obsoleteTemplateRevision(actor, id, dto.reason);
  }

  @Get("form-definitions")
  @RequirePermissions(P.DOCUMENT_READ)
  forms() {
    return this.types.listForms();
  }

  @Get("form-definitions/:key/published")
  @RequirePermissions(P.DOCUMENT_READ)
  @ApiOperation({ summary: "Latest published schema of a native form" })
  published(@Param("key") key: string) {
    return this.types.latestPublishedForm(key);
  }

  @Get("form-definition-versions/:id")
  @RequirePermissions(P.DOCUMENT_READ)
  version(@Param("id", ParseUUIDPipe) id: string) {
    return this.types.getFormVersion(id);
  }

  @Post("form-definitions/:key/versions")
  @RequirePermissions(P.DOCUMENT_TYPE_MANAGE)
  @ApiOperation({ summary: "Create a new draft version of a native form schema (validated)" })
  createVersion(@CurrentActor() actor: Actor, @Param("key") key: string, @Body() dto: CreateFormVersionDto) {
    return this.types.createFormVersion(actor, key, dto);
  }

  @Post("form-definition-versions/:id/publish")
  @RequirePermissions(P.DOCUMENT_TYPE_MANAGE)
  publishVersion(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.types.publishFormVersion(actor, id);
  }

  @Get("retention-policies")
  @RequirePermissions(P.DOCUMENT_READ)
  retention() {
    return this.types.retentionPolicies();
  }
}
