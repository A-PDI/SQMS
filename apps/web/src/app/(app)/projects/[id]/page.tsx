"use client";

import { useQuery } from "@tanstack/react-query";
import { PATHWAY_LABELS, PROJECT_MEMBER_ROLE, PROJECT_STAGE, RISK_FACTORS, computeRisk, humanize, type RiskResult } from "@sqms/shared";
import { Pause, Play, Plus, Send, Trash2, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ActionDialog } from "@/components/common/action-dialog";
import { RecordPanel } from "@/components/common/collaboration";
import { DetailGrid } from "@/components/common/detail-grid";
import { ChecklistProgress, RequirementChecklist, type ChecklistSummary, type Requirement } from "@/components/common/requirements";
import { AsyncPicker, UserPicker, type PickerItem } from "@/components/forms/async-picker";
import { FormDialog } from "@/components/forms/schema-form";
import { PageHeader } from "@/components/shell/page-header";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Alert, ErrorAlert, PageLoading } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { toOptions } from "@/lib/options";
import { useSession } from "@/lib/session";

interface RiskFactorValue {
  key: string;
  label: string;
  value: string;
  valueLabel: string;
  points: number;
}
interface Risk {
  id: string;
  modelVersion: string;
  factors: RiskFactorValue[];
  score: number;
  level: string;
  specialProcesses: boolean;
  specialProcessList: string | null;
  rationale: string | null;
  isCurrent: boolean;
  assessedAt: string;
}
interface Project {
  id: string;
  projectNumber: string;
  title: string;
  description: string | null;
  pathway: "A" | "B" | "C";
  reverseEngineeringRequired: boolean;
  engineeringOwnership: string;
  status: string;
  stage: string;
  targetDate: string | null;
  businessJustification: string;
  annualVolume: number | null;
  specialProcesses: boolean;
  customerRequirements: boolean;
  applicabilityContext: Record<string, unknown> | null;
  checklistGeneratedAt: string | null;
  supplierVisible: boolean;
  submittedAt: string | null;
  approvedAt: string | null;
  closedAt: string | null;
  holdReason: string | null;
  createdAt: string;
  version: number;
  internalPart: { id: string; partNumber: string; description: string; criticality: string; status: string };
  supplier: { id: string; name: string; supplierNumber: string; status: string; country: string };
  site: { id: string; siteCode: string; name: string; status: string; country: string };
  supplierPart: { id: string; supplierPartNumber: string; isCustom: boolean } | null;
  supplierProduct: { id: string; status: string } | null;
  configuration: { id: string; configCode: string; name: string; configurationType: string; currentApprovedRevisionId: string | null; revisions: { id: string; revisionLabel: string; status: string }[] } | null;
  owner: { id: string; displayName: string; email: string } | null;
  members: { id: string; userId: string; role: string; dueDate: string | null; responsibility: string | null; user: { id: string; displayName: string; email: string } }[];
  policyVersion: { id: string; version: number; policy: { key: string; name: string } } | null;
  requirements: Requirement[];
  checklist: ChecklistSummary;
  risk: Risk | null;
  riskHistory: Risk[];
  qualifications: { id: string; number: string; status: string; riskLevel: string | null; createdAt: string }[];
}

