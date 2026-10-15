import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AppEnv } from "@sqms/server-core";
import { APP_ENV } from "../../infra/tokens";
import { RequestContext } from "../context/request-context";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "../errors/app-errors";
import { csrfTokenValid } from "./csrf";
import { ANY_PERMISSIONS_KEY, AUDIENCE_KEY, PERMISSIONS_KEY, PUBLIC_KEY, type Audience, type AuthenticatedRequest } from "./decorators";
import { SessionService } from "./session.service";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Resolves the session cookie into an Actor and enforces authentication and audience (internal / external). */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = (req.cookies as Record<string, string> | undefined)?.[this.env.SESSION_COOKIE_NAME];
    if (token) {
      const actor = await this.sessions.resolve(token);
      if (actor) {
        req.actor = actor;
        RequestContext.setActor(actor);
      }
    }
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError();

    const audience = this.reflector.getAllAndOverride<Audience>(AUDIENCE_KEY, [ctx.getHandler(), ctx.getClass()]) ?? "internal";
    if (audience === "external") {
      // The supplier portal API does not exist while the feature flag is off.
      if (!this.env.SUPPLIER_PORTAL_ENABLED) throw new NotFoundError("Resource");
      if (actor.userType !== "EXTERNAL") throw new ForbiddenError("This endpoint is for supplier accounts");
    } else if (audience === "internal" && actor.userType !== "INTERNAL") {
      throw new ForbiddenError();
    }
    return true;
  }
}

/**
 * CSRF protection for cookie-authenticated requests:
 *  - unsafe methods must present X-CSRF-Token bound to the session (double-submit, HMAC of session id),
 *  - when an Origin/Referer header is present it must match an allowed application origin.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  private originAllowed(origin: string): boolean {
    if (this.env.APP_ORIGINS.length === 0) {
      // Development default: allow localhost origins only.
      return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    }
    return this.env.APP_ORIGINS.includes(origin);
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (SAFE_METHODS.has(req.method)) return true;
    const origin = req.header("origin");
    const referer = req.header("referer");
    const presentedOrigin = origin ?? (referer ? safeOrigin(referer) : undefined);
    if (presentedOrigin && !this.originAllowed(presentedOrigin)) throw new ForbiddenError("Cross-origin request rejected");
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic && req.actor) {
      // A public endpoint (e.g. signing in as someone else) does not act with the existing session's authority, so
      // its token is not required; an allowed Origin/Referer is mandatory instead (blocks login CSRF).
      if (!presentedOrigin) throw new ForbiddenError("Missing request origin");
      return true;
    }
    if (req.actor) {
      if (!csrfTokenValid(this.env.CSRF_SECRET, req.actor.sessionId, req.header("x-csrf-token"))) {
        throw new ForbiddenError("Missing or invalid CSRF token");
      }
    }
    return true;
  }
}

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** Enforces @RequirePermissions metadata against the actor's effective permissions. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndMerge<string[]>(PERMISSIONS_KEY, [ctx.getClass(), ctx.getHandler()]) ?? [];
    const anyOf = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS_KEY, [ctx.getHandler(), ctx.getClass()]) ?? [];
    if (!required.length && !anyOf.length) return true;
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError();
    const missing = required.filter((p) => !actor.permissions.has(p));
    if (missing.length) throw new ForbiddenError(`Missing permission: ${missing.join(", ")}`);
    if (anyOf.length && !anyOf.some((p) => actor.permissions.has(p))) throw new ForbiddenError(`Requires one of: ${anyOf.join(", ")}`);
    return true;
  }
}
