import { Injectable } from "@nestjs/common";
import type { EntityType } from "@sqms/db";
import type { Actor } from "../../common/auth/actor";
import { AccessScope } from "../../common/auth/access-scope";
import { DbService, type Tx } from "../../common/db/db.service";
import { NotFoundError } from "../../common/errors/app-errors";

export interface EntityRef {
  entityType: EntityType;
  entityId: string;
  label: string;
  supplierId: string | null;
  /** Whether a supplier user from `supplierId` may see this record at all. */
  supplierVisible: boolean;
  /** Read permission required for internal users. */
  readPermission: string;
}

type Resolver = (c: Tx, id: string) => Promise<Omit<EntityRef, "entityType" | "entityId"> | null>;

/**
 * Central record-level authorization for generic features (comments, activity timelines, attachments, approval
 * history). Returns NotFound for records the actor may not see, so other suppliers' records are never disclosed.
 */
@Injectable()
export class EntityAccessService {
  private readonly resolvers: Partial<Record<EntityType, Resolver>>;

  constructor(private readonly db: DbService) {
    this.resolvers = {
      INCOMING_INSPECTION: async (c, id) => {
        const r = await c.incomingInspection.findUnique({ where: { id }, select: { number: true, supplierId: true } });
        return r && { label: r.number, supplierId: r.supplierId, supplierVisible: false, readPermission: "inspection:read" };
      },
      INSPECTION_PLAN: async (c, id) => {
        const r = await c.inspectionPlan.findUnique({ where: { id }, select: { code: true } });
        return r && { label: r.code, supplierId: null, supplierVisible: false, readPermission: "inspection:read" };
      },
      INJECTOR_TEST: async (c, id) => {
        const r = await c.injectorTest.findUnique({ where: { id }, select: { reportExternalId: true, slotPosition: true } });
        return r && { label: `${r.reportExternalId}/${r.slotPosition}`, supplierId: null, supplierVisible: false, readPermission: "injector:read" };
      },
      INJECTOR_REPAIR: async (c, id) => {
        const r = await c.injectorRepairCase.findUnique({ where: { id }, select: { serialNumber: true } });
        return r && { label: r.serialNumber, supplierId: null, supplierVisible: false, readPermission: "injector:read" };
      },
      SUPPLIER: async (c, id) => {
        const r = await c.supplier.findUnique({ where: { id }, select: { id: true, name: true, supplierNumber: true } });
        return r && { label: `${r.supplierNumber} ${r.name}`, supplierId: r.id, supplierVisible: true, readPermission: "supplier:read" };
      },
      SUPPLIER_SITE: async (c, id) => {
        const r = await c.supplierSite.findUnique({ where: { id }, select: { name: true, supplierId: true } });
        return r && { label: r.name, supplierId: r.supplierId, supplierVisible: true, readPermission: "supplier:read" };
      },
      INTERNAL_PART: async (c, id) => {
        const r = await c.internalPart.findUnique({ where: { id }, select: { partNumber: true } });
        return r && { label: r.partNumber, supplierId: null, supplierVisible: false, readPermission: "product:read" };
      },
      SUPPLIER_PART: async (c, id) => {
        const r = await c.supplierPart.findUnique({ where: { id }, select: { supplierPartNumber: true, supplierId: true } });
        return r && { label: r.supplierPartNumber, supplierId: r.supplierId, supplierVisible: true, readPermission: "product:read" };
      },
      SUPPLIER_PRODUCT: async (c, id) => {
        const r = await c.supplierProduct.findUnique({ where: { id }, select: { supplierId: true, internalPart: { select: { partNumber: true } }, supplierPart: { select: { supplierPartNumber: true } } } });
        return r && { label: `${r.internalPart.partNumber} / ${r.supplierPart.supplierPartNumber}`, supplierId: r.supplierId, supplierVisible: true, readPermission: "product:read" };
      },
      PRODUCT_CONFIGURATION: async (c, id) => {
        const r = await c.productConfiguration.findUnique({ where: { id }, select: { configCode: true, supplierId: true } });
        return r && { label: r.configCode, supplierId: r.supplierId, supplierVisible: true, readPermission: "product:read" };
      },
      CONFIGURATION_REVISION: async (c, id) => {
        const r = await c.configurationRevision.findUnique({ where: { id }, select: { revisionLabel: true, configuration: { select: { configCode: true, supplierId: true } } } });
        return r && { label: `${r.configuration.configCode} rev ${r.revisionLabel}`, supplierId: r.configuration.supplierId, supplierVisible: true, readPermission: "product:read" };
      },
      SOURCING_PROJECT: async (c, id) => {
        const r = await c.sourcingProject.findUnique({ where: { id }, select: { projectNumber: true, title: true, supplierId: true, supplierVisible: true } });
        return r && { label: `${r.projectNumber} ${r.title}`, supplierId: r.supplierId, supplierVisible: r.supplierVisible, readPermission: "project:read" };
      },
      DOCUMENT: async (c, id) => {
        const r = await c.documentRecord.findUnique({ where: { id }, select: { docNumber: true, title: true, supplierId: true } });
        return r && { label: `${r.docNumber} ${r.title}`, supplierId: r.supplierId, supplierVisible: false, readPermission: "document:read" };
      },
      DOCUMENT_REVISION: async (c, id) => {
        const r = await c.documentRevision.findUnique({ where: { id }, select: { revisionLabel: true, document: { select: { docNumber: true, supplierId: true } } } });
        return r && { label: `${r.document.docNumber} rev ${r.revisionLabel}`, supplierId: r.document.supplierId, supplierVisible: false, readPermission: "document:read" };
      },
      SUPPLIER_QUALIFICATION: async (c, id) => {
        const r = await c.supplierQualification.findUnique({ where: { id }, select: { number: true, supplierId: true } });
        return r && { label: r.number, supplierId: r.supplierId, supplierVisible: false, readPermission: "supplier:read" };
      },
      PRODUCT_QUALIFICATION: async (c, id) => {
        const r = await c.productQualification.findUnique({ where: { id }, select: { number: true, supplierId: true, supplierVisible: true } });
        return r && { label: r.number, supplierId: r.supplierId, supplierVisible: r.supplierVisible, readPermission: "qualification:read" };
      },
      CHANGE_REQUEST: async (c, id) => {
        const r = await c.changeRequest.findUnique({ where: { id }, select: { number: true, supplierId: true, supplierVisible: true } });
        return r && { label: r.number, supplierId: r.supplierId, supplierVisible: r.supplierVisible, readPermission: "change:read" };
      },
      DEVIATION: async (c, id) => {
        const r = await c.deviation.findUnique({ where: { id }, select: { number: true, supplierId: true, supplierVisible: true } });
        return r && { label: r.number, supplierId: r.supplierId, supplierVisible: r.supplierVisible, readPermission: "deviation:read" };
      },
      NCR: async (c, id) => {
        const r = await c.nonconformance.findUnique({ where: { id }, select: { number: true, supplierId: true, supplierVisible: true } });
        return r && { label: r.number, supplierId: r.supplierId, supplierVisible: r.supplierVisible, readPermission: "ncr:read" };
      },
      SCAR: async (c, id) => {
        const r = await c.correctiveAction.findUnique({ where: { id }, select: { number: true, supplierId: true, status: true } });
        return r && { label: r.number, supplierId: r.supplierId, supplierVisible: r.status !== "DRAFT", readPermission: "scar:read" };
      },
      FIRST_ARTICLE_INSPECTION: async (c, id) => {
        const r = await c.firstArticleInspection.findUnique({ where: { id }, select: { number: true, qualification: { select: { supplierId: true } } } });
        return r && { label: r.number, supplierId: r.qualification.supplierId, supplierVisible: false, readPermission: "qualification:read" };
      },
    };
  }

  /** Resolves and authorizes read access to a record (inside `tx` when the record may not be committed yet). */
  async assertReadable(actor: Actor, entityType: EntityType, entityId: string, tx?: Tx): Promise<EntityRef> {
    const resolver = this.resolvers[entityType];
    if (!resolver) throw new NotFoundError("Record");
    const ref = await resolver(tx ?? (this.db.client as unknown as Tx), entityId);
    if (!ref) throw new NotFoundError("Record");
    const scope = AccessScope.of(actor);
    if (!scope.isInternal) {
      if (!ref.supplierVisible) throw new NotFoundError("Record");
      scope.assertSupplier(ref.supplierId);
    }
    if (!actor.permissions.has(ref.readPermission)) throw new NotFoundError("Record");
    return { entityType, entityId, ...ref };
  }

  supports(entityType: EntityType): boolean {
    return !!this.resolvers[entityType];
  }
}
