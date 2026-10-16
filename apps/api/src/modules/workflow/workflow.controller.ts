import { AuthorizeInService } from "../../common/auth/decorators";
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import type { WorkflowSubjectType } from "@sqms/db";
import { Transform } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from "class-validator";
import type { Actor } from "../../common/auth/actor";
import { CurrentActor, RequirePermissions } from "../../common/auth/decorators";
import { EntityAccessService } from "../entity/entity-access.service";
import { SUBJECT_ENTITY, WorkflowService } from "./workflow.service";

const SUBJECT_TYPES = Object.keys(SUBJECT_ENTITY) as WorkflowSubjectType[];

class DecisionDto {
  @ApiProperty({ enum: ["APPROVE", "REJECT", "REQUEST_INFO"] })
  @IsIn(["APPROVE", "REJECT", "REQUEST_INFO"])
  decision: "APPROVE" | "REJECT" | "REQUEST_INFO";

  @ApiPropertyOptional({ description: "Required for REJECT and REQUEST_INFO" })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  comment?: string;

  @ApiPropertyOptional({ description: "Optimistic concurrency token from the inbox item" })
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedVersion?: number;
}

class ReassignDto {
  @ApiProperty()
  @IsUUID()
  toUserId: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

class InboxQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === "true" || value === true)
  @IsBoolean()
  overdue?: boolean;
}

class HistoryQuery {
  @ApiProperty({ enum: SUBJECT_TYPES })
  @IsIn(SUBJECT_TYPES)
  subjectType: WorkflowSubjectType;

  @ApiProperty()
  @IsUUID()
  subjectId: string;
}

@ApiTags("approvals")
@Controller("approvals")
export class WorkflowController {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly access: EntityAccessService,
  ) {}

  @Get("inbox")
  @RequirePermissions("task:read")
  @ApiOperation({ summary: "Pending approvals assigned to the current user or their roles" })
  inbox(@CurrentActor() actor: Actor, @Query() q: InboxQuery) {
    return this.workflow.inbox(actor, { overdue: q.overdue });
  }

  @Get("recent")
  @RequirePermissions("task:read")
  @ApiOperation({ summary: "Decisions recently recorded by the current user" })
  recent(@CurrentActor() actor: Actor) {
    return this.workflow.recentDecisions(actor);
  }

  @Get("history")
  @AuthorizeInService()
  @ApiOperation({ summary: "Complete approval history of a record (who approved what, when, and which revision)" })
  async history(@CurrentActor() actor: Actor, @Query() q: HistoryQuery) {
    await this.access.assertReadable(actor, SUBJECT_ENTITY[q.subjectType], q.subjectId);
    return this.workflow.history(q.subjectType, q.subjectId);
  }

  @Post(":id/decision")
  @RequirePermissions("approval:decide")
  @ApiOperation({ summary: "Approve, reject or request information on an assigned approval" })
  decide(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: DecisionDto) {
    return this.workflow.decide(actor, id, dto.decision, dto.comment, dto.expectedVersion);
  }

  @Post(":id/reassign")
  @ApiOperation({ summary: "Delegate or reassign a pending approval (assignee delegation or approval:reassign)" })
  reassign(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ReassignDto) {
    return this.workflow.reassign(actor, id, dto.toUserId, dto.reason);
  }
}
