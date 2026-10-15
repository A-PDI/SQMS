"use client";

import { useQuery } from "@tanstack/react-query";
import { BASELINE_TYPE, CHARACTERISTIC_CLASS, REQUIREMENT_CATEGORY, humanize } from "@sqms/shared";
import { CheckCircle2, FileCog, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ActionDialog } from "@/components/common/action-dialog";
import { RecordPanel } from "@/components/common/collaboration";
import { DetailGrid } from "@/components/common/detail-grid";
import { FormDialog, type FieldSpec } from "@/components/forms/schema-form";
import { PageHeader } from "@/components/shell/page-header";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, ErrorAlert, PageLoading } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useApiMutation } from "@/lib/hooks";
import { toOptions } from "@/lib/options";
import { useSession } from "@/lib/session";

type Baseline = Record<string, string | null> & { status: string; baselineType: string; designOwnership: string; acceptedAt: string | null };
interface Requirement {
  id: string;
  code: string;
  category: string;
  title: string;
  baselineValue: string | null;
  requiredValue: string;
  acceptanceCriteria: string;
  rationale: string | null;
  isModification: boolean;
  ackStatus: string;
  ackByName: string | null;
  ackAt: string | null;
  ackNote: string | null;
  verificationStatus: string;
  verificationNote: string | null;
  verifiedAt: string | null;
}
interface Characteristic {
  id: string;
  charNumber: string;
  name: string;
  classification: string;
  source: string;
  nominal: string | number | null;
  tolerancePlus: string | number | null;
  toleranceMinus: string | number | null;
  unit: string | null;
  specification: string | null;
  measurementMethod: string | null;
  inspectionFrequency: string | null;
  acceptanceCriteria: string | null;
}
interface Revision {
  id: string;
  revisionLabel: string;
  status: string;
  description: string | null;
  changeSummary: string | null;
  supplierProductRevision: string | null;
  approvedAt: string | null;
  supersededAt: string | null;
  version: number;
  createdAt: string;
  configuration: {
    id: string;
    configCode: string;
    name: string;
    configurationType: string;
    customPartNumber: string | null;
    currentApprovedRevisionId: string | null;
    supplierProduct: { id: string; internalPart: { id: string; partNumber: string; description: string }; supplier: { id: string; name: string }; supplierPart: { supplierPartNumber: string }; site: { siteCode: string; name: string } };
    baseConfiguration: { id: string; configCode: string; name: string; currentApprovedRevisionId: string | null } | null;
  };
  baseline: Baseline | null;
  requirements: Requirement[];
  characteristics: Characteristic[];
  derivedFrom: { id: string; revisionLabel: string; status: string } | null;
  supersededBy: { id: string; revisionLabel: string } | null;
  productApproval: { id: string; number: string; status: string } | null;
  qualifications: { id: string; number: string; status: string }[];
  changeRequestsProposed: { id: string; number: string; status: string }[];
  changeRequestsCurrent: { id: string; number: string; status: string }[];
}

