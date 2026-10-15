import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { DEVIATION_STATUS, DEVIATION_TYPE, NCR_DISPOSITION, NCR_SEVERITY, NCR_SOURCE, NCR_STATUS, SCAR_STATUS } from "@sqms/shared";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from "class-validator";
import { EmptyToNull, ExpectedVersion, IsDateOnly, ToArray, ToBoolean } from "../../common/http/dto-helpers";
import { PageQueryDto } from "../../common/http/pagination";

export class QualityVersionDto {
  @ExpectedVersion() expectedVersion: number;
}

export class QualityReasonDto {
  @ExpectedVersion() expectedVersion: number;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(5000) reason: string;
}

// ------------------------------------------------------------------ deviations / concessions (OPS-05)

export class CreateDeviationDto {
  @ApiProperty({ enum: DEVIATION_TYPE }) @IsIn([...DEVIATION_TYPE]) type: (typeof DEVIATION_TYPE)[number];
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(250) title: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierProductId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() configurationRevisionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() qualificationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ncrId?: string;
  @ApiProperty() @IsString() @MinLength(10) @MaxLength(20000) description: string;
  @ApiProperty() @IsString() @MinLength(10) @MaxLength(20000) justification: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) riskAssessment?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) quantityLimit?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) lotNumbers?: string;
  @IsDateOnly(true) startDate?: string;
  @IsDateOnly(true) endDate?: string;
  @ApiPropertyOptional({ description: "Whether the open request blocks product approval (default true)" }) @IsOptional() @IsBoolean() blocksApproval?: boolean;
}

export class UpdateDeviationDto {
  @ExpectedVersion() expectedVersion: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(3) @MaxLength(250) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(10) @MaxLength(20000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(10) @MaxLength(20000) justification?: string;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(10000) riskAssessment?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) quantityLimit?: number;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(5000) lotNumbers?: string | null;
  @IsDateOnly(true) startDate?: string;
  @IsDateOnly(true) endDate?: string;
}

export class DeviationListQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: DEVIATION_STATUS, isArray: true }) @IsOptional() @ToArray() @IsIn([...DEVIATION_STATUS], { each: true }) status?: string[];
  @ApiPropertyOptional({ enum: DEVIATION_TYPE }) @IsOptional() @IsIn([...DEVIATION_TYPE]) type?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ncrId?: string;
}

// ------------------------------------------------------------------ nonconformance reports (OPS-06)

export class CreateNcrDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(250) title: string;
  @IsDateOnly() dateIdentified: string;
  @ApiProperty({ enum: NCR_SOURCE }) @IsIn([...NCR_SOURCE]) source: (typeof NCR_SOURCE)[number];
  @ApiPropertyOptional({ description: "Approved/qualifying supplier product; supplier, part and site are derived from it" }) @IsOptional() @IsUUID() supplierProductId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() siteId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() internalPartId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierPartId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() configurationRevisionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() characteristicId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() qualificationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) lotNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) serialNumbers?: string;
  @ApiProperty() @IsInt() @Min(1) quantityAffected: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) quantityInspected?: number;
  @ApiProperty() @IsString() @MinLength(10) @MaxLength(20000) defectDescription: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) expectedSpecification?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) actualCondition?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) inspectionResults?: string;
  @ApiProperty({ enum: NCR_SEVERITY }) @IsIn([...NCR_SEVERITY]) severity: (typeof NCR_SEVERITY)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) containmentAction?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() blocksApproval?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ownerId?: string;
  @ApiPropertyOptional({ description: "Internal-only notes (never shown to supplier users)" }) @IsOptional() @IsString() @MaxLength(20000) internalNotes?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() supplierVisible?: boolean;
}

export class UpdateNcrDto {
  @ExpectedVersion() expectedVersion: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(3) @MaxLength(250) title?: string;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(80) lotNumber?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(5000) serialNumbers?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) quantityAffected?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) quantityInspected?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(10) @MaxLength(20000) defectDescription?: string;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(10000) expectedSpecification?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(10000) actualCondition?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(10000) inspectionResults?: string | null;
  @ApiPropertyOptional({ enum: NCR_SEVERITY }) @IsOptional() @IsIn([...NCR_SEVERITY]) severity?: (typeof NCR_SEVERITY)[number];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() blocksApproval?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ownerId?: string;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(20000) internalNotes?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() supplierVisible?: boolean;
}

export class ContainmentDto {
  @ExpectedVersion() expectedVersion: number;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(10000) containmentAction: string;
  @ApiPropertyOptional({ description: "Mark containment as completed now" }) @IsOptional() @IsBoolean() completed?: boolean;
}

