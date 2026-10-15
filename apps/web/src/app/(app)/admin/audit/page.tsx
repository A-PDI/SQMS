"use client";

import { humanize } from "@sqms/shared";
import { FileJson } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DataTable } from "@/components/data/data-table";
import { PageHeader } from "@/components/shell/page-header";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/format";
import { entityHref } from "@/lib/links";

interface AuditRow {
  id: string;
  occurredAt: string;
  actorType: string;
  actorEmail: string | null;
  eventType: string;
  outcome: string;
  entityType: string | null;
  entityId: string | null;
  entityLabel: string | null;
  changes: unknown;
  metadata: unknown;
  reason: string | null;
  correlationId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

const EVENT_PREFIXES = ["auth.", "admin.", "user.", "approval.", "workflow.", "supplier.", "supplier_site.", "supplier_qualification.", "certification.", "product.", "supplier_product.", "configuration.", "configuration_revision.", "baseline.", "sourcing_project.", "risk.", "requirement.", "document.", "document_revision.", "document_type.", "template_revision.", "form_version.", "qualification.", "change_request.", "ncr.", "scar.", "deviation.", "file.", "attachment.", "comment.", "task.", "export."];
const ENTITY_TYPES = ["USER", "SYSTEM", "SUPPLIER", "SUPPLIER_SITE", "SUPPLIER_QUALIFICATION", "SUPPLIER_CERTIFICATION", "CONTACT", "INTERNAL_PART", "SUPPLIER_PART", "SUPPLIER_PRODUCT", "PRODUCT_CONFIGURATION", "CONFIGURATION_REVISION", "SOURCING_PROJECT", "REQUIRED_DOCUMENT", "DOCUMENT", "DOCUMENT_REVISION", "DOCUMENT_TYPE", "DOCUMENT_TEMPLATE", "TEMPLATE_REVISION", "PRODUCT_QUALIFICATION", "CHANGE_REQUEST", "NCR", "SCAR", "DEVIATION", "FILE", "TASK", "APPLICABILITY_POLICY"];

export default function AuditPage() {
  const [detail, setDetail] = useState<AuditRow | null>(null);
  return (
    <>
      <PageHeader title="Audit trail" description="Append-only record of security events, data changes, approvals, waivers and administrative actions. Entries cannot be edited or deleted from the application." />
      <DataTable<AuditRow>
        endpoint="/audit"
        queryKey="audit"
        exportPath="/audit/export.csv"
        savedViewsModule="audit"
        searchPlaceholder="Search record label or actor email"
        pageSize={50}
        filters={[
          { key: "outcome", label: "Outcome", options: ["SUCCESS", "FAILURE", "DENIED"].map((v) => ({ value: v, label: humanize(v) })) },
          { key: "eventType", label: "Event", options: EVENT_PREFIXES.map((p) => ({ value: p, label: humanize(p.slice(0, -1).toUpperCase()) })) },
          { key: "entityType", label: "Record type", options: ENTITY_TYPES.map((t) => ({ value: t, label: humanize(t) })) },
        ]}
        columns={[
          { key: "when", header: "When", cell: (r) => <span className="whitespace-nowrap text-xs">{formatDateTime(r.occurredAt)}</span> },
          { key: "actor", header: "Actor", cell: (r) => <span className="text-xs">{r.actorEmail ?? humanize(r.actorType)}</span> },
          { key: "event", header: "Event", cell: (r) => <span className="font-mono text-xs">{r.eventType}</span> },
          {
            key: "record",
            header: "Record",
            cell: (r) => {
              const href = entityHref(r.entityType, r.entityId);
              const label = r.entityLabel ?? (r.entityType ? humanize(r.entityType) : "-");
              return href ? (
                <Link className="text-xs text-accent hover:underline" href={href}>
                  {label}
                </Link>
              ) : (
                <span className="text-xs">{label}</span>
              );
            },
          },
          { key: "outcome", header: "Outcome", cell: (r) => <StatusBadge status={r.outcome} /> },
          { key: "reason", header: "Reason", cell: (r) => <span className="line-clamp-2 max-w-xs text-xs">{r.reason ?? ""}</span> },
          {
            key: "detail",
            header: "",
            cell: (r) => (
              <Button size="icon" variant="ghost" aria-label="Event details" onClick={() => setDetail(r)}>
                <FileJson />
              </Button>
            ),
          },
        ]}
      />
      {detail && (
        <Dialog open onOpenChange={(o) => !o && setDetail(null)}>
          <DialogContent title={detail.eventType} description={`${formatDateTime(detail.occurredAt)} · ${detail.actorEmail ?? detail.actorType} · ${detail.outcome}`} wide>
            <div className="max-h-[65vh] space-y-3 overflow-y-auto text-xs">
              {detail.reason && <p>Reason: {detail.reason}</p>}
              <p className="text-muted-foreground">
                Correlation {detail.correlationId ?? "-"} · IP {detail.ipAddress ?? "-"} · {detail.userAgent ?? ""}
              </p>
              {detail.changes != null && (
                <div>
                  <p className="mb-1 font-medium">Changes</p>
                  <pre className="overflow-x-auto rounded bg-muted p-2">{JSON.stringify(detail.changes, null, 2)}</pre>
                </div>
              )}
              {detail.metadata != null && (
                <div>
                  <p className="mb-1 font-medium">Metadata</p>
                  <pre className="overflow-x-auto rounded bg-muted p-2">{JSON.stringify(detail.metadata, null, 2)}</pre>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
