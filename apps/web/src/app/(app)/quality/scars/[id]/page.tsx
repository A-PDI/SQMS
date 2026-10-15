"use client";

import { useQuery } from "@tanstack/react-query";
import { NCR_SEVERITY, humanize } from "@sqms/shared";
import { Lock, Save, Send } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
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
import { Alert, ErrorAlert, PageLoading } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { toOptions } from "@/lib/options";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

interface Response8D {
  id: string;
  revisionNumber: number;
  status: string;
  submittedByName: string | null;
  submittedAt: string | null;
  reviewComment: string | null;
  reviewedAt: string | null;
  d1Team: string | null;
  d2Problem: string | null;
  d3Containment: string | null;
  d4RootCause: string | null;
  d4EscapePoint: string | null;
  d5CorrectiveActions: string | null;
  d6Implementation: string | null;
  d6ImplementationDate: string | null;
  d7Prevention: string | null;
  d8Closure: string | null;
}
interface Scar {
  id: string;
  number: string;
  title: string;
  problemDescription: string;
  requirements: string | null;
  severity: string;
  status: string;
  issuedAt: string | null;
  containmentDueDate: string | null;
  responseDueDate: string;
  effectivenessDueDate: string | null;
  effectivenessResult: string | null;
  effectivenessNotes: string | null;
  effectivenessVerifiedAt: string | null;
  escalationLevel: number;
  internalNotes?: string | null;
  closedAt: string | null;
  closureComment: string | null;
  overdue: boolean;
  version: number;
  supplier: { id: string; name: string; supplierNumber: string };
  site: { id: string; siteCode: string; name: string } | null;
  ncr: { id: string; number: string; title: string; severity: string; status: string } | null;
  responses: Response8D[];
}

const SECTIONS: { key: keyof Response8D; label: string; help: string; required: boolean }[] = [
  { key: "d1Team", label: "D1 Team", help: "Cross-functional team members and roles.", required: true },
  { key: "d2Problem", label: "D2 Problem description", help: "What, where, when, how many (is / is not).", required: true },
  { key: "d3Containment", label: "D3 Interim containment", help: "Actions protecting the customer until permanent correction; stock and in-transit sorting results.", required: true },
  { key: "d4RootCause", label: "D4 Root cause (occurrence)", help: "Verified root cause of the occurrence.", required: true },
  { key: "d4EscapePoint", label: "D4 Escape point", help: "Why the defect was not detected.", required: false },
  { key: "d5CorrectiveActions", label: "D5 Permanent corrective actions", help: "Chosen actions and how they were verified.", required: true },
  { key: "d6Implementation", label: "D6 Implementation", help: "How and where the actions were implemented; evidence.", required: true },
  { key: "d7Prevention", label: "D7 Prevent recurrence", help: "System changes (PFMEA, control plan, procedures, similar products).", required: true },
  { key: "d8Closure", label: "D8 Team recognition / closure", help: "Optional closure summary.", required: false },
];
const AWAITING = ["ISSUED", "RESPONSE_REJECTED"];

