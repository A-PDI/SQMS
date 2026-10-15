import type { Actor } from "./actor";
import { ForbiddenError, NotFoundError } from "../errors/app-errors";

/**
 * Server-side data isolation. Internal users see all records; external (supplier) users are restricted to their own
 * supplier. The supplier id always comes from the authenticated session, never from request parameters.
 * Access failures on individual records return 404 to avoid disclosing the existence of other suppliers' records.
 */
export class AccessScope {
  constructor(readonly actor: Actor) {}

  static of(actor: Actor): AccessScope {
    return new AccessScope(actor);
  }

  get isInternal(): boolean {
    return this.actor.userType === "INTERNAL" && this.actor.organizationType === "INTERNAL";
  }

  get supplierId(): string | null {
    return this.isInternal ? null : this.actor.supplierId;
  }

  /** Prisma where-fragment restricting a model with a `supplierId` column. */
  supplierWhere(): { supplierId?: string } {
    if (this.isInternal) return {};
    if (!this.actor.supplierId) throw new ForbiddenError("No supplier organization is associated with this account");
    return { supplierId: this.actor.supplierId };
  }

  /** Throws NotFound when an external user addresses another supplier's record. */
  assertSupplier(recordSupplierId: string | null | undefined, entity = "Record"): void {
    if (this.isInternal) return;
    if (!this.actor.supplierId || recordSupplierId !== this.actor.supplierId) throw new NotFoundError(entity);
  }

  requireInternal(): void {
    if (!this.isInternal) throw new ForbiddenError();
  }
}
