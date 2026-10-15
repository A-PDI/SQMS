"use client";

import { CHANGE_REQUEST_STATUS, DEVIATION_STATUS, DOCUMENT_STATUS, NCR_SEVERITY, NCR_STATUS, PRODUCT_QUALIFICATION_STATUS, PROJECT_STAGE, SCAR_STATUS, SOURCING_PATHWAY, SOURCING_PROJECT_STATUS, SUPPLIER_PRODUCT_STATUS, humanize } from "@sqms/shared";
import { DataTable, type FilterDef } from "@/components/data/data-table";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { formatDate, formatDateTime } from "@/lib/format";
import { toOptions } from "@/lib/options";

type Base = Record<string, unknown>;
interface Common {
  baseQuery?: Record<string, unknown>;
  syncUrl?: boolean;
  filters?: boolean;
  savedViews?: boolean;
}
const ref = (v: unknown, k: string) => ((v as Record<string, unknown> | null | undefined)?.[k] as string | undefined) ?? "";

export function ProjectsTable({ baseQuery, syncUrl = true, filters = true, savedViews = true }: Common) {
  return (
    <DataTable<{ id: string } & Base>
      endpoint="/sourcing-projects"
      queryKey="projects"
      baseQuery={baseQuery}
      syncUrl={syncUrl}
      savedViewsModule={savedViews ? "projects" : undefined}
      exportPath={syncUrl ? "/sourcing-projects/export.csv" : undefined}
      searchPlaceholder="Project, title, part, supplier"
      rowHref={(r) => `/projects/${r.id}`}
      filters={
        filters
          ? ([
              { key: "status", label: "Status", options: toOptions(SOURCING_PROJECT_STATUS) },
              { key: "pathway", label: "Pathway", options: SOURCING_PATHWAY.map((p) => ({ value: p, label: `Pathway ${p}` })) },
              { key: "stage", label: "Stage", options: toOptions(PROJECT_STAGE) },
            ] satisfies FilterDef[])
          : []
      }
      columns={[
        { key: "n", header: "Project", sortKey: "projectNumber", cell: (r) => String(r.projectNumber) },
        { key: "title", header: "Title", sortKey: "title", cell: (r) => <span className="line-clamp-2">{String(r.title)}</span> },
        { key: "pathway", header: "Path", cell: (r) => <Badge>{String(r.pathway)}</Badge> },
        { key: "part", header: "Part", cell: (r) => ref(r.internalPart, "partNumber") },
        { key: "supplier", header: "Supplier", cell: (r) => ref(r.supplier, "name") },
        { key: "status", header: "Status", sortKey: "status", cell: (r) => <StatusBadge status={String(r.status)} /> },
        { key: "stage", header: "Stage", sortKey: "stage", cell: (r) => humanize(String(r.stage)) },
        { key: "risk", header: "Risk", cell: (r) => <StatusBadge status={ref(r.risk, "level") || null} /> },
        {
          key: "check",
          header: "Checklist",
          cell: (r) => {
            const c = r.checklist as { percent: number; missing: number } | undefined;
            return c ? (
              <span className="text-xs">
                {c.percent}% {c.missing > 0 && <span className="text-warning">· {c.missing} missing</span>}
              </span>
            ) : null;
          },
        },
        { key: "target", header: "Target", sortKey: "targetDate", cell: (r) => formatDate(r.targetDate as string | null) },
      ]}
    />
  );
}

export function DocumentsTable({ baseQuery, syncUrl = true, filters = true, savedViews = true }: Common) {
  return (
    <DataTable<{ id: string } & Base>
      endpoint="/documents"
      queryKey="documents"
      baseQuery={baseQuery}
      syncUrl={syncUrl}
      savedViewsModule={savedViews ? "documents" : undefined}
      exportPath={syncUrl ? "/documents/export.csv" : undefined}
      searchPlaceholder="Number, title or type code"
      rowHref={(r) => `/documents/${r.id}`}
      filters={filters ? [{ key: "status", label: "Status", options: toOptions(DOCUMENT_STATUS) }] : []}
      columns={[
        { key: "n", header: "Number", sortKey: "docNumber", cell: (r) => String(r.docNumber) },
        { key: "title", header: "Title", sortKey: "title", cell: (r) => <span className="line-clamp-2">{String(r.title)}</span> },
        { key: "type", header: "Type", cell: (r) => <span title={ref(r.documentType, "name")}>{ref(r.documentType, "code")}</span> },
        { key: "supplier", header: "Supplier", cell: (r) => ref(r.supplier, "name") || "-" },
        { key: "status", header: "Status", sortKey: "status", cell: (r) => <StatusBadge status={String(r.status)} /> },
        { key: "rev", header: "Latest rev", cell: (r) => (r.latestRevision ? `${ref(r.latestRevision, "revisionLabel")} · ${humanize(ref(r.latestRevision, "status"))}` : "-") },
        { key: "released", header: "Released rev", cell: (r) => (r.releasedRevision ? ref(r.releasedRevision, "revisionLabel") : "-") },
        { key: "updated", header: "Updated", sortKey: "updatedAt", cell: (r) => formatDateTime(r.updatedAt as string) },
      ]}
    />
  );
}

