import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { REQUIREMENT_LEVEL } from "@sqms/shared";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { EmptyToNull, IsDateOnly, ToArray } from "../../common/http/dto-helpers";
import { PageQueryDto } from "../../common/http/pagination";

const ROLE_KEY = /^[A-Z][A-Z0-9_]{1,59}$/;

// ------------------------------------------------------------------ users & invitations

export class UserListQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: ["INTERNAL", "EXTERNAL"] }) @IsOptional() @IsIn(["INTERNAL", "EXTERNAL"]) userType?: "INTERNAL" | "EXTERNAL";
  @ApiPropertyOptional({ enum: ["INVITED", "ACTIVE", "DISABLED"], isArray: true }) @IsOptional() @ToArray() @IsIn(["INVITED", "ACTIVE", "DISABLED"], { each: true }) status?: string[];
  @ApiPropertyOptional() @IsOptional() @IsUUID() organizationId?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(ROLE_KEY) roleKey?: string;
}

export class UpdateUserDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(160) displayName?: string;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(120) jobTitle?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(120) department?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(40) phone?: string | null;
}

export class UserStatusDto {
  @ApiProperty({ enum: ["ACTIVE", "DISABLED"] }) @IsIn(["ACTIVE", "DISABLED"]) status: "ACTIVE" | "DISABLED";
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(500) reason: string;
}

export class UserRolesDto {
  @ApiPropertyOptional({ description: "Organization membership to update (defaults to the user's only membership)" }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(20) @Matches(ROLE_KEY, { each: true }) roleKeys: string[];
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(500) reason: string;
}

export class InviteUserDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(160) displayName?: string;
  @ApiPropertyOptional({ description: "Defaults to the internal organization; supplier organizations require the supplier portal" }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @Matches(ROLE_KEY, { each: true }) roleKeys: string[];
}

export class InvitationListQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: ["PENDING", "ACCEPTED", "REVOKED", "EXPIRED"], isArray: true }) @IsOptional() @ToArray() @IsIn(["PENDING", "ACCEPTED", "REVOKED", "EXPIRED"], { each: true }) status?: string[];
}

// ------------------------------------------------------------------ roles & permissions

export class CreateRoleDto {
  @ApiProperty() @Matches(ROLE_KEY) key: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiProperty({ enum: ["INTERNAL", "EXTERNAL"] }) @IsIn(["INTERNAL", "EXTERNAL"]) scope: "INTERNAL" | "EXTERNAL";
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) permissionKeys: string[];
}

export class RolePermissionsDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) permissionKeys: string[];
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(500) reason: string;
}

// ------------------------------------------------------------------ settings, numbering, file types, retention

export class UpdateSettingDto {
  @ApiProperty({ description: "New JSON value (validated per setting)" }) @IsDefined() value: unknown;
}

export class UpdateNumberingDto {
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z0-9]{1,10}$/) prefix?: string;
  @ApiPropertyOptional({ example: "{prefix}-{yyyy}-{seq}" }) @IsOptional() @IsString() @MaxLength(60) pattern?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(10) padding?: number;
}

export class UpdateFileTypeDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional({ description: "Per-type size limit in MB (null = global limit)" }) @IsOptional() @EmptyToNull() @IsInt() @Min(1) @Max(2048) maxSizeMb?: number | null;
}

export class UpdateRetentionPolicyDto {
  @ApiPropertyOptional({ enum: ["FROM_CREATION", "FROM_RELEASE", "FROM_SUPERSESSION", "FROM_CLOSURE", "UNDEFINED"] })
  @IsOptional()
  @IsIn(["FROM_CREATION", "FROM_RELEASE", "FROM_SUPERSESSION", "FROM_CLOSURE", "UNDEFINED"])
  trigger?: "FROM_CREATION" | "FROM_RELEASE" | "FROM_SUPERSESSION" | "FROM_CLOSURE" | "UNDEFINED";
  @ApiPropertyOptional({ description: "Company-defined retention period in months (null = not defined)" }) @IsOptional() @EmptyToNull() @IsInt() @Min(1) @Max(1200) retentionMonths?: number | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(120) dispositionAction?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(5000) description?: string | null;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(500) reason: string;
}

