import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { INSPECTION_OUTCOME, PRODUCT_QUALIFICATION_STATUS, TEST_TYPE } from "@sqms/shared";
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from "class-validator";
import { EmptyToNull, ExpectedVersion, IsDateOnly, ToArray } from "../../common/http/dto-helpers";
import { PageQueryDto } from "../../common/http/pagination";

export class CreateQualificationDto {
  @ApiPropertyOptional({ description: "Create from a sourcing project (target configuration revision is resolved)" }) @IsOptional() @IsUUID() sourcingProjectId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() configurationRevisionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(3) @MaxLength(250) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) requiredSampleQty?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) sampleNotes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) inspectionPlanNotes?: string;
}

export class UpdateQualificationDto {
  @ExpectedVersion() expectedVersion: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(3) @MaxLength(250) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) requiredSampleQty?: number;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(5000) sampleNotes?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(10000) inspectionPlanNotes?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(10000) approvalRestrictions?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(10000) deviationsSummary?: string | null;
}

export const MANUAL_QUAL_STATUSES = ["DOCUMENTATION_PENDING", "EVALUATION", "VALIDATION"] as const;

export class QualificationStatusDto {
  @ExpectedVersion() expectedVersion: number;
  @ApiProperty({ enum: [...MANUAL_QUAL_STATUSES, "ON_HOLD"] }) @IsIn([...MANUAL_QUAL_STATUSES, "ON_HOLD"]) status: (typeof MANUAL_QUAL_STATUSES)[number] | "ON_HOLD";
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) reason?: string;
}

export class QualificationVersionDto {
  @ExpectedVersion() expectedVersion: number;
}

export class TestDto {
  @ApiProperty({ enum: TEST_TYPE }) @IsIn([...TEST_TYPE]) testType: (typeof TEST_TYPE)[number];
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(250) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) procedure?: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(10000) acceptanceCriteria: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isRequired?: boolean;
}

export class TestResultDto {
  @ApiProperty({ enum: ["PASS", "FAIL", "CONDITIONAL"] }) @IsIn(["PASS", "FAIL", "CONDITIONAL"]) outcome: "PASS" | "FAIL" | "CONDITIONAL";
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(10000) resultSummary: string;
  @IsDateOnly(true) testedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) laboratory?: string;
  @ApiPropertyOptional({ description: "Test report document (e.g. VAL-03)" }) @IsOptional() @IsUUID() documentId?: string;
}

export class EvidenceReviewDto {
  @ApiProperty({ enum: ["ACCEPTED", "REJECTED"] }) @IsIn(["ACCEPTED", "REJECTED"]) decision: "ACCEPTED" | "REJECTED";
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(5000) comment: string;
}

export class FaiDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) serialNumbers?: string;
  @IsDateOnly(true) inspectionDate?: string;
  @ApiProperty() @IsInt() @Min(0) characteristicsInspected: number;
  @ApiProperty() @IsInt() @Min(0) nonconformingCount: number;
  @ApiProperty({ enum: ["PASS", "FAIL", "CONDITIONAL"] }) @IsIn(["PASS", "FAIL", "CONDITIONAL"]) outcome: "PASS" | "FAIL" | "CONDITIONAL";
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) summary?: string;
  @ApiPropertyOptional({ description: "FAIR document (VAL-02)" }) @IsOptional() @IsUUID() documentId?: string;
}

export class InspectionResultDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() characteristicId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() firstArticleId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) sampleIdentifier?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) measuredValue?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() numericValue?: number;
  @ApiProperty({ enum: INSPECTION_OUTCOME }) @IsIn([...INSPECTION_OUTCOME]) outcome: (typeof INSPECTION_OUTCOME)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) notes?: string;
}

export class QualificationListQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: PRODUCT_QUALIFICATION_STATUS, isArray: true }) @IsOptional() @ToArray() @IsIn([...PRODUCT_QUALIFICATION_STATUS], { each: true }) status?: string[];
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() internalPartId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sourcingProjectId?: string;
}
