import { Injectable, OnModuleInit } from "@nestjs/common";
import type { Prisma, WorkflowInstance } from "@sqms/db";
import type { Actor } from "../../common/auth/actor";
import { AccessScope } from "../../common/auth/access-scope";
import { RequestContext } from "../../common/context/request-context";
import { ActivityService } from "../../common/audit/activity.service";
import { AuditService, diffControlled } from "../../common/audit/audit.service";
import { DbService, type AfterCommit, type Tx } from "../../common/db/db.service";
import { BusinessRuleError, InvalidTransitionError, NotFoundError, StaleVersionError } from "../../common/errors/app-errors";
import { pageArgs, sortArg, trimQ, type Page } from "../../common/http/pagination";
import { toDate } from "../../common/http/dto-helpers";
import { NumberingService } from "../../common/services/numbering.service";
import { OutboxService } from "../../common/services/outbox.service";
import { WorkflowService, type WorkflowSubjectHandler } from "../workflow/workflow.service";
import type {
  CertificationDto,
  ChangeStatusDto,
  ContactDto,
  CreateSupplierDto,
  CreateSupplierQualificationDto,
  SetAddressesDto,
  SiteDto,
  SupplierListQuery,
  UpdateSiteDto,
  UpdateSupplierDto,
  UpdateSupplierQualificationDto,
} from "./suppliers.dto";

const CONTROLLED_FIELDS = ["name", "legalName", "website", "country", "dunsNumber", "taxId", "status", "statusReason"] as const;
const OPEN_NCR = ["OPEN", "CONTAINED", "UNDER_INVESTIGATION", "DISPOSITIONED"] as const;
const PENDING_CHANGE = ["SUBMITTED", "UNDER_REVIEW", "INFO_REQUIRED", "VALIDATION_REQUIRED"] as const;
const OPEN_SCAR = ["ISSUED", "RESPONSE_SUBMITTED", "RESPONSE_REJECTED", "ACCEPTED", "VERIFICATION"] as const;

