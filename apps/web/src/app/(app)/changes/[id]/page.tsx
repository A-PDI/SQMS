"use client";

import { useQuery } from "@tanstack/react-query";
import { DISCIPLINE, IMPACT_RECOMMENDATION, RISK_LEVEL, humanize } from "@sqms/shared";
import { ArrowRight, CheckCircle2, Send, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ActionDialog } from "@/components/common/action-dialog";
import { RecordPanel } from "@/components/common/collaboration";
import { DetailGrid } from "@/components/common/detail-grid";
import { RequirementChecklist, type Requirement } from "@/components/common/requirements";
import { FormDialog } from "@/components/forms/schema-form";
import { PageHeader } from "@/components/shell/page-header";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, ErrorAlert, PageLoading } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { api } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { toOptions } from "@/lib/options";
import { useSession } from "@/lib/session";

interface Rev {
  id: string;
  revisionLabel: string;
  status: string;
  changeSummary: string | null;
  configuration: { id: string; configCode: string; name: string; currentApprovedRevisionId: string | null };
}
interface Assessment {
  id: string;
  discipline: string;
  impactSummary: string;
  recommendation: string;
  comments: string | null;
  createdAt: string;
  [flag: string]: unknown;
}
interface Change {
  id: string;
  number: string;
  title: string;
  status: string;
  riskLevel: string | null;
  reason: string;
  description: string;
  affectedCharacteristics: string | null;
  proposedImplementationDate: string | null;
  inventoryImpact: string | null;
  wipImpact: string | null;
  riskAssessment?: string | null;
  requiredValidation: string | null;
  infoRequest: string | null;
  disposition: string | null;
  dispositionConditions: string | null;
  decisionComment: string | null;
  decidedAt: string | null;
  implementationNotes: string | null;
  implementationVerifiedAt: string | null;
  shipmentAuthorizedAt: string | null;
  submittedAt: string | null;
  closedAt: string | null;
  withdrawnAt: string | null;
  version: number;
  categories: string[];
  supplier: { id: string; name: string; supplierNumber: string; status: string };
  supplierProduct: { id: string; status: string };
  internalPart: { id: string; partNumber: string; description: string; criticality: string };
  supplierPart: { id: string; supplierPartNumber: string };
  currentSite: { id: string; siteCode: string; name: string; country: string };
  proposedSite: { id: string; siteCode: string; name: string; country: string } | null;
  currentRevision: Rev;
  proposedRevision: Rev | null;
  requalification?: { id: string; number: string; status: string; riskLevel: string | null } | null;
  submittedByOrganization: { id: string; name: string; type: string };
  comparison: {
    siteChanged: boolean;
    baseline: { field: string; current: unknown; proposed: unknown }[];
    requirements: { added: { code: string; title: string; requiredValue: string }[]; removed: { code: string; title: string }[]; changed: { code: string; fields: { field: string; current: unknown; proposed: unknown }[] }[] };
    characteristics: { charNumber: string; name: string; change: string }[];
  } | null;
  requiredDocuments: Requirement[];
  impactAssessments?: Assessment[];
  gate?: { key: string; label: string; passed: boolean; details: string[] }[];
}

const FLAGS = [
  ["affectsFormFitFunction", "Affects form, fit or function"],
  ["affectsInterchangeability", "Affects interchangeability"],
  ["requiresFai", "Requires FAI"],
  ["requiresPartialRequalification", "Requires partial requalification"],
  ["requiresFunctionalTest", "Requires functional test"],
  ["requiresMaterialCertificates", "Requires material certificates"],
  ["requiresControlPlanUpdate", "Requires control plan update"],
  ["requiresSpecificationRevision", "Requires specification revision"],
  ["requiresNewProductApproval", "Requires new product approval"],
] as const;
const EDITABLE = ["DRAFT", "INFO_REQUIRED"];
const REVIEW = ["SUBMITTED", "UNDER_REVIEW", "VALIDATION_REQUIRED"];
const OPEN = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "INFO_REQUIRED", "VALIDATION_REQUIRED"];

