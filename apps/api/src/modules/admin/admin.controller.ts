import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { PERMISSIONS as P } from "@sqms/shared";
import type { Response } from "express";
import type { Actor } from "../../common/auth/actor";
import { CurrentActor, RequirePermissions } from "../../common/auth/decorators";
import { AuditService } from "../../common/audit/audit.service";
import { sendCsv, toCsv } from "../../common/http/csv";
import {
  ActivatePolicyDto,
  AuditQuery,
  CreatePolicyVersionDto,
  CreateRoleDto,
  EvaluatePolicyDto,
  InvitationListQuery,
  InviteUserDto,
  PublishWorkflowDto,
  ReplacePolicyRulesDto,
  RolePermissionsDto,
  UpdateFileTypeDto,
  UpdateNumberingDto,
  UpdateRetentionPolicyDto,
  UpdateSettingDto,
  UpdateUserDto,
  UserListQuery,
  UserRolesDto,
  UserStatusDto,
} from "./admin.dto";
import { ConfigAdminService } from "./config-admin.service";
import { UsersAdminService } from "./users-admin.service";

@ApiTags("admin")
@Controller("admin")
export class AdminController {
  constructor(
    private readonly users: UsersAdminService,
    private readonly config: ConfigAdminService,
  ) {}

  // users & invitations ------------------------------------------------------

  @Get("users")
  @RequirePermissions(P.ADMIN_USERS)
  listUsers(@Query() q: UserListQuery) {
    return this.users.list(q);
  }

  @Get("users/:id")
  @RequirePermissions(P.ADMIN_USERS)
  getUser(@Param("id", ParseUUIDPipe) id: string) {
    return this.users.get(id);
  }

  @Patch("users/:id")
  @RequirePermissions(P.ADMIN_USERS)
  updateUser(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(actor, id, dto);
  }

  @Post("users/:id/status")
  @RequirePermissions(P.ADMIN_USERS)
  @ApiOperation({ summary: "Disable (revokes all sessions immediately) or re-enable a user" })
  setStatus(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UserStatusDto) {
    return this.users.setStatus(actor, id, dto.status, dto.reason);
  }

  @Post("users/:id/unlock")
  @RequirePermissions(P.ADMIN_USERS)
  unlock(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.users.unlock(actor, id);
  }

  @Post("users/:id/revoke-sessions")
  @RequirePermissions(P.ADMIN_USERS)
  revokeSessions(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.users.revokeSessions(actor, id);
  }

  @Put("users/:id/roles")
  @RequirePermissions(P.ADMIN_USERS, P.ADMIN_ROLES)
  setRoles(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UserRolesDto) {
    return this.users.setRoles(actor, id, dto.roleKeys, dto.reason, dto.organizationId);
  }

  @Get("invitations")
  @RequirePermissions(P.ADMIN_USERS)
  invitations(@Query() q: InvitationListQuery) {
    return this.users.listInvitations(q);
  }

  @Post("invitations")
  @RequirePermissions(P.ADMIN_USERS)
  @ApiOperation({ summary: "Invite a user by email (the invitation link is only delivered by email)" })
  invite(@CurrentActor() actor: Actor, @Body() dto: InviteUserDto) {
    return this.users.invite(actor, dto);
  }

  @Post("invitations/:id/revoke")
  @RequirePermissions(P.ADMIN_USERS)
  revokeInvitation(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.users.revokeInvitation(actor, id);
  }

  // roles & permissions ------------------------------------------------------

  @Get("roles")
  @RequirePermissions(P.ADMIN_ROLES)
  roles() {
    return this.users.roles();
  }

  @Get("permissions")
  @RequirePermissions(P.ADMIN_ROLES)
  permissions() {
    return this.users.permissions();
  }

  @Post("roles")
  @RequirePermissions(P.ADMIN_ROLES)
  createRole(@CurrentActor() actor: Actor, @Body() dto: CreateRoleDto) {
    return this.users.createRole(actor, dto);
  }

  @Put("roles/:id/permissions")
  @RequirePermissions(P.ADMIN_ROLES)
  @ApiOperation({ summary: "Replace a role's permissions (internal-only permissions can never be granted to supplier roles)" })
  setRolePermissions(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: RolePermissionsDto) {
    return this.users.setRolePermissions(actor, id, dto.permissionKeys, dto.reason);
  }

  // settings, numbering, file types, retention ----------------------------------

  @Get("settings")
  @RequirePermissions(P.ADMIN_SETTINGS)
  settings() {
    return this.config.listSettings();
  }

  @Put("settings/:key")
  @RequirePermissions(P.ADMIN_SETTINGS)
  updateSetting(@CurrentActor() actor: Actor, @Param("key") key: string, @Body() dto: UpdateSettingDto) {
    return this.config.updateSetting(actor, key, dto.value);
  }

  @Get("numbering")
  @RequirePermissions(P.ADMIN_SETTINGS)
  numbering() {
    return this.config.listNumbering();
  }

