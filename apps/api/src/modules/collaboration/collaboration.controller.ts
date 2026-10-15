import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiOperation, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { IsOptional, IsString, Matches, MaxLength } from "class-validator";
import { DbService } from "../../common/db/db.service";
import { PERMISSIONS as P } from "@sqms/shared";
import type { Actor } from "../../common/auth/actor";
import { AudienceScope, CurrentActor, RequirePermissions } from "../../common/auth/decorators";
import { PageQueryDto } from "../../common/http/pagination";
import {
  CreateCommentDto,
  CreateSavedViewDto,
  CreateTaskDto,
  EntityRefQuery,
  NotificationListQuery,
  SavedViewQuery,
  TaskListQuery,
  UpdateCommentDto,
  UpdatePreferencesDto,
  UpdateSavedViewDto,
  UpdateTaskDto,
} from "./collaboration.dto";
import { CollaborationService } from "./collaboration.service";
import { TasksService } from "./tasks.service";

class ActivityQuery extends PageQueryDto {}

@ApiTags("tasks")
@Controller("tasks")
@AudienceScope("any")
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @RequirePermissions(P.TASK_READ)
  @ApiOperation({ summary: "Tasks assigned to me / my roles (scope=mine), created by me, or all (internal)" })
  list(@CurrentActor() actor: Actor, @Query() q: TaskListQuery) {
    return this.tasks.list(actor, q);
  }

  @Get("summary")
  @RequirePermissions(P.TASK_READ)
  summary(@CurrentActor() actor: Actor) {
    return this.tasks.summary(actor);
  }

  @Post()
  @AudienceScope("internal")
  @RequirePermissions(P.TASK_WRITE)
  create(@CurrentActor() actor: Actor, @Body() dto: CreateTaskDto) {
    return this.tasks.create(actor, dto);
  }

  @Patch(":id")
  @RequirePermissions(P.TASK_READ)
  @ApiOperation({ summary: "Update status, priority, due date or assignee (assignee, creator or coordinator)" })
  update(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateTaskDto) {
    return this.tasks.update(actor, id, dto);
  }
}

@ApiTags("comments")
@Controller("comments")
@AudienceScope("any")
export class CommentsController {
  constructor(private readonly collab: CollaborationService) {}

  @Get()
  @ApiOperation({ summary: "Comments on a record (internal comments are never returned to supplier users)" })
  list(@CurrentActor() actor: Actor, @Query() q: EntityRefQuery) {
    return this.collab.comments(actor, q.entityType, q.entityId);
  }

  @Post()
  create(@CurrentActor() actor: Actor, @Body() dto: CreateCommentDto) {
    return this.collab.addComment(actor, dto);
  }

  @Patch(":id")
  edit(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateCommentDto) {
    return this.collab.editComment(actor, id, dto.body);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.collab.deleteComment(actor, id);
  }
}

@ApiTags("activity")
@Controller("activity")
@AudienceScope("any")
export class ActivityController {
  constructor(private readonly collab: CollaborationService) {}

  @Get(":entityType/:entityId")
  @ApiOperation({ summary: "Activity timeline of a record (supplier, part and project timelines include related records)" })
  timeline(@CurrentActor() actor: Actor, @Param() ref: EntityRefQuery, @Query() q: ActivityQuery) {
    return this.collab.activity(actor, ref.entityType, ref.entityId, q);
  }
}

@ApiTags("notifications")
@Controller("notifications")
@AudienceScope("any")
export class NotificationsController {
  constructor(private readonly collab: CollaborationService) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Query() q: NotificationListQuery) {
    return this.collab.notifications(actor, q);
  }

  @Get("unread-count")
  unread(@CurrentActor() actor: Actor) {
    return this.collab.unreadCount(actor);
  }

  @Post("read-all")
  @HttpCode(200)
  readAll(@CurrentActor() actor: Actor) {
    return this.collab.markAllRead(actor);
  }

  @Post(":id/read")
  @HttpCode(200)
  read(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.collab.markRead(actor, id);
  }

  @Get("preferences")
  preferences(@CurrentActor() actor: Actor) {
    return this.collab.preferences(actor);
  }

  @Put("preferences")
  updatePreferences(@CurrentActor() actor: Actor, @Body() dto: UpdatePreferencesDto) {
    return this.collab.updatePreferences(actor, dto.items);
  }
}

@ApiTags("saved-views")
@Controller("saved-views")
@AudienceScope("any")
export class SavedViewsController {
  constructor(private readonly collab: CollaborationService) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Query() q: SavedViewQuery) {
    return this.collab.savedViews(actor, q.module);
  }

  @Post()
  create(@CurrentActor() actor: Actor, @Body() dto: CreateSavedViewDto) {
    return this.collab.createSavedView(actor, dto);
  }

  @Patch(":id")
  update(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateSavedViewDto) {
    return this.collab.updateSavedView(actor, id, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.collab.deleteSavedView(actor, id);
  }
}

class DirectoryQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z_]{2,60}$/) roleKey?: string;
}

/** Minimal internal user directory for people pickers (no administrative details). */
@ApiTags("directory")
@Controller("directory")
export class DirectoryController {
  constructor(private readonly db: DbService) {}

  @Get("users")
  @RequirePermissions(P.TASK_READ)
  async users(@Query() q: DirectoryQuery) {
    const term = q.q?.trim();
    const users = await this.db.client.user.findMany({
      where: {
        userType: "INTERNAL",
        status: "ACTIVE",
        ...(term ? { OR: [{ displayName: { contains: term } }, { email: { contains: term } }] } : {}),
        ...(q.roleKey ? { memberships: { some: { status: "ACTIVE", roles: { some: { role: { key: q.roleKey } } } } } } : {}),
      },
      orderBy: { displayName: "asc" },
      take: 50,
      select: { id: true, displayName: true, email: true, jobTitle: true, memberships: { where: { status: "ACTIVE" }, select: { roles: { select: { role: { select: { key: true } } } } } } },
    });
    return users.map(({ memberships, ...u }) => ({ ...u, roles: [...new Set(memberships.flatMap((m) => m.roles.map((r) => r.role.key)))] }));
  }
}