export default function ChangePage() {
  const { id } = useParams<{ id: string }>();
  const { can, isInternal } = useSession();
  const q = useQuery({ queryKey: ["change", id], queryFn: () => api<Change>(`/change-requests/${id}`) });
  if (q.isLoading) return <PageLoading />;
  if (q.error || !q.data) return <ErrorAlert error={q.error} />;
  const c = q.data;
  const refetch = () => void q.refetch();
  const post = (path: string, body: Record<string, unknown> = {}) => api(`/change-requests/${id}/${path}`, { method: "POST", body: { expectedVersion: c.version, ...body } }).then(refetch);
  const review = isInternal && can("change:review");
  const gatePassed = c.gate?.every((g) => g.passed) ?? false;

  return (
    <>
      <PageHeader
        title={c.title}
        breadcrumbs={[{ href: "/changes", label: "Change requests" }, { label: c.number }]}
        description={`${c.number} · ${c.internalPart.partNumber} · ${c.supplier.name} @ ${c.currentSite.siteCode}`}
        meta={
          <>
            <StatusBadge status={c.status} />
            {c.categories.map((x) => (
              <Badge key={x}>{humanize(x)}</Badge>
            ))}
            {c.riskLevel && (
              <span className="flex items-center gap-1">
                Risk <StatusBadge status={c.riskLevel} />
              </span>
            )}
            <span>Raised by {c.submittedByOrganization.type === "INTERNAL" ? "internal team" : c.submittedByOrganization.name}</span>
          </>
        }
        actions={
          <>
            {can("change:submit") && EDITABLE.includes(c.status) && (
              <>
                <ActionDialog trigger={<Button><Send /> {c.status === "INFO_REQUIRED" ? "Resubmit" : "Submit"}</Button>} title="Submit change request" description="The change is sent for internal review. Shipments of changed product are not authorized until approval." confirmLabel="Submit" onConfirm={() => post("submit").then(() => toast.success("Change request submitted"))} />
                <FormDialog
                  trigger={<Button variant="outline">Edit</Button>}
                  title="Edit change request"
                  wide
                  columns={2}
                  fields={[
                    { name: "title", label: "Title", required: true, minLength: 3, maxLength: 250, wide: true },
                    { name: "proposedImplementationDate", label: "Proposed implementation date", type: "date" },
                    { name: "reason", label: "Reason", type: "textarea", required: true, minLength: 5, maxLength: 10000 },
                    { name: "description", label: "Description", type: "textarea", required: true, minLength: 10, maxLength: 20000 },
                    { name: "affectedCharacteristics", label: "Affected characteristics", type: "textarea", nullable: true, maxLength: 10000 },
                    { name: "inventoryImpact", label: "Inventory impact", type: "textarea", nullable: true, maxLength: 5000 },
                    { name: "wipImpact", label: "WIP impact", type: "textarea", nullable: true, maxLength: 5000 },
                    { name: "riskAssessment", label: "Risk assessment", type: "textarea", nullable: true, maxLength: 10000 },
                  ]}
                  defaultValues={c as unknown as Record<string, unknown>}
                  onSubmit={async (payload) => {
                    await api(`/change-requests/${id}`, { method: "PATCH", body: { expectedVersion: c.version, ...payload } });
                    toast.success("Change request updated");
                    refetch();
                  }}
                />
              </>
            )}
            {review && REVIEW.includes(c.status) && (
              <>
                <ImpactAssessment id={id} onDone={refetch} />
                <RequalificationDecision c={c} onDone={refetch} />
                <ActionDialog
                  trigger={<Button>Submit for approval</Button>}
                  title="Submit change for approval"
                  description={gatePassed || c.status !== "VALIDATION_REQUIRED" ? "Starts the change approval workflow. Conditions entered here are recorded with the approval." : "Validation evidence is still incomplete; submission will be refused until the requalification gate passes."}
                  reasonLabel="Conditions of approval (optional)"
                  reasonRequired={false}
                  confirmLabel="Submit for approval"
                  onConfirm={(conditions) => post("submit-for-approval", conditions ? { dispositionConditions: conditions } : {}).then(() => toast.success("Submitted for approval"))}
                />
                <ActionDialog trigger={<Button variant="outline">Request information</Button>} title="Request information from the submitter" reasonLabel="Information needed" confirmLabel="Send request" onConfirm={(reason) => post("request-information", { reason }).then(() => toast.success("Information requested"))} />
              </>
            )}
            {review && c.status === "APPROVED" && (
              <ActionDialog trigger={<Button>Verify implementation</Button>} title="Verify implementation" description="Confirms the approved change was implemented as approved; the new configuration becomes authorized for shipment." reasonLabel="Implementation verification notes" confirmLabel="Verify" onConfirm={(notes) => post("verify-implementation", { implementationNotes: notes }).then(() => toast.success("Implementation verified"))} />
            )}
            {review && (c.status === "IMPLEMENTATION_VERIFIED" || c.status === "REJECTED") && <ActionDialog trigger={<Button variant="outline">Close</Button>} title="Close change request" confirmLabel="Close" onConfirm={() => post("close").then(() => toast.success("Change request closed"))} />}
            {can("change:submit") && OPEN.includes(c.status) && (
              <ActionDialog trigger={<Button variant="ghost">Withdraw</Button>} title="Withdraw change request" description="The proposed configuration is withdrawn; the authorized configuration is unaffected." reasonLabel="Reason" confirmVariant="destructive" confirmLabel="Withdraw" onConfirm={(reason) => post("withdraw", { reason }).then(() => toast.success("Change request withdrawn"))} />
            )}
          </>
        }
      />
      {c.status === "INFO_REQUIRED" && c.infoRequest && <Alert tone="warning" className="mb-4" title="Information requested">{c.infoRequest}</Alert>}
      {c.decisionComment && <Alert tone={c.status === "REJECTED" ? "danger" : "success"} className="mb-4" title={`Decision ${formatDateTime(c.decidedAt)}`}>{c.decisionComment}{c.dispositionConditions && ` · Conditions: ${c.dispositionConditions}`}</Alert>}
      {c.shipmentAuthorizedAt && <Alert tone="success" className="mb-4">Shipments of the changed configuration authorized {formatDateTime(c.shipmentAuthorizedAt)}.</Alert>}
      <div className="grid gap-4 2xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Authorized vs proposed" description="The authorized configuration remains in force (and is preserved in history) until the proposed revision is approved." />
            <CardBody className="space-y-4">
              <div className="grid items-center gap-3 md:grid-cols-[1fr_auto_1fr]">
                <RevBox label="Currently authorized" rev={c.currentRevision} site={c.currentSite} />
                <ArrowRight className="mx-auto hidden size-5 text-muted-foreground md:block" />
                {c.proposedRevision ? <RevBox label="Proposed" rev={c.proposedRevision} site={c.proposedSite ?? c.currentSite} highlightSite={!!c.proposedSite} /> : <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">No proposed configuration</div>}
              </div>
              {c.comparison && <Comparison cmp={c.comparison} />}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Change details" />
            <CardBody>
              <DetailGrid
                columns={2}
                items={[
                  { label: "Product", value: <Link className="text-accent hover:underline" href={`/products/${c.internalPart.id}`}>{c.internalPart.partNumber}</Link> },
                  { label: "Source", value: <Link className="text-accent hover:underline" href={`/products/supplier-products/${c.supplierProduct.id}`}>{c.supplierPart.supplierPartNumber} @ {c.currentSite.siteCode}</Link> },
                  { label: "Proposed implementation", value: formatDate(c.proposedImplementationDate) },
                  { label: "Submitted", value: formatDateTime(c.submittedAt) },
                  { label: "Reason", value: c.reason, wide: true },
                  { label: "Description", value: c.description, wide: true },
                  { label: "Affected characteristics", value: c.affectedCharacteristics, wide: true },
                  { label: "Inventory impact", value: c.inventoryImpact },
                  { label: "WIP impact", value: c.wipImpact },
                  c.riskAssessment !== undefined && { label: "Risk assessment", value: c.riskAssessment, wide: true },
                  c.requiredValidation && { label: "Required validation", value: c.requiredValidation, wide: true },
                  c.implementationNotes && { label: `Implementation verified ${formatDateTime(c.implementationVerifiedAt)}`, value: c.implementationNotes, wide: true },
                ]}
              />
            </CardBody>
          </Card>
          {c.impactAssessments && (
            <Card>
              <CardHeader title="Impact assessments" description="Cross-functional evaluation; internal only." />
              {c.impactAssessments.length === 0 ? (
                <CardBody>
                  <p className="text-muted-foreground">No assessments recorded yet.</p>
                </CardBody>
              ) : (
                <Table>
                  <THead>
                    <tr>
                      <TH>Discipline</TH>
                      <TH>Impact</TH>
                      <TH>Flags</TH>
                      <TH>Recommendation</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {c.impactAssessments.map((a) => (
                      <TR key={a.id}>
                        <TD>{humanize(a.discipline)}</TD>
                        <TD className="max-w-sm text-xs">
                          {a.impactSummary}
                          {a.comments && <p className="text-muted-foreground">{a.comments}</p>}
                        </TD>
                        <TD className="text-xs">
                          <div className="flex flex-wrap gap-1">
                            {FLAGS.filter(([k]) => a[k] === true).map(([k, label]) => (
                              <Badge key={k} tone="warning">
                                {label}
                              </Badge>
                            ))}
                          </div>
                        </TD>
                        <TD>
                          <StatusBadge status={a.recommendation} />
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </Card>
          )}
          {c.gate && (c.status === "VALIDATION_REQUIRED" || c.requalification) && (
            <Card>
              <CardHeader
                title="Requalification gate"
                description={c.requalification ? `Evidence is collected on ${c.requalification.number}.` : undefined}
                actions={
                  c.requalification && (
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/qualifications/${c.requalification.id}`}>Open {c.requalification.number}</Link>
                    </Button>
                  )
                }
              />
              <CardBody>
                <ul className="space-y-2">
                  {c.gate.map((g) => (
                    <li key={g.key} className="flex gap-2">
                      {g.passed ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="Passed" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="Failed" />}
                      <div>
                        <p>{g.label}</p>
                        {g.details.map((d) => (
                          <p key={d} className="text-xs text-muted-foreground">
                            {d}
                          </p>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
          {c.requiredDocuments.length > 0 && (
            <Card>
              <CardHeader title="Required documents" description="Evidence required by the requalification decision." />
              <CardBody>
                <RequirementChecklist requirements={c.requiredDocuments} onChanged={refetch} editable={isInternal && OPEN.includes(c.status)} />
              </CardBody>
            </Card>
          )}
        </div>
        <div className="min-w-0">
          <RecordPanel entityType="CHANGE_REQUEST" entityId={id} workflowSubjectType={isInternal ? "CHANGE_REQUEST" : undefined} />
        </div>
      </div>
    </>
  );
}

function RevBox({ label, rev, site, highlightSite }: { label: string; rev: Rev; site: { siteCode: string; name: string; country: string }; highlightSite?: boolean }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5">
        <Link className="font-medium text-accent hover:underline" href={`/configurations/revisions/${rev.id}`}>
          {rev.configuration.configCode} rev {rev.revisionLabel}
        </Link>{" "}
        <StatusBadge status={rev.status} />
      </p>
      <p className="text-xs">{rev.configuration.name}</p>
      <p className={`mt-1 text-xs ${highlightSite ? "font-medium text-warning" : "text-muted-foreground"}`}>
        Site {site.siteCode} {site.name} ({site.country})
      </p>
      {rev.changeSummary && <p className="mt-1 text-xs text-muted-foreground">{rev.changeSummary}</p>}
    </div>
  );
}

function Comparison({ cmp }: { cmp: NonNullable<Change["comparison"]> }) {
  const none = !cmp.siteChanged && cmp.baseline.length === 0 && !cmp.requirements.added.length && !cmp.requirements.removed.length && !cmp.requirements.changed.length && cmp.characteristics.length === 0;
  if (none) return <p className="text-xs text-muted-foreground">The proposed revision does not yet differ from the authorized revision. Edit the proposed revision to describe the change.</p>;
  const show = (v: unknown) => (v === null || v === undefined || v === "" ? <span className="text-muted-foreground">-</span> : String(v));
  return (
    <div className="space-y-3">
      {cmp.siteChanged && <Alert tone="warning">The manufacturing site changes.</Alert>}
      {cmp.baseline.length > 0 && (
        <Table>
          <THead>
            <tr>
              <TH>Baseline field</TH>
              <TH>Authorized</TH>
              <TH>Proposed</TH>
            </tr>
          </THead>
          <TBody>
            {cmp.baseline.map((b) => (
              <TR key={b.field}>
                <TD>{humanize(b.field.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase())}</TD>
                <TD className="whitespace-pre-wrap text-xs line-through decoration-destructive/40">{show(b.current)}</TD>
                <TD className="whitespace-pre-wrap text-xs font-medium">{show(b.proposed)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {(cmp.requirements.added.length > 0 || cmp.requirements.removed.length > 0 || cmp.requirements.changed.length > 0) && (
        <div className="text-xs">
          <p className="mb-1 font-medium">Customer-specific requirements</p>
          <ul className="space-y-0.5">
            {cmp.requirements.added.map((r) => (
              <li key={`a-${r.code}`}>
                <Badge tone="success">Added</Badge> {r.code} {r.title}: {r.requiredValue}
              </li>
            ))}
            {cmp.requirements.removed.map((r) => (
              <li key={`r-${r.code}`}>
                <Badge tone="danger">Removed</Badge> {r.code} {r.title}
              </li>
            ))}
            {cmp.requirements.changed.map((r) => (
              <li key={`c-${r.code}`}>
                <Badge tone="warning">Changed</Badge> {r.code}: {r.fields.map((f) => `${humanize(f.field.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase())} "${String(f.current ?? "")}" → "${String(f.proposed ?? "")}"`).join("; ")}
              </li>
            ))}
          </ul>
        </div>
      )}
      {cmp.characteristics.length > 0 && (
        <div className="text-xs">
          <p className="mb-1 font-medium">Critical characteristics</p>
          {cmp.characteristics.map((x) => (
            <p key={x.charNumber}>
              <Badge tone={x.change === "added" ? "success" : "warning"}>{humanize(x.change.toUpperCase())}</Badge> {x.charNumber} {x.name}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function ImpactAssessment({ id, onDone }: { id: string; onDone: () => void }) {
  return (
    <FormDialog
      trigger={<Button variant="outline">Add impact assessment</Button>}
      title="Impact assessment"
      wide
      columns={2}
      fields={[
        { name: "discipline", label: "Discipline", type: "select", required: true, options: toOptions(DISCIPLINE) },
        { name: "recommendation", label: "Recommendation", type: "select", required: true, options: toOptions(IMPACT_RECOMMENDATION) },
        { name: "impactSummary", label: "Impact summary", type: "textarea", required: true, minLength: 5, maxLength: 10000 },
        { name: "comments", label: "Comments", type: "textarea", maxLength: 10000 },
        ...FLAGS.map(([name, label]) => ({ name, label, type: "checkbox" as const })),
      ]}
      onSubmit={async (payload) => {
        await api(`/change-requests/${id}/impact-assessments`, { method: "POST", body: payload });
        toast.success("Impact assessment recorded");
        onDone();
      }}
    />
  );
}

function RequalificationDecision({ c, onDone }: { c: Change; onDone: () => void }) {
  const [risk, setRisk] = useState<string>(c.riskLevel ?? "MEDIUM");
  return (
    <ActionDialog
      trigger={<Button variant="outline">Requalification decision</Button>}
      title="Determine requalification"
      description="Sets the change risk and generates the evidence requirements (FAI, test reports, certificates, control plan...) from the impact assessments. A requalification of the proposed configuration is opened."
      reasonLabel="Required validation summary"
      reasonRequired={false}
      confirmLabel="Record decision"
      onConfirm={async (requiredValidation) => {
        await api(`/change-requests/${c.id}/requalification-decision`, { method: "POST", body: { expectedVersion: c.version, riskLevel: risk, ...(requiredValidation ? { requiredValidation } : {}) } });
        toast.success("Requalification determined");
        onDone();
      }}
    >
      <Field label="Change risk level" htmlFor="rq-risk">
        <Select id="rq-risk" value={risk} onChange={(e) => setRisk(e.target.value)} options={toOptions(RISK_LEVEL)} />
      </Field>
    </ActionDialog>
  );
}

