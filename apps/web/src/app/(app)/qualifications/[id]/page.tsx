"use client";

import { useQuery } from "@tanstack/react-query";
import { INSPECTION_OUTCOME, TEST_TYPE, humanize } from "@sqms/shared";
import { CheckCircle2, Plus, Send, ShieldCheck, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ActionDialog } from "@/components/common/action-dialog";
import { RecordPanel } from "@/components/common/collaboration";
import { DetailGrid } from "@/components/common/detail-grid";
import { AsyncPicker, type PickerItem } from "@/components/forms/async-picker";
import { FormDialog } from "@/components/forms/schema-form";
import { PageHeader } from "@/components/shell/page-header";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Alert, ErrorAlert, PageLoading } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { toOptions } from "@/lib/options";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

interface GateCheck {
  key: string;
  label: string;
  passed: boolean;
  details: string[];
}
interface Evidence {
  id: string;
  status: string;
  outcome: string | null;
  reviewComment: string | null;
  reviewedAt: string | null;
  documentId: string | null;
}
interface TestRecord extends Evidence {
  testType: string;
  name: string;
  procedure: string | null;
  acceptanceCriteria: string;
  isRequired: boolean;
  resultSummary: string | null;
  laboratory: string | null;
  testedAt: string | null;
}
interface Fai extends Evidence {
  number: string;
  serialNumbers: string | null;
  inspectionDate: string | null;
  characteristicsInspected: number;
  nonconformingCount: number;
  summary: string | null;
}
interface InspectionResult {
  id: string;
  characteristicId: string | null;
  firstArticleId: string | null;
  sampleIdentifier: string | null;
  measuredValue: string | null;
  numericValue: number | null;
  outcome: string;
  notes: string | null;
  createdAt: string;
}
interface Characteristic {
  id: string;
  charNumber: string;
  name: string;
  classification: string;
  nominal: string | number | null;
}
interface Qualification {
  id: string;
  number: string;
  title: string;
  pathway: string | null;
  riskLevel: string | null;
  status: string;
  requiredSampleQty: number | null;
  sampleNotes: string | null;
  inspectionPlanNotes: string | null;
  approvalRestrictions: string | null;
  deviationsSummary: string | null;
  decisionComment: string | null;
  decidedAt: string | null;
  holdReason: string | null;
  createdAt: string;
  version: number;
  changeRequestId: string | null;
  supplier: { id: string; name: string; supplierNumber: string; status: string };
  supplierProduct: { id: string; status: string; internalPart: { id: string; partNumber: string; description: string; criticality: string }; supplierPart: { supplierPartNumber: string; description: string; isCustom: boolean }; site: { siteCode: string; name: string; city: string; country: string; status: string } };
  configurationRevision: { id: string; revisionLabel: string; status: string; configuration: { configCode: string; name: string; configurationType: string }; baseline: { status: string; baselineType: string } | null; characteristics: Characteristic[] };
  sourcingProject: { id: string; projectNumber: string; title: string; pathway: string } | null;
  changeRequest: { id: string; number: string; title: string } | null;
  tests: TestRecord[];
  firstArticles: Fai[];
  inspectionResults: InspectionResult[];
  approvalPackage: { id: string; number: string; snapshotHash: string; createdAt: string; snapshot: { gate?: { key: string; passed: boolean }[] } } | null;
  productApproval: { id: string; number: string; status: string; approvedAt: string; restrictions: string | null; supersededAt: string | null } | null;
  deviations: { id: string; number: string; title: string; status: string; type: string }[];
  nonconformances: { id: string; number: string; title: string; status: string; severity: string }[];
  gate: GateCheck[];
}
interface Package {
  id: string;
  number: string;
  snapshotHash: string;
  createdAt: string;
  integrityVerified: boolean;
  snapshot: {
    gate?: { key: string; passed: boolean }[];
    documents?: { revisionId: string; documentId: string; docNumber: string; revisionLabel: string; documentTypeCode: string }[];
    waivers?: { level: string; justification: string | null; documentTypeCode: string; waivedAt: string | null }[];
  };
  items: { id: string; documentRevisionId: string; documentTypeCode: string; contentHash: string }[];
}

