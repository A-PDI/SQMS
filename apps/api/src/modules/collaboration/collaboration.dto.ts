import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { PRIORITY, TASK_STATUS } from "@sqms/shared";
import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsISO8601, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateNested } from "class-validator";
import { EmptyToNull, ToArray, ToBoolean } from "../../common/http/dto-helpers";
import { PageQueryDto } from "../../common/http/pagination";

/** Entity types that support comments, activity timelines and tasks (resolved by EntityAccessService). */
export const COLLAB_ENTITY_TYPES = [
  "SUPPLIER", "SUPPLIER_SITE", "INTERNAL_PART", "SUPPLIER_PART", "SUPPLIER_PRODUCT", "PRODUCT_CONFIGURATION", "CONFIGURATION_REVISION", "SOURCING_PROJECT",
  "DOCUMENT", "DOCUMENT_REVISION", "SUPPLIER_QUALIFICATION", "PRODUCT_QUALIFICATION", "CHANGE_REQUEST", "DEVIATION", "NCR", "SCAR", "FIRST_ARTICLE_INSPECTION",
] as const;
export type CollabEntityType = (typeof COLLAB_ENTITY_TYPES)[number];
const MANUAL_TASK_TYPES = ["ACTION", "REVIEW", "INFO_REQUEST", "FOLLOW_UP"] as const;

export class EntityRefQuery {
  @ApiProperty({ enum: COLLAB_ENTITY_TYPES }) @IsIn([...COLLAB_ENTITY_TYPES]) entityType: CollabEntityType;
  @ApiProperty() @IsUUID() entityId: string;
}

// ------------------------------------------------------------------ tasks

export class TaskListQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: ["mine", "created", "all"], description: "mine = assigned to me or my roles (default)" }) @IsOptional() @IsIn(["mine", "created", "all"]) scope?: "mine" | "created" | "all";
  @ApiPropertyOptional({ enum: TASK_STATUS, isArray: true, description: "Defaults to open tasks" }) @IsOptional() @ToArray() @IsIn([...TASK_STATUS], { each: true }) status?: string[];
  @ApiPropertyOptional() @IsOptional() @ToArray() @IsString({ each: true }) type?: string[];
  @ApiPropertyOptional() @IsOptional() @ToBoolean() @IsBoolean() overdue?: boolean;
  @ApiPropertyOptional({ enum: COLLAB_ENTITY_TYPES }) @IsOptional() @IsIn([...COLLAB_ENTITY_TYPES]) entityType?: CollabEntityType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() entityId?: string;
}

export class CreateTaskDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(300) title: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) description?: string;
  @ApiProperty({ enum: MANUAL_TASK_TYPES }) @IsIn([...MANUAL_TASK_TYPES]) type: (typeof MANUAL_TASK_TYPES)[number];
  @ApiPropertyOptional({ enum: PRIORITY }) @IsOptional() @IsIn([...PRIORITY]) priority?: (typeof PRIORITY)[number];
  @ApiPropertyOptional() @IsOptional() @IsUUID() assigneeUserId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^[A-Z_]{2,60}$/) assigneeRoleKey?: string;
  @ApiPropertyOptional({ description: "ISO 8601 date-time (UTC)" }) @IsOptional() @IsISO8601({ strict: true }) dueAt?: string;
  @ApiPropertyOptional({ enum: COLLAB_ENTITY_TYPES }) @IsOptional() @IsIn([...COLLAB_ENTITY_TYPES]) entityType?: CollabEntityType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() entityId?: string;
}

export class UpdateTaskDto {
  @ApiPropertyOptional() @IsOptional() @IsIn([...TASK_STATUS]) status?: (typeof TASK_STATUS)[number];
  @ApiPropertyOptional({ enum: PRIORITY }) @IsOptional() @IsIn([...PRIORITY]) priority?: (typeof PRIORITY)[number];
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsUUID() assigneeUserId?: string | null;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsISO8601({ strict: true }) dueAt?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) description?: string;
}

// ------------------------------------------------------------------ comments

export class CreateCommentDto {
  @ApiProperty({ enum: COLLAB_ENTITY_TYPES }) @IsIn([...COLLAB_ENTITY_TYPES]) entityType: CollabEntityType;
  @ApiProperty() @IsUUID() entityId: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(10000) body: string;
  @ApiPropertyOptional({ enum: ["INTERNAL", "SUPPLIER"], description: "INTERNAL comments are never shown to supplier users (default INTERNAL for company users)" })
  @IsOptional()
  @IsIn(["INTERNAL", "SUPPLIER"])
  visibility?: "INTERNAL" | "SUPPLIER";
  @ApiPropertyOptional() @IsOptional() @IsUUID() parentId?: string;
}

export class UpdateCommentDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(10000) body: string;
}

// ------------------------------------------------------------------ notifications

export class NotificationListQuery extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @ToBoolean() @IsBoolean() unread?: boolean;
}

export class PreferenceItemDto {
  @ApiProperty({ description: 'Event type from the catalog, or "*" for all events' }) @IsString() @MaxLength(80) eventType: string;
  @ApiProperty({ enum: ["IN_APP", "EMAIL"] }) @IsIn(["IN_APP", "EMAIL"]) channel: "IN_APP" | "EMAIL";
  @ApiProperty() @IsBoolean() enabled: boolean;
}

export class UpdatePreferencesDto {
  @ApiProperty({ type: [PreferenceItemDto] }) @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => PreferenceItemDto) items: PreferenceItemDto[];
}

// ------------------------------------------------------------------ saved views (saved filters)

export class SavedViewQuery {
  @ApiProperty() @IsString() @Matches(/^[a-z][a-z0-9-]{1,59}$/) module: string;
}

export class CreateSavedViewDto {
  @ApiProperty() @IsString() @Matches(/^[a-z][a-z0-9-]{1,59}$/) module: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name: string;
  @ApiProperty() @IsObject() filters: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) sort?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isShared?: boolean;
}

export class UpdateSavedViewDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() filters?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @EmptyToNull() @IsString() @MaxLength(120) sort?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isShared?: boolean;
}
