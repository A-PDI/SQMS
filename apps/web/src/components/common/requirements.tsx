"use client";

import { humanize } from "@sqms/shared";
import { FilePlus2, Link2, MoreHorizontal, RotateCcw, ShieldOff, UserCog } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AsyncPicker, UserPicker, type DirectoryUser, type PickerItem } from "@/components/forms/async-picker";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState, ErrorAlert } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

export interface Requirement {
  id: string;
  level: "REQUIRED" | "CONDITIONAL" | "NOT_APPLICABLE";
  status: string;
  source: string;
  reason: string | null;
  notes: string | null;
  dueDate: string | null;
  overdue?: boolean;
  waiverJustification: string | null;
  waivedAt: string | null;
  documentType: { id: string; code: string; name: string; acronym: string | null; category: string; nativeFormKey: string | null; nativeModule: string | null; allowUpload: boolean; supplierVisibility: string };
  document: { id: string; docNumber: string; title: string; status: string } | null;
  acceptedRevision: { id: string; revisionLabel: string } | null;
  assignedTo: { id: string; displayName: string } | null;
  waivedBy: { id: string; displayName: string } | null;
}

export interface ChecklistSummary {
  total: number;
  completed: number;
  missing: number;
  pendingReview: number;
  required: number;
  percent: number;
}