export function NcrTable({ baseQuery, syncUrl = true, filters = true, savedViews = true }: Common) {
  return (
    <DataTable<{ id: string } & Base>
      endpoint="/ncrs"
      queryKey="ncrs"
      baseQuery={baseQuery}
      syncUrl={syncUrl}
      savedViewsModule={savedViews ? "ncrs" : undefined}
      exportPath={syncUrl ? "/ncrs/export.csv" : undefined}
      searchPlaceholder="NCR, title, lot, part"
      rowHref={(r) => `/quality/ncrs/${r.id}`}
      filters={
        filters
          ? [
              { key: "status", label: "Status", options: toOptions(NCR_STATUS) },
              { key: "severity", label: "Severity", options: toOptions(NCR_SEVERITY) },
              { key: "open", label: "Open only", options: [{ value: "true", label: "Open only" }] },
            ]
          : []
      }
      columns={[
        { key: "n", header: "NCR", sortKey: "number", cell: (r) => String(r.number) },
        { key: "title", header: "Title", sortKey: "title", cell: (r) => <span className="line-clamp-2">{String(r.title)}</span> },
        { key: "supplier", header: "Supplier", cell: (r) => ref(r.supplier, "name") },
        { key: "part", header: "Part", cell: (r) => ref(r.internalPart, "partNumber") },
        { key: "sev", header: "Severity", sortKey: "severity", cell: (r) => <StatusBadge status={String(r.severity)} /> },
        { key: "status", header: "Status", sortKey: "status", cell: (r) => <StatusBadge status={String(r.status)} /> },
        { key: "disp", header: "Disposition", cell: (r) => (r.disposition ? humanize(String(r.disposition)) : "-") },
        { key: "date", header: "Identified", sortKey: "dateIdentified", cell: (r) => formatDate(r.dateIdentified as string) },
      ]}
    />
  );
}

export function ScarTable({ baseQuery, syncUrl = true, filters = true, savedViews = true }: Common) {
  return (
    <DataTable<{ id: string } & Base>
      endpoint="/scars"
      queryKey="scars"
      baseQuery={baseQuery}
      syncUrl={syncUrl}
      savedViewsModule={savedViews ? "scars" : undefined}
      exportPath={syncUrl ? "/scars/export.csv" : undefined}
      searchPlaceholder="SCAR or title"
      rowHref={(r) => `/quality/scars/${r.id}`}
      filters={
        filters
          ? [
              { key: "status", label: "Status", options: toOptions(SCAR_STATUS) },
              { key: "overdue", label: "Overdue", options: [{ value: "true", label: "Overdue only" }] },
            ]
          : []
      }
      columns={[
        { key: "n", header: "SCAR", sortKey: "number", cell: (r) => String(r.number) },
        { key: "title", header: "Title", sortKey: "title", cell: (r) => <span className="line-clamp-2">{String(r.title)}</span> },
        { key: "supplier", header: "Supplier", cell: (r) => ref(r.supplier, "name") },
        { key: "ncr", header: "NCR", cell: (r) => ref(r.ncr, "number") || "-" },
        { key: "sev", header: "Severity", cell: (r) => <StatusBadge status={String(r.severity)} /> },
        { key: "status", header: "Status", sortKey: "status", cell: (r) => <StatusBadge status={String(r.status)} /> },
        { key: "due", header: "Response due", sortKey: "responseDueDate", cell: (r) => <span className={r.overdue ? "font-medium text-destructive" : ""}>{formatDate(r.responseDueDate as string)}{r.overdue ? " · overdue" : ""}</span> },
        { key: "esc", header: "Escalation", cell: (r) => (Number(r.escalationLevel) > 0 ? <Badge tone="danger">Level {String(r.escalationLevel)}</Badge> : "-") },
      ]}
    />
  );
}

export function ChangesTable({ baseQuery, syncUrl = true, filters = true, savedViews = true }: Common) {
  return (
    <DataTable<{ id: string } & Base>
      endpoint="/change-requests"
      queryKey="change-requests"
      baseQuery={baseQuery}
      syncUrl={syncUrl}
      savedViewsModule={savedViews ? "changes" : undefined}
      exportPath={syncUrl ? "/change-requests/export.csv" : undefined}
      searchPlaceholder="Number, title or part"
      rowHref={(r) => `/changes/${r.id}`}
      filters={filters ? [{ key: "status", label: "Status", options: toOptions(CHANGE_REQUEST_STATUS) }] : []}
      columns={[
        { key: "n", header: "Change", sortKey: "number", cell: (r) => String(r.number) },
        { key: "title", header: "Title", sortKey: "title", cell: (r) => <span className="line-clamp-2">{String(r.title)}</span> },
        { key: "supplier", header: "Supplier", cell: (r) => ref(r.supplier, "name") },
        { key: "part", header: "Part", cell: (r) => ref(r.internalPart, "partNumber") },
        { key: "cat", header: "Categories", cell: (r) => (r.categories as string[]).map(humanize).join(", ") },
        { key: "status", header: "Status", sortKey: "status", cell: (r) => <StatusBadge status={String(r.status)} /> },
        { key: "impl", header: "Proposed implementation", sortKey: "proposedImplementationDate", cell: (r) => formatDate(r.proposedImplementationDate as string | null) },
        { key: "updated", header: "Updated", sortKey: "updatedAt", cell: (r) => formatDateTime(r.updatedAt as string) },
      ]}
    />
  );
}

