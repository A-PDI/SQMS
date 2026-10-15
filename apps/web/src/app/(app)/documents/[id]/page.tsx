"use client";

import { useQuery } from "@tanstack/react-query";
import { humanize, validateFormData, type FormData, type FormSchema, type FormValidationIssue } from "@sqms/shared";
import { Download, Eye, FilePlus2, Link2, Paperclip, Save, Send, Share2, Trash2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ActionDialog } from "@/components/common/action-dialog";
import { ApprovalHistory, RecordPanel } from "@/components/common/collaboration";
import { DetailGrid } from "@/components/common/detail-grid";
import { FileUpload } from "@/components/common/file-upload";
import { AsyncPicker, type PickerItem } from "@/components/forms/async-picker";
import { FormDialog } from "@/components/forms/schema-form";
import { NativeForm } from "@/components/forms/native-form";
import { PageHeader } from "@/components/shell/page-header";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, ErrorAlert, PageLoading } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { api, ApiError, fileDownloadUrl, filePreviewUrl } from "@/lib/api";
import { formatBytes, formatDate, formatDateTime } from "@/lib/format";
import { entityHref } from "@/lib/links";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

interface RevisionFile {
  id: string;
  role: string;
  description: string | null;
  addedAt: string;
  file: { id: string; safeFilename: string; contentType: string; category: string; sizeBytes: number; sha256: string; status: string };
}
interface Revision {
  id: string;
  revisionNumber: number;
  revisionLabel: string;
  status: string;
  submissionMethod: "NATIVE_FORM" | "UPLOAD";
  formData: FormData | null;
  changeSummary: string | null;
  contentHash: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  releasedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  supersededAt: string | null;
  obsoletedAt: string | null;
  createdAt: string;
  version: number;
  files: RevisionFile[];
  release: { releaseNumber: string; releasedAt: string; effectiveDate: string; releaseNotes: string | null } | null;
  templateRevision: { id: string; revisionLabel: string; template: { id: string; name: string } } | null;
  formDefinitionVersion: { id: string; version: number; schema: FormSchema } | null;
  acknowledgments: { id: string; acknowledgedByName: string; acknowledgedAt: string; comment: string | null; organization: { id: string; name: string } | null }[];
}
interface Doc {
  id: string;
  docNumber: string;
  title: string;
  description: string | null;
  status: string;
  createdAt: string;
  version: number;
  latestRevisionId: string | null;
  releasedRevisionId: string | null;
  access: "internal" | "owner" | "shared" | string;
  documentType: { id: string; code: string; name: string; acronym: string | null; category: string; instructions: string | null; supplierVisibility: string; approvalRequirements: string | null; retentionPolicyId: string | null };
  supplier: { id: string; name: string; supplierNumber: string } | null;
  createdBy: { id: string; displayName: string } | null;
  revisions: Revision[];
  links: { id: string; entityType: string; entityId: string; linkRole: string; note: string | null; label: string | null; revisionId: string | null }[];
  shares: { id: string; grantedAt: string; note: string | null; revokedAt: string | null; organization: { id: string; name: string } }[];
  supersededBy: { id: string; reason: string | null; supersedingDocument: { id: string; docNumber: string; title: string } }[];
  supersedes: { id: string; reason: string | null; supersededDocument: { id: string; docNumber: string; title: string } }[];
}

