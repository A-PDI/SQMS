import { Injectable, Logger } from "@nestjs/common";
import type { ProductApprovalStatus } from "@sqms/db";
import type { Actor } from "../../common/auth/actor";
import { AccessScope } from "../../common/auth/access-scope";
import { DbService } from "../../common/db/db.service";
import { NotFoundError } from "../../common/errors/app-errors";
import { ChangeRequestsService } from "../change-requests/change-requests.service";
import { DocumentsService } from "../documents/documents.service";
import { ProductsService } from "../products/products.service";
import { QualificationsService } from "../qualifications/qualifications.service";
import { DeviationsService } from "../quality/deviations.service";
import { NcrService, OPEN_NCR_STATUSES } from "../quality/ncr.service";
import { ScarService } from "../quality/scar.service";
import { SourcingService } from "../sourcing/sourcing.service";
import { SuppliersService } from "../suppliers/suppliers.service";
import type { ReportQuery, SearchQuery } from "./insights.dto";

const DAY = 86_400_000;
const OPEN_SCAR = ["ISSUED", "RESPONSE_SUBMITTED", "RESPONSE_REJECTED", "ACCEPTED", "VERIFICATION"] as const;
const OPEN_CR = ["SUBMITTED", "UNDER_REVIEW", "INFO_REQUIRED", "VALIDATION_REQUIRED"] as const;
const ACTIVE_PROJECT = ["DRAFT", "SUBMITTED", "IN_PROGRESS", "QUALIFICATION", "ON_HOLD"] as const;

export interface ReportColumn {
  key: string;
  header: string;
}

export interface ReportResult {
  key: string;
  title: string;
  generatedAt: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
}

const startOfUtcDay = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const ageDays = (d: Date) => Math.floor((Date.now() - d.getTime()) / DAY);

export const REPORTS: Record<string, { title: string; description: string }> = {
  "approved-suppliers": { title: "Approved supplier list", description: "Approved and conditionally approved suppliers with sites, certifications and open quality items." },
  "product-approvals": { title: "Product approval register", description: "Approved supplier-product-configuration-site records with their approval package." },
  "project-checklists": { title: "Sourcing project checklist status", description: "Active sourcing projects with document checklist completeness and overdue items." },
  "quality-open-items": { title: "Open quality items", description: "Open NCRs, corrective actions and deviations with age and due dates." },
  "supplier-scorecard": { title: "Supplier scorecard", description: "Quality performance per supplier over the last 12 months." },
  "expiring-certifications": { title: "Expiring certifications", description: "Supplier certifications expiring within the selected number of days." },
};

@Injectable()
export class InsightsService {
  private readonly logger = new Logger("Search");

  constructor(
    private readonly db: DbService,
    private readonly suppliers: SuppliersService,
    private readonly products: ProductsService,
    private readonly projects: SourcingService,
    private readonly documents: DocumentsService,
    private readonly changes: ChangeRequestsService,
    private readonly ncrs: NcrService,
    private readonly scars: ScarService,
    private readonly deviations: DeviationsService,
    private readonly qualifications: QualificationsService,
  ) {}

  // ------------------------------------------------------------------ dashboard