export default function ScarPage() {
  const { id } = useParams<{ id: string }>();
  const { can, canAny, isInternal } = useSession();
  const q = useQuery({ queryKey: ["scar", id], queryFn: () => api<Scar>(`/scars/${id}`) });
  if (q.isLoading) return <PageLoading />;
  if (q.error || !q.data) return <ErrorAlert error={q.error} />;
  const s = q.data;
  const refetch = () => void q.refetch();
  const post = (path: string, body: Record<string, unknown>) => api(`/scars/${id}/${path}`, { method: "POST", body: { expectedVersion: s.version, ...body } }).then(refetch);
  const latest = s.responses[0];
  const submitted = s.responses.find((r) => r.status === "SUBMITTED");
  const canRespond = AWAITING.includes(s.status) && canAny("scar:respond", "scar:write");
  const close = isInternal && can("scar:close");

  return (
    <>
      <PageHeader
        title={s.title}
        breadcrumbs={[{ href: "/quality/scars", label: "Corrective actions" }, { label: s.number }]}
        description={`${s.number} · ${s.supplier.name}${s.site ? ` @ ${s.site.siteCode}` : ""}`}
        meta={
          <>
            <StatusBadge status={s.status} />
            <StatusBadge status={s.severity} />
            <span>Response due {formatDate(s.responseDueDate)}</span>
            {s.overdue && <Badge tone="danger">Overdue{s.escalationLevel ? ` · escalation level ${s.escalationLevel}` : ""}</Badge>}
            {s.ncr && (
              <Link className="text-accent hover:underline" href={`/quality/ncrs/${s.ncr.id}`}>
                {s.ncr.number}
              </Link>
            )}
          </>
        }
        actions={
          isInternal && (
            <>
              {can("scar:write") && s.status === "DRAFT" && <ActionDialog trigger={<Button><Send /> Issue to supplier</Button>} title="Issue SCAR" description="The supplier is notified and the response clock starts. The request content is frozen after issue." confirmLabel="Issue" onConfirm={() => post("issue", {}).then(() => toast.success("SCAR issued"))} />}
              {close && s.status === "RESPONSE_SUBMITTED" && submitted && <ReviewResponse scar={s} response={submitted} onDone={refetch} />}
              {close && s.status === "ACCEPTED" && <EffectivenessAction scar={s} onDone={refetch} />}
              {close && s.status === "VERIFICATION" && s.effectivenessResult === "EFFECTIVE" && <ActionDialog trigger={<Button>Close SCAR</Button>} title="Close SCAR" reasonLabel="Closure comment" confirmLabel="Close" onConfirm={(comment) => post("close", { comment }).then(() => toast.success("SCAR closed"))} />}
              {can("scar:write") && s.status !== "CLOSED" && s.status !== "CANCELLED" && (
                <FormDialog
                  trigger={<Button variant="outline">Edit</Button>}
                  title="Edit SCAR"
                  description={s.status === "DRAFT" ? undefined : "After issue only due dates and internal notes can change."}
                  columns={2}
                  wide
                  fields={[
                    ...(s.status === "DRAFT"
                      ? [
                          { name: "title", label: "Title", required: true, minLength: 3, maxLength: 250, wide: true },
                          { name: "problemDescription", label: "Problem description", type: "textarea" as const, required: true, minLength: 10, maxLength: 20000 },
                          { name: "requirements", label: "Requirements / specification", type: "textarea" as const, nullable: true, maxLength: 10000 },
                          { name: "severity", label: "Severity", type: "select" as const, options: toOptions(NCR_SEVERITY) },
                        ]
                      : []),
                    { name: "containmentDueDate", label: "Containment due", type: "date" },
                    { name: "responseDueDate", label: "Response due", type: "date" },
                    { name: "effectivenessDueDate", label: "Effectiveness check due", type: "date" },
                    { name: "internalNotes", label: "Internal notes", type: "textarea", nullable: true, maxLength: 20000 },
                  ]}
                  defaultValues={s as unknown as Record<string, unknown>}
                  onSubmit={async (payload) => {
                    await api(`/scars/${id}`, { method: "PATCH", body: { expectedVersion: s.version, ...payload } });
                    toast.success("SCAR updated");
                    refetch();
                  }}
                />
              )}
              {can("scar:write") && s.status !== "CLOSED" && s.status !== "CANCELLED" && <ActionDialog trigger={<Button variant="ghost">Cancel</Button>} title="Cancel SCAR" reasonLabel="Reason" confirmVariant="destructive" confirmLabel="Cancel SCAR" onConfirm={(reason) => post("cancel", { reason }).then(() => toast.success("SCAR cancelled"))} />}
            </>
          )
        }
      />
      {s.closedAt && <Alert tone="success" className="mb-4" title={`Closed ${formatDateTime(s.closedAt)}`}>{s.closureComment}</Alert>}
      {s.status === "RESPONSE_REJECTED" && latest?.reviewComment && <Alert tone="warning" className="mb-4" title="Previous response rejected">{latest.reviewComment}</Alert>}
      <div className="grid gap-4 2xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Request" />
            <CardBody>
              <DetailGrid
                items={[
                  { label: "Supplier", value: isInternal ? <Link className="text-accent hover:underline" href={`/suppliers/${s.supplier.id}`}>{s.supplier.name}</Link> : s.supplier.name },
                  { label: "Site", value: s.site ? `${s.site.siteCode} ${s.site.name}` : null },
                  { label: "Issued", value: formatDateTime(s.issuedAt) },
                  { label: "Containment due", value: formatDate(s.containmentDueDate) },
                  { label: "Response due", value: formatDate(s.responseDueDate) },
                  { label: "Effectiveness check due", value: formatDate(s.effectivenessDueDate) },
                  { label: "Problem description", value: s.problemDescription, wide: true },
                  { label: "Requirements / specification", value: s.requirements, wide: true },
                  s.effectivenessResult && { label: `Effectiveness (${formatDateTime(s.effectivenessVerifiedAt)})`, value: `${humanize(s.effectivenessResult)}: ${s.effectivenessNotes ?? ""}`, wide: true },
                ]}
              />
            </CardBody>
          </Card>
          {isInternal && s.internalNotes !== undefined && (
            <Card>
              <CardHeader title={<span className="flex items-center gap-1"><Lock className="size-3.5" /> Internal notes</span>} description="Never shown to supplier users." />
              <CardBody>{s.internalNotes ? <p className="whitespace-pre-wrap">{s.internalNotes}</p> : <p className="text-muted-foreground">None.</p>}</CardBody>
            </Card>
          )}
          {canRespond ? (
            <ResponseEditor scar={s} draft={latest?.status === "DRAFT" ? latest : null} previous={latest && latest.status !== "DRAFT" ? latest : null} onDone={refetch} />
          ) : null}
          {s.responses
            .filter((r) => !(canRespond && r.status === "DRAFT"))
            .map((r) => (
              <ResponseView key={r.id} r={r} />
            ))}
          {s.responses.length === 0 && !canRespond && (
            <Card>
              <CardBody>
                <p className="text-muted-foreground">{s.status === "DRAFT" ? "Issue the SCAR to request the supplier's 8D response." : "Waiting for the supplier's 8D response."}</p>
              </CardBody>
            </Card>
          )}
        </div>
        <div className="min-w-0">
          <RecordPanel entityType="SCAR" entityId={id} />
        </div>
      </div>
    </>
  );
}

