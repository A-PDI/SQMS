import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { CHANGE_CATEGORY, CHANGE_REQUEST_STATUS, DISCIPLINE, IMPACT_RECOMMENDATION, RISK_LEVEL } from "@sqms/shared";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";
import { EmptyToNull, ExpectedVersion, IsDateOnly, ToArray } from "../../common/http/dto-helpers";
import { PageQueryDto } from "../../common/http/pagination";

type Category = (typeof CHANGE_CATEGORY)[number];

export class CreateChangeRequestDto {
  @ApiProperty({ description: "Approved supplier product (part + supplier part + site) affected by the change" }) @IsUUID() supplierProductId: string;
  @ApiPropertyOptional({ description: "Approved configuration revision affected (required when the product has several approved configurations)" })
  @IsOptional()
  @IsUUID()
  currentRevisionId?: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(250) title: string;
  @ApiProperty({ enum: CHANGE_CATEGORY, isArray: true }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(11) @IsIn([...CHANGE_CATEGORY], { each: true }) categories: Category[];
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(10000) reason: string;
  @ApiProperty() @IsString() @MinLength(10) @MaxLength(20000) description: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) affectedCharacteristics?: string;
  @IsDateOnly(true) proposedImplementationDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) inventoryImpact?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) wipImpact?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) riskAssessment?: string;
  @ApiPropertyOptional({ description: "Location changes: the proposed manufacturing site (same supplier)" }) @IsOptional() @IsUUID() proposedSiteId?: string;
}

export class UpdateChangeRequestDto {
  @ExpectedVersion() expectedVersion: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(3) @MaxLength(250) title?: string;
  @ApiPropertyOptional({ enum: CHANGE_CATEGORY, isArray: true }) @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(11) @IsIn([...CHANGE_CATEGORY], { each: true }) categories?: Category[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(5) @MaxLength(10000) reason?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(10) @MaxLength(20000) description?: string;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(10000) affectedCharacteristics?: string | null;
  @IsDateOnly(true) proposedImplementationDate?: string;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(5000) inventoryImpact?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(5000) wipImpact?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(10000) riskAssessment?: string | null;
}

export class ChangeVersionDto {
  @ExpectedVersion() expectedVersion: number;
}

export class ChangeReasonDto {
  @ExpectedVersion() expectedVersion: number;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(5000) reason: string;
}

/** One discipline's input to the Change Impact & Requalification Decision (CIRD, OPS-04). */
export class ImpactAssessmentDto {
  @ApiProperty({ enum: DISCIPLINE }) @IsIn([...DISCIPLINE]) discipline: (typeof DISCIPLINE)[number];
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(10000) impactSummary: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() affectsFormFitFunction?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() affectsInterchangeability?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requiresFai?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requiresPartialRequalification?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requiresFunctionalTest?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requiresMaterialCertificates?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requiresControlPlanUpdate?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requiresSpecificationRevision?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requiresNewProductApproval?: boolean;
  @ApiProperty({ enum: IMPACT_RECOMMENDATION }) @IsIn([...IMPACT_RECOMMENDATION]) recommendation: (typeof IMPACT_RECOMMENDATION)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) comments?: string;
}

export class RequalificationDecisionDto {
  @ExpectedVersion() expectedVersion: number;
  @ApiProperty({ enum: RISK_LEVEL }) @IsIn([...RISK_LEVEL]) riskLevel: (typeof RISK_LEVEL)[number];
  @ApiPropertyOptional({ description: "Summary of the validation required before approval" }) @IsOptional() @IsString() @MaxLength(10000) requiredValidation?: string;
}

export class SubmitChangeForApprovalDto {
  @ExpectedVersion() expectedVersion: number;
  @ApiPropertyOptional({ description: "Conditions of approval (approves with conditions when present)" }) @IsOptional() @IsString() @MaxLength(10000) dispositionConditions?: string;
}

export class VerifyImplementationDto {
  @ExpectedVersion() expectedVersion: number;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(10000) implementationNotes: string;
}

export class ChangeRequestListQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: CHANGE_REQUEST_STATUS, isArray: true }) @IsOptional() @ToArray() @IsIn([...CHANGE_REQUEST_STATUS], { each: true }) status?: string[];
  @ApiPropertyOptional({ enum: CHANGE_CATEGORY, isArray: true }) @IsOptional() @ToArray() @IsIn([...CHANGE_CATEGORY], { each: true }) category?: string[];
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() internalPartId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierProductId?: string;
}