  async dashboard(actor: Actor) {
    AccessScope.of(actor).requireInternal();
    const c = this.db.client;
    const now = new Date();
    const today = startOfUtcDay();
    const myTasks = { OR: [{ assigneeUserId: actor.userId }, { assigneeUserId: null, assigneeRoleKey: { in: actor.roles } }], status: { in: ["OPEN" as const, "IN_PROGRESS" as const] } };
    const [
      tasksOpen,
      tasksOverdue,
      approvalsPending,
      projectsByStatus,
      projectsByStage,
      overdueRequirements,
      suppliersByStatus,
      certsExpiring,
      ncrsBySeverity,
      scarsOpen,
      scarsOverdue,
      changesOpen,
      deviationsOpen,
      documentsInReview,
      approvals30,
      activity,
    ] = await Promise.all([
      c.task.count({ where: myTasks }),
      c.task.count({ where: { ...myTasks, dueAt: { lt: now } } }),
      c.task.count({ where: { ...myTasks, type: "APPROVAL" } }),
      c.sourcingProject.groupBy({ by: ["status"], where: { archivedAt: null }, _count: { _all: true } }),
      c.sourcingProject.groupBy({ by: ["stage"], where: { archivedAt: null, status: { in: [...ACTIVE_PROJECT] } }, _count: { _all: true } }),
      c.requiredDocument.count({ where: { status: { in: ["OPEN", "REJECTED"] }, dueDate: { lt: today }, project: { status: { in: [...ACTIVE_PROJECT] } } } }),
      c.supplier.groupBy({ by: ["status"], where: { archivedAt: null }, _count: { _all: true } }),
      c.supplierCertification.count({ where: { archivedAt: null, status: { in: ["VALID", "PENDING_VERIFICATION"] }, expiresAt: { gte: today, lte: new Date(today.getTime() + 60 * DAY) } } }),
      c.nonconformance.groupBy({ by: ["severity"], where: { status: { in: OPEN_NCR_STATUSES } }, _count: { _all: true } }),
      c.correctiveAction.count({ where: { status: { in: [...OPEN_SCAR] } } }),
      c.correctiveAction.count({ where: { status: { in: ["ISSUED", "RESPONSE_REJECTED"] }, responseDueDate: { lt: today } } }),
      c.changeRequest.groupBy({ by: ["status"], where: { status: { in: [...OPEN_CR, "APPROVED"] } }, _count: { _all: true } }),
      c.deviation.count({ where: { status: { in: ["SUBMITTED", "APPROVED"] } } }),
      c.documentRevision.count({ where: { status: "IN_REVIEW" } }),
      c.productApproval.count({ where: { approvedAt: { gte: new Date(now.getTime() - 30 * DAY) } } }),
      c.activityEvent.findMany({ orderBy: { occurredAt: "desc" }, take: 15 }),
    ]);
    const count = <T extends string>(rows: { _count: { _all: number } }[], key: (r: never) => T) => Object.fromEntries(rows.map((r) => [key(r as never), r._count._all]));
    return {
      generatedAt: now.toISOString(),
      myWork: { tasksOpen, tasksOverdue, approvalsPending },
      projects: { byStatus: count(projectsByStatus, (r: { status: string }) => r.status), byStage: count(projectsByStage, (r: { stage: string }) => r.stage), overdueRequirements },
      suppliers: { byStatus: count(suppliersByStatus, (r: { status: string }) => r.status), certificationsExpiring60Days: certsExpiring },
      quality: { openNcrsBySeverity: count(ncrsBySeverity, (r: { severity: string }) => r.severity), scarsOpen, scarsOverdue, deviationsOpen },
      changes: { byStatus: count(changesOpen, (r: { status: string }) => r.status) },
      documents: { inReview: documentsInReview },
      approvals: { productApprovalsLast30Days: approvals30 },
      recentActivity: activity,
    };
  }

  // ------------------------------------------------------------------ reports

  list() {
    return Object.entries(REPORTS).map(([key, r]) => ({ key, ...r }));
  }

  async run(actor: Actor, key: string, q: ReportQuery): Promise<ReportResult> {
    AccessScope.of(actor).requireInternal();
    const def = REPORTS[key];
    if (!def) throw new NotFoundError("Report");
    const build = { "approved-suppliers": () => this.approvedSuppliers(q), "product-approvals": () => this.productApprovals(q), "project-checklists": () => this.projectChecklists(q), "quality-open-items": () => this.openQualityItems(q), "supplier-scorecard": () => this.scorecard(q), "expiring-certifications": () => this.expiringCertifications(q) }[key]!;
    const { columns, rows } = await build();
    return { key, title: def.title, generatedAt: new Date().toISOString(), columns, rows };
  }

