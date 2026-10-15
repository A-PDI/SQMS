import { Injectable } from "@nestjs/common";
import type { Prisma } from "@sqms/db";
import type { Actor } from "../../common/auth/actor";
import { AccessScope } from "../../common/auth/access-scope";
import { ActivityService } from "../../common/audit/activity.service";
import { AuditService, diffControlled } from "../../common/audit/audit.service";
import { DbService } from "../../common/db/db.service";
import { BusinessRuleError, NotFoundError, StaleVersionError } from "../../common/errors/app-errors";
import { pageArgs, sortArg, trimQ, type Page } from "../../common/http/pagination";
import { OutboxService } from "../../common/services/outbox.service";
import type {
  CreatePartDto,
  CreateSupplierPartDto,
  CreateSupplierProductDto,
  CrossReferenceDto,
  OemReferenceDto,
  PartListQuery,
  ProductApprovalQuery,
  SupplierPartListQuery,
  SupplierProductListQuery,
  SupplierProductStatusDto,
  UpdatePartDto,
  UpdateSupplierPartDto,
} from "./products.dto";

const PART_CONTROLLED = ["description", "categoryId", "criticality", "status", "designOwnership", "engineeringRevision", "unitOfMeasure"] as const;
const OPEN_NCR = ["OPEN", "CONTAINED", "UNDER_INVESTIGATION", "DISPOSITIONED"] as const;
const OPEN_CHANGE = ["SUBMITTED", "UNDER_REVIEW", "INFO_REQUIRED", "VALIDATION_REQUIRED", "APPROVED"] as const;