export class DispositionDto {
  @ExpectedVersion() expectedVersion: number;
  @ApiProperty({ enum: NCR_DISPOSITION }) @IsIn([...NCR_DISPOSITION]) disposition: (typeof NCR_DISPOSITION)[number];
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(10000) dispositionNotes: string;
  @ApiPropertyOptional({ description: "Approved concession supporting use-as-is / repair" }) @IsOptional() @IsUUID() deviationId?: string;
}

export class CloseDto {
  @ExpectedVersion() expectedVersion: number;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(10000) comment: string;
}

export class NcrListQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: NCR_STATUS, isArray: true }) @IsOptional() @ToArray() @IsIn([...NCR_STATUS], { each: true }) status?: string[];
  @ApiPropertyOptional({ enum: NCR_SEVERITY, isArray: true }) @IsOptional() @ToArray() @IsIn([...NCR_SEVERITY], { each: true }) severity?: string[];
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() internalPartId?: string;
  @ApiPropertyOptional() @IsOptional() @ToBoolean() @IsBoolean() open?: boolean;
}

// ------------------------------------------------------------------ SCAR (OPS-07) and 8D responses (OPS-08)

export class CreateScarDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(250) title: string;
  @ApiPropertyOptional({ description: "Originating NCR (supplier, site and severity are taken from it)" }) @IsOptional() @IsUUID() ncrId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() siteId?: string;
  @ApiProperty() @IsString() @MinLength(10) @MaxLength(20000) problemDescription: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) requirements?: string;
  @ApiPropertyOptional({ enum: NCR_SEVERITY }) @IsOptional() @IsIn([...NCR_SEVERITY]) severity?: (typeof NCR_SEVERITY)[number];
  @IsDateOnly(true) containmentDueDate?: string;
  @IsDateOnly(true) responseDueDate?: string;
  @IsDateOnly(true) effectivenessDueDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20000) internalNotes?: string;
}

export class UpdateScarDto {
  @ExpectedVersion() expectedVersion: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(3) @MaxLength(250) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(10) @MaxLength(20000) problemDescription?: string;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(10000) requirements?: string | null;
  @IsDateOnly(true) containmentDueDate?: string;
  @IsDateOnly(true) responseDueDate?: string;
  @IsDateOnly(true) effectivenessDueDate?: string;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(20000) internalNotes?: string | null;
}

export class ScarResponseDto {
  @ApiPropertyOptional({ description: "Name of the supplier representative when entered by an internal user on the supplier's behalf" }) @IsOptional() @IsString() @MaxLength(160) submittedByName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) d1Team?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) d2Problem?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) d3Containment?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) d4RootCause?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) d4EscapePoint?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) d5CorrectiveActions?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) d6Implementation?: string;
  @IsDateOnly(true) d6ImplementationDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) d7Prevention?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) d8Closure?: string;
}

export class ResponseReviewDto {
  @ApiProperty({ enum: ["ACCEPTED", "REJECTED"] }) @IsIn(["ACCEPTED", "REJECTED"]) decision: "ACCEPTED" | "REJECTED";
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(10000) comment: string;
  @IsDateOnly(true) effectivenessDueDate?: string;
}

export class EffectivenessDto {
  @ExpectedVersion() expectedVersion: number;
  @ApiProperty({ enum: ["EFFECTIVE", "NOT_EFFECTIVE"] }) @IsIn(["EFFECTIVE", "NOT_EFFECTIVE"]) result: "EFFECTIVE" | "NOT_EFFECTIVE";
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(10000) notes: string;
}

export class ScarListQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: SCAR_STATUS, isArray: true }) @IsOptional() @ToArray() @IsIn([...SCAR_STATUS], { each: true }) status?: string[];
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ncrId?: string;
  @ApiPropertyOptional() @IsOptional() @ToBoolean() @IsBoolean() overdue?: boolean;
}

/** Overrides when generating a SCAR from an NCR (defaults come from the NCR). */
export class GenerateScarDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(3) @MaxLength(250) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(10) @MaxLength(20000) problemDescription?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) requirements?: string;
  @ApiPropertyOptional({ enum: NCR_SEVERITY }) @IsOptional() @IsIn([...NCR_SEVERITY]) severity?: (typeof NCR_SEVERITY)[number];
  @IsDateOnly(true) containmentDueDate?: string;
  @IsDateOnly(true) responseDueDate?: string;
  @IsDateOnly(true) effectivenessDueDate?: string;
}