  private async approvedSuppliers(q: ReportQuery) {
    const rows = await this.db.client.supplier.findMany({
      where: { archivedAt: null, status: { in: q.status?.length ? (q.status as ("APPROVED" | "CONDITIONALLY_APPROVED")[]) : ["APPROVED", "CONDITIONALLY_APPROVED"] }, ...(q.supplierId ? { id: q.supplierId } : {}) },
      orderBy: { name: "asc" },
      take: 5000,
      include: {
        sites: { where: { archivedAt: null }, select: { siteCode: true, status: true } },
        certifications: { where: { archivedAt: null, status: "VALID" }, select: { standard: true, expiresAt: true } },
        qualifications: { where: { status: { in: ["APPROVED", "CONDITIONALLY_APPROVED"] } }, orderBy: { decidedAt: "desc" }, take: 1, select: { number: true, decidedAt: true } },
        _count: { select: { nonconformances: { where: { status: { in: OPEN_NCR_STATUSES } } }, correctiveActions: { where: { status: { in: [...OPEN_SCAR] } } } } },
      },
    });
    const approvals = await this.db.client.productApproval.groupBy({ by: ["supplierId"], where: { status: "ACTIVE", supplierId: { in: rows.map((r) => r.id) } }, _count: { _all: true } });
    return {
      columns: [
        { key: "supplierNumber", header: "Supplier no." },
        { key: "name", header: "Supplier" },
        { key: "status", header: "Status" },
        { key: "country", header: "Country" },
        { key: "sites", header: "Sites" },
        { key: "certifications", header: "Valid certifications" },
        { key: "qualifiedAt", header: "Last qualified" },
        { key: "approvedProducts", header: "Approved products" },
        { key: "openNcrs", header: "Open NCRs" },
        { key: "openScars", header: "Open SCARs" },
      ],
      rows: rows.map((s) => ({
        id: s.id,
        supplierNumber: s.supplierNumber,
        name: s.name,
        status: s.status,
        country: s.country,
        sites: s.sites.map((x) => `${x.siteCode}${["APPROVED", "CONDITIONALLY_APPROVED"].includes(x.status) ? "" : ` (${x.status})`}`).join(", "),
        certifications: s.certifications.map((c) => `${c.standard}${c.expiresAt ? ` exp ${iso(c.expiresAt)}` : ""}`).join("; "),
        qualifiedAt: iso(s.qualifications[0]?.decidedAt),
        approvedProducts: approvals.find((a) => a.supplierId === s.id)?._count._all ?? 0,
        openNcrs: s._count.nonconformances,
        openScars: s._count.correctiveActions,
      })),
    };
  }

  private async productApprovals(q: ReportQuery) {
    const rows = await this.db.client.productApproval.findMany({
      where: { status: { in: (q.status?.length ? q.status : ["ACTIVE"]) as ProductApprovalStatus[] }, ...(q.supplierId ? { supplierId: q.supplierId } : {}) },
      orderBy: { approvedAt: "desc" },
      take: 10_000,
      include: {
        internalPart: { select: { partNumber: true, description: true } },
        supplierProduct: { include: { supplier: { select: { name: true, supplierNumber: true } }, supplierPart: { select: { supplierPartNumber: true } }, site: { select: { siteCode: true, name: true } } } },
        configurationRevision: { select: { revisionLabel: true, configuration: { select: { configCode: true, customPartNumber: true, configurationType: true } } } },
        approvalPackage: { select: { number: true } },
      },
    });
    return {
      columns: [
        { key: "number", header: "Approval" },
        { key: "partNumber", header: "Part" },
        { key: "description", header: "Description" },
        { key: "supplier", header: "Supplier" },
        { key: "supplierPartNumber", header: "Supplier part no." },
        { key: "site", header: "Site" },
        { key: "configuration", header: "Configuration" },
        { key: "configurationType", header: "Type" },
        { key: "status", header: "Status" },
        { key: "approvedAt", header: "Approved" },
        { key: "restrictions", header: "Restrictions" },
        { key: "approvalPackage", header: "Approval package" },
      ],
      rows: rows.map((a) => ({
        id: a.id,
        number: a.number,
        partNumber: a.internalPart.partNumber,
        description: a.internalPart.description,
        supplier: `${a.supplierProduct.supplier.supplierNumber} ${a.supplierProduct.supplier.name}`,
        supplierPartNumber: a.configurationRevision.configuration.customPartNumber ?? a.supplierProduct.supplierPart.supplierPartNumber,
        site: `${a.supplierProduct.site.siteCode} ${a.supplierProduct.site.name}`,
        configuration: `${a.configurationRevision.configuration.configCode} rev ${a.configurationRevision.revisionLabel}`,
        configurationType: a.configurationRevision.configuration.configurationType,
        status: a.status,
        approvedAt: iso(a.approvedAt),
        restrictions: a.restrictions,
        approvalPackage: a.approvalPackage.number,
      })),
    };
  }