@Injectable()
export class ProductsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
    private readonly outbox: OutboxService,
  ) {}

  // ------------------------------------------------------------------ lookups
  categories() {
    return this.db.client.productCategory.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  }

  capabilities() {
    return this.db.client.capability.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  }

  // ------------------------------------------------------------------ internal parts
  private partWhere(actor: Actor, q: PartListQuery): Prisma.InternalPartWhereInput {
    const scope = AccessScope.of(actor);
    const term = trimQ(q.q);
    const supplierFilter = scope.isInternal ? q.supplierId : scope.supplierId;
    return {
      archivedAt: null,
      ...(q.status?.length ? { status: { in: q.status as never } } : {}),
      ...(q.criticality?.length ? { criticality: { in: q.criticality as never } } : {}),
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(supplierFilter ? { supplierProducts: { some: { supplierId: supplierFilter } } } : {}),
      ...(term
        ? {
            OR: [
              { partNumber: { contains: term } },
              { description: { contains: term } },
              { oemReferences: { some: { oemPartNumber: { contains: term } } } },
              { crossReferences: { some: { supplierPart: { supplierPartNumber: { contains: term } } } } },
            ],
          }
        : {}),
    };
  }

  async listParts(actor: Actor, q: PartListQuery): Promise<Page<unknown>> {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where = this.partWhere(actor, q);
    const [total, rows] = await Promise.all([
      this.db.client.internalPart.count({ where }),
      this.db.client.internalPart.findMany({
        where,
        skip,
        take,
        orderBy: sortArg(q, ["partNumber", "description", "criticality", "status", "updatedAt", "createdAt"] as const, "partNumber", "asc"),
        include: {
          category: { select: { id: true, name: true } },
          _count: {
            select: {
              supplierProducts: { where: { status: { in: ["APPROVED", "CONDITIONALLY_APPROVED"] } } },
              nonconformances: { where: { status: { in: [...OPEN_NCR] } } },
              changeRequests: { where: { status: { in: [...OPEN_CHANGE] } } },
            },
          },
        },
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: rows.map(({ _count, ...p }) => ({ ...p, approvedSourceCount: _count.supplierProducts, openNcrCount: _count.nonconformances, openChangeCount: _count.changeRequests })),
    };
  }

  async exportParts(actor: Actor, q: PartListQuery) {
    return this.db.client.internalPart.findMany({ where: this.partWhere(actor, q), orderBy: { partNumber: "asc" }, take: 10_000, include: { category: true, oemReferences: true } });
  }

  async getPart(actor: Actor, id: string) {
    const scope = AccessScope.of(actor);
    const part = await this.db.client.internalPart.findFirst({
      where: { id, archivedAt: null, ...(scope.isInternal ? {} : { supplierProducts: { some: { supplierId: scope.supplierId ?? "__none__" } } }) },
      include: {
        category: true,
        oemReferences: { orderBy: { oemName: "asc" } },
        crossReferences: { include: { supplierPart: { include: { supplier: { select: { id: true, name: true, supplierNumber: true } } } } } },
        supplierProducts: {
          where: { archivedAt: null, ...(scope.isInternal ? {} : { supplierId: scope.supplierId! }) },
          include: {
            supplier: { select: { id: true, name: true, supplierNumber: true, status: true } },
            supplierPart: { select: { id: true, supplierPartNumber: true, supplierRevision: true, isCustom: true } },
            site: { select: { id: true, siteCode: true, name: true, country: true, status: true } },
            configurations: {
              orderBy: { createdAt: "asc" },
              include: {
                currentApprovedRevision: { select: { id: true, revisionLabel: true, status: true, approvedAt: true } },
                revisions: { orderBy: { revisionNumber: "desc" }, select: { id: true, revisionLabel: true, status: true, approvedAt: true, supersededAt: true, createdAt: true } },
              },
            },
          },
        },
        _count: {
          select: { nonconformances: { where: { status: { in: [...OPEN_NCR] } } }, changeRequests: { where: { status: { in: [...OPEN_CHANGE] } } }, sourcingProjects: true },
        },
      },
    });
    if (!part) throw new NotFoundError("Product");
    const { notes, ...rest } = part;
    return { ...rest, notes: scope.isInternal ? notes : null };
  }

  async createPart(actor: Actor, dto: CreatePartDto) {
    return this.db.tx(async (tx) => {
      const part = await tx.internalPart.create({ data: { ...dto, partNumber: dto.partNumber.trim().toUpperCase(), createdById: actor.userId } });
      await this.audit.record({ eventType: "product.created", entityType: "INTERNAL_PART", entityId: part.id, entityLabel: part.partNumber, changes: diffControlled({}, part, [...PART_CONTROLLED]) }, tx);
      await this.activity.record(tx, { entityType: "INTERNAL_PART", entityId: part.id, entityLabel: part.partNumber, verb: "created", summary: `Product ${part.partNumber} created`, internalPartId: part.id });
      await this.outbox.publish(tx, "product.created", "INTERNAL_PART", part.id, { partNumber: part.partNumber, description: part.description });
      return part;
    });
  }

  async updatePart(actor: Actor, id: string, dto: UpdatePartDto) {
    const { expectedVersion, ...changes } = dto;
    return this.db.tx(async (tx) => {
      const before = await tx.internalPart.findFirst({ where: { id, archivedAt: null } });
      if (!before) throw new NotFoundError("Product");
      const res = await tx.internalPart.updateMany({ where: { id, version: expectedVersion }, data: { ...changes, version: { increment: 1 } } });
      if (res.count !== 1) throw new StaleVersionError("Product");
      const after = await tx.internalPart.findUniqueOrThrow({ where: { id } });
      const diff = diffControlled(before, after, [...PART_CONTROLLED]);
      await this.audit.record({ eventType: "product.updated", entityType: "INTERNAL_PART", entityId: id, entityLabel: after.partNumber, changes: diff }, tx);
      if (diff) await this.activity.record(tx, { entityType: "INTERNAL_PART", entityId: id, entityLabel: after.partNumber, verb: "updated", summary: `Updated ${Object.keys(diff).join(", ")}`, internalPartId: id });
      return after;
    });
  }

  async addOemReference(actor: Actor, partId: string, dto: OemReferenceDto) {
    return this.db.tx(async (tx) => {
      const part = await tx.internalPart.findFirst({ where: { id: partId, archivedAt: null } });
      if (!part) throw new NotFoundError("Product");
      const ref = await tx.oemCrossReference.create({ data: { internalPartId: partId, oemName: dto.oemName.trim(), oemPartNumber: dto.oemPartNumber.trim().toUpperCase(), notes: dto.notes } });
      await this.audit.record({ eventType: "product.oem_reference_added", entityType: "INTERNAL_PART", entityId: partId, entityLabel: part.partNumber, metadata: { oemName: ref.oemName, oemPartNumber: ref.oemPartNumber } }, tx);
      return ref;
    });
  }

  async removeOemReference(actor: Actor, partId: string, refId: string) {
    return this.db.tx(async (tx) => {
      const ref = await tx.oemCrossReference.findFirst({ where: { id: refId, internalPartId: partId } });
      if (!ref) throw new NotFoundError("OEM reference");
      await tx.oemCrossReference.delete({ where: { id: refId } });
      await this.audit.record({ eventType: "product.oem_reference_removed", entityType: "INTERNAL_PART", entityId: partId, metadata: { oemName: ref.oemName, oemPartNumber: ref.oemPartNumber } }, tx);
    });
  }

  async approvalHistory(actor: Actor, partId: string) {
    const scope = AccessScope.of(actor);
    scope.requireInternal();
    return this.db.client.productApproval.findMany({
      where: { internalPartId: partId },
      orderBy: { approvedAt: "desc" },
      include: {
        supplierProduct: { include: { supplier: { select: { id: true, name: true, supplierNumber: true } }, supplierPart: { select: { supplierPartNumber: true } }, site: { select: { siteCode: true, name: true } } } },
        configurationRevision: { select: { id: true, revisionLabel: true, status: true, configuration: { select: { id: true, configCode: true, name: true, configurationType: true } } } },
        qualification: { select: { id: true, number: true } },
        approvalPackage: { select: { id: true, number: true, snapshotHash: true } },
      },
    });
  }

  // ------------------------------------------------------------------ supplier parts
  async listSupplierParts(actor: Actor, q: SupplierPartListQuery): Promise<Page<unknown>> {
    const scope = AccessScope.of(actor);
    const { skip, take, page, pageSize } = pageArgs(q);
    const term = trimQ(q.q);
    const where: Prisma.SupplierPartWhereInput = {
      archivedAt: null,
      ...(scope.isInternal ? (q.supplierId ? { supplierId: q.supplierId } : {}) : scope.supplierWhere()),
      ...(term ? { OR: [{ supplierPartNumber: { contains: term } }, { description: { contains: term } }] } : {}),
    };
    const [total, items] = await Promise.all([
      this.db.client.supplierPart.count({ where }),
      this.db.client.supplierPart.findMany({
        where,
        skip,
        take,
        orderBy: sortArg(q, ["supplierPartNumber", "updatedAt", "createdAt"] as const, "supplierPartNumber", "asc"),
        include: { supplier: { select: { id: true, name: true, supplierNumber: true } }, crossReferences: { include: { internalPart: { select: { id: true, partNumber: true } } } } },
      }),
    ]);
    return { total, page, pageSize, items };
  }

  async createSupplierPart(actor: Actor, dto: CreateSupplierPartDto) {
    return this.db.tx(async (tx) => {
      const supplier = await tx.supplier.findFirst({ where: { id: dto.supplierId, archivedAt: null } });
      if (!supplier) throw new NotFoundError("Supplier");
      const sp = await tx.supplierPart.create({ data: { ...dto, supplierPartNumber: dto.supplierPartNumber.trim().toUpperCase() } });
      await this.audit.record({ eventType: "supplier_part.created", entityType: "SUPPLIER_PART", entityId: sp.id, entityLabel: `${supplier.name} ${sp.supplierPartNumber}`, metadata: { supplierId: supplier.id, isCustom: sp.isCustom } }, tx);
      await this.activity.record(tx, { entityType: "SUPPLIER", entityId: supplier.id, entityLabel: supplier.name, verb: "supplier_part_added", summary: `Supplier part ${sp.supplierPartNumber} added`, supplierId: supplier.id });
      return sp;
    });
  }

  async updateSupplierPart(actor: Actor, id: string, dto: UpdateSupplierPartDto) {
    return this.db.tx(async (tx) => {
      const before = await tx.supplierPart.findFirst({ where: { id, archivedAt: null } });
      if (!before) throw new NotFoundError("Supplier part");
      const after = await tx.supplierPart.update({ where: { id }, data: dto });
      await this.audit.record({ eventType: "supplier_part.updated", entityType: "SUPPLIER_PART", entityId: id, entityLabel: after.supplierPartNumber, changes: diffControlled(before, after, ["description", "supplierRevision", "status"]) }, tx);
      return after;
    });
  }

  async addCrossReference(actor: Actor, dto: CrossReferenceDto) {
    return this.db.tx(async (tx) => {
      const [part, sp] = await Promise.all([tx.internalPart.findFirst({ where: { id: dto.internalPartId, archivedAt: null } }), tx.supplierPart.findFirst({ where: { id: dto.supplierPartId, archivedAt: null } })]);
      if (!part) throw new NotFoundError("Product");
      if (!sp) throw new NotFoundError("Supplier part");
      const ref = await tx.partCrossReference.create({ data: { ...dto, type: dto.type ?? (sp.isCustom ? "CUSTOM_CONFIGURATION" : "EQUIVALENT"), createdById: actor.userId } });
      await this.audit.record({ eventType: "product.cross_reference_added", entityType: "INTERNAL_PART", entityId: part.id, entityLabel: part.partNumber, metadata: { supplierPartId: sp.id, supplierPartNumber: sp.supplierPartNumber, type: ref.type } }, tx);
      await this.activity.record(tx, { entityType: "INTERNAL_PART", entityId: part.id, entityLabel: part.partNumber, verb: "cross_reference_added", summary: `Cross-referenced to supplier part ${sp.supplierPartNumber}`, internalPartId: part.id, supplierId: sp.supplierId });
      return ref;
    });
  }

  async removeCrossReference(actor: Actor, id: string) {
    return this.db.tx(async (tx) => {
      const ref = await tx.partCrossReference.findUnique({ where: { id }, include: { supplierPart: true } });
      if (!ref) throw new NotFoundError("Cross-reference");
      const inUse = await tx.supplierProduct.count({ where: { internalPartId: ref.internalPartId, supplierPartId: ref.supplierPartId, archivedAt: null } });
      if (inUse) throw new BusinessRuleError("The cross-reference is used by a supplier-product relationship and cannot be removed");
      await tx.partCrossReference.delete({ where: { id } });
      await this.audit.record({ eventType: "product.cross_reference_removed", entityType: "INTERNAL_PART", entityId: ref.internalPartId, metadata: { supplierPartNumber: ref.supplierPart.supplierPartNumber } }, tx);
    });
  }

  // ------------------------------------------------------------------ supplier products (supplier-product-site)
  async listSupplierProducts(actor: Actor, q: SupplierProductListQuery): Promise<Page<unknown>> {
    const scope = AccessScope.of(actor);
    const { skip, take, page, pageSize } = pageArgs(q);
    const term = trimQ(q.q);
    const where: Prisma.SupplierProductWhereInput = {
      archivedAt: null,
      ...(scope.isInternal ? (q.supplierId ? { supplierId: q.supplierId } : {}) : scope.supplierWhere()),
      ...(q.internalPartId ? { internalPartId: q.internalPartId } : {}),
      ...(q.siteId ? { siteId: q.siteId } : {}),
      ...(q.status?.length ? { status: { in: q.status as never } } : {}),
      ...(term ? { OR: [{ internalPart: { partNumber: { contains: term } } }, { supplierPart: { supplierPartNumber: { contains: term } } }, { supplier: { name: { contains: term } } }] } : {}),
    };
    const [total, items] = await Promise.all([
      this.db.client.supplierProduct.count({ where }),
      this.db.client.supplierProduct.findMany({
        where,
        skip,
        take,
        orderBy: sortArg(q, ["updatedAt", "createdAt", "status"] as const, "updatedAt"),
        include: {
          internalPart: { select: { id: true, partNumber: true, description: true, criticality: true } },
          supplier: { select: { id: true, name: true, supplierNumber: true, status: true } },
          supplierPart: { select: { id: true, supplierPartNumber: true, isCustom: true } },
          site: { select: { id: true, siteCode: true, name: true } },
          configurations: { select: { id: true, configCode: true, name: true, configurationType: true, currentApprovedRevision: { select: { id: true, revisionLabel: true } } } },
        },
      }),
    ]);
    return { total, page, pageSize, items };
  }

  async getSupplierProduct(actor: Actor, id: string) {
    const scope = AccessScope.of(actor);
    const sp = await this.db.client.supplierProduct.findFirst({
      where: { id, archivedAt: null },
      include: {
        internalPart: true,
        supplier: { select: { id: true, name: true, supplierNumber: true, status: true } },
        supplierPart: true,
        site: true,
        originProject: { select: { id: true, projectNumber: true, title: true, pathway: true } },
        configurations: {
          include: {
            baseConfiguration: { select: { id: true, configCode: true, name: true } },
            revisions: { orderBy: { revisionNumber: "desc" }, select: { id: true, revisionNumber: true, revisionLabel: true, status: true, approvedAt: true, supersededAt: true, createdAt: true } },
          },
        },
        productApprovals: { orderBy: { approvedAt: "desc" }, include: { configurationRevision: { select: { revisionLabel: true, configuration: { select: { configCode: true } } } } } },
      },
    });
    if (!sp) throw new NotFoundError("Supplier product");
    scope.assertSupplier(sp.supplierId, "Supplier product");
    return sp;
  }

  async createSupplierProduct(actor: Actor, dto: CreateSupplierProductDto) {
    return this.db.tx(async (tx) => {
      const [part, sp, site] = await Promise.all([
        tx.internalPart.findFirst({ where: { id: dto.internalPartId, archivedAt: null } }),
        tx.supplierPart.findFirst({ where: { id: dto.supplierPartId, archivedAt: null } }),
        tx.supplierSite.findFirst({ where: { id: dto.siteId, archivedAt: null } }),
      ]);
      if (!part) throw new NotFoundError("Product");
      if (!sp) throw new NotFoundError("Supplier part");
      if (!site) throw new NotFoundError("Site");
      if (site.supplierId !== sp.supplierId) throw new BusinessRuleError("The manufacturing site must belong to the supplier of the supplier part");
      await tx.partCrossReference.upsert({
        where: { internalPartId_supplierPartId: { internalPartId: part.id, supplierPartId: sp.id } },
        update: {},
        create: { internalPartId: part.id, supplierPartId: sp.id, type: sp.isCustom ? "CUSTOM_CONFIGURATION" : "EQUIVALENT", createdById: actor.userId },
      });
      const created = await tx.supplierProduct.create({
        data: { internalPartId: part.id, supplierId: sp.supplierId, supplierPartId: sp.id, siteId: site.id, isPreferred: dto.isPreferred ?? false },
      });
      await this.audit.record({ eventType: "supplier_product.created", entityType: "SUPPLIER_PRODUCT", entityId: created.id, entityLabel: `${part.partNumber} / ${sp.supplierPartNumber} @ ${site.siteCode}`, metadata: { supplierId: sp.supplierId, siteId: site.id } }, tx);
      await this.activity.record(tx, { entityType: "INTERNAL_PART", entityId: part.id, entityLabel: part.partNumber, verb: "source_added", summary: `Source ${sp.supplierPartNumber} at site ${site.siteCode} proposed`, internalPartId: part.id, supplierId: sp.supplierId });
      return created;
    });
  }

  async changeSupplierProductStatus(actor: Actor, id: string, dto: SupplierProductStatusDto) {
    return this.db.tx(async (tx) => {
      await this.db.lockRow(tx, "supplier_products", id);
      const before = await tx.supplierProduct.findFirst({ where: { id, archivedAt: null }, include: { internalPart: true } });
      if (!before) throw new NotFoundError("Supplier product");
      const after = await tx.supplierProduct.update({ where: { id }, data: { status: dto.status, statusReason: dto.reason, version: { increment: 1 } } });
      if (dto.status !== "INACTIVE") {
        await tx.productApproval.updateMany({ where: { supplierProductId: id, status: "ACTIVE" }, data: { status: dto.status === "SUSPENDED" ? "SUSPENDED" : "REVOKED" } });
      }
      await this.audit.record({ eventType: "supplier_product.status_changed", entityType: "SUPPLIER_PRODUCT", entityId: id, entityLabel: before.internalPart.partNumber, changes: diffControlled(before, after, ["status", "statusReason"]), reason: dto.reason }, tx);
      await this.activity.record(tx, { entityType: "INTERNAL_PART", entityId: before.internalPartId, entityLabel: before.internalPart.partNumber, verb: "source_status_changed", summary: `Source status ${before.status} → ${dto.status}: ${dto.reason}`, internalPartId: before.internalPartId, supplierId: before.supplierId });
      await this.outbox.publish(tx, "approved_source.status_changed", "SUPPLIER_PRODUCT", id, { from: before.status, to: dto.status });
      return after;
    });
  }

  async listApprovals(actor: Actor, q: ProductApprovalQuery): Promise<Page<unknown>> {
    AccessScope.of(actor).requireInternal();
    const { skip, take, page, pageSize } = pageArgs(q);
    const term = trimQ(q.q);
    const where: Prisma.ProductApprovalWhereInput = {
      ...(q.internalPartId ? { internalPartId: q.internalPartId } : {}),
      ...(q.supplierId ? { supplierId: q.supplierId } : {}),
      ...(q.status?.length ? { status: { in: q.status as never } } : {}),
      ...(term ? { OR: [{ number: { contains: term } }, { internalPart: { partNumber: { contains: term } } }] } : {}),
    };
    const [total, items] = await Promise.all([
      this.db.client.productApproval.count({ where }),
      this.db.client.productApproval.findMany({
        where,
        skip,
        take,
        orderBy: { approvedAt: "desc" },
        include: {
          internalPart: { select: { id: true, partNumber: true, description: true } },
          supplierProduct: { include: { supplier: { select: { id: true, name: true } }, supplierPart: { select: { supplierPartNumber: true } }, site: { select: { siteCode: true, name: true } } } },
          configurationRevision: { select: { id: true, revisionLabel: true, configuration: { select: { id: true, configCode: true, name: true } } } },
          qualification: { select: { id: true, number: true } },
        },
      }),
    ]);
    return { total, page, pageSize, items };
  }
}
