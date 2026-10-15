"use client";

import { useQuery } from "@tanstack/react-query";
import { humanize } from "@sqms/shared";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ActionDialog } from "@/components/common/action-dialog";
import { RecordPanel } from "@/components/common/collaboration";
import { FormDialog } from "@/components/forms/schema-form";
import { PageHeader } from "@/components/shell/page-header";
import { ChangesTable } from "@/components/tables/tables";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Alert, ErrorAlert, PageLoading } from "@/components/ui/feedback";
import { Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { toOptions } from "@/lib/options";
import { useSession } from "@/lib/session";

interface SupplierProduct {
  id: string;
  status: string;
  statusReason: string | null;
  approvedAt: string | null;
  internalPart: { id: string; partNumber: string; description: string; criticality: string };
  supplier: { id: string; name: string; supplierNumber: string; status: string };
  supplierPart: { supplierPartNumber: string; description: string; isCustom: boolean };
  site: { siteCode: string; name: string; city: string; country: string; status: string };
  originProject: { id: string; projectNumber: string; title: string; pathway: string } | null;
  configurations: { id: string; configCode: string; name: string; configurationType: string; customPartNumber: string | null; currentApprovedRevisionId: string | null; baseConfiguration: { id: string; configCode: string } | null; revisions: { id: string; revisionLabel: string; status: string; changeSummary: string | null; approvedAt: string | null; supersededAt: string | null; createdAt: string }[] }[];
  productApprovals: { id: string; number: string; status: string; approvedAt: string; restrictions: string | null; configurationRevisionId: string; supersededAt: string | null; qualificationId: string }[];
}

export default function SupplierProductPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const q = useQuery({ queryKey: ["supplier-product", id], queryFn: () => api<SupplierProduct>(`/supplier-products/${id}`) });
  const [status, setStatus] = useState("SUSPENDED");
  if (q.isLoading) return <PageLoading />;
  if (q.error || !q.data) return <ErrorAlert error={q.error} />;
  const sp = q.data;
  const revLabel = (revId: string) => sp.configurations.flatMap((c) => c.revisions.map((r) => ({ c, r }))).find((x) => x.r.id === revId);

  return (
    <>
      <PageHeader
        title={`${sp.internalPart.partNumber} from ${sp.supplier.name}`}
        breadcrumbs={[{ href: "/products", label: "Products" }, { href: `/products/${sp.internalPart.id}`, label: sp.internalPart.partNumber }, { label: `${sp.supplierPart.supplierPartNumber} @ ${sp.site.siteCode}` }]}
        description={`${sp.supplierPart.supplierPartNumber} · ${sp.site.name} (${sp.site.city}, ${sp.site.country})`}
        meta={
          <>
            <StatusBadge status={sp.status} />
            {sp.statusReason && <span className="text-muted-foreground">{sp.statusReason}</span>}
            <span>Supplier</span> <StatusBadge status={sp.supplier.status} />
            {sp.originProject && (
              <Link className="text-accent hover:underline" href={`/projects/${sp.originProject.id}`}>
                {sp.originProject.projectNumber} (Pathway {sp.originProject.pathway})
              </Link>
            )}
          </>
        }
        actions={
          <>
            {can("change:submit") && (sp.status === "APPROVED" || sp.status === "CONDITIONALLY_APPROVED") && (
              <Button asChild variant="outline">
                <Link href={`/changes/new?supplierProductId=${sp.id}`}>
                  <Plus /> Change request
                </Link>
              </Button>
            )}
            {can("supplier:qualify") && (
              <ActionDialog
                trigger={<Button variant="outline">Change status</Button>}
                title="Change supplier product status"
                description="Suspension or disqualification stops further use of this source; approvals are retained in history."
                reasonLabel="Reason"
                onConfirm={async (reason) => {
                  await api(`/supplier-products/${id}/status`, { method: "POST", body: { status, reason } });
                  await q.refetch();
                }}
              >
                <Select value={status} onChange={(e) => setStatus(e.target.value)} options={toOptions(["SUSPENDED", "DISQUALIFIED", "INACTIVE"])} aria-label="Status" />
              </ActionDialog>
            )}
          </>
        }
      />
      {sp.supplier.status !== "APPROVED" && sp.supplier.status !== "CONDITIONALLY_APPROVED" && <Alert tone="warning" className="mb-4">The supplier is {humanize(sp.supplier.status).toLowerCase()}; product approval requires an approved supplier.</Alert>}
      <div className="grid gap-4 2xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Configurations" description="Each configuration keeps its revision history; only one revision per configuration is authorized at a time." actions={can("configuration:write") && <NewConfiguration supplierProductId={id} onDone={() => void q.refetch()} configs={sp.configurations} />} />
            <Table>
              <THead>
                <tr>
                  <TH>Configuration</TH>
                  <TH>Rev</TH>
                  <TH>Status</TH>
                  <TH>Change summary</TH>
                  <TH>Approved</TH>
                </tr>
              </THead>
              <TBody>
                {sp.configurations.flatMap((c) =>
                  c.revisions.map((r, i) => (
                    <TR key={r.id}>
                      <TD>
                        {i === 0 && (
                          <>
                            <span className="font-medium">{c.configCode}</span> {c.name}
                            <div className="text-xs text-muted-foreground">
                              {humanize(c.configurationType)}
                              {c.baseConfiguration && ` · based on ${c.baseConfiguration.configCode}`}
                              {c.customPartNumber && ` · PN ${c.customPartNumber}`}
                            </div>
                          </>
                        )}
                      </TD>
                      <TD>
                        <Link className="font-medium text-accent hover:underline" href={`/configurations/revisions/${r.id}`}>
                          {r.revisionLabel}
                        </Link>
                        {c.currentApprovedRevisionId === r.id && <Badge tone="success" className="ml-1">Authorized</Badge>}
                      </TD>
                      <TD>
                        <StatusBadge status={r.status} />
                      </TD>
                      <TD className="max-w-xs text-xs">{r.changeSummary ?? "-"}</TD>
                      <TD>{formatDate(r.approvedAt)}</TD>
                    </TR>
                  )),
                )}
              </TBody>
            </Table>
          </Card>
          <Card>
            <CardHeader title="Approval records" />
            <Table>
              <THead>
                <tr>
                  <TH>Approval</TH>
                  <TH>Configuration</TH>
                  <TH>Status</TH>
                  <TH>Approved</TH>
                  <TH>Superseded</TH>
                  <TH>Restrictions</TH>
                </tr>
              </THead>
              <TBody>
                {sp.productApprovals.map((a) => {
                  const x = revLabel(a.configurationRevisionId);
                  return (
                    <TR key={a.id}>
                      <TD>
                        <Link className="font-medium text-accent hover:underline" href={`/qualifications/${a.qualificationId}`}>
                          {a.number}
                        </Link>
                      </TD>
                      <TD>{x ? `${x.c.configCode} rev ${x.r.revisionLabel}` : "-"}</TD>
                      <TD>
                        <StatusBadge status={a.status} />
                      </TD>
                      <TD>{formatDate(a.approvedAt)}</TD>
                      <TD>{formatDate(a.supersededAt)}</TD>
                      <TD className="max-w-xs text-xs">{a.restrictions ?? "-"}</TD>
                    </TR>
                  );
                })}
                {sp.productApprovals.length === 0 && (
                  <TR>
                    <TD colSpan={6} className="text-center text-muted-foreground">Not approved yet.</TD>
                  </TR>
                )}
              </TBody>
            </Table>
          </Card>
          <ChangesTable baseQuery={{ supplierProductId: id }} syncUrl={false} filters={false} savedViews={false} />
        </div>
        <RecordPanel entityType="SUPPLIER_PRODUCT" entityId={id} />
      </div>
    </>
  );
}