  private async projectChecklists(q: ReportQuery) {
    const today = startOfUtcDay();
    const rows = await this.db.client.sourcingProject.findMany({
      where: { archivedAt: null, status: { in: q.status?.length ? (q.status as (typeof ACTIVE_PROJECT)[number][]) : [...ACTIVE_PROJECT] }, ...(q.supplierId ? { supplierId: q.supplierId } : {}) },
      orderBy: { projectNumber: "asc" },
      take: 5000,
      include: {
        supplier: { select: { name: true } },
        internalPart: { select: { partNumber: true } },
        owner: { select: { displayName: true } },
        riskAssessments: { where: { isCurrent: true }, select: { level: true } },
        requiredDocuments: { select: { status: true, level: true, dueDate: true } },
      },
    });
    return {
      columns: [
        { key: "projectNumber", header: "Project" },
        { key: "title", header: "Title" },
        { key: "pathway", header: "Pathway" },
        { key: "status", header: "Status" },
        { key: "stage", header: "Stage" },
        { key: "supplier", header: "Supplier" },
        { key: "part", header: "Part" },
        { key: "risk", header: "Risk" },
        { key: "owner", header: "Owner" },
        { key: "requirements", header: "Requirements" },
        { key: "completed", header: "Completed" },
        { key: "missingRequired", header: "Missing required" },
        { key: "overdue", header: "Overdue items" },
        { key: "percent", header: "Complete %" },
        { key: "targetDate", header: "Target date" },
      ],
      rows: rows.map((p) => {
        const s = this.projects.summarize(p.requiredDocuments);
        return {
          id: p.id,
          projectNumber: p.projectNumber,
          title: p.title,
          pathway: p.pathway,
          status: p.status,
          stage: p.stage,
          supplier: p.supplier.name,
          part: p.internalPart.partNumber,
          risk: p.riskAssessments[0]?.level ?? null,
          owner: p.owner.displayName,
          requirements: s.total,
          completed: s.completed,
          missingRequired: p.requiredDocuments.filter((r) => r.level === "REQUIRED" && (r.status === "OPEN" || r.status === "REJECTED")).length,
          overdue: p.requiredDocuments.filter((r) => r.dueDate && r.dueDate < today && (r.status === "OPEN" || r.status === "REJECTED")).length,
          percent: s.percent,
          targetDate: iso(p.targetDate),
        };
      }),
    };
  }

