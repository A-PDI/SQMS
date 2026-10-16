import { createParamDecorator, ExecutionContext, SetMetadata } from "@nestjs/common";
import type { Request } from "express";
import type { Actor } from "./actor";
import { UnauthorizedError } from "../errors/app-errors";

export const PUBLIC_KEY = "sqms:public";
export const PERMISSIONS_KEY = "sqms:permissions";
export const AUDIENCE_KEY = "sqms:audience";
export const ANY_PERMISSIONS_KEY = "sqms:any-permissions";
export const SERVICE_AUTHORIZED_KEY = "sqms:service-authorized";

/** Explicit exception for self-service or record-scoped endpoints enforcing authorization in their service. */
export const AuthorizeInService = () => SetMetadata(SERVICE_AUTHORIZED_KEY, true);

/** Endpoint does not require an authenticated session. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** All listed permissions are required. */
export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/** At least one of the listed permissions is required (e.g. a supplier's own permission or an internal on-behalf permission). */
export const RequireAnyPermission = (...permissions: string[]) => SetMetadata(ANY_PERMISSIONS_KEY, permissions);

/**
 * Who may call the endpoint. Default is "internal" (company users only).
 * "external" endpoints form the supplier portal API and are disabled unless SUPPLIER_PORTAL_ENABLED=true.
 * "any" endpoints serve both audiences and must apply AccessScope filtering in the service layer.
 */
export type Audience = "internal" | "external" | "any";
export const AudienceScope = (audience: Audience) => SetMetadata(AUDIENCE_KEY, audience);

export interface AuthenticatedRequest extends Request {
  actor?: Actor;
  sessionTokenHash?: string;
}

export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!req.actor) throw new UnauthorizedError();
  return req.actor;
});
