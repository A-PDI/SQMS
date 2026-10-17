import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from "class-validator";
import { ToArray } from "../../common/http/dto-helpers";

export const SEARCH_TYPES = ["incoming-inspection", "injector-test", "injector-repair", "supplier", "part", "supplier-part", "project", "document", "qualification", "change-request", "ncr", "scar", "deviation"] as const;

export class SearchQuery {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(100) q: string;
  @ApiPropertyOptional({ enum: SEARCH_TYPES, isArray: true }) @IsOptional() @ToArray() @IsIn([...SEARCH_TYPES], { each: true }) types?: string[];
  @ApiPropertyOptional({ minimum: 1, maximum: 20, default: 6 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) limit?: number;
}

export class ReportQuery {
  @ApiPropertyOptional({ isArray: true, description: "Status filter (report specific)" }) @IsOptional() @ToArray() @IsString({ each: true }) @MaxLength(40, { each: true }) status?: string[];
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional({ description: "Look-ahead window in days (expiring certifications)" }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(730) days?: number;
}
