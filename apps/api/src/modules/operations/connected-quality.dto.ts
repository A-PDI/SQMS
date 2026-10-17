import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { ExpectedVersion } from "../../common/http/dto-helpers";

export class FeatureDto {
  @IsUUID() internalPartId: string;
  @IsString() @MinLength(2) @MaxLength(80) key: string;
  @IsString() @MinLength(3) @MaxLength(250) name: string;
}
export class FeatureMappingDto {
  @IsUUID() featureId: string;
  @IsUUID() configurationRevisionId: string;
  @IsOptional() @IsUUID() characteristicId?: string;
  @IsOptional() @IsString() @MaxLength(80) balloonAlias?: string;
  @IsIn(["COMPATIBLE", "INCOMPATIBLE", "UNCERTAIN"]) compatibility: string;
  @IsString() @MinLength(5) @MaxLength(5000) reason: string;
}
export class OriginNcrDto {
  @IsOptional() @IsUUID() requestKey?: string;
  @IsString() @MinLength(3) @MaxLength(250) title: string;
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID(undefined, { each: true })
  resultIds: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  @Min(0, { each: true })
  itemPositions?: number[];
  @IsIn([
    "DIMENSIONAL",
    "FLOW",
    "LEAK",
    "MATERIAL",
    "VISUAL",
    "FUNCTIONAL",
    "DOCUMENTATION",
    "OTHER",
  ])
  defectCode: string;
  @IsOptional() @IsIn(["MINOR", "MAJOR", "CRITICAL"]) severity?:
    | "MINOR"
    | "MAJOR"
    | "CRITICAL";
  @IsInt() @Min(1) quantityAffected: number;
}
export class DefectLineDto {
  @IsOptional() @IsUUID() featureId?: string;
  @IsIn([
    "DIMENSIONAL",
    "FLOW",
    "LEAK",
    "MATERIAL",
    "VISUAL",
    "FUNCTIONAL",
    "DOCUMENTATION",
    "OTHER",
  ])
  defectCode: string;
  @IsIn(["ABOVE", "BELOW", "OTHER", "UNKNOWN"]) deviationDirection: string;
  @IsIn(["MINOR", "MAJOR", "CRITICAL"]) severity:
    | "MINOR"
    | "MAJOR"
    | "CRITICAL";
  @IsObject() specification: Record<string, unknown>;
  @IsString() @MinLength(3) @MaxLength(20000) actualCondition: string;
  @IsInt() @Min(1) quantityAffected: number;
}
export class DefectLinesDto {
  @ExpectedVersion() expectedVersion: number;
  @IsOptional() @IsString() @MinLength(5) @MaxLength(5000) reason?: string;
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => DefectLineDto)
  lines: DefectLineDto[];
}
export class RecurrenceDecisionDto {
  @IsIn(["CONFIRMED", "DISMISSED"]) status: "CONFIRMED" | "DISMISSED";
  @IsString() @MinLength(5) @MaxLength(5000) reason: string;
}
export class ReportSectionDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @MaxLength(250) title: string;
  @IsString() @MaxLength(100000) body: string;
}
export class ReportSectionsDto {
  @ExpectedVersion() expectedVersion: number;
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReportSectionDto)
  sections: ReportSectionDto[];
}
export class ScarLinkDto {
  @IsUUID() scarId: string;
  @IsString() @MinLength(5) @MaxLength(5000) reason: string;
}
