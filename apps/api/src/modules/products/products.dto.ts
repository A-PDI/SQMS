import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { DESIGN_OWNERSHIP, PART_CRITICALITY, PART_STATUS, SUPPLIER_PRODUCT_STATUS } from "@sqms/shared";
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";
import { EmptyToNull, ExpectedVersion, ToArray } from "../../common/http/dto-helpers";
import { PageQueryDto } from "../../common/http/pagination";

export class CreatePartDto {
  @ApiProperty({ example: "TC-4711-HD" }) @IsString() @MinLength(2) @MaxLength(60) partNumber: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(500) description: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) application?: string;
  @ApiPropertyOptional({ default: "EA" }) @IsOptional() @IsString() @MaxLength(12) unitOfMeasure?: string;
  @ApiPropertyOptional({ enum: PART_CRITICALITY }) @IsOptional() @IsIn([...PART_CRITICALITY]) criticality?: (typeof PART_CRITICALITY)[number];
  @ApiPropertyOptional({ enum: DESIGN_OWNERSHIP }) @IsOptional() @IsIn([...DESIGN_OWNERSHIP]) designOwnership?: (typeof DESIGN_OWNERSHIP)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) engineeringRevision?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) notes?: string;
}

export class UpdatePartDto {
  @ExpectedVersion() expectedVersion: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(500) description?: string;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsUUID() categoryId?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(5000) application?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(12) unitOfMeasure?: string;
  @ApiPropertyOptional({ enum: PART_CRITICALITY }) @IsOptional() @IsIn([...PART_CRITICALITY]) criticality?: (typeof PART_CRITICALITY)[number];
  @ApiPropertyOptional({ enum: PART_STATUS }) @IsOptional() @IsIn([...PART_STATUS]) status?: (typeof PART_STATUS)[number];
  @ApiPropertyOptional({ enum: DESIGN_OWNERSHIP }) @IsOptional() @IsIn([...DESIGN_OWNERSHIP]) designOwnership?: (typeof DESIGN_OWNERSHIP)[number];
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(20) engineeringRevision?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(10000) notes?: string | null;
}

export class PartListQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: PART_STATUS, isArray: true }) @IsOptional() @ToArray() @IsIn([...PART_STATUS], { each: true }) status?: string[];
  @ApiPropertyOptional({ enum: PART_CRITICALITY, isArray: true }) @IsOptional() @ToArray() @IsIn([...PART_CRITICALITY], { each: true }) criticality?: string[];
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional({ description: "Only parts sourced from this supplier" }) @IsOptional() @IsUUID() supplierId?: string;
}

export class OemReferenceDto {
  @ApiProperty({ example: "Cummins" }) @IsString() @MinLength(1) @MaxLength(120) oemName: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(80) oemPartNumber: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class CreateSupplierPartDto {
  @ApiProperty() @IsUUID() supplierId: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(80) supplierPartNumber: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(500) description: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) supplierRevision?: string;
  @ApiPropertyOptional({ enum: DESIGN_OWNERSHIP }) @IsOptional() @IsIn([...DESIGN_OWNERSHIP]) designOwnership?: (typeof DESIGN_OWNERSHIP)[number];
  @ApiPropertyOptional({ description: "Distinct part number assigned to a custom configuration" }) @IsOptional() @IsBoolean() isCustom?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) notes?: string;
}

export class UpdateSupplierPartDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(500) description?: string;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(20) supplierRevision?: string | null;
  @ApiPropertyOptional({ enum: ["ACTIVE", "INACTIVE", "OBSOLETE"] }) @IsOptional() @IsIn(["ACTIVE", "INACTIVE", "OBSOLETE"]) status?: "ACTIVE" | "INACTIVE" | "OBSOLETE";
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(10000) notes?: string | null;
}

export class SupplierPartListQuery extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
}

export class CrossReferenceDto {
  @ApiProperty() @IsUUID() internalPartId: string;
  @ApiProperty() @IsUUID() supplierPartId: string;
  @ApiPropertyOptional({ enum: ["EQUIVALENT", "CUSTOM_CONFIGURATION", "ALTERNATE"] }) @IsOptional() @IsIn(["EQUIVALENT", "CUSTOM_CONFIGURATION", "ALTERNATE"]) type?: "EQUIVALENT" | "CUSTOM_CONFIGURATION" | "ALTERNATE";
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class CreateSupplierProductDto {
  @ApiProperty() @IsUUID() internalPartId: string;
  @ApiProperty() @IsUUID() supplierPartId: string;
  @ApiProperty({ description: "Manufacturing site" }) @IsUUID() siteId: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPreferred?: boolean;
}

export const DIRECT_SUPPLIER_PRODUCT_STATUSES = ["SUSPENDED", "DISQUALIFIED", "INACTIVE"] as const;

export class SupplierProductStatusDto {
  @ApiProperty({ enum: DIRECT_SUPPLIER_PRODUCT_STATUSES }) @IsIn([...DIRECT_SUPPLIER_PRODUCT_STATUSES]) status: (typeof DIRECT_SUPPLIER_PRODUCT_STATUSES)[number];
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(1000) reason: string;
}

export class SupplierProductListQuery extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() internalPartId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() siteId?: string;
  @ApiPropertyOptional({ enum: SUPPLIER_PRODUCT_STATUS, isArray: true }) @IsOptional() @ToArray() @IsIn([...SUPPLIER_PRODUCT_STATUS], { each: true }) status?: string[];
}

export class ProductApprovalQuery extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() internalPartId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional({ enum: ["ACTIVE", "SUPERSEDED", "SUSPENDED", "REVOKED"], isArray: true }) @IsOptional() @ToArray() @IsIn(["ACTIVE", "SUPERSEDED", "SUSPENDED", "REVOKED"], { each: true }) status?: string[];
}
