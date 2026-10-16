import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { ExpectedVersion, IsDateOnly } from "../../common/http/dto-helpers";
import { PageQueryDto } from "../../common/http/pagination";

export class OperationsQuery extends PageQueryDto {
  @IsDateOnly(true) dateFrom?: string;
  @IsDateOnly(true) dateTo?: string;
  @IsOptional() @IsString() @MaxLength(80) disposition?: string;
  @IsOptional() @IsUUID() planRevisionId?: string;
  @IsOptional()
  @IsIn(["DRAFT", "IN_PROGRESS", "COMPLETE", "ARCHIVED"])
  status?: "DRAFT" | "IN_PROGRESS" | "COMPLETE" | "ARCHIVED";
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsUUID() internalPartId?: string;
  @IsOptional() @IsUUID() assignedToId?: string;
}
export class PlanDto {
  @IsString() @MinLength(2) @MaxLength(80) code: string;
  @IsString() @MinLength(3) @MaxLength(250) title: string;
  @IsObject() definition: Record<string, unknown>;
}
export class PlanRevisionDto {
  @IsObject() definition: Record<string, unknown>;
}
export class NewIncomingDto {
  @IsUUID() planRevisionId: string;
  @IsOptional() @IsUUID() internalPartId?: string;
  @IsOptional() @IsUUID() supplierProductId?: string;
  @IsOptional() @IsUUID() productApprovalId?: string;
  @IsOptional() @IsString() @MaxLength(200) originalPartNumber?: string;
  @IsOptional() @IsString() @MaxLength(250) originalSupplier?: string;
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(5000)
  resolutionNotes?: string;
  @IsOptional() @IsUUID() assignedToId?: string;
  @IsDateOnly(true) dueAt?: string;
  @IsInt() @Min(1) @Max(500) itemCount: number;
  @IsObject() header: Record<string, unknown>;
}
export class MeasurementDto {
  @IsOptional() @IsInt() @Min(0) @Max(499) itemPosition?: number;
  @IsString() @MinLength(1) @MaxLength(100) characteristicKey: string;
  @IsOptional() @IsNumber() value?: number;
  @IsOptional() @IsString() @MaxLength(1000) textValue?: string;
  @IsOptional() @IsIn(["PASS", "FAIL", "NOT_INSPECTED"]) outcome?:
    | "PASS"
    | "FAIL"
    | "NOT_INSPECTED";
}
export class UpdateIncomingDto {
  @ExpectedVersion() expectedVersion: number;
  @IsOptional() @IsObject() header?: Record<string, unknown>;
  @IsOptional() @IsObject() sectionData?: Record<string, unknown>;
  @IsOptional() @IsUUID() assignedToId?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10000)
  @ValidateNested({ each: true })
  @Type(() => MeasurementDto)
  measurements?: MeasurementDto[];
}
export class OperationsVersionDto {
  @ExpectedVersion() expectedVersion: number;
}
export class OperationsReasonDto extends OperationsVersionDto {
  @IsString() @MinLength(5) @MaxLength(5000) reason: string;
}
export class RecordedSyncDto {
  @IsIn(["recorded"]) mode: "recorded";
  @IsArray() @ArrayMaxSize(2000) @IsObject({ each: true }) reports: Record<
    string,
    unknown
  >[];
}
export class InjectorSelectionDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID(undefined, { each: true })
  ids: string[];
  @IsOptional() @IsString() @MaxLength(200) vendorName?: string;
  @IsOptional()
  @IsIn(["customer", "supplier_evaluation", "xlsx"])
  format?: string;
}
export class NewRepairDto {
  @IsUUID() testId: string;
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  failureCategories: string[];
}
export class RepairAttemptDto extends OperationsVersionDto {
  @IsUUID() beforeTestId: string;
  @IsDateOnly() repairDate: string;
  @IsString() @MinLength(3) @MaxLength(20000) diagnosis: string;
  @IsOptional() @IsString() @MaxLength(10000) hypothesis?: string;
  @IsOptional() @IsString() @MaxLength(10000) expectedOutcome?: string;
  @IsOptional() @IsString() @MaxLength(10000) notes?: string;
  @IsArray() @ArrayMaxSize(25) @IsObject({ each: true }) changes: Record<
    string,
    unknown
  >[];
}
export class RetestDto extends OperationsVersionDto {
  @IsUUID() afterTestId: string;
  @IsString() @MinLength(5) @MaxLength(10000) observedOutcome: string;
}
export class RepairStatusDto extends OperationsReasonDto {
  @IsIn(["OPEN", "SCRAPPED", "HOLD", "ENGINEERING_REVIEW"]) status: string;
}
export class QuickRepairDto {
  @IsOptional() @IsInt() @Min(0) expectedCaseVersion?: number;
  @IsDateOnly() repairDate: string;
  @IsArray() @ArrayMaxSize(6) @IsObject({ each: true }) measurements: Record<
    string,
    unknown
  >[];
  @IsOptional() @IsString() @MaxLength(10000) notes?: string;
}
