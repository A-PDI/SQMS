import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res } from "@nestjs/common";
import { ApiBody, ApiConsumes, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import type { EntityType } from "@sqms/db";
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";
import type { Request, Response } from "express";
import type { Actor } from "../../common/auth/actor";
import { AudienceScope, CurrentActor } from "../../common/auth/decorators";
import { FilesService } from "./files.service";

const ATTACHABLE: EntityType[] = ["SUPPLIER", "SUPPLIER_SITE", "INTERNAL_PART", "SUPPLIER_PRODUCT", "CONFIGURATION_REVISION", "SOURCING_PROJECT", "PRODUCT_QUALIFICATION", "CHANGE_REQUEST", "DEVIATION", "NCR", "SCAR", "FIRST_ARTICLE_INSPECTION"];

class AttachmentQuery {
  @ApiProperty({ enum: ATTACHABLE }) @IsIn(ATTACHABLE) entityType: EntityType;
  @ApiProperty() @IsUUID() entityId: string;
}

class AddAttachmentDto extends AttachmentQuery {
  @ApiProperty() @IsUUID() fileId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional({ enum: ["INTERNAL", "SUPPLIER"], description: "SUPPLIER makes the evidence visible to the supplier (portal)" })
  @IsOptional()
  @IsIn(["INTERNAL", "SUPPLIER"])
  visibility?: "INTERNAL" | "SUPPLIER";
}

function contentDisposition(kind: "attachment" | "inline", filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

@ApiTags("files")
@Controller()
@AudienceScope("any")
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post("files")
  @ApiConsumes("multipart/form-data")
  @ApiBody({ schema: { type: "object", required: ["file"], properties: { file: { type: "string", format: "binary" }, description: { type: "string" } } } })
  @ApiOperation({ summary: "Upload a file (streamed to private object storage; quarantined until malware scan passes)" })
  upload(@CurrentActor() actor: Actor, @Req() req: Request) {
    return this.files.upload(actor, req);
  }

  @Get("files/:id")
  @ApiOperation({ summary: "File metadata (status, checksum, size)" })
  metadata(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.files.metadata(actor, id);
  }

  @Get("files/:id/download")
  @ApiOperation({ summary: "Download an authorized, scanned file" })
  async download(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const { file, body } = await this.files.open(actor, id, "download");
    this.stream(res, file, body, "attachment");
  }

  @Get("files/:id/preview")
  @ApiOperation({ summary: "Inline preview for PDF and standard image formats" })
  async preview(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const { file, body } = await this.files.open(actor, id, "preview");
    // Allow the browser's PDF/image viewer while keeping scripts and remote content blocked.
    res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; object-src 'self'; frame-ancestors 'self'");
    this.stream(res, file, body, "inline");
  }

  private stream(res: Response, file: { contentType: string; sizeBytes: bigint; safeFilename: string; sha256: string }, body: NodeJS.ReadableStream, kind: "attachment" | "inline") {
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Length", file.sizeBytes.toString());
    res.setHeader("Content-Disposition", contentDisposition(kind, file.safeFilename));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Checksum-SHA256", file.sha256);
    body.on("error", () => res.destroy());
    body.pipe(res);
  }

  @Get("record-attachments")
  @ApiOperation({ summary: "Evidence attachments on a record (supplier users see SUPPLIER-visible attachments only)" })
  list(@CurrentActor() actor: Actor, @Query() q: AttachmentQuery) {
    return this.files.listAttachments(actor, q.entityType, q.entityId);
  }

  @Post("record-attachments")
  @ApiOperation({ summary: "Attach an uploaded file to a record" })
  add(@CurrentActor() actor: Actor, @Body() dto: AddAttachmentDto) {
    return this.files.addAttachment(actor, dto);
  }

  @Delete("record-attachments/:id")
  @HttpCode(204)
  remove(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.files.removeAttachment(actor, id);
  }
}
