import { AuthorizeInService } from "../../common/auth/decorators";
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { AppEnv } from "@sqms/server-core";
import type { CookieOptions, Request, Response } from "express";
import { APP_ENV } from "../../infra/tokens";
import type { Actor } from "../../common/auth/actor";
import { AudienceScope, CurrentActor, Public, type AuthenticatedRequest } from "../../common/auth/decorators";
import { AcceptInvitationDto, ChangePasswordDto, LoginDto, PasswordResetConfirmDto, PasswordResetRequestDto, UpdateProfileDto } from "./auth.dto";
import { AuthService } from "./auth.service";

@ApiTags("auth")
@Controller("auth")
@AudienceScope("any")
@AuthorizeInService()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  private cookieBase(): CookieOptions {
    return { secure: this.env.COOKIE_SECURE, path: "/" };
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: "Sign in with email and password (sets HttpOnly session cookie and CSRF cookie)" })
  async login(@Body() dto: LoginDto, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto.email, dto.password, req.ip ?? null, req.header("user-agent") ?? null);
    // Signing in on a browser that still holds a session ends that session (no parallel identities per browser).
    if (req.actor) await this.auth.logout(req.actor);
    res.cookie(this.env.SESSION_COOKIE_NAME, result.token, { ...this.cookieBase(), httpOnly: true, sameSite: "lax", expires: result.expiresAt });
    res.cookie(this.env.CSRF_COOKIE_NAME, result.csrfToken, { ...this.cookieBase(), httpOnly: false, sameSite: "strict", expires: result.expiresAt });
    return { csrfToken: result.csrfToken };
  }

  @Post("logout")
  @HttpCode(204)
  @ApiOperation({ summary: "Sign out and revoke the current session" })
  async logout(@CurrentActor() actor: Actor, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(actor);
    res.clearCookie(this.env.SESSION_COOKIE_NAME, this.cookieBase());
    res.clearCookie(this.env.CSRF_COOKIE_NAME, this.cookieBase());
  }

  @Get("me")
  @ApiOperation({ summary: "Current user, organization, roles, effective permissions and CSRF token" })
  me(@CurrentActor() actor: Actor) {
    return this.auth.me(actor);
  }

  @Patch("me")
  @ApiOperation({ summary: "Update own profile (display name, time zone, title, phone)" })
  updateMe(@CurrentActor() actor: Actor, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(actor, dto);
  }

  @Get("sessions")
  @ApiOperation({ summary: "List own active sessions" })
  sessions(@CurrentActor() actor: Actor) {
    return this.auth.listSessions(actor);
  }

  @Delete("sessions/:id")
  @HttpCode(204)
  @ApiOperation({ summary: "Revoke one of own sessions" })
  revokeSession(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.auth.revokeSession(actor, id);
  }

  @Post("sessions/revoke-others")
  @HttpCode(200)
  @ApiOperation({ summary: "Revoke all other sessions of the current user" })
  async revokeOthers(@CurrentActor() actor: Actor) {
    return { revoked: await this.auth.revokeOtherSessions(actor) };
  }

  @Post("password/change")
  @HttpCode(204)
  @ApiOperation({ summary: "Change own password (other sessions are revoked)" })
  changePassword(@CurrentActor() actor: Actor, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(actor, dto.currentPassword, dto.newPassword);
  }

  @Public()
  @Post("password-reset/request")
  @HttpCode(202)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Request a password reset email (always returns 202)" })
  async requestReset(@Body() dto: PasswordResetRequestDto, @Req() req: Request) {
    await this.auth.requestPasswordReset(dto.email, req.ip ?? null);
    return { accepted: true };
  }

  @Public()
  @Post("password-reset/confirm")
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Set a new password using a reset token" })
  confirmReset(@Body() dto: PasswordResetConfirmDto) {
    return this.auth.confirmPasswordReset(dto.token, dto.newPassword);
  }

  @Public()
  @Get("invitations/lookup")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: "Describe an invitation by token" })
  describeInvitation(@Query("token") token: string) {
    return this.auth.describeInvitation(String(token ?? ""));
  }

  @Public()
  @Post("invitations/accept")
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Accept an invitation and set a password" })
  acceptInvitation(@Body() dto: AcceptInvitationDto) {
    return this.auth.acceptInvitation(dto.token, dto.password, dto.displayName);
  }
}