export function DeviationsTable({ baseQuery, syncUrl = true, filters = true, savedViews = true }: Common) {
  return (
    <DataTable<{ id: string } & Base>
      endpoint="/deviations"
      queryKey="deviations"
      baseQuery={baseQuery}
      syncUrl={syncUrl}
      savedViewsModule={savedViews ? "deviations" : undefined}
      searchPlaceholder="Number or title"
      rowHref={(r) => `/quality/deviations/${r.id}`}
      filters={
        filters
          ? [
              { key: "status", label: "Status", options: toOptions(DEVIATION_STATUS) },
              { key: "type", label: "Type", options: toOptions(["DEVIATION", "CONCESSION"]) },
            ]
          : []
      }
      columns={[
        { key: "n", header: "Number", sortKey: "number", cell: (r) => String(r.number) },
        { key: "title", header: "Title", sortKey: "title", cell: (r) => <span className="line-clamp-2">{String(r.title)}</span> },
        { key: "type", header: "Type", cell: (r) => humanize(String(r.type)) },
        { key: "supplier", header: "Supplier", cell: (r) => ref(r.supplier, "name") },
        { key: "status", header: "Status", sortKey: "status", cell: (r) => <StatusBadge status={String(r.status)} /> },
        { key: "limit", header: "Limit", cell: (r) => [r.quantityLimit ? `${String(r.quantityLimit)} pcs` : null, r.endDate ? `until ${formatDate(r.endDate as string)}` : null].filter(Boolean).join(" · ") || "-" },
        { key: "updated", header: "Updated", sortKey: "updatedAt", cell: (r) => formatDateTime(r.updatedAt as string) },
      ]}
    />
  );
}

export function SupplierProductsTable({ baseQuery, syncUrl = false }: Common) {
  return (
    <DataTable<{ id: string } & Base>
      endpoint="/supplier-products"
      queryKey="supplier-products"
      baseQuery={baseQuery}
      syncUrl={syncUrl}
      searchPlaceholder="Part or supplier part number"
      rowHref={(r) => `/products/supplier-products/${r.id}`}
      filters={[{ key: "status", label: "Status", options: toOptions(SUPPLIER_PRODUCT_STATUS) }]}
      columns={[
        { key: "part", header: "Part", cell: (r) => ref(r.internalPart, "partNumber") },
        { key: "desc", header: "Description", cell: (r) => ref(r.internalPart, "description") },
        { key: "sp", header: "Supplier part", cell: (r) => ref(r.supplierPart, "supplierPartNumber") },
        { key: "supplier", header: "Supplier", cell: (r) => ref(r.supplier, "name") },
        { key: "site", header: "Site", cell: (r) => ref(r.site, "siteCode") },
        { key: "status", header: "Approval status", cell: (r) => <StatusBadge status={String(r.status)} /> },
        { key: "approved", header: "Approved", cell: (r) => formatDate(r.approvedAt as string | null) },
      ]}
    />
  );
}

export function QualificationsTable({ baseQuery, syncUrl = true, filters = true, savedViews = true }: Common) {
  return (
    <DataTable<{ id: string } & Base>
      endpoint="/qualifications"
      queryKey="qualifications"
      baseQuery={baseQuery}
      syncUrl={syncUrl}
      savedViewsModule={savedViews ? "qualifications" : undefined}
      searchPlaceholder="Number or title"
      rowHref={(r) => `/qualifications/${r.id}`}
      filters={filters ? [{ key: "status", label: "Status", options: toOptions(PRODUCT_QUALIFICATION_STATUS) }] : []}
      columns={[
        { key: "n", header: "Qualification", sortKey: "number", cell: (r) => String(r.number) },
        { key: "title", header: "Title", cell: (r) => <span className="line-clamp-2">{String(r.title)}</span> },
        { key: "supplier", header: "Supplier", cell: (r) => ref(r.supplier, "name") },
        {
          key: "config",
          header: "Configuration",
          cell: (r) => {
            const rev = r.configurationRevision as { revisionLabel: string; configuration: { configCode: string } } | null;
            return rev ? `${rev.configuration.configCode} rev ${rev.revisionLabel}` : "-";
          },
        },
        { key: "origin", header: "Origin", cell: (r) => (r.changeRequestId ? <Badge tone="info">Change request</Badge> : r.pathway ? <Badge>Pathway {String(r.pathway)}</Badge> : "-") },
        { key: "risk", header: "Risk", cell: (r) => <StatusBadge status={(r.riskLevel as string | null) ?? null} /> },
        { key: "status", header: "Status", sortKey: "status", cell: (r) => <StatusBadge status={String(r.status)} /> },
        { key: "updated", header: "Updated", sortKey: "updatedAt", cell: (r) => formatDateTime(r.updatedAt as string) },
      ]}
    />
  );
}
