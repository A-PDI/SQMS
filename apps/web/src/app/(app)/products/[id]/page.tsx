"use client";

import { useQuery } from "@tanstack/react-query";
import { PART_CRITICALITY, PART_STATUS, humanize } from "@sqms/shared";
import { Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { RecordPanel } from "@/components/common/collaboration";
import { DetailGrid } from "@/components/common/detail-grid";
import { FormDialog } from "@/components/forms/schema-form";
import { PageHeader } from "@/components/shell/page-header";
import { ChangesTable, DocumentsTable, NcrTable, ProjectsTable } from "@/components/tables/tables";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ErrorAlert, PageLoading } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useApiMutation } from "@/lib/hooks";
import { toOptions } from "@/lib/options";
import { useSession } from "@/lib/session";

interface Config {
  id: string;
  configCode: string;
  name: string;
  configurationType: string;
  customPartNumber: string | null;
  currentApprovedRevision: { id: string; revisionLabel: string; status: string } | null;
  revisions: { id: string; revisionLabel: string; status: string; createdAt: string }[];
}
interface Part {
  id: string;
  partNumber: string;
  description: string;
  application: string | null;
  unitOfMeasure: string;
  criticality: string;
  status: string;
  designOwnership: string;
  engineeringRevision: string | null;
  notes: string | null;
  version: number;
  oemReferences: { id: string; oemName: string; oemPartNumber: string; notes: string | null }[];
  crossReferences: { id: string; type: string; supplierPart: { id: string; supplierPartNumber: string; description: string; supplier?: { name: string } } }[];
  supplierProducts: { id: string; status: string; isPreferred: boolean; supplier: { id: string; name: string; supplierNumber: string; status: string }; supplierPart: { supplierPartNumber: string; isCustom: boolean }; site: { siteCode: string; name: string; status: string }; configurations: Config[] }[];
  _count: { nonconformances: number; changeRequests: number; sourcingProjects: number };
}
interface Approval {
  id: string;
  number: string;
  status: string;
  approvedAt: string;
  restrictions: string | null;
  supplierProduct?: { supplier: { name: string }; site: { siteCode: string } };
  configurationRevision?: { revisionLabel: string; configuration: { configCode: string } };
}

