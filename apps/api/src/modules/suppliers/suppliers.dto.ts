import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { SUPPLIER_QUALIFICATION_TYPE, SUPPLIER_STATUS } from "@sqms/shared";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsISO31661Alpha2,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { PageQueryDto } from "../../common/http/pagination";
import { EmptyToNull, ExpectedVersion, IsDateOnly, ToArray } from "../../common/http/dto-helpers";

export class AddressDto {
  @ApiProperty({ enum: ["LEGAL", "MAILING", "BILLING", "SHIPPING"] })
  @IsIn(["LEGAL", "MAILING", "BILLING", "SHIPPING"])
  type: "LEGAL" | "MAILING" | "BILLING" | "SHIPPING";

  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) line1: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) line2?: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) city: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) region?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) postalCode?: string;
  @ApiProperty({ example: "US" }) @IsISO31661Alpha2() country: string;
}

export class SiteDto {
  @ApiProperty({ example: "PLANT-01" }) @IsString() @MinLength(1) @MaxLength(40) siteCode: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) line1?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) line2?: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) city: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) region?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) postalCode?: string;
  @ApiProperty() @IsISO31661Alpha2() country: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isManufacturing?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) processes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) notes?: string;
}

export class UpdateSiteDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(200) line1?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(200) line2?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(120) city?: string;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(120) region?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(20) postalCode?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsISO31661Alpha2() country?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isManufacturing?: boolean;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(5000) processes?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(5000) notes?: string | null;
}

export class ContactDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(160) name: string;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(120) title?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsEmail() @MaxLength(254) email?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(40) phone?: string | null;
  @ApiPropertyOptional({ example: "Quality" }) @IsOptional() @EmptyToNull() @IsString() @MaxLength(80) role?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPrimary?: boolean;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsUUID() siteId?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(1000) notes?: string | null;
}

export class CreateSupplierDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(200) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(250) legalName?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl({ require_protocol: true, protocols: ["http", "https"] }) @MaxLength(300) website?: string;
  @ApiProperty({ example: "DE" }) @IsISO31661Alpha2() country: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) dunsNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) taxId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) notes?: string;

  @ApiPropertyOptional({ type: [AddressDto] })
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => AddressDto)
  addresses?: AddressDto[];

  @ApiPropertyOptional({ type: [SiteDto] })
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => SiteDto)
  sites?: SiteDto[];

  @ApiPropertyOptional({ type: [ContactDto] })
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ContactDto)
  contacts?: ContactDto[];

  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayUnique() @IsUUID("all", { each: true }) capabilityIds?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayUnique() @IsUUID("all", { each: true }) categoryIds?: string[];
}

export class UpdateSupplierDto {
  @ExpectedVersion() expectedVersion: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(200) name?: string;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(250) legalName?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsUrl({ require_protocol: true, protocols: ["http", "https"] }) @MaxLength(300) website?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsISO31661Alpha2() country?: string;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(20) dunsNumber?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(40) taxId?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(10000) notes?: string | null;
}

export class SetAddressesDto {
  @ApiProperty({ type: [AddressDto] })
  @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => AddressDto)
  addresses: AddressDto[];
}

export class SetIdsDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsUUID("all", { each: true }) ids: string[];
}

/** Direct status changes are limited to risk actions; approvals require a supplier qualification. */
export const DIRECT_SUPPLIER_STATUSES = ["PROSPECTIVE", "UNDER_EVALUATION", "SUSPENDED", "INACTIVE"] as const;

export class ChangeStatusDto {
  @ApiProperty({ enum: DIRECT_SUPPLIER_STATUSES }) @IsIn([...DIRECT_SUPPLIER_STATUSES]) status: (typeof DIRECT_SUPPLIER_STATUSES)[number];
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(1000) reason: string;
}

export class CertificationDto {
  @ApiProperty({ example: "IATF 16949" }) @IsString() @MinLength(2) @MaxLength(80) standard: string;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(80) certificateNumber?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(160) registrar?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(1000) scope?: string | null;
  @IsDateOnly(true) issuedAt?: string;
  @IsDateOnly(true) expiresAt?: string;
  @ApiPropertyOptional({ enum: ["PENDING_VERIFICATION", "VALID", "EXPIRED", "REVOKED"] }) @IsOptional() @IsIn(["PENDING_VERIFICATION", "VALID", "EXPIRED", "REVOKED"]) status?: "PENDING_VERIFICATION" | "VALID" | "EXPIRED" | "REVOKED";
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsUUID() siteId?: string | null;
  @ApiPropertyOptional({ description: "Document record holding the certificate" }) @IsOptional() @EmptyToNull() @IsUUID() documentId?: string | null;
}

export class SupplierListQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: SUPPLIER_STATUS, isArray: true })
  @IsOptional() @ToArray() @IsIn([...SUPPLIER_STATUS], { each: true })
  status?: string[];

  @ApiPropertyOptional() @IsOptional() @IsISO31661Alpha2() country?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() capabilityId?: string;
}

export class CreateSupplierQualificationDto {
  @ApiProperty({ enum: SUPPLIER_QUALIFICATION_TYPE }) @IsIn([...SUPPLIER_QUALIFICATION_TYPE]) type: (typeof SUPPLIER_QUALIFICATION_TYPE)[number];
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsUUID() siteId?: string | null;
  @ApiProperty({ enum: ["APPROVED", "CONDITIONALLY_APPROVED"] }) @IsIn(["APPROVED", "CONDITIONALLY_APPROVED"]) proposedStatus: "APPROVED" | "CONDITIONALLY_APPROVED";
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) scope?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20000) summary?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) auditScore?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) conditions?: string;
  @IsDateOnly(true) validUntil?: string;
}

export class UpdateSupplierQualificationDto {
  @ExpectedVersion() expectedVersion: number;
  @ApiPropertyOptional({ enum: ["APPROVED", "CONDITIONALLY_APPROVED"] }) @IsOptional() @IsIn(["APPROVED", "CONDITIONALLY_APPROVED"]) proposedStatus?: "APPROVED" | "CONDITIONALLY_APPROVED";
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(1000) scope?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(20000) summary?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) auditScore?: number | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(10000) conditions?: string | null;
  @IsDateOnly(true) validUntil?: string;
}
