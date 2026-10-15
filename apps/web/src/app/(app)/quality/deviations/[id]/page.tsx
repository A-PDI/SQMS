"use client";

import { useQuery } from "@tanstack/react-query";
import { humanize } from "@sqms/shared";
import { Send } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { ActionDialog } from "@/components/common/action-dialog";
import { RecordPanel } from "@/components/common/collaboration";
import { DetailGrid } from "@/components/common/detail-grid";
import { FormDialog } from "@/components/forms/schema-form";
import { PageHeader } from "@/components/shell/page-header";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Alert, ErrorAlert, PageLoading } from "@/components/ui/feedback";
import { api } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { useSession } from "@/lib/session";

interface Deviation {
  id: string;
  number: string;
  type: string;
  title: string;
  description: string;
  justification: string;
  riskAssessment: string | null;
  quantityLimit: number | null;
  lotNumbers: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
  blocksApproval: boolean;
  decisionComment: string | null;
  decidedAt: string | null;
  createdAt: string;
  version: number;
  supplier: { id: string; name: string; supplierNumber: string };
  supplierProduct: { id: string; internalPart: { id: string; partNumber: string }; supplierPart: { supplierPartNumber: string }; site: { siteCode: string } } | null;
  configurationRevision: { id: string; revisionLabel: string; configuration: { configCode: string } } | null;
  qualification: { id: string; number: string; status: string } | null;
  ncr: { id: string; number: string; status: string } | null;
}

export default function DeviationPage() {
  const { id } = useParams<{ id: string }>();
  const { can, isInternal } = useSession();
  const q = useQuery({ queryKey: ["deviation", id], queryFn: () => api<Deviation>(`/deviations/${id}`) });
  if (q.isLoading) return <PageLoading />;
  if (q.error || !q.data) return <ErrorAlert error={q.error} />;
  const d = q.data;
  const refetch = () => void q.refetch();
  const post = (path: string, body: Record<string, unknown> = {}) => api(`/deviations/${id}/${path}`, { method: "POST", body: { expectedVersion: d.version, ...body } }).then(refetch);
  const write = can("deviation:write");

  return (
    <>
      <PageHeader
        title={d.title}
        breadcrumbs={[{ href: "/quality/deviations", label: "Deviations" }, { label: d.number }]}
        description={`${d.number} · ${humanize(d.type)} · ${d.supplier.name}`}
        meta={
          <>
            <StatusBadge status={d.status} />
            <Badge>{humanize(d.type)}</Badge>
            {d.blocksApproval && ["DRAFT", "SUBMITTED"].includes(d.status) && <Badge tone="danger">Blocks approval until decided</Badge>}
          </>
        }
        actions={
          write && (
            <>
              {d.status === "DRAFT" && <ActionDialog trigger={<Button><Send /> Submit for approval</Button>} title="Submit for approval" description="Starts the deviation approval workflow." confirmLabel="Submit" onConfirm={() => post("submit").then(() => toast.success("Submitted for approval"))} />}
              {d.status === "DRAFT" && (
                <FormDialog
                  trigger={<Button variant="outline">Edit</Button>}
                  title="Edit request"
                  wide
                  columns={2}
                  fields={[
                    { name: "title", label: "Title", required: true, minLength: 3, maxLength: 250, wide: true },
                    { name: "quantityLimit", label: "Quantity limit", type: "number", integer: true, min: 1 },
                    { name: "lotNumbers", label: "Lot numbers", nullable: true, maxLength: 5000 },
                    { name: "startDate", label: "Start date", type: "date" },
                    { name: "endDate", label: "End date", type: "date" },
                    { name: "description", label: "Description", type: "textarea", required: true, minLength: 10, maxLength: 20000 },
                    { name: "justification", label: "Justification", type: "textarea", required: true, minLength: 10, maxLength: 20000 },
                    { name: "riskAssessment", label: "Risk assessment", type: "textarea", nullable: true, maxLength: 10000 },
                  ]}
                  defaultValues={d as unknown as Record<string, unknown>}
                  onSubmit={async (payload) => {
                    await api(`/deviations/${id}`, { method: "PATCH", body: { expectedVersion: d.version, ...payload } });
                    toast.success("Request updated");
                    refetch();
                  }}
                />
              )}
              {(d.status === "DRAFT" || d.status === "SUBMITTED") && <ActionDialog trigger={<Button variant="ghost">Withdraw</Button>} title="Withdraw request" reasonLabel="Reason" confirmVariant="destructive" confirmLabel="Withdraw" onConfirm={(reason) => post("withdraw", { reason }).then(() => toast.success("Request withdrawn"))} />}
              {isInternal && can("ncr:disposition") && (d.status === "APPROVED" || d.status === "EXPIRED") && <ActionDialog trigger={<Button variant="outline">Close</Button>} title="Close deviation" description="Ends the authorization; it can no longer support dispositions." reasonLabel="Reason" confirmLabel="Close" onConfirm={(reason) => post("close", { reason }).then(() => toast.success("Deviation closed"))} />}
            </>
          )
        }
      />
      {d.decisionComment && <Alert tone={d.status === "REJECTED" ? "danger" : "success"} className="mb-4" title={`Decision ${formatDateTime(d.decidedAt)}`}>{d.decisionComment}</Alert>}
      <div className="grid gap-4 2xl:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          <Card>
            <CardBody>
              <DetailGrid
                items={[
                  { label: "Supplier", value: isInternal ? <Link className="text-accent hover:underline" href={`/suppliers/${d.supplier.id}`}>{d.supplier.name}</Link> : d.supplier.name },
                  d.supplierProduct && { label: "Source", value: isInternal ? <Link className="text-accent hover:underline" href={`/products/supplier-products/${d.supplierProduct.id}`}>{d.supplierProduct.internalPart.partNumber} · {d.supplierProduct.supplierPart.supplierPartNumber} @ {d.supplierProduct.site.siteCode}</Link> : d.supplierProduct.internalPart.partNumber },
                  d.configurationRevision && { label: "Configuration", value: `${d.configurationRevision.configuration.configCode} rev ${d.configurationRevision.revisionLabel}` },
                  d.qualification && { label: "Qualification", value: <Link className="text-accent hover:underline" href={`/qualifications/${d.qualification.id}`}>{d.qualification.number}</Link> },
                  d.ncr && { label: "NCR", value: <Link className="text-accent hover:underline" href={`/quality/ncrs/${d.ncr.id}`}>{d.ncr.number}</Link> },
                  { label: "Quantity limit", value: d.quantityLimit },
                  { label: "Lot numbers", value: d.lotNumbers },
                  { label: "Valid", value: d.startDate || d.endDate ? `${formatDate(d.startDate)} to ${formatDate(d.endDate)}` : null },
                  { label: "Created", value: formatDateTime(d.createdAt) },
                  { label: "Description", value: d.description, wide: true },
                  { label: "Justification", value: d.justification, wide: true },
                  { label: "Risk assessment", value: d.riskAssessment, wide: true },
                ]}
              />
            </CardBody>
          </Card>
        </div>
        <div className="min-w-0">
          <RecordPanel entityType="DEVIATION" entityId={id} workflowSubjectType="DEVIATION" />
        </div>
      </div>
    </>
  );
}
