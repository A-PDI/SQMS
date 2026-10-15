import { Controller, Get, Module } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Actor } from "../../common/auth/actor";
import { AccessScope } from "../../common/auth/access-scope";
import { AudienceScope, CurrentActor } from "../../common/auth/decorators";
import { DbService } from "../../common/db/db.service";

/**
 * Supplier portal (Phase 2). Every route here is external-only and is rejected unless SUPPLIER_PORTAL_ENABLED=true.
 * The supplier is always taken from the authenticated session.
 */
@ApiTags("portal")
@Controller("portal")
@AudienceScope("external")
export class PortalController {
  constructor(private readonly db: DbService) {}

  @Get("overview")
  @ApiOperation({ summary: "Supplier portal home: open requests for the signed-in supplier" })
  async overview(@CurrentActor() actor: Actor) {
    const where = AccessScope.of(actor).supplierWhere();
    const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
    const c = this.db.client;
    const [supplier, tasks, scarsAwaiting, scarsOverdue, changesOpen, ncrsOpen, documentsShared, deviationsOpen] = await Promise.all([
      c.supplier.findUnique({ where: { id: where.supplierId }, select: { id: true, name: true, supplierNumber: true, status: true } }),
      c.task.count({ where: { assigneeOrganizationId: actor.organizationId, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
      c.correctiveAction.count({ where: { ...where, status: { in: ["ISSUED", "RESPONSE_REJECTED"] } } }),
      c.correctiveAction.count({ where: { ...where, status: { in: ["ISSUED", "RESPONSE_REJECTED"] }, responseDueDate: { lt: today } } }),
      c.changeRequest.count({ where: { ...where, supplierVisible: true, status: { in: ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "INFO_REQUIRED", "VALIDATION_REQUIRED"] } } }),
      c.nonconformance.count({ where: { ...where, supplierVisible: true, status: { in: ["OPEN", "CONTAINED", "UNDER_INVESTIGATION"] } } }),
      c.documentShare.count({ where: { organizationId: actor.organizationId, revokedAt: null } }),
      c.deviation.count({ where: { ...where, supplierVisible: true, status: { in: ["DRAFT", "SUBMITTED"] } } }),
    ]);
    return { supplier, tasks, scarsAwaiting, scarsOverdue, changesOpen, ncrsOpen, documentsShared, deviationsOpen };
  }
}

@Module({ controllers: [PortalController] })
export class PortalModule {}
