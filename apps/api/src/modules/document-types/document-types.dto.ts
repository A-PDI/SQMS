import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from "@nestjs/swagger";
import { DOCUMENT_CATEGORY, LIFECYCLE_STATUS, SOURCING_PATHWAY, SUPPLIER_VISIBILITY } from "@sqms/shared";
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from "class-validator";
import { EmptyToNull, ExpectedVersion, IsDateOnly, ToArray } from "../../common/http/dto-helpers";
import { PageQueryDto } from "../../common/http/pagination";

const ORIGINS = ["COMPANY_DEFINED", "EXTERNAL_STANDARD", "COMPANY_DEFINED_STANDARD_ALIGNED"] as const;

export class DocumentTypeListQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: DOCUMENT_CATEGORY, isArray: true }) @IsOptional() @ToArray() @IsIn([...DOCUMENT_CATEGORY], { each: true }) category?: string[];
  @ApiPropertyOptional({ enum: LIFECYCLE_STATUS, isArray: true }) @IsOptional() @ToArray() @IsIn([...LIFECYCLE_STATUS], { each: true }) status?: string[];
  @ApiPropertyOptional({ enum: SOURCING_PATHWAY }) @IsOptional() @IsIn([...SOURCING_PATHWAY]) pathway?: string;
  @ApiPropertyOptional({ enum: ORIGINS }) @IsOptional() @IsIn([...ORIGINS]) origin?: string;
}

export class CreateDocumentTypeDto {
  @ApiProperty({ example: "OPS-10" }) @Matches(/^[A-Z]{2,5}-\d{2,3}$/, { message: "code must look like ABC-01" }) code: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(200) name: string;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(30) acronym?: string | null;
  @ApiProperty({ enum: DOCUMENT_CATEGORY }) @IsIn([...DOCUMENT_CATEGORY]) category: (typeof DOCUMENT_CATEGORY)[number];
  @ApiProperty({ enum: ORIGINS }) @IsIn([...ORIGINS]) origin: (typeof ORIGINS)[number];
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(300) externalStandardRef?: string | null;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(5000) description: string;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(5000) purpose?: string | null;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) responsibleDepartment: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(160) typicalPreparer: string;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(80) workflowKey?: string | null;
  @ApiProperty({ enum: SOURCING_PATHWAY, isArray: true }) @IsArray() @ArrayUnique() @IsIn([...SOURCING_PATHWAY], { each: true }) applicablePathways: string[];
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(5000) applicabilityConditions?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(5000) riskRuleSummary?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(60) ownerRoleKey?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsUUID() ownerUserId?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(5000) approvalRequirements?: string | null;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(10) @ArrayUnique() @IsString({ each: true }) approverRoleKeys: string[];
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsUUID() retentionPolicyId?: string | null;
  @ApiProperty({ enum: SUPPLIER_VISIBILITY }) @IsIn([...SUPPLIER_VISIBILITY]) supplierVisibility: (typeof SUPPLIER_VISIBILITY)[number];
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(10000) instructions?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowUpload?: boolean;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(60) nativeFormKey?: string | null;
}

export class UpdateDocumentTypeDto extends PartialType(OmitType(CreateDocumentTypeDto, ["code"] as const)) {
  @ExpectedVersion() expectedVersion: number;
}

export class DocumentTypeStatusDto {
  @ApiProperty({ enum: LIFECYCLE_STATUS }) @IsIn([...LIFECYCLE_STATUS]) status: (typeof LIFECYCLE_STATUS)[number];
  @ApiPropertyOptional() @IsOptional() @IsUUID() supersededByTypeId?: string;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(2000) reason: string;
}

export class CreateTemplateDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(200) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) description?: string;
}

export class CreateTemplateRevisionDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(5000) changeSummary: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) instructions?: string;
  @ApiPropertyOptional({ description: "Uploaded template file (DOCX/XLSX/PDF)" }) @IsOptional() @IsUUID() fileId?: string;
  @ApiPropertyOptional({ description: "Native form schema version used for web-form submissions" }) @IsOptional() @IsUUID() formDefinitionVersionId?: string;
}

export class PublishTemplateRevisionDto {
  @IsDateOnly() effectiveDate: string;
}

export class CreateFormVersionDto {
  @ApiProperty({ description: "Form schema (sections, fields, repeatable tables, conditions)" }) @IsObject() schema: Record<string, unknown>;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(5000) changeSummary: string;
}