const LINK_PICKERS: Record<string, { endpoint: string; label: (r: Record<string, unknown>) => string }> = {
  SUPPLIER: { endpoint: "/suppliers", label: (r) => `${r.name} (${r.supplierNumber})` },
  INTERNAL_PART: { endpoint: "/products", label: (r) => `${r.partNumber} ${r.description}` },
  SOURCING_PROJECT: { endpoint: "/sourcing-projects", label: (r) => `${r.projectNumber} ${r.title}` },
  PRODUCT_QUALIFICATION: { endpoint: "/qualifications", label: (r) => `${r.number} ${r.title}` },
  CHANGE_REQUEST: { endpoint: "/change-requests", label: (r) => `${r.number} ${r.title}` },
  NCR: { endpoint: "/ncrs", label: (r) => `${r.number} ${r.title}` },
  SCAR: { endpoint: "/scars", label: (r) => `${r.number} ${r.title ?? ""}` },
  DEVIATION: { endpoint: "/deviations", label: (r) => `${r.number} ${r.title}` },
};

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const { can, isInternal } = useSession();
  const q = useQuery({ queryKey: ["document", id], queryFn: () => api<Doc>(`/documents/${id}`) });
  const [selected, setSelected] = useState<string | null>(null);
  if (q.isLoading) return <PageLoading />;
  if (q.error || !q.data) return <ErrorAlert error={q.error} />;
  const d = q.data;
  const refetch = () => void q.refetch();
  const rev = d.revisions.find((r) => r.id === selected) ?? d.revisions[0];
  const editable = can("document:write") && d.access !== "shared";
  const latest = d.revisions[0];

  return (
    <>
      <PageHeader
        title={d.title}
        breadcrumbs={[{ href: "/documents", label: "Document records" }, { label: d.docNumber }]}
        description={`${d.docNumber} · ${d.documentType.code} ${d.documentType.name}`}
        meta={
          <>
            <StatusBadge status={d.status} />
            {d.supplier && (isInternal ? <Link className="text-accent hover:underline" href={`/suppliers/${d.supplier.id}`}>{d.supplier.name}</Link> : <span>{d.supplier.name}</span>)}
            <span>Created by {d.createdBy?.displayName ?? "-"} {formatDate(d.createdAt)}</span>
            {d.releasedRevisionId && <Badge tone="success">Released rev {d.revisions.find((r) => r.id === d.releasedRevisionId)?.revisionLabel}</Badge>}
          </>
        }
        actions={
          <>
            {editable && latest?.status === "RELEASED" && (
              <ActionDialog
                trigger={<Button variant="outline"><FilePlus2 /> New revision</Button>}
                title="Open a new revision"
                description={`Revision ${latest.revisionLabel} stays released until the new revision is approved and released.`}
                reasonLabel="Change summary"
                confirmLabel="Create revision"
                onConfirm={async (changeSummary) => {
                  const r = await api<{ id: string }>(`/documents/${id}/revisions`, { method: "POST", body: { changeSummary } });
                  toast.success("New draft revision created");
                  await q.refetch();
                  setSelected(r.id);
                }}
              />
            )}
            {editable && (
              <FormDialog
                trigger={<Button variant="outline">Edit</Button>}
                title="Edit document"
                fields={[
                  { name: "title", label: "Title", required: true, minLength: 3, maxLength: 300 },
                  { name: "description", label: "Description", type: "textarea", maxLength: 5000 },
                ]}
                defaultValues={d as unknown as Record<string, unknown>}
                onSubmit={async (payload) => {
                  await api(`/documents/${id}`, { method: "PATCH", body: { expectedVersion: d.version, ...payload } });
                  toast.success("Document updated");
                  refetch();
                }}
              />
            )}
            {can("document:release") && d.status === "RELEASED" && <SupersedeAction doc={d} onDone={refetch} />}
            {can("document:release") && d.releasedRevisionId && d.status !== "OBSOLETE" && (
              <ActionDialog
                trigger={<Button variant="ghost">Make obsolete</Button>}
                title="Make document obsolete"
                description="The released revision is withdrawn from use. History and files are retained."
                reasonLabel="Reason"
                confirmVariant="destructive"
                confirmLabel="Make obsolete"
                onConfirm={async (reason) => {
                  await api(`/documents/${id}/obsolete`, { method: "POST", body: { reason } });
                  toast.success("Document made obsolete");
                  refetch();
                }}
              />
            )}
          </>
        }
      />
      {d.supersededBy.length > 0 && (
        <Alert tone="warning" className="mb-4">
          Superseded by{" "}
          {d.supersededBy.map((s) => (
            <Link key={s.id} className="font-medium underline" href={`/documents/${s.supersedingDocument.id}`}>
              {s.supersedingDocument.docNumber} {s.supersedingDocument.title}
            </Link>
          ))}
        </Alert>
      )}
      {d.supersedes.length > 0 && (
        <Alert className="mb-4">
          Supersedes{" "}
          {d.supersedes.map((s) => (
            <Link key={s.id} className="font-medium underline" href={`/documents/${s.supersededDocument.id}`}>
              {s.supersededDocument.docNumber}
            </Link>
          ))}
        </Alert>
      )}
      {d.documentType.instructions && rev.status === "DRAFT" && (
        <Alert className="mb-4" title={`${d.documentType.code} instructions`}>
          {d.documentType.instructions}
        </Alert>
      )}
      <div className="grid gap-4 2xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <div className="flex flex-wrap items-center gap-1 border-b px-4 py-2">
              <span className="mr-2 text-xs text-muted-foreground">Revisions</span>
              {d.revisions.map((r) => (
                <button key={r.id} onClick={() => setSelected(r.id)} className={cn("flex items-center gap-1 rounded-md border px-2 py-1 text-xs", r.id === rev.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")} aria-pressed={r.id === rev.id}>
                  Rev {r.revisionLabel} <span className="opacity-80">· {humanize(r.status)}</span>
                </button>
              ))}
            </div>
            <RevisionView key={rev.id} doc={d} rev={rev} editable={editable} onChanged={refetch} />
          </Card>
          <div className="grid gap-4 xl:grid-cols-2">
            <LinksCard doc={d} editable={editable && isInternal} onChanged={refetch} />
            {isInternal && <SharesCard doc={d} onChanged={refetch} />}
          </div>
        </div>
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title={`Review of rev ${rev.revisionLabel}`} />
            <CardBody>
              <ApprovalHistory subjectType="DOCUMENT_REVISION" subjectId={rev.id} />
            </CardBody>
          </Card>
          <RecordPanel entityType="DOCUMENT" entityId={id} attachments={false} />
        </div>
      </div>
    </>
  );
}

function RevisionView({ doc, rev, editable, onChanged }: { doc: Doc; rev: Revision; editable: boolean; onChanged: () => void }) {
  const { can, isInternal } = useSession();
  const draft = rev.status === "DRAFT" && editable;
  const schema = rev.formDefinitionVersion?.schema;
  const [form, setForm] = useState<FormData>(rev.formData ?? {});
  const [issues, setIssues] = useState<FormValidationIssue[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!dirty) setForm(rev.formData ?? {});
  }, [rev.formData, dirty]);
  const base = `/documents/${doc.id}/revisions/${rev.id}`;

  async function saveDraft(silent = false) {
    if (!schema) return rev.version;
    setSaving(true);
    try {
      const updated = await api<{ version: number }>(base, { method: "PATCH", body: { expectedVersion: rev.version, formData: form } });
      setDirty(false);
      setIssues([]);
      if (!silent) toast.success("Draft saved");
      onChanged();
      return updated.version;
    } catch (e) {
      if (e instanceof ApiError && Array.isArray((e.details as { issues?: unknown })?.issues)) setIssues((e.details as { issues: FormValidationIssue[] }).issues);
      throw e;
    } finally {
      setSaving(false);
    }
  }

  async function submit() {
    let version = rev.version;
    if (schema) {
      const check = validateFormData(schema, form, "submit");
      if (!check.valid) {
        setIssues(check.issues);
        throw new Error(`The form is incomplete: ${check.issues.length} problem(s) highlighted`);
      }
      if (dirty) version = await saveDraft(true);
    }
    try {
      await api(`${base}/submit`, { method: "POST", body: { expectedVersion: version } });
    } catch (e) {
      if (e instanceof ApiError && Array.isArray((e.details as { issues?: unknown })?.issues)) setIssues((e.details as { issues: FormValidationIssue[] }).issues);
      throw e;
    }
    toast.success("Submitted for review");
    onChanged();
  }

  return (
    <CardBody className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <DetailGrid
          columns={4}
          className="flex-1"
          items={[
            { label: "Status", value: <StatusBadge status={rev.status} /> },
            { label: "Method", value: rev.submissionMethod === "NATIVE_FORM" ? `Native form${rev.formDefinitionVersion ? ` (schema v${rev.formDefinitionVersion.version})` : ""}` : "Uploaded document" },
            { label: "Template", value: rev.templateRevision ? `${rev.templateRevision.template.name} rev ${rev.templateRevision.revisionLabel}` : null },
            { label: "Created", value: formatDateTime(rev.createdAt) },
            rev.submittedAt && { label: "Submitted", value: formatDateTime(rev.submittedAt) },
            rev.approvedAt && { label: "Approved", value: formatDateTime(rev.approvedAt) },
            rev.release && { label: "Released", value: `${rev.release.releaseNumber} · effective ${formatDate(rev.release.effectiveDate)}` },
            rev.supersededAt && { label: "Superseded", value: formatDateTime(rev.supersededAt) },
            { label: "Change summary", value: rev.changeSummary, wide: true },
            rev.contentHash && { label: "Content hash (SHA-256)", value: <span className="break-all font-mono text-[11px]">{rev.contentHash}</span>, wide: true },
            rev.release?.releaseNotes && { label: "Release notes", value: rev.release.releaseNotes, wide: true },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          {draft && schema && (
            <Button variant="outline" loading={saving} disabled={!dirty} onClick={() => void saveDraft().catch((e) => toast.error((e as Error).message))}>
              <Save /> Save draft
            </Button>
          )}
          {draft && <ActionDialog trigger={<Button><Send /> Submit for review</Button>} title={`Submit rev ${rev.revisionLabel} for review`} description="The content is hashed and frozen; reviewers approve exactly this version." confirmLabel="Submit" onConfirm={submit} />}
          {editable && rev.status === "IN_REVIEW" && (
            <ActionDialog trigger={<Button variant="outline"><Undo2 /> Withdraw</Button>} title="Withdraw from review" description="Returns the revision to draft and cancels the open review." reasonLabel="Reason" confirmLabel="Withdraw" onConfirm={async (reason) => { await api(`${base}/withdraw`, { method: "POST", body: { reason } }); toast.success("Withdrawn to draft"); onChanged(); }} />
          )}
          {editable && rev.status === "REJECTED" && (
            <ActionDialog trigger={<Button variant="outline">Reopen as draft</Button>} title="Reopen rejected revision" description="The revision returns to draft for correction and resubmission." confirmLabel="Reopen" onConfirm={async () => { await api(`${base}/reopen`, { method: "POST", body: { expectedVersion: rev.version } }); toast.success("Reopened"); onChanged(); }} />
          )}
          {can("document:release") && rev.status === "APPROVED" && <ReleaseAction base={base} rev={rev} onDone={onChanged} />}
          {isInternal && can("document:write") && rev.status === "RELEASED" && doc.supplier && <AcknowledgeAction base={base} supplierId={doc.supplier.id} onDone={onChanged} />}
        </div>
      </div>
      {rev.rejectionReason && (
        <Alert tone="danger" title={`Rejected ${formatDateTime(rev.rejectedAt)}`}>
          {rev.rejectionReason}
        </Alert>
      )}
      {schema && (
        <div>
          {issues.length > 0 && (
            <Alert tone="danger" className="mb-3" title="Please correct the highlighted fields">
              <ul className="list-disc pl-4">
                {issues.slice(0, 10).map((i) => (
                  <li key={i.path}>{i.message}</li>
                ))}
              </ul>
            </Alert>
          )}
          <NativeForm
            schema={schema}
            value={form}
            readOnly={!draft}
            issues={issues}
            onChange={(v) => {
              setForm(v);
              setDirty(true);
            }}
          />
        </div>
      )}
      <RevisionFiles doc={doc} rev={rev} draft={draft} onChanged={onChanged} />
      {rev.acknowledgments.length > 0 && (
        <div>
          <p className="mb-1 font-medium">Supplier acknowledgments</p>
          <ul className="space-y-1 text-xs">
            {rev.acknowledgments.map((a) => (
              <li key={a.id}>
                {a.acknowledgedByName}
                {a.organization && ` (${a.organization.name})`} · {formatDateTime(a.acknowledgedAt)}
                {a.comment && ` · ${a.comment}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </CardBody>
  );
}

function RevisionFiles({ doc, rev, draft, onChanged }: { doc: Doc; rev: Revision; draft: boolean; onChanged: () => void }) {
  const [role, setRole] = useState<"PRIMARY" | "SUPPORTING">(rev.files.some((f) => f.role === "PRIMARY") ? "SUPPORTING" : "PRIMARY");
  const base = `/documents/${doc.id}/revisions/${rev.id}/files`;
  if (!draft && rev.files.length === 0) return rev.submissionMethod === "UPLOAD" ? <p className="text-xs text-muted-foreground">No files attached.</p> : null;
  return (
    <div className="space-y-2">
      <p className="font-medium">Files</p>
      {rev.files.length > 0 && (
        <ul className="divide-y rounded-md border">
          {rev.files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 px-3 py-2 text-xs">
              <Paperclip className="size-3.5 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate" title={`SHA-256 ${f.file.sha256}`}>
                {f.file.safeFilename}
              </span>
              <Badge tone={f.role === "PRIMARY" ? "info" : "muted"}>{humanize(f.role)}</Badge>
              <span className="text-muted-foreground">{formatBytes(f.file.sizeBytes)}</span>
              <StatusBadge status={f.file.status} />
              {f.file.status === "CLEAN" && (
                <>
                  {(f.file.contentType === "application/pdf" || f.file.category === "IMAGE") && (
                    <a href={filePreviewUrl(f.file.id)} target="_blank" rel="noopener noreferrer" className="text-accent" aria-label={`Preview ${f.file.safeFilename}`}>
                      <Eye className="size-3.5" />
                    </a>
                  )}
                  <a href={fileDownloadUrl(f.file.id)} className="text-accent" aria-label={`Download ${f.file.safeFilename}`}>
                    <Download className="size-3.5" />
                  </a>
                </>
              )}
              {draft && (
                <button
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${f.file.safeFilename}`}
                  onClick={() =>
                    void api(`${base}/${f.id}`, { method: "DELETE" })
                      .then(() => {
                        toast.success("File removed");
                        onChanged();
                      })
                      .catch((e) => toast.error((e as Error).message))
                  }
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {draft && (
        <div className="space-y-2">
          <Select aria-label="File role" className="h-8 w-auto" value={role} onChange={(e) => setRole(e.target.value as "PRIMARY" | "SUPPORTING")} options={[{ value: "PRIMARY", label: "Primary document" }, { value: "SUPPORTING", label: "Supporting file" }]} />
          <FileUpload
            onReady={async (file) => {
              try {
                await api(base, { method: "POST", body: { fileId: file.id, role } });
                setRole("SUPPORTING");
                onChanged();
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

function ReleaseAction({ base, rev, onDone }: { base: string; rev: Revision; onDone: () => void }) {
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  return (
    <ActionDialog
      trigger={<Button>Release</Button>}
      title={`Release rev ${rev.revisionLabel}`}
      description="The previously released revision (if any) becomes superseded."
      reasonLabel="Release notes"
      reasonRequired={false}
      confirmLabel="Release"
      onConfirm={async (notes) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) throw new Error("Enter the effective date");
        await api(`${base}/release`, { method: "POST", body: { expectedVersion: rev.version, effectiveDate, ...(notes ? { releaseNotes: notes } : {}) } });
        toast.success("Revision released");
        onDone();
      }}
    >
      <Field label="Effective date" required htmlFor="rel-date">
        <Input id="rel-date" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
      </Field>
    </ActionDialog>
  );
}

function AcknowledgeAction({ base, supplierId, onDone }: { base: string; supplierId: string; onDone: () => void }) {
  const [name, setName] = useState("");
  return (
    <ActionDialog
      trigger={<Button variant="outline">Record acknowledgment</Button>}
      title="Record supplier acknowledgment"
      description="Records the supplier's written acknowledgment of this released revision."
      reasonLabel="Comment"
      reasonRequired={false}
      confirmLabel="Record"
      onConfirm={async (comment) => {
        if (name.trim().length < 2) throw new Error("Enter who acknowledged the revision");
        await api(`${base}/acknowledgments`, { method: "POST", body: { supplierId, acknowledgedByName: name.trim(), ...(comment ? { comment } : {}) } });
        toast.success("Acknowledgment recorded");
        onDone();
      }}
    >
      <Field label="Acknowledged by (name and title)" required htmlFor="ack-name">
        <Input id="ack-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
    </ActionDialog>
  );
}

function SupersedeAction({ doc, onDone }: { doc: Doc; onDone: () => void }) {
  const [target, setTarget] = useState<PickerItem | null>(null);
  return (
    <ActionDialog
      trigger={<Button variant="ghost">Supersede</Button>}
      title="Supersede with another document"
      description="The superseding document must have a released revision."
      reasonLabel="Reason"
      confirmLabel="Supersede"
      onConfirm={async (reason) => {
        if (!target) throw new Error("Select the superseding document");
        await api(`/documents/${doc.id}/supersede`, { method: "POST", body: { supersedingDocumentId: target.id, reason } });
        toast.success("Document superseded");
        onDone();
      }}
    >
      <Field label="Superseding document" required>
        <AsyncPicker<{ id: string; docNumber: string; title: string; status: string }> endpoint="/documents" query={{ status: "RELEASED", documentTypeId: doc.documentType.id }} value={target} onChange={setTarget} map={(r) => ({ id: r.id, label: `${r.docNumber} · ${r.title}`, sublabel: humanize(r.status) })} />
      </Field>
    </ActionDialog>
  );
}

function LinksCard({ doc, editable, onChanged }: { doc: Doc; editable: boolean; onChanged: () => void }) {
  const [entityType, setEntityType] = useState("SUPPLIER");
  const [target, setTarget] = useState<PickerItem | null>(null);
  const [busy, setBusy] = useState(false);
  const picker = LINK_PICKERS[entityType];
  const pickerMap = useMemo(() => (r: Record<string, unknown>) => ({ id: String(r.id), label: picker.label(r) }), [picker]);
  async function add() {
    if (!target) return;
    setBusy(true);
    try {
      await api(`/documents/${doc.id}/links`, { method: "POST", body: { entityType, entityId: target.id, linkRole: "REFERENCE" } });
      toast.success("Link added");
      setTarget(null);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader title="Linked records" description="A document can support several suppliers, products, projects and quality records." />
      <CardBody className="space-y-3">
        {doc.links.length === 0 ? (
          <p className="text-xs text-muted-foreground">Not linked to any record.</p>
        ) : (
          <ul className="space-y-1">
            {doc.links.map((l) => {
              const href = entityHref(l.entityType, l.entityId);
              return (
                <li key={l.id} className="flex items-center gap-2 text-xs">
                  <Link2 className="size-3.5 text-muted-foreground" />
                  <Badge tone="muted">{humanize(l.entityType)}</Badge>
                  {href ? (
                    <Link className="min-w-0 flex-1 truncate text-accent hover:underline" href={href}>
                      {l.label ?? l.entityId}
                    </Link>
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{l.label ?? l.entityId}</span>
                  )}
                  <span className="text-muted-foreground">{humanize(l.linkRole)}</span>
                  {editable && l.linkRole !== "REQUIREMENT" && (
                    <button
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Remove link"
                      onClick={() =>
                        void api(`/documents/${doc.id}/links/${l.id}`, { method: "DELETE" })
                          .then(() => {
                            toast.success("Link removed");
                            onChanged();
                          })
                          .catch((e) => toast.error((e as Error).message))
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {editable && (
          <div className="grid gap-2 sm:grid-cols-[160px_1fr_auto]">
            <Select
              aria-label="Record type"
              value={entityType}
              onChange={(e) => {
                setEntityType(e.target.value);
                setTarget(null);
              }}
              options={Object.keys(LINK_PICKERS).map((k) => ({ value: k, label: humanize(k) }))}
            />
            <AsyncPicker<Record<string, unknown>> key={entityType} endpoint={picker.endpoint} value={target} onChange={setTarget} map={pickerMap} placeholder="Search record" />
            <Button variant="outline" loading={busy} disabled={!target} onClick={add}>
              Link
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function SharesCard({ doc, onChanged }: { doc: Doc; onChanged: () => void }) {
  const { can } = useSession();
  const [supplier, setSupplier] = useState<PickerItem | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const active = doc.shares.filter((s) => !s.revokedAt);
  const shareable = doc.documentType.supplierVisibility !== "INTERNAL_ONLY";
  async function share() {
    if (!supplier) return;
    setBusy(true);
    try {
      await api(`/documents/${doc.id}/shares`, { method: "POST", body: { supplierId: supplier.id, ...(note.trim() ? { note: note.trim() } : {}) } });
      toast.success("Shared with supplier");
      setSupplier(null);
      setNote("");
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader title="Supplier access" description={shareable ? "Released revisions can be shared with specific suppliers (Phase 2 portal)." : "This document type is internal only and cannot be shared."} />
      <CardBody className="space-y-3">
        {active.length === 0 ? (
          <p className="text-xs text-muted-foreground">Not shared with any supplier.</p>
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Supplier</TH>
                <TH>Shared</TH>
                <TH>Note</TH>
                {can("document:share") && <TH />}
              </tr>
            </THead>
            <TBody>
              {active.map((s) => (
                <TR key={s.id}>
                  <TD>{s.organization.name}</TD>
                  <TD>{formatDate(s.grantedAt)}</TD>
                  <TD className="text-xs">{s.note ?? "-"}</TD>
                  {can("document:share") && (
                    <TD>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void api(`/documents/${doc.id}/shares/${s.id}`, { method: "DELETE" })
                            .then(() => {
                              toast.success("Access revoked");
                              onChanged();
                            })
                            .catch((e) => toast.error((e as Error).message))
                        }
                      >
                        Revoke
                      </Button>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {can("document:share") && shareable && doc.releasedRevisionId && (
          <div className="space-y-2">
            <AsyncPicker<{ id: string; name: string; supplierNumber: string }> endpoint="/suppliers" value={supplier} onChange={setSupplier} map={(s) => ({ id: s.id, label: s.name, sublabel: s.supplierNumber })} placeholder="Select supplier" />
            <Textarea rows={2} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Share note" />
            <Button variant="outline" loading={busy} disabled={!supplier} onClick={share}>
              <Share2 /> Share released revision
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