  private async openQualityItems(q: ReportQuery) {
    const today = startOfUtcDay();
    const supplier = q.supplierId ? { supplierId: q.supplierId } : {};
    const [ncrs, scars, devs] = await Promise.all([
      this.db.client.nonconformance.findMany({ where: { status: { in: OPEN_NCR_STATUSES }, ...supplier }, include: { supplier: { select: { name: true } }, owner: { select: { displayName: true } } }, take: 5000 }),
      this.db.client.correctiveAction.findMany({ where: { status: { in: [...OPEN_SCAR] }, ...supplier }, include: { supplier: { select: { name: true } } }, take: 5000 }),
      this.db.client.deviation.findMany({ where: { status: { in: ["SUBMITTED", "APPROVED"] }, ...supplier }, include: { supplier: { select: { name: true } } }, take: 5000 }),
    ]);
    const rows = [
      ...ncrs.map((n) => ({ id: n.id, kind: "NCR", number: n.number, title: n.title, supplier: n.supplier.name, severity: n.severity, status: n.status, opened: iso(n.dateIdentified), ageDays: ageDays(n.createdAt), due: null as string | null, overdue: false, owner: n.owner.displayName })),
      ...scars.map((s) => ({ id: s.id, kind: "SCAR", number: s.number, title: s.title, supplier: s.supplier.name, severity: s.severity, status: s.status, opened: iso(s.issuedAt ?? s.createdAt), ageDays: ageDays(s.issuedAt ?? s.createdAt), due: iso(s.responseDueDate), overdue: ["ISSUED", "RESPONSE_REJECTED"].includes(s.status) && s.responseDueDate < today, owner: null })),
      ...devs.map((d) => ({ id: d.id, kind: d.type, number: d.number, title: d.title, supplier: d.supplier.name, severity: null, status: d.status, opened: iso(d.createdAt), ageDays: ageDays(d.createdAt), due: iso(d.endDate), overdue: false, owner: null })),
    ].sort((a, b) => b.ageDays - a.ageDays);
    return {
      columns: [
        { key: "kind", header: "Type" },
        { key: "number", header: "Number" },
        { key: "title", header: "Title" },
        { key: "supplier", header: "Supplier" },
        { key: "severity", header: "Severity" },
        { key: "status", header: "Status" },
        { key: "opened", header: "Opened" },
        { key: "ageDays", header: "Age (days)" },
        { key: "due", header: "Due / end" },
        { key: "overdue", header: "Overdue" },
        { key: "owner", header: "Owner" },
      ],
      rows,
    };
  }