const BASELINE_FIELDS: FieldSpec[] = [
  { name: "baselineType", label: "Baseline type", type: "select", options: toOptions(BASELINE_TYPE) },
  { name: "designOwnership", label: "Design ownership", type: "select", options: toOptions(["COMPANY", "SUPPLIER", "SHARED"]) },
  { name: "drawingNumber", label: "Drawing number", maxLength: 80, nullable: true },
  { name: "drawingRevision", label: "Drawing revision", maxLength: 20, nullable: true },
  { name: "specificationNumber", label: "Specification number", maxLength: 80, nullable: true },
  { name: "specificationRevision", label: "Specification revision", maxLength: 20, nullable: true },
  { name: "material", label: "Material", maxLength: 200, nullable: true },
  { name: "materialSpecification", label: "Material specification", maxLength: 200, nullable: true },
  { name: "coating", label: "Coating", maxLength: 200, nullable: true },
  { name: "coatingSpecification", label: "Coating specification", maxLength: 200, nullable: true },
  { name: "heatTreatment", label: "Heat treatment", maxLength: 200, nullable: true },
  { name: "surfaceFinish", label: "Surface finish", maxLength: 200, nullable: true },
  { name: "generalTolerances", label: "General tolerances", maxLength: 200, nullable: true },
  { name: "reverseEngineeringSource", label: "Reverse engineering source sample", maxLength: 500, nullable: true },
  { name: "keyDimensions", label: "Key dimensions", type: "textarea", maxLength: 10000, nullable: true },
  { name: "performanceRequirements", label: "Performance requirements", type: "textarea", maxLength: 10000, nullable: true },
  { name: "operatingRequirements", label: "Operating requirements", type: "textarea", maxLength: 10000, nullable: true },
  { name: "guaranteedCharacteristics", label: "Guaranteed characteristics", type: "textarea", maxLength: 10000, nullable: true },
  { name: "notes", label: "Notes", type: "textarea", maxLength: 10000, nullable: true },
];
const REQ_FIELDS: FieldSpec[] = [
  { name: "category", label: "Category", type: "select", required: true, options: toOptions(REQUIREMENT_CATEGORY) },
  { name: "title", label: "Title", required: true, minLength: 3, maxLength: 250 },
  { name: "baselineValue", label: "Supplier baseline value", maxLength: 2000, nullable: true },
  { name: "requiredValue", label: "Required value", required: true, maxLength: 2000 },
  { name: "acceptanceCriteria", label: "Acceptance criteria", type: "textarea", required: true, maxLength: 5000 },
  { name: "rationale", label: "Rationale", type: "textarea", maxLength: 5000, nullable: true },
  { name: "isModification", label: "Modification of the supplier standard", type: "checkbox" },
];
const CHAR_FIELDS: FieldSpec[] = [
  { name: "name", label: "Characteristic", required: true, maxLength: 200 },
  { name: "classification", label: "Classification", type: "select", required: true, options: toOptions(CHARACTERISTIC_CLASS) },
  { name: "nominal", label: "Nominal", type: "number" },
  { name: "tolerancePlus", label: "Tolerance +", type: "number" },
  { name: "toleranceMinus", label: "Tolerance -", type: "number" },
  { name: "unit", label: "Unit", maxLength: 20, nullable: true },
  { name: "specification", label: "Specification", maxLength: 500, nullable: true },
  { name: "measurementMethod", label: "Measurement method", maxLength: 500, nullable: true },
  { name: "inspectionFrequency", label: "Inspection frequency", maxLength: 200, nullable: true },
  { name: "acceptanceCriteria", label: "Acceptance criteria", type: "textarea", maxLength: 5000, nullable: true },
];

const num = (v: string | number | null) => (v === null || v === "" ? null : Number(v));

