import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { PART_CRITICALITY, PROJECT_MEMBER_ROLE, PROJECT_STAGE, SOURCING_PATHWAY, SOURCING_PROJECT_STATUS } from "@sqms/shared";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO31661Alpha2,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { EmptyToNull, ExpectedVersion, IsDateOnly, ToArray, ToBoolean } from "../../common/http/dto-helpers";
import { PageQueryDto } from "../../common/http/pagination";
import { BaselineDto, RequirementDto } from "../configurations/configurations.dto";
import { SiteDto } from "../suppliers/suppliers.dto";

export class NewPartDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(60) partNumber: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(500) description: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional({ enum: PART_CRITICALITY }) @IsOptional() @IsIn([...PART_CRITICALITY]) criticality?: (typeof PART_CRITICALITY)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) application?: string;
}

export class NewSupplierDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(200) name: string;
  @ApiProperty() @IsISO31661Alpha2() country: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(250) legalName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) website?: string;
}

export class NewSupplierPartDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(80) supplierPartNumber: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(500) description: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) supplierRevision?: string;
}

export class MemberDto {
  @ApiProperty() @IsUUID() userId: string;
  @ApiProperty({ enum: PROJECT_MEMBER_ROLE }) @IsIn([...PROJECT_MEMBER_ROLE]) role: (typeof PROJECT_MEMBER_ROLE)[number];
  @IsDateOnly(true) dueDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) responsibility?: string;
}

/** Payload produced by the 9-step New Sourcing Project wizard. */
export class CreateSourcingProjectDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(250) title: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) description?: string;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(5000) businessJustification: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) annualVolume?: number;
  @IsDateOnly(true) targetDate?: string;

  // Step 1 - product
  @ApiPropertyOptional() @IsOptional() @IsUUID() internalPartId?: string;
  @ApiPropertyOptional({ type: NewPartDto }) @IsOptional() @ValidateNested() @Type(() => NewPartDto) newPart?: NewPartDto;

  // Step 2 - supplier and manufacturing site
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional({ type: NewSupplierDto }) @IsOptional() @ValidateNested() @Type(() => NewSupplierDto) newSupplier?: NewSupplierDto;
  @ApiPropertyOptional() @IsOptional() @IsUUID() siteId?: string;
  @ApiPropertyOptional({ type: SiteDto }) @IsOptional() @ValidateNested() @Type(() => SiteDto) newSite?: SiteDto;

  // Step 3 / 4 - pathway and reverse engineering
  @ApiProperty({ enum: SOURCING_PATHWAY }) @IsIn([...SOURCING_PATHWAY]) pathway: (typeof SOURCING_PATHWAY)[number];
  @ApiProperty() @IsBoolean() reverseEngineeringRequired: boolean;

  // Step 5 - risk assessment (assessor selections; derived factors come from project data)
  @ApiProperty({ example: { specialProcesses: "true", manufacturingComplexity: "MEDIUM", technologyNovelty: "ESTABLISHED", supplyChain: "LOW", singleSource: "false", regulatoryImpact: "false", fieldHistory: "NONE" } })
  @IsObject()
  riskFactors: Record<string, string>;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) riskRationale?: string;

  // Step 6 - technical requirements and baseline
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierPartId?: string;
  @ApiPropertyOptional({ type: NewSupplierPartDto }) @IsOptional() @ValidateNested() @Type(() => NewSupplierPartDto) newSupplierPart?: NewSupplierPartDto;
  @ApiPropertyOptional({ description: "Path C: distinct supplier part number for the custom configuration" }) @IsOptional() @IsString() @MaxLength(80) customPartNumber?: string;
  @ApiProperty() @IsBoolean() specialProcesses: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) specialProcessList?: string;
  @ApiProperty() @IsBoolean() customerRequirements: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) technicalRequirements?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) baselineInformation?: string;
  @ApiPropertyOptional({ type: BaselineDto }) @IsOptional() @ValidateNested() @Type(() => BaselineDto) baseline?: BaselineDto;
  @ApiPropertyOptional({ type: [RequirementDto], description: "Path C modified / additional requirements" })
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => RequirementDto)
  deltaRequirements?: RequirementDto[];

  // Step 8 - responsible personnel and due dates
  @ApiPropertyOptional() @IsOptional() @IsUUID() ownerId?: string;
  @ApiPropertyOptional({ type: [MemberDto] }) @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => MemberDto) members?: MemberDto[];
}

