import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { DOCUMENT_STATUS } from "@sqms/shared";
import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateNested } from "class-validator";
import { ExpectedVersion, IsDateOnly, ToArray } from "../../common/http/dto-helpers";
import { PageQueryDto } from "../../common/http/pagination";

export const LINKABLE_ENTITIES = [
  "SUPPLIER", "SUPPLIER_SITE", "INTERNAL_PART", "SUPPLIER_PART", "SUPPLIER_PRODUCT", "PRODUCT_CONFIGURATION", "CONFIGURATION_REVISION", "SOURCING_PROJECT",
  "SUPPLIER_QUALIFICATION", "PRODUCT_QUALIFICATION", "CHANGE_REQUEST", "DEVIATION", "NCR", "SCAR",
] as const;
export type LinkableEntity = (typeof LINKABLE_ENTITIES)[number];

export class DocumentLinkDto {
  @ApiProperty({ enum: LINKABLE_ENTITIES }) @IsIn([...LINKABLE_ENTITIES]) entityType: LinkableEntity;
  @ApiProperty() @IsUUID() entityId: string;
  @ApiPropertyOptional({ example: "EVIDENCE" }) @IsOptional() @Matches(/^[A-Z_]{3,40}$/) linkRole?: string;
  @ApiPropertyOptional({ description: "Pin the link to an explicit revision" }) @IsOptional() @IsUUID() revisionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class CreateDocumentDto {
  @ApiProperty() @IsUUID() documentTypeId: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(300) title: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @ApiPropertyOptional({ description: "Primary supplier context (internal users only)" }) @IsOptional() @IsUUID() supplierId?: string;
  @ApiProperty({ enum: ["NATIVE_FORM", "UPLOAD"] }) @IsIn(["NATIVE_FORM", "UPLOAD"]) submissionMethod: "NATIVE_FORM" | "UPLOAD";
  @ApiPropertyOptional({ description: "Native form data (validated against the form schema version)" }) @IsOptional() @IsObject() formData?: Record<string, unknown>;
  @ApiPropertyOptional({ type: [DocumentLinkDto] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => DocumentLinkDto) links?: DocumentLinkDto[];
  @ApiPropertyOptional({ description: "Checklist requirement this document fulfils" }) @IsOptional() @IsUUID() requiredDocumentId?: string;
  @ApiPropertyOptional({ type: [String], description: "Uploaded files to attach to revision A" }) @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID("all", { each: true }) fileIds?: string[];
}

export class UpdateDocumentDto {
  @ExpectedVersion() expectedVersion: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(3) @MaxLength(300) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) description?: string;
}

export class UpdateRevisionDraftDto {
  @ExpectedVersion() expectedVersion: number;
  @ApiPropertyOptional() @IsOptional() @IsObject() formData?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) changeSummary?: string;
}

export class AttachRevisionFileDto {
  @ApiProperty() @IsUUID() fileId: string;
  @ApiPropertyOptional({ enum: ["PRIMARY", "SUPPORTING"] }) @IsOptional() @IsIn(["PRIMARY", "SUPPORTING"]) role?: "PRIMARY" | "SUPPORTING";
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
}

export class RevisionVersionDto {
  @ExpectedVersion() expectedVersion: number;
}

export class ReleaseRevisionDto {
  @ExpectedVersion() expectedVersion: number;
  @IsDateOnly() effectiveDate: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) releaseNotes?: string;
}

export class NewDocumentRevisionDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(5000) changeSummary: string;
}

export class ReasonDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(2000) reason: string;
}

export class SupersedeDto {
  @ApiProperty() @IsUUID() supersedingDocumentId: string;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(2000) reason: string;
}

export class ShareDto {
  @ApiProperty({ description: "Supplier to share the released document with" }) @IsUUID() supplierId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class AcknowledgmentDto {
  @ApiProperty() @IsUUID() supplierId: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(160) acknowledgedByName: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) comment?: string;
}

export class GenerateDocumentDto {
  @ApiProperty({ enum: ["SBPS", "DELTA_SPEC", "CCM"] }) @IsIn(["SBPS", "DELTA_SPEC", "CCM"]) kind: "SBPS" | "DELTA_SPEC" | "CCM";
  @ApiProperty() @IsUUID() configurationRevisionId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() requiredDocumentId?: string;
}

export class DocumentListQuery extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() documentTypeId?: string;
  @ApiPropertyOptional({ example: "VAL-02" }) @IsOptional() @IsString() @MaxLength(20) typeCode?: string;
  @ApiPropertyOptional({ enum: DOCUMENT_STATUS, isArray: true }) @IsOptional() @ToArray() @IsIn([...DOCUMENT_STATUS], { each: true }) status?: string[];
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional({ enum: LINKABLE_ENTITIES }) @IsOptional() @IsIn([...LINKABLE_ENTITIES]) entityType?: LinkableEntity;
  @ApiPropertyOptional() @IsOptional() @IsUUID() entityId?: string;
  @ApiPropertyOptional({ description: "Revision label, e.g. B" }) @IsOptional() @Matches(/^[A-Z]{1,3}$/) revision?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() createdById?: string;
  @IsDateOnly(true) updatedFrom?: string;
  @IsDateOnly(true) updatedTo?: string;
}

export class RevisionNumberParam {
  @IsInt() @Min(1) n: number;
}