@Injectable()
export class SuppliersService implements OnModuleInit, WorkflowSubjectHandler {
  readonly subjectType = "SUPPLIER_QUALIFICATION" as const;

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
    private readonly numbering: NumberingService,
    private readonly outbox: OutboxService,
    private readonly workflow: WorkflowService,
  ) {}

  onModuleInit(): void {
    this.workflow.registerHandler(this);
  }

  // ------------------------------------------------------------------ suppliers

  private listWhere(actor: Actor, q: SupplierListQuery): Prisma.SupplierWhereInput {
    const scope = AccessScope.of(actor);
    const term = trimQ(q.q);
    return {
      archivedAt: null,
      ...(scope.isInternal ? {} : { id: scope.supplierId ?? "__none__" }),
      ...(q.status?.length ? { status: { in: q.status as Prisma.EnumSupplierStatusFilter["in"] } } : {}),
      ...(q.country ? { country: q.country.toUpperCase() } : {}),
      ...(q.categoryId ? { categories: { some: { categoryId: q.categoryId } } } : {}),
      ...(q.capabilityId ? { capabilities: { some: { capabilityId: q.capabilityId } } } : {}),
      ...(term
        ? { OR: [{ name: { contains: term } }, { legalName: { contains: term } }, { supplierNumber: { contains: term } }, { sites: { some: { name: { contains: term } } } }] }
        : {}),
    };
  }

  async list(actor: Actor, q: SupplierListQuery): Promise<Page<unknown>> {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where = this.listWhere(actor, q);
    const [total, rows] = await Promise.all([
      this.db.client.supplier.count({ where }),
      this.db.client.supplier.findMany({
        where,
        skip,
        take,
        orderBy: sortArg(q, ["name", "supplierNumber", "status", "country", "createdAt", "updatedAt"] as const, "name", "asc"),
        include: {
          _count: {
            select: {
              sites: { where: { archivedAt: null } },
              supplierProducts: { where: { status: { in: ["APPROVED", "CONDITIONALLY_APPROVED"] } } },
              nonconformances: { where: { status: { in: [...OPEN_NCR] } } },
              changeRequests: { where: { status: { in: [...PENDING_CHANGE] } } },
              correctiveActions: { where: { status: { in: [...OPEN_SCAR] } } },
            },
          },
          certifications: { where: { archivedAt: null, expiresAt: { not: null } }, orderBy: { expiresAt: "asc" }, take: 1, select: { standard: true, expiresAt: true } },
        },
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: rows.map((s) => ({
        id: s.id,
        supplierNumber: s.supplierNumber,
        name: s.name,
        legalName: s.legalName,
        country: s.country,
        status: s.status,
        website: s.website,
        updatedAt: s.updatedAt,
        siteCount: s._count.sites,
        approvedProductCount: s._count.supplierProducts,
        openNcrCount: s._count.nonconformances,
        pendingChangeCount: s._count.changeRequests,
        openScarCount: s._count.correctiveActions,
        nextCertificationExpiry: s.certifications[0] ?? null,
      })),
    };
  }

  async exportRows(actor: Actor, q: SupplierListQuery) {
    const rows = await this.db.client.supplier.findMany({ where: this.listWhere(actor, q), orderBy: { name: "asc" }, take: 10_000, include: { _count: { select: { sites: true } } } });
    return rows;
  }

  async get(actor: Actor, id: string) {
    const scope = AccessScope.of(actor);
    scope.assertSupplier(id, "Supplier");
    const s = await this.db.client.supplier.findFirst({
      where: { id, archivedAt: null },
      include: {
        addresses: true,
        capabilities: { include: { capability: true } },
        categories: { include: { category: true } },
        sites: { where: { archivedAt: null }, orderBy: { siteCode: "asc" } },
        _count: {
          select: {
            supplierProducts: { where: { status: { in: ["APPROVED", "CONDITIONALLY_APPROVED"] } } },
            nonconformances: { where: { status: { in: [...OPEN_NCR] } } },
            changeRequests: { where: { status: { in: [...PENDING_CHANGE] } } },
            correctiveActions: { where: { status: { in: [...OPEN_SCAR] } } },
            sourcingProjects: { where: { status: { notIn: ["CLOSED", "CANCELLED", "REJECTED"] } } },
          },
        },
      },
    });
    if (!s) throw new NotFoundError("Supplier");
    const { _count, notes, ...rest } = s;
    return {
      ...rest,
      // Internal notes are never exposed to supplier users.
      notes: scope.isInternal ? notes : null,
      counts: {
        approvedProducts: _count.supplierProducts,
        openNcrs: _count.nonconformances,
        pendingChanges: _count.changeRequests,
        openScars: _count.correctiveActions,
        activeProjects: _count.sourcingProjects,
      },
    };
  }

  async create(actor: Actor, dto: CreateSupplierDto) {
    const siteCodes = new Set<string>();
    for (const s of dto.sites ?? []) {
      const code = s.siteCode.trim().toUpperCase();
      if (siteCodes.has(code)) throw new BusinessRuleError(`Duplicate site code ${code}`);
      siteCodes.add(code);
    }
    return this.db.tx(async (tx) => {
      const supplierNumber = await this.numbering.next(tx, "SUPPLIER");
      const org = await tx.organization.create({ data: { type: "SUPPLIER", name: dto.name.trim(), code: supplierNumber } });
      const supplier = await tx.supplier.create({
        data: {
          organizationId: org.id,
          supplierNumber,
          name: dto.name.trim(),
          legalName: dto.legalName?.trim() || null,
          website: dto.website ?? null,
          country: dto.country.toUpperCase(),
          dunsNumber: dto.dunsNumber ?? null,
          taxId: dto.taxId ?? null,
          notes: dto.notes ?? null,
          status: "PROSPECTIVE",
          statusChangedAt: new Date(),
          createdById: actor.userId,
          addresses: dto.addresses?.length ? { create: dto.addresses.map((a) => ({ ...a, country: a.country.toUpperCase() })) } : undefined,
          sites: dto.sites?.length ? { create: dto.sites.map((s) => ({ ...s, siteCode: s.siteCode.trim().toUpperCase(), country: s.country.toUpperCase() })) } : undefined,
          capabilities: dto.capabilityIds?.length ? { create: dto.capabilityIds.map((capabilityId) => ({ capabilityId })) } : undefined,
          categories: dto.categoryIds?.length ? { create: dto.categoryIds.map((categoryId) => ({ categoryId })) } : undefined,
        },
      });
      if (dto.contacts?.length) {
        await tx.contact.createMany({ data: dto.contacts.map((c) => ({ ...c, siteId: null, supplierId: supplier.id })) });
      }
      await this.audit.record({ eventType: "supplier.created", entityType: "SUPPLIER", entityId: supplier.id, entityLabel: `${supplierNumber} ${supplier.name}`, changes: diffControlled({}, supplier, [...CONTROLLED_FIELDS]) }, tx);
      await this.activity.record(tx, { entityType: "SUPPLIER", entityId: supplier.id, entityLabel: supplier.name, verb: "created", summary: `Supplier ${supplierNumber} ${supplier.name} created (Prospective)`, supplierId: supplier.id });
      await this.outbox.publish(tx, "supplier.created", "SUPPLIER", supplier.id, { supplierNumber, name: supplier.name, country: supplier.country });
      return supplier;
    });
  }

  async update(actor: Actor, id: string, dto: UpdateSupplierDto) {
    const { expectedVersion, ...changes } = dto;
    return this.db.tx(async (tx) => {
      const before = await tx.supplier.findFirst({ where: { id, archivedAt: null } });
      if (!before) throw new NotFoundError("Supplier");
      const data = { ...changes, ...(changes.country ? { country: changes.country.toUpperCase() } : {}) };
      const res = await tx.supplier.updateMany({ where: { id, version: expectedVersion }, data: { ...data, version: { increment: 1 } } });
      if (res.count !== 1) throw new StaleVersionError("Supplier");
      const after = await tx.supplier.findUniqueOrThrow({ where: { id } });
      if (changes.name && changes.name !== before.name) await tx.organization.update({ where: { id: before.organizationId }, data: { name: changes.name } });
      const diff = diffControlled(before, after, [...CONTROLLED_FIELDS]);
      await this.audit.record({ eventType: "supplier.updated", entityType: "SUPPLIER", entityId: id, entityLabel: after.name, changes: diff }, tx);
      if (diff) await this.activity.record(tx, { entityType: "SUPPLIER", entityId: id, entityLabel: after.name, verb: "updated", summary: `Updated ${Object.keys(diff).join(", ")}`, supplierId: id });
      return after;
    });
  }

  async changeStatus(actor: Actor, id: string, dto: ChangeStatusDto) {
    return this.db.tx(async (tx) => {
      await this.db.lockRow(tx, "suppliers", id);
      const before = await tx.supplier.findFirst({ where: { id, archivedAt: null } });
      if (!before) throw new NotFoundError("Supplier");
      if (before.status === dto.status) throw new BusinessRuleError(`Supplier is already ${dto.status}`);
      const after = await tx.supplier.update({ where: { id }, data: { status: dto.status, statusReason: dto.reason, statusChangedAt: new Date(), version: { increment: 1 } } });
      await this.audit.record({ eventType: "supplier.status_changed", entityType: "SUPPLIER", entityId: id, entityLabel: after.name, changes: diffControlled(before, after, ["status", "statusReason"]), reason: dto.reason }, tx);
      await this.activity.record(tx, { entityType: "SUPPLIER", entityId: id, entityLabel: after.name, verb: "status_changed", summary: `Status changed ${before.status} → ${dto.status}: ${dto.reason}`, supplierId: id });
      await this.outbox.publish(tx, "supplier.status_changed", "SUPPLIER", id, { from: before.status, to: dto.status });
      return after;
    });
  }

  async setAddresses(actor: Actor, id: string, dto: SetAddressesDto) {
    return this.db.tx(async (tx) => {
      const s = await tx.supplier.findFirst({ where: { id, archivedAt: null } });
      if (!s) throw new NotFoundError("Supplier");
      await tx.supplierAddress.deleteMany({ where: { supplierId: id } });
      if (dto.addresses.length) await tx.supplierAddress.createMany({ data: dto.addresses.map((a) => ({ ...a, country: a.country.toUpperCase(), supplierId: id })) });
      await this.audit.record({ eventType: "supplier.addresses_updated", entityType: "SUPPLIER", entityId: id, entityLabel: s.name, metadata: { count: dto.addresses.length } }, tx);
      return tx.supplierAddress.findMany({ where: { supplierId: id } });
    });
  }

  async setCapabilities(actor: Actor, id: string, ids: string[]) {
    return this.db.tx(async (tx) => {
      const s = await tx.supplier.findFirst({ where: { id, archivedAt: null }, include: { capabilities: true } });
      if (!s) throw new NotFoundError("Supplier");
      const found = await tx.capability.count({ where: { id: { in: ids } } });
      if (found !== ids.length) throw new BusinessRuleError("One or more capabilities do not exist");
      await tx.supplierCapability.deleteMany({ where: { supplierId: id, capabilityId: { notIn: ids } } });
      await tx.supplierCapability.createMany({ data: ids.map((capabilityId) => ({ supplierId: id, capabilityId })), skipDuplicates: true });
      await this.audit.record({ eventType: "supplier.capabilities_updated", entityType: "SUPPLIER", entityId: id, entityLabel: s.name, changes: { capabilityIds: { before: s.capabilities.map((c) => c.capabilityId).sort(), after: [...ids].sort() } } }, tx);
      return tx.supplierCapability.findMany({ where: { supplierId: id }, include: { capability: true } });
    });
  }

  async setCategories(actor: Actor, id: string, ids: string[]) {
    return this.db.tx(async (tx) => {
      const s = await tx.supplier.findFirst({ where: { id, archivedAt: null }, include: { categories: true } });
      if (!s) throw new NotFoundError("Supplier");
      const found = await tx.productCategory.count({ where: { id: { in: ids } } });
      if (found !== ids.length) throw new BusinessRuleError("One or more product categories do not exist");
      await tx.supplierProductCategory.deleteMany({ where: { supplierId: id, categoryId: { notIn: ids } } });
      await tx.supplierProductCategory.createMany({ data: ids.map((categoryId) => ({ supplierId: id, categoryId })), skipDuplicates: true });
      await this.audit.record({ eventType: "supplier.categories_updated", entityType: "SUPPLIER", entityId: id, entityLabel: s.name, changes: { categoryIds: { before: s.categories.map((c) => c.categoryId).sort(), after: [...ids].sort() } } }, tx);
      return tx.supplierProductCategory.findMany({ where: { supplierId: id }, include: { category: true } });
    });
  }

  // ------------------------------------------------------------------ sites

  async listSites(actor: Actor, supplierId: string) {
    AccessScope.of(actor).assertSupplier(supplierId, "Supplier");
    return this.db.client.supplierSite.findMany({
      where: { supplierId, archivedAt: null },
      orderBy: { siteCode: "asc" },
      include: { _count: { select: { supplierProducts: { where: { status: { in: ["APPROVED", "CONDITIONALLY_APPROVED"] } } } } }, certifications: { where: { archivedAt: null } } },
    });
  }

  async createSite(actor: Actor, supplierId: string, dto: SiteDto) {
    return this.db.tx(async (tx) => {
      const s = await tx.supplier.findFirst({ where: { id: supplierId, archivedAt: null } });
      if (!s) throw new NotFoundError("Supplier");
      const site = await tx.supplierSite.create({ data: { ...dto, siteCode: dto.siteCode.trim().toUpperCase(), country: dto.country.toUpperCase(), supplierId } });
      await this.audit.record({ eventType: "supplier_site.created", entityType: "SUPPLIER_SITE", entityId: site.id, entityLabel: `${s.name} / ${site.name}`, metadata: { supplierId, siteCode: site.siteCode } }, tx);
      await this.activity.record(tx, { entityType: "SUPPLIER", entityId: supplierId, entityLabel: s.name, verb: "site_added", summary: `Manufacturing site ${site.siteCode} ${site.name} added`, supplierId });
      return site;
    });
  }

  async updateSite(actor: Actor, siteId: string, dto: UpdateSiteDto) {
    return this.db.tx(async (tx) => {
      const before = await tx.supplierSite.findFirst({ where: { id: siteId, archivedAt: null } });
      if (!before) throw new NotFoundError("Site");
      const after = await tx.supplierSite.update({ where: { id: siteId }, data: { ...dto, ...(dto.country ? { country: dto.country.toUpperCase() } : {}) } });
      await this.audit.record({ eventType: "supplier_site.updated", entityType: "SUPPLIER_SITE", entityId: siteId, entityLabel: after.name, changes: diffControlled(before, after, ["name", "line1", "city", "region", "postalCode", "country", "isManufacturing", "processes"]) }, tx);
      return after;
    });
  }

  async changeSiteStatus(actor: Actor, siteId: string, dto: ChangeStatusDto) {
    return this.db.tx(async (tx) => {
      const before = await tx.supplierSite.findFirst({ where: { id: siteId, archivedAt: null } });
      if (!before) throw new NotFoundError("Site");
      const after = await tx.supplierSite.update({ where: { id: siteId }, data: { status: dto.status } });
      await this.audit.record({ eventType: "supplier_site.status_changed", entityType: "SUPPLIER_SITE", entityId: siteId, entityLabel: after.name, changes: diffControlled(before, after, ["status"]), reason: dto.reason }, tx);
      await this.activity.record(tx, { entityType: "SUPPLIER", entityId: before.supplierId, verb: "site_status_changed", summary: `Site ${before.siteCode} status ${before.status} → ${dto.status}: ${dto.reason}`, supplierId: before.supplierId });
      return after;
    });
  }

  // ------------------------------------------------------------------ contacts

  async listContacts(actor: Actor, supplierId: string) {
    AccessScope.of(actor).assertSupplier(supplierId, "Supplier");
    return this.db.client.contact.findMany({ where: { supplierId, archivedAt: null }, orderBy: [{ isPrimary: "desc" }, { name: "asc" }], include: { site: { select: { id: true, siteCode: true, name: true } } } });
  }

  private async assertSiteOf(tx: Tx, supplierId: string, siteId: string | null | undefined) {
    if (!siteId) return;
    const site = await tx.supplierSite.findFirst({ where: { id: siteId, supplierId } });
    if (!site) throw new BusinessRuleError("Site does not belong to this supplier");
  }

  async createContact(actor: Actor, supplierId: string, dto: ContactDto) {
    return this.db.tx(async (tx) => {
      const s = await tx.supplier.findFirst({ where: { id: supplierId, archivedAt: null } });
      if (!s) throw new NotFoundError("Supplier");
      await this.assertSiteOf(tx, supplierId, dto.siteId);
      if (dto.isPrimary) await tx.contact.updateMany({ where: { supplierId, isPrimary: true }, data: { isPrimary: false } });
      const c = await tx.contact.create({ data: { ...dto, supplierId } });
      await this.audit.record({ eventType: "contact.created", entityType: "CONTACT", entityId: c.id, entityLabel: c.name, metadata: { supplierId } }, tx);
      return c;
    });
  }

  async updateContact(actor: Actor, supplierId: string, contactId: string, dto: Partial<ContactDto>) {
    return this.db.tx(async (tx) => {
      const before = await tx.contact.findFirst({ where: { id: contactId, supplierId, archivedAt: null } });
      if (!before) throw new NotFoundError("Contact");
      await this.assertSiteOf(tx, supplierId, dto.siteId);
      if (dto.isPrimary) await tx.contact.updateMany({ where: { supplierId, isPrimary: true, id: { not: contactId } }, data: { isPrimary: false } });
      const after = await tx.contact.update({ where: { id: contactId }, data: dto });
      await this.audit.record({ eventType: "contact.updated", entityType: "CONTACT", entityId: contactId, entityLabel: after.name, changes: diffControlled(before, after, ["name", "title", "email", "phone", "role", "isPrimary", "siteId"]) }, tx);
      return after;
    });
  }

  async archiveContact(actor: Actor, supplierId: string, contactId: string) {
    return this.db.tx(async (tx) => {
      const c = await tx.contact.findFirst({ where: { id: contactId, supplierId, archivedAt: null } });
      if (!c) throw new NotFoundError("Contact");
      await tx.contact.update({ where: { id: contactId }, data: { archivedAt: new Date(), isPrimary: false } });
      await this.audit.record({ eventType: "contact.archived", entityType: "CONTACT", entityId: contactId, entityLabel: c.name }, tx);
    });
  }

  // ------------------------------------------------------------------ certifications

  async listCertifications(actor: Actor, supplierId: string) {
    AccessScope.of(actor).assertSupplier(supplierId, "Supplier");
    return this.db.client.supplierCertification.findMany({
      where: { supplierId, archivedAt: null },
      orderBy: [{ expiresAt: "asc" }],
      include: { site: { select: { id: true, siteCode: true, name: true } }, document: { select: { id: true, docNumber: true, title: true } } },
    });
  }

  private async assertDocumentOf(tx: Tx, supplierId: string, documentId: string | null | undefined) {
    if (!documentId) return;
    const doc = await tx.documentRecord.findFirst({ where: { id: documentId, OR: [{ supplierId }, { supplierId: null }] } });
    if (!doc) throw new BusinessRuleError("Document not found for this supplier");
  }

  async createCertification(actor: Actor, supplierId: string, dto: CertificationDto) {
    return this.db.tx(async (tx) => {
      const s = await tx.supplier.findFirst({ where: { id: supplierId, archivedAt: null } });
      if (!s) throw new NotFoundError("Supplier");
      await this.assertSiteOf(tx, supplierId, dto.siteId);
      await this.assertDocumentOf(tx, supplierId, dto.documentId);
      const cert = await tx.supplierCertification.create({
        data: { ...dto, supplierId, issuedAt: toDate(dto.issuedAt) ?? null, expiresAt: toDate(dto.expiresAt) ?? null },
      });
      await this.audit.record({ eventType: "certification.created", entityType: "SUPPLIER_CERTIFICATION", entityId: cert.id, entityLabel: `${s.name} ${cert.standard}`, metadata: { supplierId, expiresAt: dto.expiresAt } }, tx);
      await this.activity.record(tx, { entityType: "SUPPLIER", entityId: supplierId, entityLabel: s.name, verb: "certification_added", summary: `Certification ${cert.standard}${dto.expiresAt ? ` (expires ${dto.expiresAt})` : ""} recorded`, supplierId });
      return cert;
    });
  }

  async updateCertification(actor: Actor, supplierId: string, certId: string, dto: Partial<CertificationDto>) {
    return this.db.tx(async (tx) => {
      const before = await tx.supplierCertification.findFirst({ where: { id: certId, supplierId, archivedAt: null } });
      if (!before) throw new NotFoundError("Certification");
      await this.assertSiteOf(tx, supplierId, dto.siteId);
      await this.assertDocumentOf(tx, supplierId, dto.documentId);
      const { issuedAt, expiresAt, ...rest } = dto;
      const after = await tx.supplierCertification.update({
        where: { id: certId },
        data: { ...rest, ...(issuedAt !== undefined ? { issuedAt: toDate(issuedAt) } : {}), ...(expiresAt !== undefined ? { expiresAt: toDate(expiresAt), lastExpiryAlertAt: null } : {}) },
      });
      await this.audit.record({ eventType: "certification.updated", entityType: "SUPPLIER_CERTIFICATION", entityId: certId, entityLabel: after.standard, changes: diffControlled(before, after, ["standard", "certificateNumber", "registrar", "issuedAt", "expiresAt", "status", "documentId"]) }, tx);
      return after;
    });
  }

  async archiveCertification(actor: Actor, supplierId: string, certId: string) {
    return this.db.tx(async (tx) => {
      const c = await tx.supplierCertification.findFirst({ where: { id: certId, supplierId, archivedAt: null } });
      if (!c) throw new NotFoundError("Certification");
      await tx.supplierCertification.update({ where: { id: certId }, data: { archivedAt: new Date() } });
      await this.audit.record({ eventType: "certification.archived", entityType: "SUPPLIER_CERTIFICATION", entityId: certId, entityLabel: c.standard }, tx);
    });
  }

  // ------------------------------------------------------------------ supplier qualifications

  async listQualifications(actor: Actor, supplierId: string) {
    AccessScope.of(actor).requireInternal();
    return this.db.client.supplierQualification.findMany({ where: { supplierId }, orderBy: { createdAt: "desc" }, include: { site: { select: { siteCode: true, name: true } } } });
  }

  async getQualification(actor: Actor, id: string) {
    AccessScope.of(actor).requireInternal();
    const q = await this.db.client.supplierQualification.findUnique({ where: { id }, include: { supplier: { select: { id: true, name: true, supplierNumber: true, status: true } }, site: true } });
    if (!q) throw new NotFoundError("Supplier qualification");
    return q;
  }

  async createQualification(actor: Actor, supplierId: string, dto: CreateSupplierQualificationDto) {
    return this.db.tx(async (tx) => {
      const s = await tx.supplier.findFirst({ where: { id: supplierId, archivedAt: null } });
      if (!s) throw new NotFoundError("Supplier");
      await this.assertSiteOf(tx, supplierId, dto.siteId);
      const number = await this.numbering.next(tx, "SUPPLIER_QUALIFICATION");
      const q = await tx.supplierQualification.create({
        data: { ...dto, number, supplierId, siteId: dto.siteId ?? null, validUntil: toDate(dto.validUntil) ?? null, createdById: actor.userId },
      });
      await this.audit.record({ eventType: "supplier_qualification.created", entityType: "SUPPLIER_QUALIFICATION", entityId: q.id, entityLabel: number, metadata: { supplierId, type: dto.type, proposedStatus: dto.proposedStatus } }, tx);
      await this.activity.record(tx, { entityType: "SUPPLIER", entityId: supplierId, entityLabel: s.name, verb: "qualification_started", summary: `Supplier qualification ${number} (${dto.type}) created`, supplierId });
      return q;
    });
  }

  async updateQualification(actor: Actor, id: string, dto: UpdateSupplierQualificationDto) {
    const { expectedVersion, validUntil, ...rest } = dto;
    return this.db.tx(async (tx) => {
      const before = await tx.supplierQualification.findUnique({ where: { id } });
      if (!before) throw new NotFoundError("Supplier qualification");
      if (before.status !== "DRAFT") throw new InvalidTransitionError("Supplier qualification", before.status, "edited");
      const res = await tx.supplierQualification.updateMany({
        where: { id, version: expectedVersion, status: "DRAFT" },
        data: { ...rest, ...(validUntil !== undefined ? { validUntil: toDate(validUntil) } : {}), version: { increment: 1 } },
      });
      if (res.count !== 1) throw new StaleVersionError("Supplier qualification");
      const after = await tx.supplierQualification.findUniqueOrThrow({ where: { id } });
      await this.audit.record({ eventType: "supplier_qualification.updated", entityType: "SUPPLIER_QUALIFICATION", entityId: id, entityLabel: after.number, changes: diffControlled(before, after, ["proposedStatus", "scope", "auditScore", "conditions", "validUntil"]) }, tx);
      return after;
    });
  }

  async submitQualification(actor: Actor, id: string, expectedVersion: number) {
    return this.db.tx(async (tx, after) => {
      const q = await tx.supplierQualification.findUnique({ where: { id }, include: { supplier: true } });
      if (!q) throw new NotFoundError("Supplier qualification");
      if (q.status !== "DRAFT") throw new InvalidTransitionError("Supplier qualification", q.status, "submitted");
      if (!q.summary?.trim()) throw new BusinessRuleError("A qualification summary is required before submission");
      if (q.proposedStatus === "CONDITIONALLY_APPROVED" && !q.conditions?.trim()) throw new BusinessRuleError("Conditions are required for a conditional approval");
      const res = await tx.supplierQualification.updateMany({ where: { id, version: expectedVersion, status: "DRAFT" }, data: { status: "IN_REVIEW", version: { increment: 1 } } });
      if (res.count !== 1) throw new StaleVersionError("Supplier qualification");
      if (q.supplier.status === "PROSPECTIVE") {
        await tx.supplier.update({ where: { id: q.supplierId }, data: { status: "UNDER_EVALUATION", statusChangedAt: new Date(), statusReason: `Qualification ${q.number} submitted`, version: { increment: 1 } } });
        await this.audit.record({ eventType: "supplier.status_changed", entityType: "SUPPLIER", entityId: q.supplierId, entityLabel: q.supplier.name, changes: { status: { before: "PROSPECTIVE", after: "UNDER_EVALUATION" } }, reason: `Qualification ${q.number} submitted` }, tx);
      }
      const instance = await this.workflow.start(tx, after, {
        definitionKey: "supplier-qualification-approval",
        subjectType: "SUPPLIER_QUALIFICATION",
        subjectId: q.id,
        subjectLabel: `${q.number} ${q.supplier.name} → ${q.proposedStatus}`,
        subjectVersionRef: `v${q.version + 1}`,
        link: `/suppliers/${q.supplierId}?tab=qualifications`,
        startedById: actor.userId,
      });
      await tx.supplierQualification.update({ where: { id }, data: { workflowInstanceId: instance.id } });
      await this.audit.record({ eventType: "supplier_qualification.submitted", entityType: "SUPPLIER_QUALIFICATION", entityId: id, entityLabel: q.number }, tx);
      await this.activity.record(tx, { entityType: "SUPPLIER", entityId: q.supplierId, entityLabel: q.supplier.name, verb: "qualification_submitted", summary: `Qualification ${q.number} submitted for approval (${q.proposedStatus})`, supplierId: q.supplierId });
      return tx.supplierQualification.findUniqueOrThrow({ where: { id } });
    });
  }

  // Workflow handler -------------------------------------------------------

  async onApproved(tx: Tx, after: AfterCommit, instance: WorkflowInstance): Promise<void> {
    const q = await tx.supplierQualification.findUniqueOrThrow({ where: { id: instance.subjectId }, include: { supplier: true, site: true } });
    const decision = q.proposedStatus === "CONDITIONALLY_APPROVED" ? "CONDITIONALLY_APPROVED" : "APPROVED";
    await tx.supplierQualification.update({ where: { id: q.id }, data: { status: decision, decidedAt: new Date(), decidedById: RequestContext.get()?.actor?.userId ?? null, version: { increment: 1 } } });
    if (q.siteId && q.site) {
      await tx.supplierSite.update({ where: { id: q.siteId }, data: { status: q.proposedStatus } });
      await this.audit.record({ eventType: "supplier_site.qualified", entityType: "SUPPLIER_SITE", entityId: q.siteId, entityLabel: q.site.name, changes: { status: { before: q.site.status, after: q.proposedStatus } }, metadata: { qualification: q.number } }, tx);
    } else {
      await tx.supplier.update({ where: { id: q.supplierId }, data: { status: q.proposedStatus, statusReason: `Qualification ${q.number} approved`, statusChangedAt: new Date(), version: { increment: 1 } } });
      await this.audit.record({ eventType: "supplier.qualified", entityType: "SUPPLIER", entityId: q.supplierId, entityLabel: q.supplier.name, changes: { status: { before: q.supplier.status, after: q.proposedStatus } }, metadata: { qualification: q.number } }, tx);
    }
    await this.activity.record(tx, { entityType: "SUPPLIER", entityId: q.supplierId, entityLabel: q.supplier.name, verb: "qualified", summary: `Qualification ${q.number} approved: ${q.siteId ? `site ${q.site?.siteCode}` : "supplier"} ${q.proposedStatus}`, supplierId: q.supplierId });
    await this.outbox.publish(tx, "supplier.qualified", "SUPPLIER", q.supplierId, { qualification: q.number, status: q.proposedStatus, siteId: q.siteId });
  }

  async onRejected(tx: Tx, _after: AfterCommit, instance: WorkflowInstance, comment: string): Promise<void> {
    const q = await tx.supplierQualification.update({ where: { id: instance.subjectId }, data: { status: "REJECTED", decidedAt: new Date(), decisionComment: comment, version: { increment: 1 } } });
    await this.activity.record(tx, { entityType: "SUPPLIER", entityId: q.supplierId, verb: "qualification_rejected", summary: `Qualification ${q.number} rejected: ${comment}`, supplierId: q.supplierId });
  }

  async onInfoRequested(tx: Tx, _after: AfterCommit, instance: WorkflowInstance, comment: string): Promise<void> {
    const q = await tx.supplierQualification.update({ where: { id: instance.subjectId }, data: { status: "DRAFT", decisionComment: comment, version: { increment: 1 } } });
    await this.activity.record(tx, { entityType: "SUPPLIER", entityId: q.supplierId, verb: "qualification_returned", summary: `Qualification ${q.number} returned for more information: ${comment}`, supplierId: q.supplierId });
  }
}