function ResponseView({ r }: { r: Response8D }) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            8D response revision {r.revisionNumber} <StatusBadge status={r.status} />
          </span>
        }
        description={r.submittedAt ? `Submitted ${formatDateTime(r.submittedAt)} by ${r.submittedByName ?? "-"}` : `Draft by ${r.submittedByName ?? "-"}`}
      />
      <CardBody>
        <dl className="grid gap-3 md:grid-cols-2">
          {SECTIONS.map((sec) => (
            <div key={sec.key} className={cn(sec.key === "d2Problem" || sec.key === "d5CorrectiveActions" ? "md:col-span-2" : "")}>
              <dt className="text-xs text-muted-foreground">{sec.label}</dt>
              <dd className="whitespace-pre-wrap">{(r[sec.key] as string | null) || <span className="text-muted-foreground">-</span>}</dd>
            </div>
          ))}
          <div>
            <dt className="text-xs text-muted-foreground">D6 implementation date</dt>
            <dd>{formatDate(r.d6ImplementationDate)}</dd>
          </div>
        </dl>
        {r.reviewComment && (
          <Alert tone={r.status === "ACCEPTED" ? "success" : "warning"} className="mt-3" title={`Review ${formatDateTime(r.reviewedAt)}`}>
            {r.reviewComment}
          </Alert>
        )}
      </CardBody>
    </Card>
  );
}