function NewConfiguration({ supplierProductId, configs, onDone }: { supplierProductId: string; configs: SupplierProduct["configurations"]; onDone: () => void }) {
  return (
    <FormDialog
      trigger={
        <Button size="sm">
          <Plus /> Configuration
        </Button>
      }
      title="New configuration"
      fields={[
        { name: "name", label: "Name", required: true, maxLength: 200 },
        { name: "configurationType", label: "Type", type: "select", required: true, options: toOptions(["CUSTOMER_DESIGN", "SUPPLIER_STANDARD", "SUPPLIER_MODIFIED"]) },
        { name: "baseConfigurationId", label: "Based on (Path C)", type: "select", options: configs.map((c) => ({ value: c.id, label: `${c.configCode} ${c.name}` })), when: (v) => v.configurationType === "SUPPLIER_MODIFIED" },
        { name: "customPartNumber", label: "Custom supplier part number", maxLength: 80, when: (v) => v.configurationType === "SUPPLIER_MODIFIED" },
        { name: "description", label: "Description", type: "textarea", maxLength: 5000 },
      ]}
      defaultValues={{ configurationType: "SUPPLIER_STANDARD" }}
      onSubmit={async (b) => {
        await api("/product-configurations", { method: "POST", body: { ...b, supplierProductId } });
        onDone();
      }}
    />
  );
}
