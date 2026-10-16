"use client";
import { NcrReportPanel } from "@/components/operations/quality-panels";

import { useQuery } from "@tanstack/react-query";
import { NCR_DISPOSITION, NCR_DISPOSITION_LABELS, NCR_SEVERITY, humanize } from "@sqms/shared";
import { Lock, Plus } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ActionDialog } from "@/components/common/action-dialog";
import { RecordPanel } from "@/components/common/collaboration";
import { DetailGrid } from "@/components/common/detail-grid";
import { FormDialog } from "@/components/forms/schema-form";
import { PageHeader } from "@/components/shell/page-header";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, ErrorAlert, PageLoading } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { api } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { toOptions } from "@/lib/options";
import { useSession } from "@/lib/session";

interface Ncr {
  id: string;
  number: string;
  title: string;
  dateIdentified: string;
  source: string;
  lotNumber: string | null;
  serialNumbers: string | null;
  quantityAffected: number;
  quantityInspected: number | null;
  defectDescription: string;
  expectedSpecification: string | null;
  actualCondition: string | null;
  inspectionResults: string | null;
  severity: string;
  containmentAction: string | null;
  containmentCompletedAt: string | null;
  disposition: string | null;
  dispositionNotes: string | null;
  dispositionAt: string | null;
  status: string;
  blocksApproval: boolean;
  internalNotes?: string | null;
  supplierVisible: boolean;
  closedAt: string | null;
  closureComment: string | null;
  createdAt: string;
  version: number;
  supplier: { id: string; name: string; supplierNumber: string } | null;
  site: { id: string; siteCode: string; name: string } | null;
  internalPart: { id: string; partNumber: string; description: string } | null;
  incomingInspection?: { originalPartNumber: string | null; originalSupplier: string | null } | null;
  legacyException?: { originalPartNumber?: string; originalSupplier?: string } | null;
  supplierPart: { id: string; supplierPartNumber: string } | null;
  supplierProductId: string | null;
  owner: { id: string; displayName: string } | null;
  qualification: { id: string; number: string } | null;
  characteristic: { id: string; charNumber: string; name: string } | null;
  correctiveActions: { id: string; number: string; status: string; responseDueDate: string }[];
  deviations: { id: string; number: string; title?: string; type: string; status: string }[];
}

const OPEN = ["OPEN", "CONTAINED", "UNDER_INVESTIGATION"];

