"use client";
import { QualityHistory } from "@/components/operations/quality-panels";

import { useQuery } from "@tanstack/react-query";
import { SUPPLIER_QUALIFICATION_TYPE, humanize } from "@sqms/shared";
import { Pencil, Plus } from "lucide-react";
import { useParams } from "next/navigation";
import { ActionDialog } from "@/components/common/action-dialog";
import { RecordPanel } from "@/components/common/collaboration";
import { DetailGrid } from "@/components/common/detail-grid";
import { FormDialog, type FieldSpec } from "@/components/forms/schema-form";
import { PageHeader } from "@/components/shell/page-header";
import { ChangesTable, DocumentsTable, NcrTable, ProjectsTable, ScarTable, SupplierProductsTable } from "@/components/tables/tables";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ErrorAlert, PageLoading } from "@/components/ui/feedback";
import { Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { useApiMutation } from "@/lib/hooks";
import { COUNTRY_FIELD, countryName, toOptions } from "@/lib/options";
import { useSession } from "@/lib/session";
import { useState } from "react";

interface Site {
  id: string;
  siteCode: string;
  name: string;
  line1: string | null;
  city: string;
  region: string | null;
  country: string;
  isManufacturing: boolean;
  status: string;
  processes: string | null;
}
interface Supplier {
  id: string;
  supplierNumber: string;
  name: string;
  legalName: string | null;
  website: string | null;
  country: string;
  status: string;
  statusReason: string | null;
  statusChangedAt: string | null;
  dunsNumber: string | null;
  taxId: string | null;
  notes: string | null;
  version: number;
  createdAt: string;
  sites: Site[];
  counts: { approvedProducts: number; openNcrs: number; pendingChanges: number; openScars: number; activeProjects: number };
}
interface Contact {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  isPrimary: boolean;
  notes: string | null;
}
interface Certification {
  id: string;
  standard: string;
  certificateNumber: string | null;
  registrar: string | null;
  scope: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  status: string;
  site: { siteCode: string } | null;
}
interface Qualification {
  id: string;
  number: string;
  type: string;
  status: string;
  proposedStatus: string;
  summary: string | null;
  conditions: string | null;
  auditScore: number | null;
  validUntil: string | null;
  decidedAt: string | null;
  version: number;
  site: { siteCode: string } | null;
}

const SITE_FIELDS: FieldSpec[] = [
  { name: "siteCode", label: "Site code", required: true, maxLength: 40 },
  { name: "name", label: "Site name", required: true, maxLength: 200 },
  { name: "line1", label: "Address", maxLength: 200 },
  { name: "city", label: "City", required: true, maxLength: 120 },
  { name: "region", label: "Region / state", maxLength: 120 },
  { name: "country", label: "Country", required: true, ...COUNTRY_FIELD },
  { name: "isManufacturing", label: "Manufacturing site", type: "checkbox" },
  { name: "processes", label: "Processes", type: "textarea", maxLength: 5000 },
];
const CONTACT_FIELDS: FieldSpec[] = [
  { name: "name", label: "Name", required: true, maxLength: 160 },
  { name: "title", label: "Title", maxLength: 120, nullable: true },
  { name: "email", label: "Email", type: "email", maxLength: 254, nullable: true },
  { name: "phone", label: "Phone", maxLength: 40, nullable: true },
  { name: "role", label: "Role (e.g. Quality, Sales)", maxLength: 80, nullable: true },
  { name: "isPrimary", label: "Primary contact", type: "checkbox" },
];
const CERT_FIELDS: FieldSpec[] = [
  { name: "standard", label: "Standard", required: true, minLength: 2, maxLength: 80, placeholder: "IATF 16949" },
  { name: "certificateNumber", label: "Certificate number", maxLength: 80, nullable: true },
  { name: "registrar", label: "Registrar", maxLength: 160, nullable: true },
  { name: "issuedAt", label: "Issued", type: "date" },
  { name: "expiresAt", label: "Expires", type: "date" },
  { name: "status", label: "Status", type: "select", options: toOptions(["PENDING_VERIFICATION", "VALID", "EXPIRED", "REVOKED"]) },
  { name: "scope", label: "Scope", type: "textarea", maxLength: 1000, nullable: true },
];

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const key = ["supplier", id];
  const q = useQuery({ queryKey: key, queryFn: () => api<Supplier>(`/suppliers/${id}`) });
  const contacts = useQuery({ queryKey: ["supplier-contacts", id], queryFn: () => api<Contact[]>(`/suppliers/${id}/contacts`) });
  const certs = useQuery({ queryKey: ["supplier-certs", id], queryFn: () => api<Certification[]>(`/suppliers/${id}/certifications`) });
  const quals = useQuery({ queryKey: ["supplier-quals", id], queryFn: () => api<Qualification[]>(`/suppliers/${id}/qualifications`) });
  const [newStatus, setNewStatus] = useState("SUSPENDED");
  const inv = (...k: string[][]) => k;
  const submitQual = useApiMutation((qual: Qualification) => api(`/supplier-qualifications/${qual.id}/submit`, { method: "POST", body: { expectedVersion: qual.version } }), {
    invalidate: inv(["supplier-quals", id], key),
    success: "Submitted for approval",
  });

  if (q.isLoading) return <PageLoading />;
  if (q.error || !q.data) return <ErrorAlert error={q.error} />;
  const s = q.data;
  const canWrite = can("supplier:write");
  const canQualify = can("supplier:qualify");

  return (
    <>
      <PageHeader
        title={s.name}
        breadcrumbs={[{ href: "/suppliers", label: "Suppliers" }, { label: s.supplierNumber }]}
        meta={
          <>
            <StatusBadge status={s.status} />
            <span className="text-muted-foreground">{s.supplierNumber}</span>
            <span className="text-muted-foreground">{countryName(s.country)}</span>
            {s.statusReason && <span className="text-muted-foreground">· {s.statusReason}</span>}
          </>
        }
        actions={
          <>
            {canWrite && (
              <FormDialog
                trigger={
                  <Button variant="outline">
                    <Pencil /> Edit
                  </Button>
                }
                title="Edit supplier"
                fields={[
                  { name: "name", label: "Name", required: true, minLength: 2, maxLength: 200 },
                  { name: "legalName", label: "Legal name", maxLength: 250, nullable: true },
                  { name: "country", label: "Country", required: true, ...COUNTRY_FIELD },
                  { name: "website", label: "Website", type: "url", maxLength: 300, nullable: true },
                  { name: "dunsNumber", label: "DUNS", maxLength: 20, nullable: true },
                  { name: "taxId", label: "Tax ID", maxLength: 40, nullable: true },
                  { name: "notes", label: "Notes", type: "textarea", maxLength: 10000, nullable: true },
                ]}
                defaultValues={s as unknown as Record<string, unknown>}
                onSubmit={async (p) => {
                  await api(`/suppliers/${id}`, { method: "PATCH", body: { ...p, country: String(p.country).toUpperCase(), expectedVersion: s.version } });
                  await q.refetch();
                }}
              />
            )}
            {canQualify && (
              <ActionDialog
                trigger={<Button variant="outline">Change status</Button>}
                title="Change supplier status"
                description="Approval is only granted through an approved supplier qualification."
                reasonLabel="Reason"
                confirmLabel="Change status"
                onConfirm={async (reason) => {
                  await api(`/suppliers/${id}/status`, { method: "POST", body: { status: newStatus, reason } });
                  await q.refetch();
                }}
              >
                <Select value={newStatus} onChange={(e) => setNewStatus(e.target.value)} options={toOptions(["PROSPECTIVE", "UNDER_EVALUATION", "SUSPENDED", "INACTIVE"])} aria-label="New status" />
              </ActionDialog>
            )}
          </>
        }
      />
      <div className="grid gap-4 2xl:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="sites">Sites ({s.sites.length})</TabsTrigger>
              <TabsTrigger value="contacts">Contacts</TabsTrigger>
              <TabsTrigger value="certifications">Certifications</TabsTrigger>
              <TabsTrigger value="qualifications">Qualifications</TabsTrigger>
              <TabsTrigger value="products">Products</TabsTrigger>
              <TabsTrigger value="projects">Projects</TabsTrigger>
              <TabsTrigger value="quality">Quality</TabsTrigger>
              <TabsTrigger value="documents">Documents</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="space-y-4">
              <Card>
                <CardBody>
                  <DetailGrid
                    items={[
                      { label: "Legal name", value: s.legalName },
                      { label: "Website", value: s.website && <a className="text-accent hover:underline" href={s.website} target="_blank" rel="noopener noreferrer">{s.website}</a> },
                      { label: "DUNS", value: s.dunsNumber },
                      { label: "Tax ID", value: s.taxId },
                      { label: "Status changed", value: formatDateTime(s.statusChangedAt) },
                      { label: "Created", value: formatDateTime(s.createdAt) },
                      { label: "Notes", value: s.notes, wide: true },
                    ]}
                  />
                </CardBody>
              </Card>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                {[
                  ["Approved products", s.counts.approvedProducts],
                  ["Active projects", s.counts.activeProjects],
                  ["Open NCRs", s.counts.openNcrs],
                  ["Open SCARs", s.counts.openScars],
                  ["Pending changes", s.counts.pendingChanges],
                ].map(([l, v]) => (
                  <Card key={String(l)} className="p-3">
                    <p className="text-xs text-muted-foreground">{l}</p>
                    <p className="text-xl font-semibold">{v}</p>
                  </Card>
                ))}
              </div>
            </TabsContent>
            <TabsContent value="sites">
              <Card>
                <CardHeader
                  title="Manufacturing and service sites"
                  description="Product approvals are specific to the site where the product is made."
                  actions={
                    canWrite && (
                      <FormDialog trigger={<Button size="sm"><Plus /> Add site</Button>} title="Add site" fields={SITE_FIELDS} defaultValues={{ isManufacturing: true, country: s.country }} onSubmit={async (p) => { await api(`/suppliers/${id}/sites`, { method: "POST", body: { ...p, country: String(p.country).toUpperCase() } }); await q.refetch(); }} />
                    )
                  }
                />
                <Table>
                  <THead>
                    <tr>
                      <TH>Code</TH>
                      <TH>Name</TH>
                      <TH>Location</TH>
                      <TH>Manufacturing</TH>
                      <TH>Status</TH>
                      <TH />
                    </tr>
                  </THead>
                  <TBody>
                    {s.sites.map((site) => (
                      <TR key={site.id}>
                        <TD className="font-mono text-xs">{site.siteCode}</TD>
                        <TD>
                          {site.name}
                          {site.processes && <p className="text-xs text-muted-foreground">{site.processes}</p>}
                        </TD>
                        <TD>
                          {[site.line1, site.city, site.region].filter(Boolean).join(", ")} · {countryName(site.country)}
                        </TD>
                        <TD>{site.isManufacturing ? "Yes" : "No"}</TD>
                        <TD>
                          <StatusBadge status={site.status} />
                        </TD>
                        <TD className="text-right">
                          {canQualify && <SiteStatusAction siteId={site.id} onDone={() => void q.refetch()} />}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </Card>
            </TabsContent>
            <TabsContent value="contacts">
              <Card>
                <CardHeader title="Contacts" actions={canWrite && <FormDialog trigger={<Button size="sm"><Plus /> Add contact</Button>} title="Add contact" fields={CONTACT_FIELDS} onSubmit={async (p) => { await api(`/suppliers/${id}/contacts`, { method: "POST", body: p }); await contacts.refetch(); }} />} />
                {contacts.error ? <ErrorAlert error={contacts.error} /> : null}
                <Table>
                  <THead>
                    <tr>
                      <TH>Name</TH>
                      <TH>Role</TH>
                      <TH>Email</TH>
                      <TH>Phone</TH>
                      <TH />
                    </tr>
                  </THead>
                  <TBody>
                    {contacts.data?.map((c) => (
                      <TR key={c.id}>
                        <TD>
                          {c.name} {c.isPrimary && <Badge tone="info">Primary</Badge>}
                          {c.title && <p className="text-xs text-muted-foreground">{c.title}</p>}
                        </TD>
                        <TD>{c.role ?? "-"}</TD>
                        <TD>{c.email ? <a className="text-accent" href={`mailto:${c.email}`}>{c.email}</a> : "-"}</TD>
                        <TD>{c.phone ?? "-"}</TD>
                        <TD className="text-right">
                          {canWrite && (
                            <FormDialog
                              trigger={<Button size="sm" variant="ghost">Edit</Button>}
                              title="Edit contact"
                              fields={CONTACT_FIELDS}
                              defaultValues={c as unknown as Record<string, unknown>}
                              onSubmit={async (p) => {
                                await api(`/suppliers/${id}/contacts/${c.id}`, { method: "PATCH", body: p });
                                await contacts.refetch();
                              }}
                            />
                          )}
                        </TD>
                      </TR>
                    ))}
                    {contacts.data?.length === 0 && (
                      <TR>
                        <TD colSpan={5} className="text-center text-muted-foreground">No contacts recorded.</TD>
                      </TR>
                    )}
                  </TBody>
                </Table>
              </Card>
            </TabsContent>
            <TabsContent value="certifications">
              <Card>
                <CardHeader
                  title="Certifications"
                  description="Expiry alerts are sent to Supplier Quality ahead of the expiry date."
                  actions={canWrite && <FormDialog trigger={<Button size="sm"><Plus /> Add certification</Button>} title="Add certification" fields={CERT_FIELDS} defaultValues={{ status: "PENDING_VERIFICATION" }} onSubmit={async (p) => { await api(`/suppliers/${id}/certifications`, { method: "POST", body: p }); await certs.refetch(); }} />}
                />
                <Table>
                  <THead>
                    <tr>
                      <TH>Standard</TH>
                      <TH>Certificate</TH>
                      <TH>Registrar</TH>
                      <TH>Issued</TH>
                      <TH>Expires</TH>
                      <TH>Status</TH>
                      <TH />
                    </tr>
                  </THead>
                  <TBody>
                    {certs.data?.map((c) => {
                      const days = c.expiresAt ? Math.ceil((new Date(c.expiresAt).getTime() - Date.now()) / 86_400_000) : null;
                      return (
                        <TR key={c.id}>
                          <TD className="font-medium">{c.standard}</TD>
                          <TD>{c.certificateNumber ?? "-"}</TD>
                          <TD>{c.registrar ?? "-"}</TD>
                          <TD>{formatDate(c.issuedAt)}</TD>
                          <TD>
                            {formatDate(c.expiresAt)} {days !== null && days <= 60 && days >= 0 && <Badge tone="warning">{days} d</Badge>}
                          </TD>
                          <TD>
                            <StatusBadge status={c.status} />
                          </TD>
                          <TD className="text-right">
                            {canWrite && (
                              <FormDialog trigger={<Button size="sm" variant="ghost">Edit</Button>} title="Edit certification" fields={CERT_FIELDS} defaultValues={c as unknown as Record<string, unknown>} onSubmit={async (p) => { await api(`/suppliers/${id}/certifications/${c.id}`, { method: "PATCH", body: p }); await certs.refetch(); }} />
                            )}
                          </TD>
                        </TR>
                      );
                    })}
                    {certs.data?.length === 0 && (
                      <TR>
                        <TD colSpan={7} className="text-center text-muted-foreground">No certifications recorded.</TD>
                      </TR>
                    )}
                  </TBody>
                </Table>
              </Card>
            </TabsContent>
            <TabsContent value="qualifications">
              <Card>
                <CardHeader
                  title="Supplier qualifications"
                  description="Supplier approval is separate from product approval: each supplier product still needs its own qualification."
                  actions={
                    canQualify && (
                      <FormDialog
                        trigger={<Button size="sm"><Plus /> Start qualification</Button>}
                        title="Start supplier qualification"
                        fields={[
                          { name: "type", label: "Type", type: "select", required: true, options: toOptions(SUPPLIER_QUALIFICATION_TYPE) },
                          { name: "proposedStatus", label: "Proposed outcome", type: "select", required: true, options: toOptions(["APPROVED", "CONDITIONALLY_APPROVED"]) },
                          { name: "siteId", label: "Site (optional)", type: "select", options: s.sites.map((x) => ({ value: x.id, label: `${x.siteCode} ${x.name}` })) },
                          { name: "auditScore", label: "Audit score", type: "number", min: 0, max: 100 },
                          { name: "validUntil", label: "Valid until", type: "date" },
                          { name: "scope", label: "Scope", type: "textarea", maxLength: 5000 },
                          { name: "summary", label: "Summary of evaluation", type: "textarea", maxLength: 10000 },
                          { name: "conditions", label: "Conditions (if conditional)", type: "textarea", maxLength: 10000, when: (v) => v.proposedStatus === "CONDITIONALLY_APPROVED" },
                        ]}
                        defaultValues={{ type: "INITIAL", proposedStatus: "APPROVED" }}
                        onSubmit={async (p) => {
                          await api(`/suppliers/${id}/qualifications`, { method: "POST", body: p });
                          await quals.refetch();
                        }}
                      />
                    )
                  }
                />
                <Table>
                  <THead>
                    <tr>
                      <TH>Number</TH>
                      <TH>Type</TH>
                      <TH>Proposed</TH>
                      <TH>Status</TH>
                      <TH>Decided</TH>
                      <TH>Summary</TH>
                      <TH />
                    </tr>
                  </THead>
                  <TBody>
                    {quals.data?.map((x) => (
                      <TR key={x.id}>
                        <TD className="font-medium">{x.number}</TD>
                        <TD>{humanize(x.type)}{x.site && ` · ${x.site.siteCode}`}</TD>
                        <TD>{humanize(x.proposedStatus)}</TD>
                        <TD>
                          <StatusBadge status={x.status} />
                        </TD>
                        <TD>{formatDateTime(x.decidedAt)}</TD>
                        <TD className="max-w-sm">
                          <span className="line-clamp-2">{x.summary ?? "-"}</span>
                        </TD>
                        <TD className="text-right">
                          {canQualify && x.status === "DRAFT" && (
                            <Button size="sm" onClick={() => submitQual.mutate(x)} loading={submitQual.isPending}>
                              Submit for approval
                            </Button>
                          )}
                        </TD>
                      </TR>
                    ))}
                    {quals.data?.length === 0 && (
                      <TR>
                        <TD colSpan={7} className="text-center text-muted-foreground">No qualifications yet.</TD>
                      </TR>
                    )}
                  </TBody>
                </Table>
                {quals.data?.map((x) => (x.status === "IN_REVIEW" ? <div key={x.id} className="border-t px-4 py-2 text-xs text-muted-foreground">{x.number} is awaiting approval in the approvals inbox.</div> : null))}
              </Card>
            </TabsContent>
            <TabsContent value="products">
              <SupplierProductsTable baseQuery={{ supplierId: id }} />
            </TabsContent>
            <TabsContent value="projects">
              <ProjectsTable baseQuery={{ supplierId: id }} syncUrl={false} filters={false} savedViews={false} />
            </TabsContent>
            <TabsContent value="quality" className="space-y-4">
              <NcrTable baseQuery={{ supplierId: id }} syncUrl={false} filters={false} savedViews={false} />
              <ScarTable baseQuery={{ supplierId: id }} syncUrl={false} filters={false} savedViews={false} />
              <ChangesTable baseQuery={{ supplierId: id }} syncUrl={false} filters={false} savedViews={false} />
            </TabsContent>
            <TabsContent value="documents">
              <DocumentsTable baseQuery={{ supplierId: id }} syncUrl={false} filters={false} savedViews={false} />
            </TabsContent>
          </Tabs>
        </div>
        <div className="min-w-0">
          <QualityHistory supplierId={id} />
          <RecordPanel entityType="SUPPLIER" entityId={id} />
        </div>
      </div>
    </>
  );
}

function SiteStatusAction({ siteId, onDone }: { siteId: string; onDone: () => void }) {
  const [status, setStatus] = useState("SUSPENDED");
  return (
    <ActionDialog
      trigger={<Button size="sm" variant="ghost">Status</Button>}
      title="Change site status"
      description="Suspending a site blocks new product approvals at that site."
      reasonLabel="Reason"
      onConfirm={async (reason) => {
        await api(`/supplier-sites/${siteId}/status`, { method: "POST", body: { status, reason } });
        onDone();
      }}
    >
      <Select value={status} onChange={(e) => setStatus(e.target.value)} options={toOptions(["PROSPECTIVE", "UNDER_EVALUATION", "SUSPENDED", "INACTIVE"])} aria-label="Site status" />
    </ActionDialog>
  );
}