const FILTERS = [
  { key: "all", label: "All" },
  { key: "missing", label: "Missing" },
  { key: "review", label: "Pending review" },
  { key: "done", label: "Complete" },
  { key: "na", label: "Not applicable / waived" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

function matches(r: Requirement, f: FilterKey) {
  if (f === "all") return true;
  if (f === "missing") return r.status === "OPEN" || r.status === "REJECTED";
  if (f === "review") return r.status === "SUBMITTED";
  if (f === "done") return r.status === "ACCEPTED";
  return r.status === "WAIVED" || r.status === "NOT_APPLICABLE";
}

export function ChecklistProgress({ summary }: { summary: ChecklistSummary }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-xs">
        <span>
          <span className="text-base font-semibold">{summary.percent}%</span> complete · {summary.completed} of {summary.total} applicable
        </span>
        <span className="text-muted-foreground">
          {summary.missing > 0 && <span className="text-warning">{summary.missing} missing</span>}
          {summary.pendingReview > 0 && <span> · {summary.pendingReview} in review</span>}
        </span>
      </div>
      <div className="h-2 rounded bg-muted" role="progressbar" aria-valuenow={summary.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Checklist completion">
        <div className={cn("h-2 rounded", summary.percent === 100 ? "bg-success" : "bg-accent")} style={{ width: `${summary.percent}%` }} />
      </div>
    </div>
  );
}

/**
 * Document checklist for a sourcing project, change request or qualification. Every requirement keeps its
 * applicability level and reason; documents are created or linked against the requirement so the server derives
 * the supplier and record links.
 */
export function RequirementChecklist({ requirements, onChanged, editable = true, title }: { requirements: Requirement[]; onChanged: () => void; editable?: boolean; title?: string }) {
  const { can } = useSession();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [dialog, setDialog] = useState<{ kind: "waive" | "assign" | "link"; r: Requirement } | null>(null);
  const router = useRouter();
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, requirements.filter((r) => matches(r, f.key)).length])) as Record<FilterKey, number>, [requirements]);
  const grouped = useMemo(() => {
    const map = new Map<string, Requirement[]>();
    for (const r of requirements.filter((x) => matches(x, filter))) {
      const k = r.documentType.category;
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    return [...map.entries()];
  }, [requirements, filter]);
  const canWaive = (r: Requirement) => (r.level === "REQUIRED" ? can("project:waive_mandatory") : can("project:waive_conditional") || can("project:waive_mandatory"));
  const writable = editable && can("project:write");

  async function createDocument(r: Requirement) {
    const native = !!r.documentType.nativeFormKey && !r.documentType.nativeModule;
    try {
      const created = await api<{ document: { id: string } }>(`/required-documents/${r.id}/create-document`, {
        method: "POST",
        body: { title: `${r.documentType.acronym ?? r.documentType.code} - ${r.documentType.name}`.slice(0, 300), submissionMethod: native ? "NATIVE_FORM" : "UPLOAD", ...(native ? { formData: {} } : {}) },
      });
      toast.success("Document created");
      router.push(`/documents/${created.document.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function reinstate(r: Requirement) {
    try {
      await api(`/required-documents/${r.id}/reinstate`, { method: "POST" });
      toast.success("Requirement reinstated");
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div>
      {title && <h3 className="mb-2 font-medium">{title}</h3>}
      <div className="mb-3 flex flex-wrap gap-1" role="tablist" aria-label="Checklist filter">
        {FILTERS.map((f) => (
          <button key={f.key} role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)} className={cn("rounded-full border px-2.5 py-0.5 text-xs", filter === f.key ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
            {f.label} <span className="opacity-70">{counts[f.key]}</span>
          </button>
        ))}
      </div>
      {grouped.length === 0 ? (
        <EmptyState title="No requirements in this view" />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <THead>
              <tr>
                <TH>Document</TH>
                <TH>Applicability</TH>
                <TH>Status</TH>
                <TH>Record</TH>
                <TH>Assigned / due</TH>
                {writable && <TH className="w-10" />}
              </tr>
            </THead>
            <TBody>
              {grouped.map(([category, rows]) => [
                <TR key={`h-${category}`} className="bg-muted/40 hover:bg-muted/40">
                  <TD colSpan={writable ? 6 : 5} className="py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {humanize(category)}
                  </TD>
                </TR>,
                ...rows.map((r) => (
                  <TR key={r.id}>
                    <TD className="min-w-56">
                      <span className="font-mono text-xs text-muted-foreground">{r.documentType.code}</span> <span className="font-medium">{r.documentType.name}</span>
                      {r.documentType.acronym && <span className="text-muted-foreground"> ({r.documentType.acronym})</span>}
                      {r.reason && <p className="text-xs text-muted-foreground">{r.reason}</p>}
                      {r.status === "WAIVED" && r.waiverJustification && (
                        <p className="text-xs text-warning">
                          Waived by {r.waivedBy?.displayName ?? "-"} {formatDate(r.waivedAt)}: {r.waiverJustification}
                        </p>
                      )}
                      {r.notes && <p className="text-xs italic text-muted-foreground">{r.notes}</p>}
                    </TD>
                    <TD>
                      <Badge tone={r.level === "REQUIRED" ? "danger" : r.level === "CONDITIONAL" ? "warning" : "muted"}>{humanize(r.level)}</Badge>
                      {r.source !== "POLICY" && <div className="mt-0.5 text-[11px] text-muted-foreground">{humanize(r.source)}</div>}
                    </TD>
                    <TD>
                      <StatusBadge status={r.status} />
                      {r.overdue && <Badge tone="danger" className="ml-1">Overdue</Badge>}
                    </TD>
                    <TD>
                      {r.document ? (
                        <Link href={`/documents/${r.document.id}`} className="text-accent hover:underline">
                          {r.document.docNumber}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                      {r.document && <div className="text-[11px] text-muted-foreground">{humanize(r.document.status)}{r.acceptedRevision && ` · rev ${r.acceptedRevision.revisionLabel} accepted`}</div>}
                    </TD>
                    <TD className="text-xs">
                      {r.assignedTo?.displayName ?? <span className="text-muted-foreground">Unassigned</span>}
                      {r.dueDate && <div className={cn(r.overdue ? "text-destructive" : "text-muted-foreground")}>due {formatDate(r.dueDate)}</div>}
                    </TD>
                    {writable && (
                      <TD>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost" aria-label={`Actions for ${r.documentType.code}`}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {!r.document && r.status !== "WAIVED" && r.status !== "NOT_APPLICABLE" && can("document:write") && !r.documentType.nativeModule && (
                              <DropdownMenuItem onSelect={() => void createDocument(r)}>
                                <FilePlus2 /> {r.documentType.nativeFormKey ? "Create (native form)" : "Create document"}
                              </DropdownMenuItem>
                            )}
                            {!r.document && r.status !== "WAIVED" && r.status !== "NOT_APPLICABLE" && (
                              <DropdownMenuItem onSelect={() => setDialog({ kind: "link", r })}>
                                <Link2 /> Link existing document
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onSelect={() => setDialog({ kind: "assign", r })}>
                              <UserCog /> Assign / due date / notes
                            </DropdownMenuItem>
                            {["OPEN", "REJECTED", "SUBMITTED"].includes(r.status) && canWaive(r) && (
                              <DropdownMenuItem onSelect={() => setDialog({ kind: "waive", r })}>
                                <ShieldOff /> Waive with justification
                              </DropdownMenuItem>
                            )}
                            {(r.status === "WAIVED" || r.status === "NOT_APPLICABLE") && (
                              <DropdownMenuItem onSelect={() => void reinstate(r)}>
                                <RotateCcw /> Reinstate
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TD>
                    )}
                  </TR>
                )),
              ])}
            </TBody>
          </Table>
        </div>
      )}
      {dialog?.kind === "waive" && <WaiveDialog r={dialog.r} onClose={() => setDialog(null)} onDone={onChanged} />}
      {dialog?.kind === "assign" && <AssignDialog r={dialog.r} onClose={() => setDialog(null)} onDone={onChanged} />}
      {dialog?.kind === "link" && <LinkDialog r={dialog.r} onClose={() => setDialog(null)} onDone={onChanged} />}
    </div>
  );
}

function useSubmit(fn: () => Promise<unknown>, onDone: () => void, onClose: () => void, success: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return {
    busy,
    error,
    run: async () => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        toast.success(success);
        onDone();
        onClose();
      } catch (e) {
        setError(e);
      } finally {
        setBusy(false);
      }
    },
  };
}

function WaiveDialog({ r, onClose, onDone }: { r: Requirement; onClose: () => void; onDone: () => void }) {
  const [justification, setJustification] = useState("");
  const s = useSubmit(() => api(`/required-documents/${r.id}/waive`, { method: "POST", body: { justification: justification.trim() } }), onDone, onClose, "Requirement waived");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Waive ${r.documentType.code}`} description={r.level === "REQUIRED" ? "This is a mandatory control. The waiver, your identity and the justification are recorded in the audit trail." : "Record why this conditional requirement does not apply to this project."}>
        {s.error ? <ErrorAlert error={s.error} /> : null}
        <Field label="Justification" required hint="At least 10 characters.">
          <Textarea rows={4} value={justification} onChange={(e) => setJustification(e.target.value)} autoFocus />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" loading={s.busy} disabled={justification.trim().length < 10} onClick={s.run}>
            Waive requirement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignDialog({ r, onClose, onDone }: { r: Requirement; onClose: () => void; onDone: () => void }) {
  const [assignee, setAssignee] = useState<PickerItem | null>(r.assignedTo ? { id: r.assignedTo.id, label: r.assignedTo.displayName } : null);
  const [dueDate, setDueDate] = useState(r.dueDate?.slice(0, 10) ?? "");
  const [notes, setNotes] = useState(r.notes ?? "");
  const s = useSubmit(() => api(`/required-documents/${r.id}`, { method: "PATCH", body: { assignedToId: assignee?.id ?? null, ...(dueDate ? { dueDate } : {}), notes: notes.trim() || null } }), onDone, onClose, "Requirement updated");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Assign ${r.documentType.code}`}>
        {s.error ? <ErrorAlert error={s.error} /> : null}
        <div className="space-y-3">
          <Field label="Assigned to">
            <UserPicker value={assignee} onChange={setAssignee} />
          </Field>
          <Field label="Due date" htmlFor="req-due">
            <Input id="req-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <Field label="Notes" htmlFor="req-notes">
            <Textarea id="req-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={s.busy} onClick={s.run}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface DocRow {
  id: string;
  docNumber: string;
  title: string;
  status: string;
  supplier: { name: string } | null;
}

function LinkDialog({ r, onClose, onDone }: { r: Requirement; onClose: () => void; onDone: () => void }) {
  const [doc, setDoc] = useState<PickerItem | null>(null);
  const s = useSubmit(() => api(`/required-documents/${r.id}/link-document`, { method: "POST", body: { documentId: doc!.id } }), onDone, onClose, "Document linked");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Link a ${r.documentType.code} document`} description="Only documents of this type are listed. An approved or released revision fulfils the requirement immediately.">
        {s.error ? <ErrorAlert error={s.error} /> : null}
        <Field label="Document">
          <AsyncPicker<DocRow> endpoint="/documents" query={{ documentTypeId: r.documentType.id }} value={doc} onChange={setDoc} map={(d) => ({ id: d.id, label: `${d.docNumber} · ${d.title}`, sublabel: `${humanize(d.status)}${d.supplier ? ` · ${d.supplier.name}` : ""}` })} placeholder="Search documents" />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={s.busy} disabled={!doc} onClick={s.run}>
            Link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type { DirectoryUser };