export default function NcrPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can, isInternal } = useSession();
  const q = useQuery({ queryKey: ["ncr", id], queryFn: () => api<Ncr>(`/ncrs/${id}`) });
  if (q.isLoading) return <PageLoading />;
  if (q.error || !q.data) return <ErrorAlert error={q.error} />;
  const n = q.data;
  const originalPart = n.incomingInspection?.originalPartNumber ?? n.legacyException?.originalPartNumber;
  const originalSupplier = n.incomingInspection?.originalSupplier ?? n.legacyException?.originalSupplier;
  const refetch = () => void q.refetch();
  const post = (path: string, body: Record<string, unknown>) => api(`/ncrs/${id}/${path}`, { method: "POST", body: { expectedVersion: n.version, ...body } }).then(refetch);
  const open = OPEN.includes(n.status);
  const write = isInternal && can("ncr:write");
  const dispose = isInternal && can("ncr:disposition");

  return (
    <>
      <PageHeader
        title={n.title}
        breadcrumbs={[{ href: "/quality/ncrs", label: "Nonconformances" }, { label: n.number }]}
        description={`${n.number} · ${n.internalPart?.partNumber ?? originalPart ?? "Unresolved part"} · ${n.supplier?.name ?? originalSupplier ?? "Unattributed"}${n.site ? ` @ ${n.site.siteCode}` : ""}`}
        meta={
          <>
            <StatusBadge status={n.status} />
            <StatusBadge status={n.severity} />
            <span>{humanize(n.source)}</span>
            {n.blocksApproval && open && <Badge tone="danger">Blocks approval</Badge>}
            {n.owner && <span>Owner {n.owner.displayName}</span>}
          </>
        }
        actions={
          <>
            {write && open && <ContainmentAction n={n} onDone={refetch} />}
            {write && (n.status === "OPEN" || n.status === "CONTAINED") && <ActionDialog trigger={<Button variant="outline">Start investigation</Button>} title="Start investigation" confirmLabel="Start" onConfirm={() => post("investigate", {}).then(() => toast.success("Under investigation"))} />}
            {dispose && open && <DispositionAction n={n} onDone={refetch} />}
            {dispose && n.status === "DISPOSITIONED" && <ActionDialog trigger={<Button>Close NCR</Button>} title="Close NCR" description="Confirm the disposition was carried out." reasonLabel="Closure comment" confirmLabel="Close" onConfirm={(comment) => post("close", { comment }).then(() => toast.success("NCR closed"))} />}
            {can("scar:write") && n.status !== "CANCELLED" && <GenerateScar n={n} onCreated={(sid) => router.push(`/quality/scars/${sid}`)} />}
            {can("deviation:write") && open && (
              <Button asChild variant="outline">
                <Link href={`/quality/deviations/new?ncrId=${id}&type=CONCESSION`}>
                  <Plus /> Concession
                </Link>
              </Button>
            )}
            {write && open && (
              <FormDialog
                trigger={<Button variant="outline">Edit</Button>}
                title="Edit NCR"
                wide
                columns={2}
                fields={[
                  { name: "title", label: "Title", required: true, minLength: 3, maxLength: 250, wide: true },
                  { name: "severity", label: "Severity", type: "select", required: true, options: toOptions(NCR_SEVERITY) },
                  { name: "lotNumber", label: "Lot / batch", nullable: true, maxLength: 80 },
                  { name: "quantityAffected", label: "Quantity affected", type: "number", integer: true, min: 1, required: true },
                  { name: "quantityInspected", label: "Quantity inspected", type: "number", integer: true, min: 0 },
                  { name: "serialNumbers", label: "Serial numbers", type: "textarea", nullable: true, maxLength: 5000 },
                  { name: "defectDescription", label: "Defect description", type: "textarea", required: true, minLength: 10, maxLength: 20000 },
                  { name: "expectedSpecification", label: "Expected specification", type: "textarea", nullable: true, maxLength: 10000 },
                  { name: "actualCondition", label: "Actual condition", type: "textarea", nullable: true, maxLength: 10000 },
                  { name: "inspectionResults", label: "Inspection results", type: "textarea", nullable: true, maxLength: 10000 },
                  { name: "internalNotes", label: "Internal notes", type: "textarea", nullable: true, maxLength: 20000 },
                  { name: "blocksApproval", label: "Blocks product approval while open", type: "checkbox" },
                  { name: "supplierVisible", label: "Visible to the supplier", type: "checkbox" },
                ]}
                defaultValues={n as unknown as Record<string, unknown>}
                onSubmit={async (payload) => {
                  await api(`/ncrs/${id}`, { method: "PATCH", body: { expectedVersion: n.version, ...payload } });
                  toast.success("NCR updated");
                  refetch();
                }}
              />
            )}
            {dispose && open && <ActionDialog trigger={<Button variant="ghost">Cancel NCR</Button>} title="Cancel NCR" description="Use only for NCRs raised in error." reasonLabel="Reason" confirmVariant="destructive" confirmLabel="Cancel NCR" onConfirm={(reason) => post("cancel", { reason }).then(() => toast.success("NCR cancelled"))} />}
          </>
        }
      />
      {n.closedAt && <Alert tone="success" className="mb-4" title={`Closed ${formatDateTime(n.closedAt)}`}>{n.closureComment}</Alert>}
      <div className="grid gap-4 2xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Nonconformance" />
            <CardBody>
              <DetailGrid
                items={[
                  { label: "Supplier", value: n.supplier ? (isInternal ? <Link className="text-accent hover:underline" href={`/suppliers/${n.supplier.id}`}>{n.supplier.name}</Link> : n.supplier.name) : originalSupplier ? `${originalSupplier} (unmapped)` : "Unattributed / internal" },
                  { label: "Part", value: n.internalPart ? (isInternal ? <Link className="text-accent hover:underline" href={`/products/${n.internalPart.id}`}>{n.internalPart.partNumber}</Link> : n.internalPart.partNumber) : originalPart ? `${originalPart} (unmapped)` : "Unresolved" },
                  { label: "Supplier part", value: n.supplierPart?.supplierPartNumber },
                  { label: "Site", value: n.site ? `${n.site.siteCode} ${n.site.name}` : null },
                  { label: "Date identified", value: formatDate(n.dateIdentified) },
                  { label: "Lot / batch", value: n.lotNumber },
                  { label: "Quantity affected", value: n.quantityAffected },
                  { label: "Quantity inspected", value: n.quantityInspected },
                  n.characteristic && { label: "Characteristic", value: `${n.characteristic.charNumber} ${n.characteristic.name}` },
                  n.qualification && { label: "Qualification", value: <Link className="text-accent hover:underline" href={`/qualifications/${n.qualification.id}`}>{n.qualification.number}</Link> },
                  { label: "Serial numbers", value: n.serialNumbers, wide: true },
                  { label: "Defect description", value: n.defectDescription, wide: true },
                  { label: "Expected specification", value: n.expectedSpecification },
                  { label: "Actual condition", value: n.actualCondition },
                  { label: "Inspection results", value: n.inspectionResults, wide: true },
                ]}
              />
            </CardBody>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Containment" />
              <CardBody className="text-sm">
                {n.containmentAction ? <p className="whitespace-pre-wrap">{n.containmentAction}</p> : <p className="text-muted-foreground">No containment recorded.</p>}
                <p className="mt-2 text-xs text-muted-foreground">{n.containmentCompletedAt ? `Completed ${formatDateTime(n.containmentCompletedAt)}` : "Not completed"}</p>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Disposition" />
              <CardBody className="text-sm">
                {n.disposition ? (
                  <>
                    <p className="font-medium">{NCR_DISPOSITION_LABELS[n.disposition as keyof typeof NCR_DISPOSITION_LABELS] ?? humanize(n.disposition)}</p>
                    <p className="mt-1 whitespace-pre-wrap">{n.dispositionNotes}</p>
                    <p className="mt-2 text-xs text-muted-foreground">{formatDateTime(n.dispositionAt)}</p>
                  </>
                ) : (
                  <p className="text-muted-foreground">Not yet dispositioned.</p>
                )}
              </CardBody>
            </Card>
          </div>
          {isInternal && n.internalNotes !== undefined && (
            <Card>
              <CardHeader title={<span className="flex items-center gap-1"><Lock className="size-3.5" /> Internal notes</span>} description="Never shown to supplier users." />
              <CardBody>{n.internalNotes ? <p className="whitespace-pre-wrap">{n.internalNotes}</p> : <p className="text-muted-foreground">None.</p>}</CardBody>
            </Card>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Corrective actions" />
              <CardBody className="space-y-1">
                {n.correctiveActions.length === 0 && <p className="text-muted-foreground">No SCAR raised.</p>}
                {n.correctiveActions.map((s) => (
                  <p key={s.id}>
                    <Link className="font-medium text-accent hover:underline" href={`/quality/scars/${s.id}`}>{s.number}</Link> <StatusBadge status={s.status} /> <span className="text-xs text-muted-foreground">response due {formatDate(s.responseDueDate)}</span>
                  </p>
                ))}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Deviations / concessions" />
              <CardBody className="space-y-1">
                {n.deviations.length === 0 && <p className="text-muted-foreground">None.</p>}
                {n.deviations.map((d) => (
                  <p key={d.id}>
                    <Link className="font-medium text-accent hover:underline" href={`/quality/deviations/${d.id}`}>{d.number}</Link> <Badge>{humanize(d.type)}</Badge> <StatusBadge status={d.status} />
                  </p>
                ))}
              </CardBody>
            </Card>
          </div>
        </div>
        <div className="min-w-0">
          <RecordPanel entityType="NCR" entityId={id} canAttach={can("ncr:write") && !["DISPOSITIONED","CLOSED","CANCELLED"].includes(n.status)} />
          {isInternal && <NcrReportPanel id={id} />}
        </div>
      </div>
    </>
  );
}

function ContainmentAction({ n, onDone }: { n: Ncr; onDone: () => void }) {
  const [completed, setCompleted] = useState(false);
  return (
    <ActionDialog
      trigger={<Button variant="outline">Containment</Button>}
      title="Record containment"
      description={n.containmentAction ? `Current: ${n.containmentAction}` : "Segregation, sorting, stop-ship or field actions taken."}
      reasonLabel="Containment action"
      confirmLabel="Save"
      onConfirm={async (action) => {
        await api(`/ncrs/${n.id}/containment`, { method: "POST", body: { expectedVersion: n.version, containmentAction: action, completed } });
        toast.success("Containment recorded");
        onDone();
      }}
    >
      <label className="flex items-center gap-2">
        <Checkbox checked={completed} onCheckedChange={(c) => setCompleted(c === true)} /> Containment completed
      </label>
    </ActionDialog>
  );
}

function DispositionAction({ n, onDone }: { n: Ncr; onDone: () => void }) {
  const [disposition, setDisposition] = useState<string>("REWORK");
  const [deviationId, setDeviationId] = useState("");
  const approved = n.deviations.filter((d) => d.status === "APPROVED" && d.type === "CONCESSION");
  const needsConcession = disposition === "USE_AS_IS_CONCESSION" || disposition === "REPAIR";
  return (
    <ActionDialog
      trigger={<Button>Disposition</Button>}
      title="Disposition nonconforming material"
      description="Use-as-is and repair require an approved concession."
      reasonLabel="Disposition notes"
      confirmLabel="Record disposition"
      onConfirm={async (notes) => {
        if (needsConcession && !deviationId) throw new Error("Select the approved concession supporting this disposition");
        await api(`/ncrs/${n.id}/disposition`, { method: "POST", body: { expectedVersion: n.version, disposition, dispositionNotes: notes, ...(needsConcession ? { deviationId } : {}) } });
        toast.success("Disposition recorded");
        onDone();
      }}
    >
      <Field label="Disposition" htmlFor="ncr-disp">
        <Select id="ncr-disp" value={disposition} onChange={(e) => setDisposition(e.target.value)} options={NCR_DISPOSITION.filter((d) => d !== "HOLD").map((d) => ({ value: d, label: NCR_DISPOSITION_LABELS[d] }))} />
      </Field>
      {needsConcession && (
        <Field label="Approved concession" required htmlFor="ncr-dev" hint={approved.length ? undefined : "No approved concession is linked to this NCR yet."}>
          <Select id="ncr-dev" value={deviationId} onChange={(e) => setDeviationId(e.target.value)} placeholder="Select..." options={approved.map((d) => ({ value: d.id, label: `${d.number}${d.title ? ` ${d.title}` : ""}` }))} />
        </Field>
      )}
    </ActionDialog>
  );
}

function GenerateScar({ n, onCreated }: { n: Ncr; onCreated: (id: string) => void }) {
  const in14 = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const in3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const [responseDue, setResponseDue] = useState(in14);
  const [containmentDue, setContainmentDue] = useState(in3);
  return (
    <ActionDialog
      trigger={<Button variant="outline">Raise SCAR</Button>}
      title="Raise supplier corrective action request"
      description="Creates a draft SCAR from this NCR. Review and issue it to the supplier from the SCAR page."
      confirmLabel="Create SCAR"
      onConfirm={async () => {
        const s = await api<{ id: string }>(`/ncrs/${n.id}/scar`, { method: "POST", body: { responseDueDate: responseDue, containmentDueDate: containmentDue } });
        toast.success("SCAR created");
        onCreated(s.id);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Containment due" htmlFor="scar-cd">
          <Input id="scar-cd" type="date" value={containmentDue} onChange={(e) => setContainmentDue(e.target.value)} />
        </Field>
        <Field label="8D response due" htmlFor="scar-rd">
          <Input id="scar-rd" type="date" value={responseDue} onChange={(e) => setResponseDue(e.target.value)} />
        </Field>
      </div>
    </ActionDialog>
  );
}