  @Patch("numbering/:key")
  @RequirePermissions(P.ADMIN_SETTINGS)
  updateNumbering(@CurrentActor() actor: Actor, @Param("key") key: string, @Body() dto: UpdateNumberingDto) {
    return this.config.updateNumbering(actor, key, dto);
  }

  @Get("file-types")
  @RequirePermissions(P.ADMIN_SETTINGS)
  fileTypes() {
    return this.config.listFileTypes();
  }

  @Patch("file-types/:id")
  @RequirePermissions(P.ADMIN_SETTINGS)
  updateFileType(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateFileTypeDto) {
    return this.config.updateFileType(actor, id, dto);
  }

  @Get("retention-policies")
  @RequirePermissions(P.ADMIN_SETTINGS)
  retention() {
    return this.config.listRetentionPolicies();
  }

  @Patch("retention-policies/:id")
  @RequirePermissions(P.ADMIN_SETTINGS)
  @ApiOperation({ summary: "Record the company-defined retention period (the system does not assume legal periods)" })
  updateRetention(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateRetentionPolicyDto) {
    return this.config.updateRetentionPolicy(actor, id, dto);
  }

  // workflow definitions -------------------------------------------------------

  @Get("workflows")
  @RequirePermissions(P.ADMIN_WORKFLOWS)
  workflows() {
    return this.config.listWorkflows();
  }

  @Post("workflows/:key/versions")
  @RequirePermissions(P.ADMIN_WORKFLOWS)
  @ApiOperation({ summary: "Publish a new workflow version (running approvals keep their version)" })
  publishWorkflow(@CurrentActor() actor: Actor, @Param("key") key: string, @Body() dto: PublishWorkflowDto) {
    return this.config.publishWorkflow(actor, key, dto);
  }

  // applicability policies -----------------------------------------------------

  @Get("applicability-policies")
  @RequirePermissions(P.ADMIN_POLICIES)
  policies() {
    return this.config.listPolicies();
  }

  @Get("applicability-policies/versions/:id")
  @RequirePermissions(P.ADMIN_POLICIES)
  policyVersion(@Param("id", ParseUUIDPipe) id: string) {
    return this.config.getPolicyVersion(id);
  }

  @Post("applicability-policies/:policyId/versions")
  @RequirePermissions(P.ADMIN_POLICIES)
  @ApiOperation({ summary: "Create a draft policy version (copied from the active version by default)" })
  createPolicyVersion(@CurrentActor() actor: Actor, @Param("policyId", ParseUUIDPipe) policyId: string, @Body() dto: CreatePolicyVersionDto) {
    return this.config.createPolicyVersion(actor, policyId, dto.fromVersionId, dto.notes);
  }

  @Put("applicability-policies/versions/:id/rules")
  @RequirePermissions(P.ADMIN_POLICIES)
  replaceRules(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ReplacePolicyRulesDto) {
    return this.config.replaceRules(actor, id, dto.rules, dto.notes);
  }

  @Post("applicability-policies/versions/:id/activate")
  @RequirePermissions(P.ADMIN_POLICIES)
  activatePolicy(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ActivatePolicyDto) {
    return this.config.activatePolicyVersion(actor, id, dto.reason);
  }

  @Post("applicability-policies/evaluate")
  @RequirePermissions(P.ADMIN_POLICIES)
  @ApiOperation({ summary: "Preview the requirements a policy version generates for a context" })
  evaluate(@Body() dto: EvaluatePolicyDto) {
    return this.config.evaluatePolicy(dto.versionId, dto.context);
  }
}

@ApiTags("audit")
@Controller("audit")
export class AuditController {
  constructor(
    private readonly config: ConfigAdminService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions(P.AUDIT_READ)
  @ApiOperation({ summary: "Query the append-only audit trail (no update or delete operations exist)" })
  list(@Query() q: AuditQuery) {
    return this.config.auditEvents(q);
  }

  @Get("export.csv")
  @RequirePermissions(P.AUDIT_READ, P.REPORT_EXPORT)
  async export(@Query() q: AuditQuery, @Res() res: Response) {
    const rows = await this.config.auditExportRows(q);
    await this.audit.record({ eventType: "export.audit", metadata: { rows: rows.length, filters: { ...q } } });
    sendCsv(
      res,
      "audit-trail.csv",
      toCsv(rows, [
        { header: "Occurred (UTC)", value: (r) => r.occurredAt.toISOString() },
        { header: "Event", value: (r) => r.eventType },
        { header: "Outcome", value: (r) => r.outcome },
        { header: "Actor", value: (r) => r.actorEmail ?? r.actorType },
        { header: "Entity type", value: (r) => r.entityType },
        { header: "Entity", value: (r) => r.entityLabel ?? r.entityId },
        { header: "Reason", value: (r) => r.reason },
        { header: "Changes", value: (r) => (r.changes ? JSON.stringify(r.changes) : "") },
        { header: "IP", value: (r) => r.ipAddress },
        { header: "Correlation", value: (r) => r.correlationId },
      ]),
    );
  }
}