export class PreviewChecklistDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() internalPartId?: string;
  @ApiPropertyOptional({ enum: PART_CRITICALITY }) @IsOptional() @IsIn([...PART_CRITICALITY]) criticality?: (typeof PART_CRITICALITY)[number];
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiProperty({ enum: SOURCING_PATHWAY }) @IsIn([...SOURCING_PATHWAY]) pathway: (typeof SOURCING_PATHWAY)[number];
  @ApiProperty() @IsBoolean() reverseEngineeringRequired: boolean;
  @ApiProperty() @IsBoolean() specialProcesses: boolean;
  @ApiProperty() @IsBoolean() customerRequirements: boolean;
  @ApiProperty() @IsObject() riskFactors: Record<string, string>;
}

export class UpdateProjectDto {
  @ExpectedVersion() expectedVersion: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(3) @MaxLength(250) title?: string;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(10000) description?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(5) @MaxLength(5000) businessJustification?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) annualVolume?: number;
  @IsDateOnly(true) targetDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ownerId?: string;
  @ApiPropertyOptional({ enum: PROJECT_STAGE }) @IsOptional() @IsIn([...PROJECT_STAGE]) stage?: (typeof PROJECT_STAGE)[number];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() supplierVisible?: boolean;
}

export class ReassessRiskDto {
  @ExpectedVersion() expectedVersion: number;
  @ApiProperty() @IsObject() riskFactors: Record<string, string>;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() specialProcesses?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() customerRequirements?: boolean;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(5000) rationale: string;
}

export class ProjectVersionDto {
  @ExpectedVersion() expectedVersion: number;
}

export class ProjectReasonDto {
  @ExpectedVersion() expectedVersion: number;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(5000) reason: string;
}

export class AddRequirementDto {
  @ApiProperty() @IsUUID() documentTypeId: string;
  @ApiProperty({ enum: ["REQUIRED", "CONDITIONAL"] }) @IsIn(["REQUIRED", "CONDITIONAL"]) level: "REQUIRED" | "CONDITIONAL";
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(500) reason: string;
  @IsDateOnly(true) dueDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assignedToId?: string;
}

export class UpdateRequirementAssignmentDto {
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsUUID() assignedToId?: string | null;
  @IsDateOnly(true) dueDate?: string;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(5000) notes?: string | null;
}

export class WaiveRequirementDto {
  @ApiProperty({ description: "Documented justification (recorded in the audit trail)" }) @IsString() @MinLength(10) @MaxLength(5000) justification: string;
}

export class LinkRequirementDocumentDto {
  @ApiProperty() @IsUUID() documentId: string;
}

export class CreateRequirementDocumentDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(300) title: string;
  @ApiProperty({ enum: ["NATIVE_FORM", "UPLOAD"] }) @IsIn(["NATIVE_FORM", "UPLOAD"]) submissionMethod: "NATIVE_FORM" | "UPLOAD";
  @ApiPropertyOptional() @IsOptional() @IsObject() formData?: Record<string, unknown>;
}

export class ProjectListQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: SOURCING_PROJECT_STATUS, isArray: true }) @IsOptional() @ToArray() @IsIn([...SOURCING_PROJECT_STATUS], { each: true }) status?: string[];
  @ApiPropertyOptional({ enum: SOURCING_PATHWAY, isArray: true }) @IsOptional() @ToArray() @IsIn([...SOURCING_PATHWAY], { each: true }) pathway?: string[];
  @ApiPropertyOptional({ enum: PROJECT_STAGE, isArray: true }) @IsOptional() @ToArray() @IsIn([...PROJECT_STAGE], { each: true }) stage?: string[];
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() internalPartId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ownerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() siteId?: string;
  @ApiPropertyOptional() @IsOptional() @ToBoolean() @IsBoolean() active?: boolean;
}