const DONE = ["APPROVED", "REJECTED"];

export default function QualificationPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const q = useQuery({ queryKey: ["qualification", id], queryFn: () => api<Qualification>(`/qualifications/${id}`) });
  const [gateError, setGateError] = useState<GateCheck[] | null>(null);
  if (q.isLoading) return <PageLoading />;
  if (q.error || !q.data) return <ErrorAlert error={q.error} />;
  const x = q.data;
  const refetch = () => void q.refetch();
  const write = can("qualification:write") && !DONE.includes(x.status) && x.status !== "APPROVAL_REVIEW";
  const gatePassed = x.gate.every((c) => c.passed);
  const sp = x.supplierProduct;

  return (
    <>
      <PageHeader
        title={x.title}
        breadcrumbs={[{ href: "/qualifications", label: "Qualifications" }, { label: x.number }]}
        description={`${x.number} · ${sp.internalPart.partNumber} from ${x.supplier.name} @ ${sp.site.siteCode}`}
        meta={
          <>
            <StatusBadge status={x.status} />
            {x.riskLevel && (
              <span className="flex items-center gap-1">
                Risk <StatusBadge status={x.riskLevel} />
              </span>
            )}
            {x.sourcingProject && (
              <Link className="text-accent hover:underline" href={`/projects/${x.sourcingProject.id}`}>
                {x.sourcingProject.projectNumber} (Pathway {x.sourcingProject.pathway})
              </Link>
            )}
            {x.changeRequest && (
              <Link className="text-accent hover:underline" href={`/changes/${x.changeRequest.id}`}>
                {x.changeRequest.number}
              </Link>
            )}
          </>
        }
        actions={
          write && (
            <>
              {!x.changeRequestId && ["DOCUMENTATION_PENDING", "EVALUATION", "VALIDATION"].includes(x.status) && (
                <ActionDialog
                  trigger={<Button><Send /> Submit for approval</Button>}
                  title="Submit for product approval"
                  description={gatePassed ? "All approval gate checks pass. The exact configuration revision and accepted document revisions are frozen for review." : "Some gate checks are failing; submission will be refused until they pass."}
                  confirmLabel="Submit"
                  onConfirm={async () => {
                    try {
                      await api(`/qualifications/${id}/submit`, { method: "POST", body: { expectedVersion: x.version } });
                      toast.success("Submitted for product approval");
                      setGateError(null);
                      refetch();
                    } catch (e) {
                      if (e instanceof ApiError && Array.isArray((e.details as { checks?: unknown })?.checks)) setGateError((e.details as { checks: GateCheck[] }).checks);
                      throw e;
                    }
                  }}
                />
              )}
              <StatusChange x={x} onDone={refetch} />
              <FormDialog
                trigger={<Button variant="outline">Edit</Button>}
                title="Edit qualification"
                wide
                columns={2}
                fields={[
                  { name: "title", label: "Title", required: true, minLength: 3, maxLength: 250, wide: true },
                  { name: "requiredSampleQty", label: "Required sample quantity", type: "number", integer: true, min: 0 },
                  { name: "sampleNotes", label: "Sample notes", type: "textarea", nullable: true, maxLength: 5000 },
                  { name: "inspectionPlanNotes", label: "Inspection plan notes", type: "textarea", nullable: true, maxLength: 10000 },
                  { name: "approvalRestrictions", label: "Proposed approval restrictions", type: "textarea", nullable: true, maxLength: 10000 },
                  { name: "deviationsSummary", label: "Deviations summary", type: "textarea", nullable: true, maxLength: 10000 },
                ]}
                defaultValues={x as unknown as Record<string, unknown>}
                onSubmit={async (payload) => {
                  await api(`/qualifications/${id}`, { method: "PATCH", body: { expectedVersion: x.version, ...payload } });
                  toast.success("Qualification updated");
                  refetch();
                }}
              />
            </>
          )
        }
      />
      {x.status === "ON_HOLD" && x.holdReason && <Alert tone="warning" className="mb-4" title="On hold">{x.holdReason}</Alert>}
      {x.changeRequestId && !DONE.includes(x.status) && <Alert className="mb-4">This requalification is approved through its change request workflow.</Alert>}
      {x.decisionComment && <Alert tone={x.status === "APPROVED" ? "success" : "warning"} className="mb-4" title={`Decision ${formatDateTime(x.decidedAt)}`}>{x.decisionComment}</Alert>}
      <div className="grid gap-4 2xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Approval gate" description={x.approvalPackage ? `Result recorded in ${x.approvalPackage.number} at submission.` : "Every check must pass before submission. Status changes cannot bypass the gate."} />
              <CardBody>
                <GateList
                  checks={
                    gateError ??
                    (x.approvalPackage?.snapshot.gate
                      ? x.approvalPackage.snapshot.gate.map((g) => ({ key: g.key, passed: g.passed, label: x.gate.find((c) => c.key === g.key)?.label ?? humanize(g.key), details: [] }))
                      : DONE.includes(x.status) || x.status === "APPROVAL_REVIEW"
                        ? null
                        : x.gate)
                  }
                  snapshotPassed={DONE.includes(x.status) || x.status === "APPROVAL_REVIEW"}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Subject of approval" />
              <CardBody>
                <DetailGrid
                  columns={2}
                  items={[
                    { label: "Product", value: <Link className="text-accent hover:underline" href={`/products/${sp.internalPart.id}`}>{sp.internalPart.partNumber}</Link> },
                    { label: "Criticality", value: <StatusBadge status={sp.internalPart.criticality} /> },
                    { label: "Supplier", value: <Link className="text-accent hover:underline" href={`/suppliers/${x.supplier.id}`}>{x.supplier.name}</Link> },
                    { label: "Supplier status", value: <StatusBadge status={x.supplier.status} /> },
                    { label: "Site", value: `${sp.site.siteCode} ${sp.site.name}, ${sp.site.city}` },
                    { label: "Supplier part", value: `${sp.supplierPart.supplierPartNumber}${sp.supplierPart.isCustom ? " (custom)" : ""}` },
                    {
                      label: "Configuration revision",
                      value: (
                        <Link className="text-accent hover:underline" href={`/configurations/revisions/${x.configurationRevision.id}`}>
                          {x.configurationRevision.configuration.configCode} rev {x.configurationRevision.revisionLabel}
                        </Link>
                      ),
                    },
                    { label: "Revision status", value: <StatusBadge status={x.configurationRevision.status} /> },
                    { label: "Baseline", value: x.configurationRevision.baseline ? `${humanize(x.configurationRevision.baseline.baselineType)} · ${humanize(x.configurationRevision.baseline.status)}` : "Missing" },
                    { label: "Sample quantity", value: x.requiredSampleQty },
                  ]}
                />
              </CardBody>
            </Card>
          </div>
          {x.productApproval && (
            <Alert tone={x.productApproval.status === "ACTIVE" ? "success" : "info"} title={`Product approval ${x.productApproval.number}`}>
              {humanize(x.productApproval.status)} since {formatDateTime(x.productApproval.approvedAt)}
              {x.productApproval.restrictions && ` · Restrictions: ${x.productApproval.restrictions}`}
              {x.productApproval.supersededAt && ` · superseded ${formatDateTime(x.productApproval.supersededAt)}`}
            </Alert>
          )}
          <Card>
            <Tabs defaultValue="tests">
              <div className="border-b px-4 pt-3">
                <TabsList>
                  <TabsTrigger value="tests">Tests ({x.tests.length})</TabsTrigger>
                  <TabsTrigger value="fai">First articles ({x.firstArticles.length})</TabsTrigger>
                  <TabsTrigger value="inspection">Inspection results ({x.inspectionResults.length})</TabsTrigger>
                  <TabsTrigger value="quality">NCR / deviations ({x.nonconformances.length + x.deviations.length})</TabsTrigger>
                  <TabsTrigger value="details">Plan</TabsTrigger>
                  {x.approvalPackage && <TabsTrigger value="package">Approval package</TabsTrigger>}
                </TabsList>
              </div>
              <CardBody>
                <TabsContent value="tests">
                  <TestsTab x={x} write={write} onDone={refetch} />
                </TabsContent>
                <TabsContent value="fai">
                  <FaiTab x={x} write={write} onDone={refetch} />
                </TabsContent>
                <TabsContent value="inspection">
                  <InspectionTab x={x} write={write} onDone={refetch} />
                </TabsContent>
                <TabsContent value="quality" className="space-y-3">
                  {x.nonconformances.length + x.deviations.length === 0 && <p className="text-muted-foreground">No nonconformances or deviations are linked to this qualification.</p>}
                  {x.nonconformances.map((n) => (
                    <p key={n.id}>
                      <Link className="font-medium text-accent hover:underline" href={`/quality/ncrs/${n.id}`}>{n.number}</Link> {n.title} <StatusBadge status={n.severity} /> <StatusBadge status={n.status} />
                    </p>
                  ))}
                  {x.deviations.map((d) => (
                    <p key={d.id}>
                      <Link className="font-medium text-accent hover:underline" href={`/quality/deviations/${d.id}`}>{d.number}</Link> {d.title} <Badge>{humanize(d.type)}</Badge> <StatusBadge status={d.status} />
                    </p>
                  ))}
                </TabsContent>
                <TabsContent value="details">
                  <DetailGrid
                    columns={2}
                    items={[
                      { label: "Sample notes", value: x.sampleNotes, wide: true },
                      { label: "Inspection plan notes", value: x.inspectionPlanNotes, wide: true },
                      { label: "Proposed approval restrictions", value: x.approvalRestrictions, wide: true },
                      { label: "Deviations summary", value: x.deviationsSummary, wide: true },
                    ]}
                  />
                  {x.sourcingProject && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Documentation requirements are managed on the <Link className="text-accent hover:underline" href={`/projects/${x.sourcingProject.id}`}>sourcing project checklist</Link>.
                    </p>
                  )}
                  {x.changeRequest && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Documentation requirements are managed on the <Link className="text-accent hover:underline" href={`/changes/${x.changeRequest.id}`}>change request</Link>.
                    </p>
                  )}
                </TabsContent>
                {x.approvalPackage && (
                  <TabsContent value="package">
                    <PackageTab id={id} />
                  </TabsContent>
                )}
              </CardBody>
            </Tabs>
          </Card>
        </div>
        <div className="min-w-0">
          <RecordPanel entityType="PRODUCT_QUALIFICATION" entityId={id} workflowSubjectType="PRODUCT_QUALIFICATION" />
        </div>
      </div>
    </>
  );
}

