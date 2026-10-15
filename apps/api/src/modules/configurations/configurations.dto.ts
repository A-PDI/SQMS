import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import { BASELINE_TYPE, CHARACTERISTIC_CLASS, CONFIGURATION_TYPE, DESIGN_OWNERSHIP, REQUIREMENT_CATEGORY } from "@sqms/shared";
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from "class-validator";
import { EmptyToNull, ExpectedVersion } from "../../common/http/dto-helpers";

const TEXT = 20000;

export class BaselineDto {
  @ApiPropertyOptional({ enum: BASELINE_TYPE }) @IsOptional() @IsIn([...BASELINE_TYPE]) baselineType?: (typeof BASELINE_TYPE)[number];
  @ApiPropertyOptional({ enum: DESIGN_OWNERSHIP }) @IsOptional() @IsIn([...DESIGN_OWNERSHIP]) designOwnership?: (typeof DESIGN_OWNERSHIP)[number];
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(80) drawingNumber?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(20) drawingRevision?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(80) specificationNumber?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(20) specificationRevision?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(300) material?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(300) materialSpecification?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(300) coating?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(300) coatingSpecification?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(300) heatTreatment?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(300) surfaceFinish?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(500) generalTolerances?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(TEXT) keyDimensions?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(TEXT) performanceRequirements?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(TEXT) operatingRequirements?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(TEXT) guaranteedCharacteristics?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(TEXT) reverseEngineeringSource?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(TEXT) notes?: string | null;
}

export class UpdateBaselineDto extends BaselineDto {
  @ExpectedVersion() expectedVersion: number;
}

export class CreateConfigurationDto {
  @ApiProperty() @IsUUID() supplierProductId: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(200) name: string;
  @ApiProperty({ enum: CONFIGURATION_TYPE }) @IsIn([...CONFIGURATION_TYPE]) configurationType: (typeof CONFIGURATION_TYPE)[number];
  @ApiPropertyOptional({ description: "Path C: original supplier configuration this one modifies" }) @IsOptional() @IsUUID() baseConfigurationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) customPartNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) supplierProductRevision?: string;
  @ApiPropertyOptional({ type: BaselineDto }) @IsOptional() baseline?: BaselineDto;
}

export class UpdateRevisionDto {
  @ExpectedVersion() expectedVersion: number;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(TEXT) description?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(TEXT) changeSummary?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(40) supplierProductRevision?: string | null;
}

export class NewRevisionDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(TEXT) changeSummary: string;
}

export class ReasonDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(2000) reason: string;
}

export class RequirementDto {
  @ApiPropertyOptional({ description: "Auto-assigned (REQ-001...) when omitted" }) @IsOptional() @IsString() @MinLength(1) @MaxLength(20) code?: string;
  @ApiProperty({ enum: REQUIREMENT_CATEGORY }) @IsIn([...REQUIREMENT_CATEGORY]) category: (typeof REQUIREMENT_CATEGORY)[number];
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(250) title: string;
  @ApiPropertyOptional({ description: "The supplier's original baseline value" }) @IsOptional() @EmptyToNull() @IsString() @MaxLength(TEXT) baselineValue?: string | null;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(TEXT) requiredValue: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(TEXT) acceptanceCriteria: string;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(TEXT) rationale?: string | null;
  @ApiPropertyOptional({ description: "true = modification of a baseline characteristic; false = additional requirement" }) @IsOptional() @IsBoolean() isModification?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class UpdateRequirementDto {
  @ApiPropertyOptional({ enum: REQUIREMENT_CATEGORY }) @IsOptional() @IsIn([...REQUIREMENT_CATEGORY]) category?: (typeof REQUIREMENT_CATEGORY)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(250) title?: string;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(TEXT) baselineValue?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(TEXT) requiredValue?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(TEXT) acceptanceCriteria?: string;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(TEXT) rationale?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isModification?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class AcknowledgeRequirementDto {
  @ApiProperty({ enum: ["ACKNOWLEDGED", "DECLINED"] }) @IsIn(["ACKNOWLEDGED", "DECLINED"]) status: "ACKNOWLEDGED" | "DECLINED";
  @ApiProperty({ description: "Supplier representative who acknowledged" }) @IsString() @MinLength(2) @MaxLength(160) acknowledgedByName: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) note?: string;
}

export class VerifyRequirementDto {
  @ApiProperty({ enum: ["VERIFIED", "FAILED", "WAIVED"] }) @IsIn(["VERIFIED", "FAILED", "WAIVED"]) status: "VERIFIED" | "FAILED" | "WAIVED";
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(TEXT) note: string;
}

export class CharacteristicDto {
  @ApiPropertyOptional({ description: "Auto-assigned (C-01...) when omitted" }) @IsOptional() @IsString() @MinLength(1) @MaxLength(20) charNumber?: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(250) name: string;
  @ApiProperty({ enum: CHARACTERISTIC_CLASS }) @IsIn([...CHARACTERISTIC_CLASS]) classification: (typeof CHARACTERISTIC_CLASS)[number];
  @ApiPropertyOptional({ enum: ["BASELINE", "DELTA"] }) @IsOptional() @IsIn(["BASELINE", "DELTA"]) source?: "BASELINE" | "DELTA";
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsUUID() customerRequirementId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() nominal?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() tolerancePlus?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() toleranceMinus?: number | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(20) unit?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(500) specification?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(300) measurementMethod?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(200) inspectionFrequency?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(TEXT) acceptanceCriteria?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class UpdateCharacteristicDto extends PartialType(CharacteristicDto) {}