export default function PartDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const q = useQuery({ queryKey: ["part", id], queryFn: () => api<Part>(`/products/${id}`) });
  const approvals = useQuery({ queryKey: ["part-approvals", id], queryFn: () => api<Approval[] | { items: Approval[] }>(`/products/${id}/approvals`) });
  const removeOem = useApiMutation((refId: string) => api(`/products/${id}/oem-references/${refId}`, { method: "DELETE" }), { invalidate: [["part", id]], success: "Reference removed" });

  if (q.isLoading) return <PageLoading />;
  if (q.error || !q.data) return <ErrorAlert error={q.error} />;
  const p = q.data;
  const approvalList = Array.isArray(approvals.data) ? approvals.data : (approvals.data?.items ?? []);
  const canWrite = can("product:write");

  return (
    <>
      <PageHeader
        title={`${p.partNumber} · ${p.description}`}
        breadcrumbs={[{ href: "/products", label: "Products" }, { label: p.partNumber }]}
        meta={
          <>
            <StatusBadge status={p.status} />
            <span>Criticality</span> <StatusBadge status={p.criticality} />
            <span className="text-muted-foreground">Design ownership: {humanize(p.designOwnership)}</span>
          </>
        }
        actions={
          canWrite && (
            <FormDialog
              trigger={
                <Button variant="outline">
                  <Pencil /> Edit
                </Button>
              }
              title="Edit part"
              fields={[
                { name: "description", label: "Description", required: true, minLength: 2, maxLength: 500 },
                { name: "criticality", label: "Criticality", type: "select", options: toOptions(PART_CRITICALITY) },
                { name: "status", label: "Status", type: "select", options: toOptions(PART_STATUS) },
                { name: "designOwnership", label: "Design ownership", type: "select", options: toOptions(["COMPANY", "SUPPLIER", "SHARED"]) },
                { name: "engineeringRevision", label: "Engineering revision", maxLength: 20, nullable: true },
                { name: "unitOfMeasure", label: "Unit of measure", maxLength: 10 },
                { name: "application", label: "Application", type: "textarea", maxLength: 5000, nullable: true },
                { name: "notes", label: "Notes", type: "textarea", maxLength: 10000, nullable: true },
              ]}
              defaultValues={p as unknown as Record<string, unknown>}
              onSubmit={async (body) => {
                await api(`/products/${id}`, { method: "PATCH", body: { ...body, expectedVersion: p.version } });
                await q.refetch();
              }}
            />
          )
        }
      />
      <div className="grid gap-4 2xl:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          <Tabs defaultValue="sources">
            <TabsList>
              <TabsTrigger value="sources">Supplier sources ({p.supplierProducts.length})</TabsTrigger>
              <TabsTrigger value="approvals">Approvals ({approvalList.length})</TabsTrigger>
              <TabsTrigger value="details">Details & references</TabsTrigger>
              <TabsTrigger value="projects">Projects</TabsTrigger>
              <TabsTrigger value="quality">Quality & changes</TabsTrigger>
              <TabsTrigger value="documents">Documents</TabsTrigger>
            </TabsList>
            <TabsContent value="sources" className="space-y-3">
              {p.supplierProducts.length === 0 && <Card className="p-4 text-muted-foreground">No supplier sources yet. Start a sourcing project to add one.</Card>}
              {p.supplierProducts.map((sp) => (
                <Card key={sp.id}>
                  <CardHeader
                    title={
                      <Link className="text-accent hover:underline" href={`/products/supplier-products/${sp.id}`}>
                        {sp.supplier.name} · {sp.supplierPart.supplierPartNumber} @ {sp.site.siteCode}
                      </Link>
                    }
                    description={`${sp.site.name}${sp.supplierPart.isCustom ? " · custom supplier part number" : ""}`}
                    actions={
                      <>
                        {sp.isPreferred && <Badge tone="info">Preferred</Badge>}
                        <StatusBadge status={sp.status} />
                      </>
                    }
                  />
                  <Table>
                    <THead>
                      <tr>
                        <TH>Configuration</TH>
                        <TH>Type</TH>
                        <TH>Approved revision</TH>
                        <TH>Revisions</TH>
                      </tr>
                    </THead>
                    <TBody>
                      {sp.configurations.map((c) => (
                        <TR key={c.id}>
                          <TD>
                            <span className="font-medium">{c.configCode}</span> {c.name}
                            {c.customPartNumber && <span className="text-xs text-muted-foreground"> · {c.customPartNumber}</span>}
                          </TD>
                          <TD>{humanize(c.configurationType)}</TD>
                          <TD>{c.currentApprovedRevision ? <Link className="text-accent hover:underline" href={`/configurations/revisions/${c.currentApprovedRevision.id}`}>Rev {c.currentApprovedRevision.revisionLabel}</Link> : <span className="text-muted-foreground">None</span>}</TD>
                          <TD className="space-x-1">
                            {c.revisions.map((r) => (
                              <Link key={r.id} href={`/configurations/revisions/${r.id}`} className="inline-flex items-center gap-1 hover:underline">
                                {r.revisionLabel} <StatusBadge status={r.status} />
                              </Link>
                            ))}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </Card>
              ))}
            </TabsContent>
            <TabsContent value="approvals">
              <Card>
                <CardHeader title="Product approvals" description="Explicit approved supplier-product-configuration-site records; superseded approvals are retained." />
                <Table>
                  <THead>
                    <tr>
                      <TH>Approval</TH>
                      <TH>Supplier / site</TH>
                      <TH>Configuration</TH>
                      <TH>Status</TH>
                      <TH>Approved</TH>
                      <TH>Restrictions</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {approvalList.map((a) => (
                      <TR key={a.id}>
                        <TD className="font-medium">{a.number}</TD>
                        <TD>
                          {a.supplierProduct?.supplier.name} @ {a.supplierProduct?.site.siteCode}
                        </TD>
                        <TD>
                          {a.configurationRevision?.configuration.configCode} rev {a.configurationRevision?.revisionLabel}
                        </TD>
                        <TD>
                          <StatusBadge status={a.status} />
                        </TD>
                        <TD>{formatDate(a.approvedAt)}</TD>
                        <TD className="max-w-xs text-xs">{a.restrictions ?? "-"}</TD>
                      </TR>
                    ))}
                    {approvalList.length === 0 && (
                      <TR>
                        <TD colSpan={6} className="text-center text-muted-foreground">No approvals yet.</TD>
                      </TR>
                    )}
                  </TBody>
                </Table>
              </Card>
            </TabsContent>
            <TabsContent value="details" className="space-y-4">
              <Card>
                <CardBody>
                  <DetailGrid
                    items={[
                      { label: "Engineering revision", value: p.engineeringRevision },
                      { label: "Unit of measure", value: p.unitOfMeasure },
                      { label: "Projects", value: p._count.sourcingProjects },
                      { label: "Application", value: p.application, wide: true },
                      { label: "Notes", value: p.notes, wide: true },
                    ]}
                  />
                </CardBody>
              </Card>
              <Card>
                <CardHeader
                  title="OEM references"
                  actions={
                    canWrite && (
                      <FormDialog
                        trigger={<Button size="sm"><Plus /> Add</Button>}
                        title="Add OEM reference"
                        fields={[
                          { name: "oemName", label: "OEM", required: true, maxLength: 120 },
                          { name: "oemPartNumber", label: "OEM part number", required: true, maxLength: 80 },
                          { name: "notes", label: "Notes", type: "textarea", maxLength: 2000 },
                        ]}
                        onSubmit={async (b) => {
                          await api(`/products/${id}/oem-references`, { method: "POST", body: b });
                          await q.refetch();
                        }}
                      />
                    )
                  }
                />
                <ul className="divide-y">
                  {p.oemReferences.map((r) => (
                    <li key={r.id} className="flex items-center gap-2 px-4 py-2">
                      <span className="font-medium">{r.oemName}</span> {r.oemPartNumber}
                      {r.notes && <span className="text-xs text-muted-foreground">· {r.notes}</span>}
                      {canWrite && (
                        <button className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => removeOem.mutate(r.id)} aria-label="Remove reference">
                          <Trash2 className="size-4" />
                        </button>
                      )}
                    </li>
                  ))}
                  {p.oemReferences.length === 0 && <li className="px-4 py-3 text-muted-foreground">No OEM references.</li>}
                </ul>
              </Card>
              <Card>
                <CardHeader title="Supplier part cross-references" />
                <ul className="divide-y">
                  {p.crossReferences.map((x) => (
                    <li key={x.id} className="px-4 py-2">
                      <span className="font-medium">{x.supplierPart.supplierPartNumber}</span> · {x.supplierPart.description} <Badge>{humanize(x.type)}</Badge>
                    </li>
                  ))}
                </ul>
              </Card>
            </TabsContent>
            <TabsContent value="projects">
              <ProjectsTable baseQuery={{ internalPartId: id }} syncUrl={false} filters={false} savedViews={false} />
            </TabsContent>
            <TabsContent value="quality" className="space-y-4">
              <NcrTable baseQuery={{ internalPartId: id }} syncUrl={false} filters={false} savedViews={false} />
              <ChangesTable baseQuery={{ internalPartId: id }} syncUrl={false} filters={false} savedViews={false} />
            </TabsContent>
            <TabsContent value="documents">
              <DocumentsTable baseQuery={{ entityType: "INTERNAL_PART", entityId: id }} syncUrl={false} filters={false} savedViews={false} />
            </TabsContent>
          </Tabs>
        </div>
        <RecordPanel entityType="INTERNAL_PART" entityId={id} />
      </div>
    </>
  );
}