  private async scorecard(q: ReportQuery) {
    const since = new Date(Date.now() - 365 * DAY);
    const suppliers = await this.db.client.supplier.findMany({ where: { archivedAt: null, status: { in: ["APPROVED", "CONDITIONALLY_APPROVED", "SUSPENDED"] }, ...(q.supplierId ? { id: q.supplierId } : {}) }, orderBy: { name: "asc" }, take: 2000, select: { id: true, name: true, supplierNumber: true, status: true } });
    const ids = suppliers.map((s) => s.id);
    const [ncr, critical, scarIssued, scarClosed, scarOpen, overdue, changes, approvals] = await Promise.all([
      this.db.client.nonconformance.groupBy({ by: ["supplierId"], where: { supplierId: { in: ids }, dateIdentified: { gte: since }, status: { not: "CANCELLED" } }, _count: { _all: true } }),
      this.db.client.nonconformance.groupBy({ by: ["supplierId"], where: { supplierId: { in: ids }, dateIdentified: { gte: since }, severity: "CRITICAL", status: { not: "CANCELLED" } }, _count: { _all: true } }),
      this.db.client.correctiveAction.groupBy({ by: ["supplierId"], where: { supplierId: { in: ids }, issuedAt: { gte: since } }, _count: { _all: true } }),
      this.db.client.correctiveAction.findMany({ where: { supplierId: { in: ids }, closedAt: { gte: since }, issuedAt: { not: null }, status: "CLOSED" }, select: { supplierId: true, issuedAt: true, closedAt: true } }),
      this.db.client.correctiveAction.groupBy({ by: ["supplierId"], where: { supplierId: { in: ids }, status: { in: [...OPEN_SCAR] } }, _count: { _all: true } }),
      this.db.client.correctiveAction.groupBy({ by: ["supplierId"], where: { supplierId: { in: ids }, status: { in: ["ISSUED", "RESPONSE_REJECTED"] }, responseDueDate: { lt: startOfUtcDay() } }, _count: { _all: true } }),
      this.db.client.changeRequest.groupBy({ by: ["supplierId"], where: { supplierId: { in: ids }, createdAt: { gte: since } }, _count: { _all: true } }),
      this.db.client.productApproval.groupBy({ by: ["supplierId"], where: { supplierId: { in: ids }, status: "ACTIVE" }, _count: { _all: true } }),
    ]);
    const get = (rows: { supplierId: string; _count: { _all: number } }[], id: string) => rows.find((r) => r.supplierId === id)?._count._all ?? 0;
    return {
      columns: [
        { key: "supplierNumber", header: "Supplier no." },
        { key: "name", header: "Supplier" },
        { key: "status", header: "Status" },
        { key: "approvedProducts", header: "Approved products" },
        { key: "ncrs12m", header: "NCRs (12 mo)" },
        { key: "criticalNcrs12m", header: "Critical NCRs (12 mo)" },
        { key: "scarsIssued12m", header: "SCARs issued (12 mo)" },
        { key: "openScars", header: "Open SCARs" },
        { key: "overdueScars", header: "Overdue SCARs" },
        { key: "avgScarCloseDays", header: "Avg SCAR closure (days)" },
        { key: "changeRequests12m", header: "Change requests (12 mo)" },
      ],
      rows: suppliers.map((s) => {
        const closed = scarClosed.filter((x) => x.supplierId === s.id);
        const avg = closed.length ? Math.round((closed.reduce((sum, x) => sum + (x.closedAt!.getTime() - x.issuedAt!.getTime()) / DAY, 0) / closed.length) * 10) / 10 : null;
        return {
          id: s.id,
          supplierNumber: s.supplierNumber,
          name: s.name,
          status: s.status,
          approvedProducts: get(approvals, s.id),
          ncrs12m: get(ncr, s.id),
          criticalNcrs12m: get(critical, s.id),
          scarsIssued12m: get(scarIssued, s.id),
          openScars: get(scarOpen, s.id),
          overdueScars: get(overdue, s.id),
          avgScarCloseDays: avg,
          changeRequests12m: get(changes, s.id),
        };
      }),
    };
  }

  private async expiringCertifications(q: ReportQuery) {
    const today = startOfUtcDay();
    const days = q.days ?? 90;
    const rows = await this.db.client.supplierCertification.findMany({
      where: { archivedAt: null, status: { in: ["VALID", "PENDING_VERIFICATION", "EXPIRED"] }, expiresAt: { not: null, lte: new Date(today.getTime() + days * DAY) }, ...(q.supplierId ? { supplierId: q.supplierId } : {}) },
      orderBy: { expiresAt: "asc" },
      take: 5000,
      include: { supplier: { select: { name: true, supplierNumber: true, status: true } } },
    });
    return {
      columns: [
        { key: "supplier", header: "Supplier" },
        { key: "supplierStatus", header: "Supplier status" },
        { key: "standard", header: "Standard" },
        { key: "certificateNumber", header: "Certificate" },
        { key: "status", header: "Status" },
        { key: "expiresAt", header: "Expires" },
        { key: "daysLeft", header: "Days left" },
      ],
      rows: rows.map((c) => ({ id: c.id, supplierId: c.supplierId, supplier: `${c.supplier.supplierNumber} ${c.supplier.name}`, supplierStatus: c.supplier.status, standard: c.standard, certificateNumber: c.certificateNumber, status: c.status, expiresAt: iso(c.expiresAt), daysLeft: Math.ceil((c.expiresAt!.getTime() - today.getTime()) / DAY) })),
    };
  }

  // ------------------------------------------------------------------ global search