function GateList({ checks, snapshotPassed }: { checks: GateCheck[] | null; snapshotPassed: boolean }) {
  if (!checks) return <p className="text-xs text-muted-foreground">{snapshotPassed ? "The gate passed at submission; see the approval package for the recorded result." : "No gate result."}</p>;
  return (
    <ul className="space-y-2">
      {checks.map((c) => (
        <li key={c.key} className="flex gap-2">
          {c.passed ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="Passed" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="Failed" />}
          <div>
            <p className={cn(!c.passed && "font-medium")}>{c.label}</p>
            {c.details.map((d) => (
              <p key={d} className="text-xs text-muted-foreground">
                {d}
              </p>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

function StatusChange({ x, onDone }: { x: Qualification; onDone: () => void }) {
  const options = ["DOCUMENTATION_PENDING", "EVALUATION", "VALIDATION", "ON_HOLD"].filter((s) => s !== x.status);
  const [status, setStatus] = useState(options[0]);
  return (
    <ActionDialog
      trigger={<Button variant="outline">Change stage</Button>}
      title="Change qualification stage"
      description="Moves between documentation, evaluation and validation, or puts the qualification on hold. Approval is only possible through submission."
      reasonLabel="Reason"
      reasonRequired={status === "ON_HOLD"}
      confirmLabel="Change stage"
      onConfirm={async (reason) => {
        await api(`/qualifications/${x.id}/status`, { method: "POST", body: { expectedVersion: x.version, status, ...(reason ? { reason } : {}) } });
        toast.success(`Moved to ${humanize(status)}`);
        onDone();
      }}
    >
      <Select aria-label="New stage" value={status} onChange={(e) => setStatus(e.target.value)} options={toOptions(options)} />
    </ActionDialog>
  );
}

function ReviewButtons({ path, onDone, outcome }: { path: string; onDone: () => void; outcome: string | null }) {
  const [decision, setDecision] = useState<"ACCEPTED" | "REJECTED">(outcome === "FAIL" ? "REJECTED" : "ACCEPTED");
  return (
    <ActionDialog
      trigger={<Button size="sm" variant="outline"><ShieldCheck /> Review</Button>}
      title="Review evidence"
      description="Accept or reject the submitted result. Failed results cannot be accepted."
      reasonLabel="Review comment"
      reasonMin={3}
      confirmLabel="Record review"
      onConfirm={async (comment) => {
        await api(path, { method: "POST", body: { decision, comment } });
        toast.success(`Evidence ${decision.toLowerCase()}`);
        onDone();
      }}
    >
      <Select aria-label="Decision" value={decision} onChange={(e) => setDecision(e.target.value as "ACCEPTED" | "REJECTED")} options={toOptions(outcome === "FAIL" ? ["REJECTED"] : ["ACCEPTED", "REJECTED"])} />
    </ActionDialog>
  );
}

interface DocRow {
  id: string;
  docNumber: string;
  title: string;
  status: string;
}

function DocPicker({ typeCode, supplierId, value, onChange }: { typeCode: string; supplierId: string; value: PickerItem | null; onChange: (v: PickerItem | null) => void }) {
  return <AsyncPicker<DocRow> endpoint="/documents" query={{ typeCode, supplierId }} value={value} onChange={onChange} map={(d) => ({ id: d.id, label: `${d.docNumber} · ${d.title}`, sublabel: humanize(d.status) })} placeholder={`Optional ${typeCode} document`} />;
}

function TestsTab({ x, write, onDone }: { x: Qualification; write: boolean; onDone: () => void }) {
  return (
    <div className="space-y-3">
      {write && (
        <div className="flex justify-end">
          <FormDialog
            trigger={<Button size="sm" variant="outline"><Plus /> Plan test</Button>}
            title="Plan a qualification test"
            columns={2}
            fields={[
              { name: "testType", label: "Type", type: "select", required: true, options: toOptions(TEST_TYPE) },
              { name: "name", label: "Name", required: true, minLength: 3, maxLength: 250 },
              { name: "procedure", label: "Procedure", maxLength: 500, wide: true },
              { name: "acceptanceCriteria", label: "Acceptance criteria", type: "textarea", required: true, minLength: 3, maxLength: 10000 },
              { name: "isRequired", label: "Required for approval", type: "checkbox" },
            ]}
            defaultValues={{ isRequired: true }}
            onSubmit={async (payload) => {
              await api(`/qualifications/${x.id}/tests`, { method: "POST", body: payload });
              toast.success("Test planned");
              onDone();
            }}
          />
        </div>
      )}
      {x.tests.length === 0 ? (
        <p className="text-muted-foreground">No tests planned.</p>
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Test</TH>
              <TH>Acceptance criteria</TH>
              <TH>Result</TH>
              <TH>Status</TH>
              {write && <TH />}
            </tr>
          </THead>
          <TBody>
            {x.tests.map((t) => (
              <TR key={t.id}>
                <TD>
                  <span className="font-medium">{t.name}</span> {t.isRequired && <Badge tone="danger">Required</Badge>}
                  <div className="text-xs text-muted-foreground">
                    {humanize(t.testType)}
                    {t.procedure && ` · ${t.procedure}`}
                  </div>
                </TD>
                <TD className="max-w-xs text-xs">{t.acceptanceCriteria}</TD>
                <TD className="max-w-xs text-xs">
                  {t.outcome ? <StatusBadge status={t.outcome} /> : "-"} {t.resultSummary}
                  {t.laboratory && <div className="text-muted-foreground">{t.laboratory} · {formatDate(t.testedAt)}</div>}
                  {t.documentId && (
                    <Link className="text-accent hover:underline" href={`/documents/${t.documentId}`}>
                      Test report
                    </Link>
                  )}
                  {t.reviewComment && <div className="text-muted-foreground">Review: {t.reviewComment}</div>}
                </TD>
                <TD>
                  <StatusBadge status={t.status} />
                </TD>
                {write && (
                  <TD className="space-y-1 text-right">
                    {(t.status === "PLANNED" || t.status === "REJECTED") && <ResultDialog kind="test" x={x} target={t} onDone={onDone} />}
                    {t.status === "SUBMITTED" && <ReviewButtons path={`/qualifications/tests/${t.id}/review`} outcome={t.outcome} onDone={onDone} />}
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}

function ResultDialog({ kind, x, target, onDone }: { kind: "test" | "fai"; x: Qualification; target?: TestRecord; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState("PASS");
  const [summary, setSummary] = useState("");
  const [date, setDate] = useState("");
  const [lab, setLab] = useState("");
  const [serials, setSerials] = useState("");
  const [inspected, setInspected] = useState("0");
  const [nonconforming, setNonconforming] = useState("0");
  const [doc, setDoc] = useState<PickerItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (kind === "test") {
        await api(`/qualifications/tests/${target!.id}/result`, { method: "POST", body: { outcome, resultSummary: summary.trim(), ...(date ? { testedAt: date } : {}), ...(lab.trim() ? { laboratory: lab.trim() } : {}), ...(doc ? { documentId: doc.id } : {}) } });
      } else {
        const ci = Number(inspected);
        const nc = Number(nonconforming);
        if (!Number.isInteger(ci) || ci < 0 || !Number.isInteger(nc) || nc < 0) throw new Error("Counts must be whole numbers of zero or more");
        await api(`/qualifications/${x.id}/first-articles`, { method: "POST", body: { outcome, characteristicsInspected: ci, nonconformingCount: nc, ...(summary.trim() ? { summary: summary.trim() } : {}), ...(serials.trim() ? { serialNumbers: serials.trim() } : {}), ...(date ? { inspectionDate: date } : {}), ...(doc ? { documentId: doc.id } : {}) } });
      }
      toast.success(kind === "test" ? "Result recorded" : "First article inspection recorded");
      setOpen(false);
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const valid = kind === "test" ? summary.trim().length >= 3 : inspected !== "";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {kind === "test" ? <Button size="sm" variant="outline">Record result</Button> : <Button size="sm" variant="outline"><Plus /> Record FAI</Button>}
      </DialogTrigger>
      <DialogContent title={kind === "test" ? `Result: ${target!.name}` : "Record first article inspection"} description={kind === "fai" ? `Inspects configuration revision ${x.configurationRevision.revisionLabel}. A passing FAI cannot have nonconforming characteristics.` : undefined}>
        {error ? <ErrorAlert error={error} /> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Outcome" htmlFor="res-outcome">
            <Select id="res-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} options={toOptions(["PASS", "FAIL", "CONDITIONAL"])} />
          </Field>
          <Field label={kind === "test" ? "Tested on" : "Inspection date"} htmlFor="res-date">
            <Input id="res-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          {kind === "test" ? (
            <Field label="Laboratory" htmlFor="res-lab" className="sm:col-span-2">
              <Input id="res-lab" value={lab} onChange={(e) => setLab(e.target.value)} />
            </Field>
          ) : (
            <>
              <Field label="Characteristics inspected" required htmlFor="res-ci">
                <Input id="res-ci" type="number" min={0} step={1} value={inspected} onChange={(e) => setInspected(e.target.value)} />
              </Field>
              <Field label="Nonconforming" required htmlFor="res-nc">
                <Input id="res-nc" type="number" min={0} step={1} value={nonconforming} onChange={(e) => setNonconforming(e.target.value)} />
              </Field>
              <Field label="Serial numbers" htmlFor="res-sn" className="sm:col-span-2">
                <Input id="res-sn" value={serials} onChange={(e) => setSerials(e.target.value)} />
              </Field>
            </>
          )}
          <Field label={kind === "test" ? "Result summary" : "Summary"} required={kind === "test"} htmlFor="res-sum" className="sm:col-span-2">
            <Textarea id="res-sum" value={summary} onChange={(e) => setSummary(e.target.value)} />
          </Field>
          <Field label={kind === "test" ? "Test report document (VAL-03)" : "FAIR document (VAL-02)"} className="sm:col-span-2">
            <DocPicker typeCode={kind === "test" ? "VAL-03" : "VAL-02"} supplierId={x.supplier.id} value={doc} onChange={setDoc} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button loading={busy} disabled={!valid} onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FaiTab({ x, write, onDone }: { x: Qualification; write: boolean; onDone: () => void }) {
  return (
    <div className="space-y-3">
      {write && (
        <div className="flex justify-end">
          <ResultDialog kind="fai" x={x} onDone={onDone} />
        </div>
      )}
      {x.firstArticles.length === 0 ? (
        <p className="text-muted-foreground">No first article inspections recorded.</p>
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>FAI</TH>
              <TH>Inspected</TH>
              <TH>Outcome</TH>
              <TH>Summary</TH>
              <TH>Status</TH>
              {write && <TH />}
            </tr>
          </THead>
          <TBody>
            {x.firstArticles.map((f) => (
              <TR key={f.id}>
                <TD>
                  <span className="font-medium">{f.number}</span>
                  <div className="text-xs text-muted-foreground">
                    {f.serialNumbers ?? "-"} · {formatDate(f.inspectionDate)}
                  </div>
                </TD>
                <TD>
                  {f.characteristicsInspected} chars
                  {f.nonconformingCount > 0 && <span className="text-destructive"> · {f.nonconformingCount} NC</span>}
                </TD>
                <TD>
                  <StatusBadge status={f.outcome} />
                </TD>
                <TD className="max-w-xs text-xs">
                  {f.summary ?? "-"}
                  {f.documentId && (
                    <div>
                      <Link className="text-accent hover:underline" href={`/documents/${f.documentId}`}>FAIR document</Link>
                    </div>
                  )}
                  {f.reviewComment && <div className="text-muted-foreground">Review: {f.reviewComment}</div>}
                </TD>
                <TD>
                  <StatusBadge status={f.status} />
                </TD>
                {write && <TD className="text-right">{f.status === "SUBMITTED" && <ReviewButtons path={`/qualifications/first-articles/${f.id}/review`} outcome={f.outcome} onDone={onDone} />}</TD>}
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}

function InspectionTab({ x, write, onDone }: { x: Qualification; write: boolean; onDone: () => void }) {
  const chars = x.configurationRevision.characteristics;
  const charName = (cid: string | null) => {
    const c = chars.find((y) => y.id === cid);
    return c ? `${c.charNumber} ${c.name}` : "-";
  };
  return (
    <div className="space-y-3">
      {write && (
        <div className="flex justify-end">
          <FormDialog
            trigger={<Button size="sm" variant="outline"><Plus /> Record inspection result</Button>}
            title="Record inspection result"
            columns={2}
            fields={[
              { name: "characteristicId", label: "Characteristic", type: "select", options: chars.map((c) => ({ value: c.id, label: `${c.charNumber} ${c.name} (${humanize(c.classification)})` })) },
              { name: "firstArticleId", label: "First article", type: "select", options: x.firstArticles.map((f) => ({ value: f.id, label: f.number })) },
              { name: "sampleIdentifier", label: "Sample", maxLength: 80 },
              { name: "measuredValue", label: "Measured value", maxLength: 200 },
              { name: "numericValue", label: "Numeric value", type: "number" },
              { name: "outcome", label: "Outcome", type: "select", required: true, options: toOptions(INSPECTION_OUTCOME) },
              { name: "notes", label: "Notes", type: "textarea", maxLength: 5000 },
            ]}
            onSubmit={async (payload) => {
              await api(`/qualifications/${x.id}/inspection-results`, { method: "POST", body: payload });
              toast.success("Inspection result recorded");
              onDone();
            }}
          />
        </div>
      )}
      {x.inspectionResults.length === 0 ? (
        <p className="text-muted-foreground">No inspection results recorded.</p>
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Characteristic</TH>
              <TH>Sample</TH>
              <TH>Measured</TH>
              <TH>Outcome</TH>
              <TH>Notes</TH>
              <TH>Recorded</TH>
            </tr>
          </THead>
          <TBody>
            {x.inspectionResults.map((r) => (
              <TR key={r.id}>
                <TD>{charName(r.characteristicId)}</TD>
                <TD>{r.sampleIdentifier ?? "-"}</TD>
                <TD>{r.measuredValue ?? r.numericValue ?? "-"}</TD>
                <TD>
                  <StatusBadge status={r.outcome} />
                </TD>
                <TD className="max-w-xs text-xs">{r.notes ?? "-"}</TD>
                <TD>{formatDateTime(r.createdAt)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}

function PackageTab({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["approval-package", id], queryFn: () => api<Package>(`/qualifications/${id}/approval-package`) });
  if (q.isLoading) return <p className="text-muted-foreground">Loading...</p>;
  if (q.error || !q.data) return <ErrorAlert error={q.error} />;
  const pkg = q.data;
  return (
    <div className="space-y-3">
      <Alert tone={pkg.integrityVerified ? "success" : "danger"} title={pkg.integrityVerified ? "Integrity verified" : "Integrity check failed"}>
        {pkg.number} created {formatDateTime(pkg.createdAt)}. Snapshot hash <span className="break-all font-mono text-xs">{pkg.snapshotHash}</span>
        {!pkg.integrityVerified && " — the recorded document revisions no longer match their content hashes. Investigate before relying on this approval."}
      </Alert>
      <Table>
        <THead>
          <tr>
            <TH>Document type</TH>
            <TH>Document revision</TH>
            <TH>Content hash (SHA-256)</TH>
          </tr>
        </THead>
        <TBody>
          {pkg.items.map((i) => {
            const d = pkg.snapshot.documents?.find((x) => x.revisionId === i.documentRevisionId);
            return (
            <TR key={i.id}>
              <TD className="font-mono text-xs">{i.documentTypeCode}</TD>
              <TD>
                {d ? (
                  <Link className="text-accent hover:underline" href={`/documents/${d.documentId}`}>
                    {d.docNumber} rev {d.revisionLabel}
                  </Link>
                ) : (
                  <span className="font-mono text-xs">{i.documentRevisionId.slice(0, 8)}</span>
                )}
              </TD>
              <TD className="break-all font-mono text-[11px] text-muted-foreground">{i.contentHash}</TD>
            </TR>
            );
          })}
        </TBody>
      </Table>
      {pkg.snapshot.waivers && pkg.snapshot.waivers.length > 0 && (
        <div>
          <p className="mb-1 font-medium">Waivers in effect at approval</p>
          <ul className="space-y-1 text-xs">
            {pkg.snapshot.waivers.map((w, i) => (
              <li key={i}>
                <Badge tone={w.level === "REQUIRED" ? "danger" : "warning"}>{humanize(w.level)}</Badge> {w.documentTypeCode} {w.justification} <span className="text-muted-foreground">({formatDate(w.waivedAt)})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
