"use client";

import { useQuery } from "@tanstack/react-query";
import { LIFECYCLE_STATUS, humanize, type FormSchema } from "@sqms/shared";
import { Download, Plus } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ActionDialog } from "@/components/common/action-dialog";
import { DetailGrid } from "@/components/common/detail-grid";
import { FileUpload } from "@/components/common/file-upload";
import { AsyncPicker, type PickerItem } from "@/components/forms/async-picker";
import { NativeForm } from "@/components/forms/native-form";
import { FormDialog } from "@/components/forms/schema-form";
import { PageHeader } from "@/components/shell/page-header";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ErrorAlert, PageLoading } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DocumentsTable } from "@/components/tables/tables";
import { api, fileDownloadUrl } from "@/lib/api";
import { describeCondition, formatDate, formatDateTime } from "@/lib/format";
import { toOptions } from "@/lib/options";
import { useSession } from "@/lib/session";
import { DOC_TYPE_FIELDS, docTypeDefaults, toDocTypePayload } from "../type-fields";

interface TemplateRevision {
  id: string;
  revisionLabel: string;
  status: string;
  effectiveDate: string | null;
  changeSummary: string | null;
  instructions: string | null;
  approvedAt: string | null;
  file: { id: string; safeFilename: string; status: string } | null;
  formDefinitionVersion: { id: string; version: number; formDefinition: { key: string } } | null;
}
interface DocType {
  id: string;
  code: string;
  name: string;
  acronym: string | null;
  category: string;
  origin: string;
  externalStandardRef: string | null;
  description: string;
  purpose: string | null;
  responsibleDepartment: string;
  typicalPreparer: string;
  workflowKey: string | null;
  applicablePathways: string[];
  applicabilityConditions: string | null;
  riskRuleSummary: string | null;
  ownerRoleKey: string | null;
  approvalRequirements: string | null;
  approverRoleKeys: string[];
  supplierVisibility: string;
  status: string;
  instructions: string | null;
  allowUpload: boolean;
  nativeFormKey: string | null;
  nativeModule: string | null;
  version: number;
  retentionPolicy: { code: string; name: string; description: string | null; trigger: string; retentionMonths: number | null } | null;
  supersededByType: { id: string; code: string; name: string } | null;
  templates: { id: string; name: string; description: string | null; status: string; revisions: TemplateRevision[] }[];
  formDefinitions: { id: string; key: string; name: string; versions: { id: string; version: number; status: string; publishedAt: string | null; changeSummary: string | null }[] }[];
  rules: { id: string; outcome: string; priority: number; conditions: unknown; reason: string; dueOffsetDays: number | null; defaultAssigneeRoleKey: string | null; policyVersion: { version: number; policy: { key: string; name: string } } }[];
  documentCounts: { status: string; count: number }[];
}