  /**
   * Searches across record types through each module's own list query, so the same record-level access rules
   * (including supplier isolation) apply as on the list pages.
   */
  async search(actor: Actor, q: SearchQuery) {
    const scope = AccessScope.of(actor);
    const term = q.q.trim();
    const limit = q.limit ?? 6;
    const page = { q: term, page: 1, pageSize: limit };
    const want = (t: string) => !q.types?.length || q.types.includes(t);
    const has = (p: string) => actor.permissions.has(p);
    type Hit = { type: string; id: string; title: string; subtitle?: string | null; status?: string | null; link: string };
    const tasks: Promise<Hit[]>[] = [];
    const add = (type: string, enabled: boolean, run: () => Promise<Hit[]>) => {
      if (!enabled || !want(type)) return;
      // One failing source must not break global search; the failure is logged server-side.
      tasks.push(
        run().catch((err: unknown) => {
          this.logger.warn(`Search source ${type} failed: ${err instanceof Error ? err.message : String(err)}`);
          return [];
        }),
      );
    };
    type R = Record<string, unknown>;
    const items = async (p: Promise<{ items: unknown[] }>) => (await p).items as R[];
    add("supplier", has("supplier:read") && scope.isInternal, async () => (await items(this.suppliers.list(actor, page as never))).map((s) => ({ type: "supplier", id: String(s.id), title: String(s.name), subtitle: String(s.supplierNumber), status: String(s.status), link: `/suppliers/${s.id}` })));
    add("part", has("product:read") && scope.isInternal, async () => (await items(this.products.listParts(actor, page as never))).map((p) => ({ type: "part", id: String(p.id), title: String(p.partNumber), subtitle: String(p.description ?? ""), status: String(p.status ?? ""), link: `/products/${p.id}` })));
    add("supplier-part", has("product:read"), async () => (await items(this.products.listSupplierParts(actor, page as never))).map((p) => ({ type: "supplier-part", id: String(p.id), title: String(p.supplierPartNumber), subtitle: String(p.description ?? ""), link: scope.isInternal ? `/suppliers/${p.supplierId}` : "/portal" })));
    add("project", has("project:read"), async () => (await items(this.projects.list(actor, page as never))).map((p) => ({ type: "project", id: String(p.id), title: `${p.projectNumber} ${p.title}`, subtitle: `Pathway ${p.pathway}`, status: String(p.status), link: `/projects/${p.id}` })));
    add("document", has("document:read"), async () => (await items(this.documents.list(actor, page as never))).map((d) => ({ type: "document", id: String(d.id), title: `${d.docNumber} ${d.title}`, subtitle: String((d.documentType as R | undefined)?.code ?? ""), status: String(d.status), link: `/documents/${d.id}` })));
    add("qualification", has("qualification:read") && scope.isInternal, async () => (await items(this.qualifications.list(actor, page as never))).map((x) => ({ type: "qualification", id: String(x.id), title: `${x.number} ${x.title}`, status: String(x.status), link: `/qualifications/${x.id}` })));
    add("change-request", has("change:read"), async () => (await items(this.changes.list(actor, page as never))).map((x) => ({ type: "change-request", id: String(x.id), title: `${x.number} ${x.title}`, status: String(x.status), link: `/changes/${x.id}` })));
    add("ncr", has("ncr:read"), async () => (await items(this.ncrs.list(actor, page as never))).map((x) => ({ type: "ncr", id: String(x.id), title: `${x.number} ${x.title}`, subtitle: String(x.severity), status: String(x.status), link: `/quality/ncrs/${x.id}` })));
    add("scar", has("scar:read"), async () => (await items(this.scars.list(actor, page as never))).map((x) => ({ type: "scar", id: String(x.id), title: `${x.number} ${x.title}`, status: String(x.status), link: `/quality/scars/${x.id}` })));
    add("deviation", has("deviation:read"), async () => (await items(this.deviations.list(actor, page as never))).map((x) => ({ type: "deviation", id: String(x.id), title: `${x.number} ${x.title}`, subtitle: String(x.type), status: String(x.status), link: `/quality/deviations/${x.id}` })));
    const results = (await Promise.all(tasks)).flat();
    return { q: term, total: results.length, results };
  }
}