const EDITABLE = ["DRAFT", "SUBMITTED", "IN_PROGRESS", "QUALIFICATION", "ON_HOLD", "APPROVED"];

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useSession();
  const q = useQuery({ queryKey: ["project", id], queryFn: () => api<Project>(`/sourcing-projects/${id}`) });
  if (q.isLoading) return <PageLoading />;
  if (q.error || !q.data) return <ErrorAlert error={q.error} />;
  const p = q.data;
  const refetch = () => void q.refetch();
  const write = can("project:write");
  const post = (path: string, body: Record<string, unknown> = {}) => api(`/sourcing-projects/${id}/${path}`, { method: "POST", body: { expectedVersion: p.version, ...body } }).then(refetch);
  const latestRevision = p.configuration?.revisions[0];

  return (
    <>
      <PageHeader
        title={p.title}
        breadcrumbs={[{ href: "/projects", label: "Sourcing projects" }, { label: p.projectNumber }]}
        description={`${p.projectNumber} · ${PATHWAY_LABELS[p.pathway] ?? `Pathway ${p.pathway}`}`}
        meta={
          <>
            <StatusBadge status={p.status} />
            <span>Stage: {humanize(p.stage)}</span>
            {p.risk && (
              <span className="flex items-center gap-1">
                Risk <StatusBadge status={p.risk.level} />
              </span>
            )}
            {p.reverseEngineeringRequired && <Badge tone="warning">Reverse engineering</Badge>}
          </>
        }
        actions={
          write && (
            <>
              {p.status === "DRAFT" && (
                <ActionDialog trigger={<Button><Send /> Submit for intake review</Button>} title="Submit sourcing project" description="Submits the Product Sourcing Request and the Sourcing Path & Risk Assessment for intake review." confirmLabel="Submit" onConfirm={() => post("submit").then(() => toast.success("Submitted for intake review"))} />
              )}
              {["IN_PROGRESS", "QUALIFICATION", "DRAFT"].includes(p.status) && (
                <ActionDialog trigger={<Button variant="outline"><Pause /> Hold</Button>} title="Put project on hold" reasonLabel="Reason" confirmLabel="Put on hold" onConfirm={(reason) => post("hold", { reason })} />
              )}
              {p.status === "ON_HOLD" && <ActionDialog trigger={<Button variant="outline"><Play /> Resume</Button>} title="Resume project" confirmLabel="Resume" onConfirm={() => post("resume")} />}
              {p.status === "APPROVED" && <ActionDialog trigger={<Button variant="outline">Close project</Button>} title="Close project" description="The approved product moves to production; the project record becomes read-only." confirmLabel="Close" onConfirm={() => post("close")} />}
              {!["CLOSED", "CANCELLED", "APPROVED", "REJECTED"].includes(p.status) && (
                <ActionDialog trigger={<Button variant="ghost"><XCircle /> Cancel</Button>} title="Cancel sourcing project" reasonLabel="Reason for cancellation" confirmLabel="Cancel project" confirmVariant="destructive" onConfirm={(reason) => post("cancel", { reason })} />
              )}
              {EDITABLE.includes(p.status) && <EditProject p={p} onDone={refetch} />}
            </>
          )
        }
      />
      {p.holdReason && p.status === "ON_HOLD" && <Alert tone="warning" className="mb-4" title="On hold">{p.holdReason}</Alert>}
      {p.status === "SUBMITTED" && <Alert className="mb-4">Intake review is in progress. The checklist can be worked while the request is reviewed.</Alert>}
      <div className="grid gap-4 2xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardBody className="space-y-3">
                <ChecklistProgress summary={p.checklist} />
                <p className="text-xs text-muted-foreground">
                  Generated {formatDateTime(p.checklistGeneratedAt)} from {p.policyVersion ? `${p.policyVersion.policy.name} v${p.policyVersion.version}` : "the applicability policy"}. {p.checklist.required} mandatory controls.
                </p>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="space-y-1 text-xs">
                <p>
                  <span className="text-muted-foreground">Product </span>
                  <Link className="font-medium text-accent hover:underline" href={`/products/${p.internalPart.id}`}>{p.internalPart.partNumber}</Link> <StatusBadge status={p.internalPart.criticality} />
                </p>
                <p>
                  <span className="text-muted-foreground">Supplier </span>
                  <Link className="font-medium text-accent hover:underline" href={`/suppliers/${p.supplier.id}`}>{p.supplier.name}</Link> <StatusBadge status={p.supplier.status} />
                </p>
                <p>
                  <span className="text-muted-foreground">Site </span>
                  {p.site.siteCode} {p.site.name} <StatusBadge status={p.site.status} />
                </p>
                {p.supplierProduct && (
                  <p>
                    <span className="text-muted-foreground">Source </span>
                    <Link className="text-accent hover:underline" href={`/products/supplier-products/${p.supplierProduct.id}`}>{p.supplierPart?.supplierPartNumber ?? "Supplier product"}</Link> <StatusBadge status={p.supplierProduct.status} />
                  </p>
                )}
                {latestRevision && (
                  <p>
                    <span className="text-muted-foreground">Configuration </span>
                    <Link className="text-accent hover:underline" href={`/configurations/revisions/${latestRevision.id}`}>{p.configuration!.configCode} rev {latestRevision.revisionLabel}</Link> <StatusBadge status={latestRevision.status} />
                  </p>
                )}
              </CardBody>
            </Card>
          </div>
          <Card>
            <Tabs defaultValue="checklist">
              <div className="border-b px-4 pt-3">
                <TabsList>
                  <TabsTrigger value="checklist">Document checklist</TabsTrigger>
                  <TabsTrigger value="details">Details</TabsTrigger>
                  <TabsTrigger value="risk">Risk</TabsTrigger>
                  <TabsTrigger value="team">Team ({p.members.length})</TabsTrigger>
                  <TabsTrigger value="qualification">Qualification ({p.qualifications.length})</TabsTrigger>
                </TabsList>
              </div>
              <CardBody>
                <TabsContent value="checklist" className="space-y-3">
                  {write && !["CLOSED", "CANCELLED", "REJECTED", "APPROVED"].includes(p.status) && (
                    <div className="flex justify-end">
                      <AddRequirement projectId={id} onDone={refetch} />
                    </div>
                  )}
                  <RequirementChecklist requirements={p.requirements} onChanged={refetch} editable={!["CLOSED", "CANCELLED"].includes(p.status)} />
                </TabsContent>
                <TabsContent value="details">
                  <DetailGrid
                    items={[
                      { label: "Project number", value: p.projectNumber },
                      { label: "Pathway", value: PATHWAY_LABELS[p.pathway] ?? p.pathway },
                      { label: "Engineering ownership", value: humanize(p.engineeringOwnership) },
                      { label: "Owner", value: p.owner?.displayName },
                      { label: "Target date", value: formatDate(p.targetDate) },
                      { label: "Annual volume", value: p.annualVolume?.toLocaleString() },
                      { label: "Special processes", value: p.specialProcesses ? "Yes" : "No" },
                      { label: "Customer-specific requirements", value: p.customerRequirements ? "Yes" : "No" },
                      { label: "Visible to supplier", value: p.supplierVisible ? "Yes" : "No" },
                      { label: "Submitted", value: formatDateTime(p.submittedAt) },
                      { label: "Approved", value: formatDateTime(p.approvedAt) },
                      { label: "Closed", value: formatDateTime(p.closedAt) },
                      { label: "Business justification", value: p.businessJustification, wide: true },
                      { label: "Description", value: p.description, wide: true },
                    ]}
                  />
                  {p.applicabilityContext && (
                    <div className="mt-4">
                      <p className="mb-1 text-xs text-muted-foreground">Applicability inputs recorded with the checklist</p>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(p.applicabilityContext).map(([k, v]) => (
                          <Badge key={k} tone="muted">
                            {humanize(k.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase())}: {String(v)}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="risk">
                  <RiskTab p={p} onDone={refetch} />
                </TabsContent>
                <TabsContent value="team">
                  <TeamTab p={p} onDone={refetch} />
                </TabsContent>
                <TabsContent value="qualification" className="space-y-3">
                  {p.qualifications.length === 0 ? (
                    <p className="text-muted-foreground">No product qualification has been opened yet. Qualification evaluates the exact configuration revision, site and documentation for approval.</p>
                  ) : (
                    <Table>
                      <THead>
                        <tr>
                          <TH>Qualification</TH>
                          <TH>Status</TH>
                          <TH>Risk</TH>
                          <TH>Opened</TH>
                        </tr>
                      </THead>
                      <TBody>
                        {p.qualifications.map((x) => (
                          <TR key={x.id}>
                            <TD>
                              <Link className="font-medium text-accent hover:underline" href={`/qualifications/${x.id}`}>{x.number}</Link>
                            </TD>
                            <TD><StatusBadge status={x.status} /></TD>
                            <TD><StatusBadge status={x.riskLevel} /></TD>
                            <TD>{formatDate(x.createdAt)}</TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  )}
                  {can("qualification:write") && ["IN_PROGRESS", "QUALIFICATION"].includes(p.status) && !p.qualifications.some((x) => !["REJECTED", "CANCELLED"].includes(x.status)) && (
                    <ActionDialog
                      trigger={<Button><Plus /> Open product qualification</Button>}
                      title="Open product qualification"
                      description="Creates a qualification for the project's target configuration revision and supplier site. Approval remains gated on the full checklist, baseline and validation evidence."
                      confirmLabel="Open qualification"
                      onConfirm={async () => {
                        const created = await api<{ id: string }>("/qualifications", { method: "POST", body: { sourcingProjectId: id } });
                        router.push(`/qualifications/${created.id}`);
                      }}
                    />
                  )}
                </TabsContent>
              </CardBody>
            </Tabs>
          </Card>
        </div>
        <div className="min-w-0">
          <RecordPanel entityType="SOURCING_PROJECT" entityId={id} workflowSubjectType="SOURCING_PROJECT" />
        </div>
      </div>
    </>
  );
}

function EditProject({ p, onDone }: { p: Project; onDone: () => void }) {
  return (
    <FormDialog
      trigger={<Button variant="outline">Edit</Button>}
      title="Edit sourcing project"
      wide
      columns={2}
      fields={[
        { name: "title", label: "Title", required: true, minLength: 3, maxLength: 250, wide: true },
        { name: "stage", label: "Stage", type: "select", options: toOptions(PROJECT_STAGE) },
        { name: "targetDate", label: "Target date", type: "date" },
        { name: "annualVolume", label: "Annual volume", type: "number", integer: true, min: 0 },
        { name: "supplierVisible", label: "Visible to supplier (Phase 2 portal)", type: "checkbox" },
        { name: "businessJustification", label: "Business justification", type: "textarea", required: true, minLength: 5, maxLength: 5000 },
        { name: "description", label: "Description", type: "textarea", maxLength: 10000, nullable: true },
      ]}
      defaultValues={p as unknown as Record<string, unknown>}
      onSubmit={async (payload) => {
        await api(`/sourcing-projects/${p.id}`, { method: "PATCH", body: { expectedVersion: p.version, ...payload } });
        toast.success("Project updated");
        onDone();
      }}
    />
  );
}

interface DocTypeRow {
  id: string;
  code: string;
  name: string;
  category: string;
  status: string;
}

function AddRequirement({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<PickerItem | null>(null);
  const [level, setLevel] = useState<"REQUIRED" | "CONDITIONAL">("REQUIRED");
  const [reason, setReason] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [assignee, setAssignee] = useState<PickerItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/sourcing-projects/${projectId}/requirements`, { method: "POST", body: { documentTypeId: type!.id, level, reason: reason.trim(), ...(dueDate ? { dueDate } : {}), ...(assignee ? { assignedToId: assignee.id } : {}) } });
      toast.success("Requirement added");
      setOpen(false);
      setType(null);
      setReason("");
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Plus /> Add requirement</Button>
      </DialogTrigger>
      <DialogContent title="Add document requirement" description="Adds a requirement beyond the policy-generated checklist. The reason is kept with the requirement.">
        {error ? <ErrorAlert error={error} /> : null}
        <div className="space-y-3">
          <Field label="Document type" required>
            <AsyncPicker<DocTypeRow> endpoint="/document-types" query={{ status: "ACTIVE" }} value={type} onChange={setType} map={(t) => ({ id: t.id, label: `${t.code} ${t.name}`, sublabel: humanize(t.category) })} placeholder="Search document types" />
          </Field>
          <Field label="Level" htmlFor="req-level">
            <Select id="req-level" value={level} onChange={(e) => setLevel(e.target.value as "REQUIRED" | "CONDITIONAL")} options={toOptions(["REQUIRED", "CONDITIONAL"])} />
          </Field>
          <Field label="Reason" required htmlFor="req-reason" hint="At least 5 characters.">
            <Textarea id="req-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Assigned to">
              <UserPicker value={assignee} onChange={setAssignee} />
            </Field>
            <Field label="Due date" htmlFor="req-due-new">
              <Input id="req-due-new" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button loading={busy} disabled={!type || reason.trim().length < 5} onClick={save}>Add requirement</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const USER_FACTORS = RISK_FACTORS.filter((f) => !f.derived && f.key !== "specialProcesses");

function RiskTab({ p, onDone }: { p: Project; onDone: () => void }) {
  const { can } = useSession();
  return (
    <div className="space-y-4">
      {p.risk ? <RiskView risk={p.risk} /> : <p className="text-muted-foreground">No risk assessment recorded.</p>}
      {can("project:write") && ["DRAFT", "IN_PROGRESS", "ON_HOLD"].includes(p.status) && <ReassessRisk p={p} onDone={onDone} />}
      {p.riskHistory.length > 1 && (
        <div>
          <p className="mb-1 font-medium">Assessment history</p>
          <Table>
            <THead>
              <tr>
                <TH>Assessed</TH>
                <TH>Score</TH>
                <TH>Level</TH>
                <TH>Model</TH>
                <TH>Rationale</TH>
              </tr>
            </THead>
            <TBody>
              {p.riskHistory.map((r) => (
                <TR key={r.id}>
                  <TD>{formatDateTime(r.assessedAt)} {r.isCurrent && <Badge tone="success">Current</Badge>}</TD>
                  <TD>{r.score}</TD>
                  <TD><StatusBadge status={r.level} /></TD>
                  <TD>{r.modelVersion}</TD>
                  <TD className="max-w-sm text-xs">{r.rationale ?? "-"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function RiskView({ risk }: { risk: Risk | RiskResult }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <p className="flex flex-wrap items-center gap-2 font-medium">
        <StatusBadge status={risk.level} /> score {risk.score} <span className="text-xs font-normal text-muted-foreground">model {risk.modelVersion}</span>
      </p>
      <div className="mt-2 grid gap-1 sm:grid-cols-2">
        {risk.factors.map((f) => (
          <div key={f.key} className="flex justify-between gap-2 border-b border-dashed py-0.5 text-xs">
            <span className="text-muted-foreground">{f.label}</span>
            <span>
              {f.valueLabel} <span className={f.points > 0 ? "text-warning" : "text-muted-foreground"}>+{f.points}</span>
            </span>
          </div>
        ))}
      </div>
      {"specialProcessList" in risk && risk.specialProcessList && <p className="mt-2 text-xs">Special processes: {risk.specialProcessList}</p>}
      {"rationale" in risk && risk.rationale && <p className="mt-1 text-xs">Rationale: {risk.rationale}</p>}
      {"overrides" in risk && risk.overrides.map((o) => <p key={o} className="mt-1 text-xs text-warning">{o}</p>)}
    </div>
  );
}

function ReassessRisk({ p, onDone }: { p: Project; onDone: () => void }) {
  const current = Object.fromEntries((p.risk?.factors ?? []).map((f) => [f.key, f.value]));
  const [open, setOpen] = useState(false);
  const [factors, setFactors] = useState<Record<string, string>>(() => Object.fromEntries(USER_FACTORS.map((f) => [f.key, current[f.key] ?? f.options[0].value])));
  const [special, setSpecial] = useState(p.specialProcesses);
  const [customer, setCustomer] = useState(p.customerRequirements);
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ctx = p.applicabilityContext ?? {};
  const preview = useMemo(() => {
    try {
      return computeRisk(
        { criticality: (ctx.criticality ?? p.internalPart.criticality) as never, supplierStatus: (ctx.supplierStatus ?? p.supplier.status) as never, pathway: p.pathway, reverseEngineering: p.reverseEngineeringRequired },
        { ...factors, specialProcesses: String(special) },
      );
    } catch {
      return null;
    }
  }, [factors, special, ctx.criticality, ctx.supplierStatus, p.internalPart.criticality, p.supplier.status, p.pathway, p.reverseEngineeringRequired]);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/sourcing-projects/${p.id}/risk-assessment`, { method: "POST", body: { expectedVersion: p.version, riskFactors: factors, specialProcesses: special, customerRequirements: customer, rationale: rationale.trim() } });
      toast.success("Risk re-assessed; the checklist was re-evaluated");
      setOpen(false);
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Re-assess risk</Button>
      </DialogTrigger>
      <DialogContent title="Re-assess sourcing risk" description="A new assessment is recorded; previous assessments stay in history. Requirements added by the new risk level are added to the checklist." wide>
        {error ? <ErrorAlert error={error} /> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {USER_FACTORS.map((f) => (
            <Field key={f.key} label={f.label} htmlFor={`rr-${f.key}`} hint={f.help}>
              <Select id={`rr-${f.key}`} value={factors[f.key]} onChange={(e) => setFactors({ ...factors, [f.key]: e.target.value })} options={f.options.map((o) => ({ value: o.value, label: `${o.label} (+${o.points})` }))} />
            </Field>
          ))}
          <label className="flex items-center gap-2">
            <Checkbox checked={special} onCheckedChange={(c) => setSpecial(c === true)} /> Special processes
          </label>
          <label className="flex items-center gap-2">
            <Checkbox checked={customer} onCheckedChange={(c) => setCustomer(c === true)} /> Customer-specific requirements
          </label>
          <Field label="Rationale" required className="sm:col-span-2" htmlFor="rr-rationale" hint="Why the assessment changed (at least 5 characters).">
            <Textarea id="rr-rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} />
          </Field>
        </div>
        {preview && <RiskView risk={preview} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button loading={busy} disabled={rationale.trim().length < 5} onClick={save}>Record assessment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TeamTab({ p, onDone }: { p: Project; onDone: () => void }) {
  const { can } = useSession();
  const write = can("project:write") && !["CLOSED", "CANCELLED"].includes(p.status);
  const [user, setUser] = useState<PickerItem | null>(null);
  const [role, setRole] = useState("CONTRIBUTOR");
  const [dueDate, setDueDate] = useState("");
  const [responsibility, setResponsibility] = useState("");
  const [busy, setBusy] = useState(false);
  async function add() {
    setBusy(true);
    try {
      await api(`/sourcing-projects/${p.id}/members`, { method: "POST", body: { userId: user!.id, role, ...(dueDate ? { dueDate } : {}), ...(responsibility.trim() ? { responsibility: responsibility.trim() } : {}) } });
      toast.success("Team member added");
      setUser(null);
      setResponsibility("");
      setDueDate("");
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(memberId: string) {
    try {
      await api(`/sourcing-projects/${p.id}/members/${memberId}`, { method: "DELETE" });
      toast.success("Team member removed");
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return (
    <div className="space-y-4">
      <Table>
        <THead>
          <tr>
            <TH>Person</TH>
            <TH>Role</TH>
            <TH>Responsibility</TH>
            <TH>Due</TH>
            {write && <TH className="w-10" />}
          </tr>
        </THead>
        <TBody>
          {p.members.map((m) => (
            <TR key={m.id}>
              <TD>
                {m.user.displayName}
                <div className="text-xs text-muted-foreground">{m.user.email}</div>
              </TD>
              <TD>{humanize(m.role)}</TD>
              <TD className="text-xs">{m.responsibility ?? "-"}</TD>
              <TD>{formatDate(m.dueDate)}</TD>
              {write && (
                <TD>
                  {m.role !== "OWNER" && (
                    <Button size="icon" variant="ghost" onClick={() => void remove(m.id)} aria-label={`Remove ${m.user.displayName}`}>
                      <Trash2 />
                    </Button>
                  )}
                </TD>
              )}
            </TR>
          ))}
        </TBody>
      </Table>
      {write && (
        <div className="grid items-end gap-2 rounded-md border p-3 sm:grid-cols-2 xl:grid-cols-[1fr_180px_150px_1fr_auto]">
          <Field label="Person">
            <UserPicker value={user} onChange={setUser} />
          </Field>
          <Field label="Role" htmlFor="tm-role">
            <Select id="tm-role" value={role} onChange={(e) => setRole(e.target.value)} options={toOptions(PROJECT_MEMBER_ROLE.filter((r) => r !== "OWNER"))} />
          </Field>
          <Field label="Due date" htmlFor="tm-due">
            <Input id="tm-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <Field label="Responsibility" htmlFor="tm-resp">
            <Input id="tm-resp" value={responsibility} onChange={(e) => setResponsibility(e.target.value)} />
          </Field>
          <Button onClick={add} loading={busy} disabled={!user}>
            <Plus /> Add
          </Button>
        </div>
      )}
    </div>
  );
}