export default function DocumentTypePage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const q = useQuery({ queryKey: ["document-type", id], queryFn: () => api<DocType>(`/document-types/${id}`) });
  const [preview, setPreview] = useState<string | null>(null);
  if (q.isLoading) return <PageLoading />;
  if (q.error || !q.data) return <ErrorAlert error={q.error} />;
  const t = q.data;
  const refetch = () => void q.refetch();
  const manage = can("document_type:manage");

  return (
    <>
      <PageHeader
        title={`${t.code} ${t.name}`}
        breadcrumbs={[{ href: "/document-types", label: "Document library" }, { label: t.code }]}
        description={t.description}
        meta={
          <>
            <StatusBadge status={t.status} />
            <span>{humanize(t.category)}</span>
            {t.acronym && <Badge>{t.acronym}</Badge>}
            {t.applicablePathways.map((p) => (
              <Badge key={p} tone="info">
                Pathway {p}
              </Badge>
            ))}
            {t.supersededByType && <span>Superseded by {t.supersededByType.code}</span>}
          </>
        }
        actions={
          manage && (
            <>
              <FormDialog
                trigger={<Button variant="outline">Edit governance</Button>}
                title={`Edit ${t.code}`}
                wide
                columns={2}
                fields={DOC_TYPE_FIELDS}
                defaultValues={docTypeDefaults(t as unknown as Record<string, unknown>)}
                onSubmit={async (payload) => {
                  await api(`/document-types/${id}`, { method: "PATCH", body: { expectedVersion: t.version, ...toDocTypePayload(payload) } });
                  toast.success("Document type updated");
                  refetch();
                }}
              />
              <TypeStatus t={t} onDone={refetch} />
            </>
          )
        }
      />
      <Tabs defaultValue="governance">
        <TabsList>
          <TabsTrigger value="governance">Governance</TabsTrigger>
          <TabsTrigger value="templates">Templates ({t.templates.length})</TabsTrigger>
          <TabsTrigger value="forms">Native forms ({t.formDefinitions.length})</TabsTrigger>
          <TabsTrigger value="rules">Applicability rules ({t.rules.length})</TabsTrigger>
          <TabsTrigger value="records">Records ({t.documentCounts.reduce((a, c) => a + c.count, 0)})</TabsTrigger>
        </TabsList>
        <TabsContent value="governance">
          <Card>
            <CardBody>
              <DetailGrid
                items={[
                  { label: "Origin", value: humanize(t.origin) },
                  { label: "External standard reference", value: t.externalStandardRef },
                  { label: "Responsible department", value: t.responsibleDepartment },
                  { label: "Typical preparer", value: t.typicalPreparer },
                  { label: "Owner role", value: t.ownerRoleKey && humanize(t.ownerRoleKey) },
                  { label: "Approver roles", value: t.approverRoleKeys.map(humanize).join(", ") },
                  { label: "Review workflow", value: t.workflowKey },
                  { label: "Supplier visibility", value: humanize(t.supplierVisibility) },
                  { label: "Submission", value: `${t.nativeFormKey ? `Native form ${t.nativeFormKey}` : "Upload"}${t.nativeFormKey && t.allowUpload ? " or upload" : ""}${t.nativeModule ? ` (produced by ${humanize(t.nativeModule).toLowerCase()})` : ""}` },
                  {
                    label: "Retention policy",
                    value: t.retentionPolicy ? `${t.retentionPolicy.name} (${t.retentionPolicy.retentionMonths ? `${t.retentionPolicy.retentionMonths} months, ` : "period set by records management, "}${humanize(t.retentionPolicy.trigger).toLowerCase()})` : "Not assigned",
                  },
                  { label: "Purpose", value: t.purpose, wide: true },
                  { label: "Applicability conditions", value: t.applicabilityConditions, wide: true },
                  { label: "Risk rule summary", value: t.riskRuleSummary, wide: true },
                  { label: "Approval requirements", value: t.approvalRequirements, wide: true },
                  { label: "Instructions", value: t.instructions, wide: true },
                ]}
              />
            </CardBody>
          </Card>
        </TabsContent>
        <TabsContent value="templates" className="space-y-4">
          {manage && (
            <div className="flex justify-end">
              <FormDialog
                trigger={<Button variant="outline"><Plus /> New template</Button>}
                title="New template"
                fields={[
                  { name: "name", label: "Name", required: true, minLength: 2, maxLength: 200 },
                  { name: "description", label: "Description", type: "textarea", maxLength: 5000 },
                ]}
                onSubmit={async (payload) => {
                  await api(`/document-types/${id}/templates`, { method: "POST", body: payload });
                  toast.success("Template created");
                  refetch();
                }}
              />
            </div>
          )}
          {t.templates.length === 0 && <p className="text-muted-foreground">No templates.</p>}
          {t.templates.map((tpl) => (
            <Card key={tpl.id}>
              <CardHeader title={tpl.name} description={tpl.description ?? undefined} actions={manage && !tpl.revisions.some((r) => r.status === "DRAFT") && <NewTemplateRevision templateId={tpl.id} forms={t.formDefinitions} onDone={refetch} />} />
              <Table>
                <THead>
                  <tr>
                    <TH>Rev</TH>
                    <TH>Status</TH>
                    <TH>Effective</TH>
                    <TH>Template file / form</TH>
                    <TH>Change summary</TH>
                    {manage && <TH />}
                  </tr>
                </THead>
                <TBody>
                  {tpl.revisions.map((r) => (
                    <TR key={r.id}>
                      <TD className="font-medium">{r.revisionLabel}</TD>
                      <TD>
                        <StatusBadge status={r.status} />
                      </TD>
                      <TD>{formatDate(r.effectiveDate)}</TD>
                      <TD className="text-xs">
                        {r.file ? (
                          r.file.status === "CLEAN" ? (
                            <a className="inline-flex items-center gap-1 text-accent hover:underline" href={fileDownloadUrl(r.file.id)}>
                              <Download className="size-3.5" /> {r.file.safeFilename}
                            </a>
                          ) : (
                            <span>
                              {r.file.safeFilename} <StatusBadge status={r.file.status} />
                            </span>
                          )
                        ) : (
                          <span className="text-muted-foreground">No file</span>
                        )}
                        {r.formDefinitionVersion && <div>Form {r.formDefinitionVersion.formDefinition.key} v{r.formDefinitionVersion.version}</div>}
                      </TD>
                      <TD className="max-w-sm text-xs">{r.changeSummary ?? "-"}</TD>
                      {manage && (
                        <TD className="space-x-1 whitespace-nowrap text-right">
                          {r.status === "DRAFT" && <TemplateRevisionActions rev={r} onDone={refetch} />}
                          {r.status === "EFFECTIVE" && (
                            <ActionDialog
                              trigger={<Button size="sm" variant="ghost">Obsolete</Button>}
                              title={`Obsolete template rev ${r.revisionLabel}`}
                              reasonLabel="Reason"
                              confirmVariant="destructive"
                              confirmLabel="Obsolete"
                              onConfirm={async (reason) => {
                                await api(`/template-revisions/${r.id}/obsolete`, { method: "POST", body: { reason } });
                                toast.success("Template revision made obsolete");
                                refetch();
                              }}
                            />
                          )}
                        </TD>
                      )}
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          ))}
        </TabsContent>
        <TabsContent value="forms" className="space-y-4">
          {t.formDefinitions.length === 0 && <p className="text-muted-foreground">This type has no native form; submissions are uploaded documents.</p>}
          {t.formDefinitions.map((f) => (
            <Card key={f.id}>
              <CardHeader title={`${f.name} (${f.key})`} description="Published schema versions are immutable; each submission records the version it used." />
              <Table>
                <THead>
                  <tr>
                    <TH>Version</TH>
                    <TH>Status</TH>
                    <TH>Published</TH>
                    <TH>Change summary</TH>
                    <TH />
                  </tr>
                </THead>
                <TBody>
                  {f.versions.map((v) => (
                    <TR key={v.id}>
                      <TD>v{v.version}</TD>
                      <TD>
                        <StatusBadge status={v.status} />
                      </TD>
                      <TD>{formatDateTime(v.publishedAt)}</TD>
                      <TD className="text-xs">{v.changeSummary ?? "-"}</TD>
                      <TD className="space-x-1 whitespace-nowrap text-right">
                        <Button size="sm" variant="outline" onClick={() => setPreview(v.id)}>
                          Preview
                        </Button>
                        {manage && v.status === "DRAFT" && (
                          <ActionDialog
                            trigger={<Button size="sm">Publish</Button>}
                            title={`Publish ${f.key} v${v.version}`}
                            description="Once published the schema cannot be changed. New template revisions can reference it."
                            confirmLabel="Publish"
                            onConfirm={async () => {
                              await api(`/form-definition-versions/${v.id}/publish`, { method: "POST" });
                              toast.success("Form version published");
                              refetch();
                            }}
                          />
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          ))}
          {preview && <FormPreview versionId={preview} onClose={() => setPreview(null)} />}
        </TabsContent>
        <TabsContent value="rules">
          <Card>
            <CardHeader title="Rules in the active applicability policy" description="Rules are maintained under Administration > Applicability policies and are versioned; projects record the policy version used." />
            {t.rules.length === 0 ? (
              <CardBody>
                <p className="text-muted-foreground">No rules reference this type; it is not generated automatically.</p>
              </CardBody>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Outcome</TH>
                    <TH>Condition</TH>
                    <TH>Reason</TH>
                    <TH>Due</TH>
                    <TH>Default assignee</TH>
                    <TH>Policy</TH>
                  </tr>
                </THead>
                <TBody>
                  {t.rules.map((r) => (
                    <TR key={r.id}>
                      <TD>
                        <StatusBadge status={r.outcome} />
                      </TD>
                      <TD className="max-w-md font-mono text-[11px]">{describeCondition(r.conditions)}</TD>
                      <TD className="text-xs">{r.reason}</TD>
                      <TD>{r.dueOffsetDays != null ? `+${r.dueOffsetDays} days` : "-"}</TD>
                      <TD>{r.defaultAssigneeRoleKey ? humanize(r.defaultAssigneeRoleKey) : "-"}</TD>
                      <TD className="text-xs">
                        {r.policyVersion.policy.name} v{r.policyVersion.version}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </TabsContent>
        <TabsContent value="records">
          <DocumentsTable baseQuery={{ documentTypeId: id }} syncUrl={false} savedViews={false} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function TypeStatus({ t, onDone }: { t: DocType; onDone: () => void }) {
  const options = LIFECYCLE_STATUS.filter((s) => s !== t.status);
  const [status, setStatus] = useState<string>(options[0]);
  const [successor, setSuccessor] = useState<PickerItem | null>(null);
  return (
    <ActionDialog
      trigger={<Button variant="outline">Change status</Button>}
      title={`Change status of ${t.code}`}
      description="Obsolete types cannot be used for new records; existing records keep their history."
      reasonLabel="Reason"
      confirmLabel="Change status"
      onConfirm={async (reason) => {
        if (status === "SUPERSEDED" && !successor) throw new Error("Select the superseding document type");
        await api(`/document-types/${t.id}/status`, { method: "POST", body: { status, reason, ...(status === "SUPERSEDED" && successor ? { supersededByTypeId: successor.id } : {}) } });
        toast.success("Status changed");
        onDone();
      }}
    >
      <Select aria-label="New status" value={status} onChange={(e) => setStatus(e.target.value)} options={toOptions(options)} />
      {status === "SUPERSEDED" && (
        <Field label="Superseded by" required>
          <AsyncPicker<{ id: string; code: string; name: string }> endpoint="/document-types" query={{ status: "ACTIVE" }} value={successor} onChange={setSuccessor} map={(x) => ({ id: x.id, label: `${x.code} ${x.name}` })} />
        </Field>
      )}
    </ActionDialog>
  );
}

function NewTemplateRevision({ templateId, forms, onDone }: { templateId: string; forms: DocType["formDefinitions"]; onDone: () => void }) {
  const published = forms.flatMap((f) => f.versions.filter((v) => v.status === "PUBLISHED").map((v) => ({ value: v.id, label: `${f.key} v${v.version}` })));
  return (
    <FormDialog
      trigger={<Button size="sm" variant="outline"><Plus /> New revision</Button>}
      title="New template revision"
      description="Creates a draft. Attach the controlled template file, then publish it with an effective date."
      fields={[
        { name: "changeSummary", label: "Change summary", type: "textarea", required: true, minLength: 5, maxLength: 5000 },
        { name: "instructions", label: "Instructions", type: "textarea", maxLength: 10000 },
        ...(published.length ? [{ name: "formDefinitionVersionId", label: "Native form version", type: "select" as const, options: published }] : []),
      ]}
      onSubmit={async (payload) => {
        await api(`/document-templates/${templateId}/revisions`, { method: "POST", body: payload });
        toast.success("Draft template revision created");
        onDone();
      }}
    />
  );
}

function TemplateRevisionActions({ rev, onDone }: { rev: TemplateRevision; onDone: () => void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [attachOpen, setAttachOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setAttachOpen(true)}>
        {rev.file ? "Replace file" : "Attach file"}
      </Button>
      <Dialog open={attachOpen} onOpenChange={setAttachOpen}>
        <DialogContent title={`Template file for rev ${rev.revisionLabel}`} description="DOCX, XLSX or PDF. The file must pass malware scanning before the revision can be published.">
          <FileUpload
            multiple={false}
            accept=".docx,.xlsx,.pdf,.doc,.xls"
            onReady={async (f) => {
              try {
                await api(`/template-revisions/${rev.id}/attach-file`, { method: "POST", body: { fileId: f.id } });
                toast.success("Template file attached");
                setAttachOpen(false);
                onDone();
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          />
        </DialogContent>
      </Dialog>
      <ActionDialog
        trigger={<Button size="sm">Publish</Button>}
        title={`Publish template rev ${rev.revisionLabel}`}
        description="The current effective revision is superseded on publication."
        confirmLabel="Publish"
        onConfirm={async () => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Enter the effective date");
          await api(`/template-revisions/${rev.id}/publish`, { method: "POST", body: { effectiveDate: date } });
          toast.success("Template revision published");
          onDone();
        }}
      >
        <Field label="Effective date" required htmlFor={`eff-${rev.id}`}>
          <Input id={`eff-${rev.id}`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </ActionDialog>
    </>
  );
}

function FormPreview({ versionId, onClose }: { versionId: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ["form-version", versionId], queryFn: () => api<{ id: string; version: number; schema: FormSchema }>(`/form-definition-versions/${versionId}`) });
  const [data, setData] = useState<Record<string, unknown>>({});
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={q.data ? `${q.data.schema.title} (v${q.data.version})` : "Form preview"} description="Interactive preview; nothing is saved." wide>
        {q.error ? <ErrorAlert error={q.error} /> : null}
        <div className="max-h-[70vh] overflow-y-auto pr-1">{q.data && <NativeForm schema={q.data.schema} value={data} onChange={setData} />}</div>
      </DialogContent>
    </Dialog>
  );
}