function ResponseEditor({ scar, draft, previous, onDone }: { scar: Scar; draft: Response8D | null; previous: Response8D | null; onDone: () => void }) {
  const { isInternal } = useSession();
  const source = draft ?? previous;
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries([...SECTIONS.map((s) => [s.key, (source?.[s.key] as string | null) ?? ""]), ["d6ImplementationDate", source?.d6ImplementationDate?.slice(0, 10) ?? ""], ["submittedByName", draft?.submittedByName ?? ""]]));
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const body = () => {
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v)) if (val.trim()) out[k] = val.trim();
    return out;
  };
  async function save() {
    return api<{ id: string }>(`/scars/${scar.id}/responses`, { method: "POST", body: body() });
  }
  async function run(kind: "save" | "submit") {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "submit") {
        const miss = SECTIONS.filter((s) => s.required && !v[s.key]?.trim()).map((s) => s.key);
        setMissing(miss);
        if (miss.length) throw new Error(`Complete the required 8D sections: ${miss.map((m) => SECTIONS.find((s) => s.key === m)!.label).join(", ")}`);
      }
      const saved = await save();
      if (kind === "submit") {
        await api(`/scars/${scar.id}/responses/${saved.id}/submit`, { method: "POST" });
        toast.success("8D response submitted for review");
      } else toast.success("Draft saved");
      onDone();
    } catch (e) {
      if (e instanceof ApiError && Array.isArray((e.details as { missing?: unknown })?.missing)) setMissing((e.details as { missing: string[] }).missing);
      setError(e);
    } finally {
      setBusy(null);
    }
  }
  return (
    <Card>
      <CardHeader title={draft ? `8D response (draft revision ${draft.revisionNumber})` : "8D response"} description={previous ? "Start from the previous response and address the review comments." : "Complete every required section, then submit for review."} />
      <CardBody className="space-y-3">
        {error ? <ErrorAlert error={error} /> : null}
        {isInternal && (
          <Field label="Supplier representative providing the response" required htmlFor="r-name" hint="Internal users may enter a response on the supplier's behalf (Phase 1).">
            <Input id="r-name" value={v.submittedByName} onChange={(e) => setV({ ...v, submittedByName: e.target.value })} maxLength={160} />
          </Field>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {SECTIONS.map((sec) => (
            <Field key={sec.key} label={sec.label} required={sec.required} hint={sec.help} htmlFor={`r-${sec.key}`} error={missing.includes(sec.key) ? "Required" : undefined} className={cn(sec.key === "d2Problem" || sec.key === "d5CorrectiveActions" ? "md:col-span-2" : "")}>
              <Textarea id={`r-${sec.key}`} rows={3} value={v[sec.key]} onChange={(e) => setV({ ...v, [sec.key]: e.target.value })} maxLength={10000} />
            </Field>
          ))}
          <Field label="D6 implementation date" htmlFor="r-d6date">
            <Input id="r-d6date" type="date" value={v.d6ImplementationDate} onChange={(e) => setV({ ...v, d6ImplementationDate: e.target.value })} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" loading={busy === "save"} disabled={!!busy || (isInternal && !v.submittedByName.trim())} onClick={() => void run("save")}>
            <Save /> Save draft
          </Button>
          <Button loading={busy === "submit"} disabled={!!busy || (isInternal && !v.submittedByName.trim())} onClick={() => void run("submit")}>
            <Send /> Submit response
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function ReviewResponse({ scar, response, onDone }: { scar: Scar; response: Response8D; onDone: () => void }) {
  const [decision, setDecision] = useState<"ACCEPTED" | "REJECTED">("ACCEPTED");
  const [effDue, setEffDue] = useState(new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10));
  return (
    <ActionDialog
      trigger={<Button>Review response</Button>}
      title={`Review 8D response revision ${response.revisionNumber}`}
      description="The reviewer must not be the person who entered the response. Rejected responses return to the supplier for revision."
      reasonLabel="Review comment"
      confirmLabel="Record review"
      onConfirm={async (comment) => {
        await api(`/scars/${scar.id}/responses/${response.id}/review`, { method: "POST", body: { decision, comment, ...(decision === "ACCEPTED" && effDue ? { effectivenessDueDate: effDue } : {}) } });
        toast.success(decision === "ACCEPTED" ? "Response accepted" : "Response rejected");
        onDone();
      }}
    >
      <Field label="Decision" htmlFor="rv-dec">
        <Select id="rv-dec" value={decision} onChange={(e) => setDecision(e.target.value as "ACCEPTED" | "REJECTED")} options={toOptions(["ACCEPTED", "REJECTED"])} />
      </Field>
      {decision === "ACCEPTED" && (
        <Field label="Effectiveness check due" htmlFor="rv-eff">
          <Input id="rv-eff" type="date" value={effDue} onChange={(e) => setEffDue(e.target.value)} />
        </Field>
      )}
    </ActionDialog>
  );
}

function EffectivenessAction({ scar, onDone }: { scar: Scar; onDone: () => void }) {
  const [result, setResult] = useState<"EFFECTIVE" | "NOT_EFFECTIVE">("EFFECTIVE");
  return (
    <ActionDialog
      trigger={<Button>Verify effectiveness</Button>}
      title="Verify effectiveness"
      description="Not effective re-opens the request for a new 8D response."
      reasonLabel="Verification notes (evidence reviewed)"
      confirmLabel="Record verification"
      onConfirm={async (notes) => {
        await api(`/scars/${scar.id}/effectiveness`, { method: "POST", body: { expectedVersion: scar.version, result, notes } });
        toast.success("Effectiveness recorded");
        onDone();
      }}
    >
      <Field label="Result" htmlFor="ef-res">
        <Select id="ef-res" value={result} onChange={(e) => setResult(e.target.value as "EFFECTIVE" | "NOT_EFFECTIVE")} options={toOptions(["EFFECTIVE", "NOT_EFFECTIVE"])} />
      </Field>
    </ActionDialog>
  );
}
