import { Injectable } from "@nestjs/common";
import { hashPassword, Prisma } from "@sqms/db";
import { SessionService } from "../../common/auth/session.service";
import type { Actor } from "../../common/auth/actor";
import {
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
} from "../../common/errors/app-errors";
import { UsersAdminService } from "../admin/users-admin.service";
import { QmsService } from "./qms.service";
import * as p from "./qms-presenters";
import type { Row } from "./qms-presenters";
const roles: Row = {
  inspector: "INSPECTOR",
  qc_manager: "QUALITY_MANAGER",
  admin: "SYSTEM_ADMIN",
};
const json = (v: any) => v as Prisma.InputJsonValue;
@Injectable()
export class QmsAdminService {
  constructor(
    readonly qms: QmsService,
    readonly users: UsersAdminService,
    readonly sessions: SessionService,
  ) {}
  async list(q: Row) {
    const users = await this.qms.db.client.user.findMany({
      where: {
        userType: "INTERNAL",
        ...(q.include_inactive ? {} : { status: "ACTIVE" }),
      },
      select: {
        id: true,
        displayName: true,
        email: true,
        status: true,
        createdAt: true,
        legacyPermissions: true,
        memberships: {
          select: { roles: { select: { role: { select: { key: true } } } } },
        },
      },
      orderBy: { displayName: "asc" },
    });
    return { users: users.map(p.user) };
  }
  async save(actor: Actor, id: string | null, body: Row) {
    if (body.role && !roles[body.role])
      throw new BusinessRuleError("Invalid role");
    let uid = id;
    if (!uid) {
      if (!body.name || !body.email || !body.password)
        throw new BusinessRuleError("Name, email, and password are required");
      const result = await this.users.createLocal(
        actor,
        {
          displayName: body.name,
          email: body.email,
          password: body.password,
          roleKeys: [roles[body.role || "inspector"]],
        },
        "operational",
      );
      uid = result.id;
    } else {
      await this.users.update(actor, uid, { displayName: body.name });
      if (body.email !== undefined) {
        await this.qms.db.tx(async (tx) => {
          await tx.user.update({
            where: { id: uid! },
            data: { email: String(body.email).trim().toLowerCase() },
          });
          await this.sessions.revokeAllForUser(
            uid!,
            "email_changed",
            undefined,
            tx,
          );
          await this.qms.audit.record(
            {
              eventType: "qms.user.email_changed",
              entityType: "USER",
              entityId: uid!,
            },
            tx,
          );
        });
      }
      if (body.role) {
        if (!actor.permissions.has("admin:roles"))
          throw new ForbiddenError("Role administration is required");
        await this.users.setRoles(
          actor,
          uid,
          [roles[body.role]],
          "Role changed in operational administration",
        );
      }
      if (body.password) {
        if (String(body.password).length < 8)
          throw new BusinessRuleError("Password must be at least 8 characters");
        const hash = await hashPassword(body.password);
        await this.qms.db.tx(async (tx) => {
          await tx.user.update({
            where: { id: uid! },
            data: {
              passwordHash: hash,
              passwordChangedAt: new Date(),
              failedLoginCount: 0,
              lockedUntil: null,
            },
          });
          await this.sessions.revokeAllForUser(
            uid!,
            "administrator_password_reset",
            undefined,
            tx,
          );
          await this.qms.audit.record(
            {
              eventType: "qms.user.password_reset",
              entityType: "USER",
              entityId: uid!,
            },
            tx,
          );
        });
      }
    }
    if (body.active !== undefined)
      await this.users.setStatus(
        actor,
        uid!,
        body.active ? "ACTIVE" : "DISABLED",
        "Account status changed in operational administration",
      );
    if (body.usePermissions !== undefined)
      await this.qms.db.client.user.update({
        where: { id: uid! },
        data: {
          legacyPermissions:
            body.usePermissions && Array.isArray(body.permTabs)
              ? json({ tabs: body.permTabs })
              : Prisma.DbNull,
        },
      });
    const user = (await this.list({ include_inactive: 1 })).users.find(
      (u) => u.id === uid,
    );
    return { user };
  }
  async saved(actor: Actor) {
    const rows = await this.qms.db.client.savedView.findMany({
      where: {
        module: "qms-reports",
        ...(actor.roles.includes("SYSTEM_ADMIN")
          ? {}
          : { userId: actor.userId }),
      },
      orderBy: { updatedAt: "desc" },
    });
    return {
      reports: rows.map((r) => ({
        id: r.id,
        name: r.name,
        created_by: r.userId,
        config_json: r.filters,
        created_at: p.iso(r.createdAt),
        updated_at: p.iso(r.updatedAt),
      })),
    };
  }
  async saveReport(actor: Actor, id: string | null, body: Row, remove = false) {
    const old = id
      ? await this.qms.db.client.savedView.findFirst({
          where: { id, module: "qms-reports" },
        })
      : null;
    if (id && !old) throw new NotFoundError("Report");
    if (
      old &&
      old.userId !== actor.userId &&
      !actor.roles.includes("SYSTEM_ADMIN")
    )
      throw new ForbiddenError("Not allowed to update this report");
    if (remove) {
      await this.qms.db.client.savedView.delete({ where: { id: id! } });
      return { ok: true };
    }
    if (!id && !String(body.name || "").trim())
      throw new BusinessRuleError("name is required");
    const data = {
      name: body.name ?? old?.name,
      filters: json(body.config_json ?? old?.filters ?? {}),
    };
    const r = id
      ? await this.qms.db.client.savedView.update({ where: { id }, data })
      : await this.qms.db.client.savedView.create({
          data: { ...data, userId: actor.userId, module: "qms-reports" },
        });
    return {
      report: {
        id: r.id,
        name: r.name,
        config_json: r.filters,
        created_by: r.userId,
        created_at: p.iso(r.createdAt),
        updated_at: p.iso(r.updatedAt),
      },
    };
  }
}