export default function RevisionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useSession();
  const key = ["config-revision", id];
  const q = useQuery({ queryKey: key, queryFn: () => api<Revision>(`/product-configurations/revisions/${id}`) });
  const del = useApiMutation((path: string) => api(path, { method: "DELETE" }), { invalidate: [key], success: "Removed" });
  const accept = useApiMutation((version: number) => api(`/product-configurations/revisions/${id}/baseline/accept`, { method: "POST", body: { expectedVersion: version } }), { invalidate: [key], success: "Baseline accepted" });
  const generate = useApiMutation((kind: string) => api<{ document: { id: string } }>("/documents/generate", { method: "POST", body: { kind, configurationRevisionId: id } }), { success: "Document generated", onSuccess: (r) => router.push(`/documents/${r.document.id}`) });

  if (q.isLoading) return <PageLoading />;
  if (q.error || !q.data) return <ErrorAlert error={q.error} />;
  const r = q.data;
  const c = r.configuration;
  const sp = c.supplierProduct;
  const editable = ["DRAFT", "PROPOSED"].includes(r.status) && can("configuration:write");
  const authorized = c.currentApprovedRevisionId === r.id;
  const refresh = () => q.refetch();

  return (
    <>
      <PageHeader
        title={`${c.configCode} rev ${r.revisionLabel}`}
        breadcrumbs={[{ href: "/products", label: "Products" }, { href: `/products/${sp.internalPart.id}`, label: sp.internalPart.partNumber }, { href: `/products/supplier-products/${sp.id}`, label: `${sp.supplier.name} @ ${sp.site.siteCode}` }, { label: `${c.configCode} rev ${r.revisionLabel}` }]}
        description={`${c.name} · ${humanize(c.configurationType)}${c.customPartNumber ? ` · supplier PN ${c.customPartNumber}` : ` · supplier PN ${sp.supplierPart.supplierPartNumber}`}`}
        meta={
          <>
            <StatusBadge status={r.status} />
            {authorized && <Badge tone="success">Authorized configuration</Badge>}
            {r.derivedFrom && (
              <span>
                Derived from{" "}
                <Link className="text-accent hover:underline" href={`/configurations/revisions/${r.derivedFrom.id}`}>
                  rev {r.derivedFrom.revisionLabel}
                </Link>
              </span>
            )}
            {r.supersededBy && (
              <span>
                Superseded by{" "}
                <Link className="text-accent hover:underline" href={`/configurations/revisions/${r.supersededBy.id}`}>
                  rev {r.supersededBy.revisionLabel}
                </Link>
              </span>
            )}
            {c.baseConfiguration && <span className="text-muted-foreground">Base: {c.baseConfiguration.configCode} {c.baseConfiguration.name}</span>}
          </>
        }
        actions={
          <>
            {can("document:write", "configuration:write") && (
              <>
                <Button variant="outline" size="sm" onClick={() => generate.mutate("SBPS")} loading={generate.isPending && generate.variables === "SBPS"}>
                  <FileCog /> ENG-04 baseline
                </Button>
                {r.requirements.length > 0 && (
                  <Button variant="outline" size="sm" onClick={() => generate.mutate("DELTA_SPEC")} loading={generate.isPending && generate.variables === "DELTA_SPEC"}>
                    <FileCog /> ENG-06 delta spec
                  </Button>
                )}
                {r.characteristics.length > 0 && (
                  <Button variant="outline" size="sm" onClick={() => generate.mutate("CCM")} loading={generate.isPending && generate.variables === "CCM"}>
                    <FileCog /> ENG-08 characteristics
                  </Button>
                )}
              </>
            )}
            {r.status === "APPROVED" && can("configuration:write") && (
              <ActionDialog
                trigger={<Button size="sm">New revision</Button>}
                title="Create a new revision"
                description="Copies this definition into a new draft revision. The authorized revision is not modified. Supplier-initiated changes should use a change request."
                reasonLabel="Change summary"
                confirmLabel="Create revision"
                onConfirm={async (summary) => {
                  const rev = await api<{ id: string }>(`/product-configurations/${c.id}/revisions`, { method: "POST", body: { changeSummary: summary } });
                  router.push(`/configurations/revisions/${rev.id}`);
                }}
              />
            )}
            {editable && r.changeRequestsProposed.length === 0 && (
              <ActionDialog
                trigger={<Button size="sm" variant="outline">Withdraw</Button>}
                title="Withdraw revision"
                reasonLabel="Reason"
                confirmVariant="destructive"
                confirmLabel="Withdraw"
                onConfirm={async (reason) => {
                  await api(`/product-configurations/revisions/${id}/withdraw`, { method: "POST", body: { reason } });
                  await refresh();
                }}
              />
            )}
          </>
        }
      />
      {!editable && ["DRAFT", "PROPOSED"].includes(r.status) === false && (
        <Alert tone="info" className="mb-4">
          This revision is {humanize(r.status).toLowerCase()} and controlled; its definition cannot be edited. {authorized && "Create a new revision or a change request to modify it."}
        </Alert>
      )}
      {(r.changeRequestsProposed.length > 0 || r.qualifications.length > 0) && (
        <div className="mb-4 flex flex-wrap gap-2 text-xs">
          {r.changeRequestsProposed.map((x) => (
            <Link key={x.id} href={`/changes/${x.id}`} className="rounded border bg-surface px-2 py-1 hover:border-accent">
              Proposed by {x.number} <StatusBadge status={x.status} />
            </Link>
          ))}
          {r.qualifications.map((x) => (
            <Link key={x.id} href={`/qualifications/${x.id}`} className="rounded border bg-surface px-2 py-1 hover:border-accent">
              Qualification {x.number} <StatusBadge status={x.status} />
            </Link>
          ))}
        </div>
      )}
      <div className="grid gap-4 2xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader
              title="Engineering baseline / product definition"
              description="Engineering acceptance is required before product approval."
              actions={
                <>
                  {r.baseline && <StatusBadge status={r.baseline.status} />}
                  {editable && (
                    <FormDialog
                      wide
                      trigger={
                        <Button size="sm" variant="outline">
                          <Pencil /> Edit
                        </Button>
                      }
                      title="Edit baseline"
                      description="Editing withdraws any existing engineering acceptance."
                      fields={BASELINE_FIELDS}
                      defaultValues={r.baseline ?? {}}
                      onSubmit={async (b) => {
                        await api(`/product-configurations/revisions/${id}/baseline`, { method: "PUT", body: { ...b, expectedVersion: r.version } });
                        await refresh();
                      }}
                    />
                  )}
                  {editable && r.baseline && r.baseline.status !== "ACCEPTED" && (
                    <Button size="sm" onClick={() => accept.mutate(r.version)} loading={accept.isPending}>
                      <CheckCircle2 /> Accept baseline
                    </Button>
                  )}
                </>
              }
            />
            <CardBody>
              {r.baseline ? (
                <DetailGrid
                  items={[
                    { label: "Baseline type", value: humanize(r.baseline.baselineType) },
                    { label: "Design ownership", value: humanize(r.baseline.designOwnership) },
                    { label: "Accepted", value: r.baseline.acceptedAt ? formatDateTime(r.baseline.acceptedAt) : null },
                    ...BASELINE_FIELDS.slice(2).map((f) => ({ label: f.label, value: r.baseline?.[f.name] ?? null, wide: f.type === "textarea" })),
                  ].filter((i) => i.value !== null && i.value !== undefined && i.value !== "")}
                />
              ) : (
                <p className="text-muted-foreground">No baseline recorded.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Customer-specific (delta) requirements"
              description="Each requirement needs written supplier acknowledgment and verification evidence before approval."
              actions={
                editable && (
                  <FormDialog
                    wide
                    trigger={
                      <Button size="sm">
                        <Plus /> Requirement
                      </Button>
                    }
                    title="Add requirement"
                    fields={REQ_FIELDS}
                    defaultValues={{ isModification: true }}
                    onSubmit={async (b) => {
                      await api(`/product-configurations/revisions/${id}/requirements`, { method: "POST", body: b });
                      await refresh();
                    }}
                  />
                )
              }
            />
            <Table>
              <THead>
                <tr>
                  <TH>Code</TH>
                  <TH>Requirement</TH>
                  <TH>Baseline → required</TH>
                  <TH>Supplier acknowledgment</TH>
                  <TH>Verification</TH>
                  <TH />
                </tr>
              </THead>
              <TBody>
                {r.requirements.map((req) => (
                  <TR key={req.id}>
                    <TD className="font-mono text-xs">{req.code}</TD>
                    <TD className="min-w-56 max-w-sm">
                      <p className="font-medium">{req.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {humanize(req.category)} · Acceptance: {req.acceptanceCriteria}
                      </p>
                    </TD>
                    <TD className="max-w-xs text-xs">
                      <span className="text-muted-foreground">{req.baselineValue ?? "-"}</span> → <span className="font-medium">{req.requiredValue}</span>
                    </TD>
                    <TD className="text-xs">
                      <StatusBadge status={req.ackStatus} />
                      {req.ackByName && <p className="mt-0.5">{req.ackByName}</p>}
                      {req.ackAt && <p className="text-muted-foreground">{formatDateTime(req.ackAt)}</p>}
                    </TD>
                    <TD className="text-xs">
                      <StatusBadge status={req.verificationStatus} />
                      {req.verificationNote && <p className="mt-0.5">{req.verificationNote}</p>}
                    </TD>
                    <TD className="whitespace-nowrap text-right">
                      {editable && (
                        <>
                          <FormDialog
                            trigger={<Button size="sm" variant="ghost">Acknowledge</Button>}
                            title={`Supplier acknowledgment · ${req.code}`}
                            description="Record the supplier's written acknowledgment of this requirement."
                            fields={[
                              { name: "status", label: "Response", type: "select", required: true, options: toOptions(["ACKNOWLEDGED", "DECLINED"]) },
                              { name: "acknowledgedByName", label: "Supplier representative", required: true, maxLength: 160 },
                              { name: "note", label: "Note", type: "textarea", maxLength: 5000 },
                            ]}
                            defaultValues={{ status: "ACKNOWLEDGED" }}
                            onSubmit={async (b) => {
                              await api(`/product-configurations/requirements/${req.id}/acknowledge`, { method: "POST", body: b });
                              await refresh();
                            }}
                          />
                          <FormDialog
                            trigger={<Button size="sm" variant="ghost">Verify</Button>}
                            title={`Verification · ${req.code}`}
                            fields={[
                              { name: "status", label: "Result", type: "select", required: true, options: toOptions(["VERIFIED", "FAILED", "WAIVED"]) },
                              { name: "note", label: "Evidence / note", type: "textarea", required: true, minLength: 3, maxLength: 5000 },
                            ]}
                            defaultValues={{ status: "VERIFIED" }}
                            onSubmit={async (b) => {
                              await api(`/product-configurations/requirements/${req.id}/verify`, { method: "POST", body: b });
                              await refresh();
                            }}
                          />
                          <FormDialog
                            wide
                            trigger={
                              <Button size="icon" variant="ghost" aria-label="Edit requirement">
                                <Pencil />
                              </Button>
                            }
                            title={`Edit ${req.code}`}
                            description="Changing the content resets acknowledgment and verification."
                            fields={REQ_FIELDS}
                            defaultValues={req as unknown as Record<string, unknown>}
                            onSubmit={async (b) => {
                              await api(`/product-configurations/requirements/${req.id}`, { method: "PATCH", body: b });
                              await refresh();
                            }}
                          />
                          <Button size="icon" variant="ghost" aria-label="Delete requirement" onClick={() => del.mutate(`/product-configurations/requirements/${req.id}`)}>
                            <Trash2 />
                          </Button>
                        </>
                      )}
                    </TD>
                  </TR>
                ))}
                {r.requirements.length === 0 && (
                  <TR>
                    <TD colSpan={6} className="text-center text-muted-foreground">No delta requirements.</TD>
                  </TR>
                )}
              </TBody>
            </Table>
          </Card>

          <Card>
            <CardHeader
              title="Critical characteristics"
              actions={
                editable && (
                  <FormDialog
                    wide
                    trigger={
                      <Button size="sm">
                        <Plus /> Characteristic
                      </Button>
                    }
                    title="Add characteristic"
                    fields={CHAR_FIELDS}
                    defaultValues={{ classification: "MAJOR" }}
                    onSubmit={async (b) => {
                      await api(`/product-configurations/revisions/${id}/characteristics`, { method: "POST", body: b });
                      await refresh();
                    }}
                  />
                )
              }
            />
            <Table>
              <THead>
                <tr>
                  <TH>No.</TH>
                  <TH>Characteristic</TH>
                  <TH>Class</TH>
                  <TH>Nominal / tolerance</TH>
                  <TH>Method</TH>
                  <TH />
                </tr>
              </THead>
              <TBody>
                {r.characteristics.map((ch) => (
                  <TR key={ch.id}>
                    <TD className="font-mono text-xs">{ch.charNumber}</TD>
                    <TD>
                      {ch.name}
                      {ch.specification && <p className="text-xs text-muted-foreground">{ch.specification}</p>}
                    </TD>
                    <TD>
                      <StatusBadge status={ch.classification} />
                    </TD>
                    <TD className="text-xs">
                      {ch.nominal !== null ? `${ch.nominal} ${ch.unit ?? ""}` : "-"} {ch.tolerancePlus !== null && `+${ch.tolerancePlus}`} {ch.toleranceMinus !== null && `/ -${ch.toleranceMinus}`}
                    </TD>
                    <TD className="text-xs">{[ch.measurementMethod, ch.inspectionFrequency].filter(Boolean).join(" · ") || "-"}</TD>
                    <TD className="whitespace-nowrap text-right">
                      {editable && (
                        <>
                          <FormDialog
                            wide
                            trigger={
                              <Button size="icon" variant="ghost" aria-label="Edit characteristic">
                                <Pencil />
                              </Button>
                            }
                            title={`Edit ${ch.charNumber}`}
                            fields={CHAR_FIELDS}
                            defaultValues={{ ...ch, nominal: num(ch.nominal), tolerancePlus: num(ch.tolerancePlus), toleranceMinus: num(ch.toleranceMinus) }}
                            onSubmit={async (b) => {
                              await api(`/product-configurations/characteristics/${ch.id}`, { method: "PATCH", body: b });
                              await refresh();
                            }}
                          />
                          <Button size="icon" variant="ghost" aria-label="Delete characteristic" onClick={() => del.mutate(`/product-configurations/characteristics/${ch.id}`)}>
                            <Trash2 />
                          </Button>
                        </>
                      )}
                    </TD>
                  </TR>
                ))}
                {r.characteristics.length === 0 && (
                  <TR>
                    <TD colSpan={6} className="text-center text-muted-foreground">No characteristics identified.</TD>
                  </TR>
                )}
              </TBody>
            </Table>
          </Card>
        </div>
        <RecordPanel entityType="CONFIGURATION_REVISION" entityId={id} />
      </div>
    </>
  );
}