// ------------------------------------------------------------------ workflow definitions

export class WorkflowStepInputDto {
  @ApiProperty() @IsInt() @Min(1) @Max(20) stepOrder: number;
  @ApiProperty() @Matches(/^[a-z][a-z0-9-]{1,79}$/) key: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(200) name: string;
  @ApiProperty({ enum: ["ROLE", "USER", "RECORD_OWNER"] }) @IsIn(["ROLE", "USER", "RECORD_OWNER"]) approverType: "ROLE" | "USER" | "RECORD_OWNER";
  @ApiPropertyOptional() @IsOptional() @Matches(ROLE_KEY) approverRoleKey?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() approverUserId?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(10) requiredApprovals?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(365) dueInDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(365) escalateAfterDays?: number;
  @ApiPropertyOptional() @IsOptional() @Matches(ROLE_KEY) escalateToRoleKey?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowDelegation?: boolean;
  @ApiPropertyOptional({ description: "Condition on the subject context, e.g. {field: riskLevel, op: gte, value: HIGH}" }) @IsOptional() @IsObject() condition?: Record<string, unknown>;
}

export class PublishWorkflowDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(200) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @ApiProperty({ type: [WorkflowStepInputDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => WorkflowStepInputDto) steps: WorkflowStepInputDto[];
}

// ------------------------------------------------------------------ applicability policies

export class PolicyRuleInputDto {
  @ApiProperty({ example: "VAL-02" }) @Matches(/^[A-Z]{3}-\d{2}$/) documentTypeCode: string;
  @ApiProperty({ enum: REQUIREMENT_LEVEL }) @IsIn([...REQUIREMENT_LEVEL]) outcome: (typeof REQUIREMENT_LEVEL)[number];
  @ApiProperty() @IsInt() @Min(0) @Max(1000) priority: number;
  @ApiProperty({ description: "Condition tree; {} matches always" }) @IsObject() conditions: Record<string, unknown>;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(500) reason: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(730) dueOffsetDays?: number;
  @ApiPropertyOptional() @IsOptional() @Matches(ROLE_KEY) defaultAssigneeRoleKey?: string;
}

export class CreatePolicyVersionDto {
  @ApiPropertyOptional({ description: "Copy rules from this version (defaults to the active version)" }) @IsOptional() @IsUUID() fromVersionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) notes?: string;
}

export class ReplacePolicyRulesDto {
  @ApiProperty({ type: [PolicyRuleInputDto] }) @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => PolicyRuleInputDto) rules: PolicyRuleInputDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) notes?: string;
}

export class ActivatePolicyDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(1000) reason: string;
}

export class EvaluatePolicyDto {
  @ApiPropertyOptional({ description: "Version to evaluate (defaults to the active version)" }) @IsOptional() @IsUUID() versionId?: string;
  @ApiProperty({ description: "Applicability context (pathway, riskLevel, criticality, supplierStatus, engineeringOwnership, reverseEngineering, specialProcesses, customerRequirements)" })
  @IsObject()
  context: Record<string, unknown>;
}

// ------------------------------------------------------------------ audit

export class AuditQuery extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) entityType?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() entityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() actorUserId?: string;
  @ApiPropertyOptional({ description: "Exact event type or prefix ending with a dot, e.g. auth." }) @IsOptional() @IsString() @MaxLength(100) eventType?: string;
  @ApiPropertyOptional({ enum: ["SUCCESS", "FAILURE", "DENIED"] }) @IsOptional() @IsIn(["SUCCESS", "FAILURE", "DENIED"]) outcome?: "SUCCESS" | "FAILURE" | "DENIED";
  @IsDateOnly(true) from?: string;
  @IsDateOnly(true) to?: string;
}
