"use client";

import {
  DOCUMENT_CATEGORY,
  LIFECYCLE_STATUS,
  SOURCING_PATHWAY,
  humanize,
} from "@sqms/shared";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DataTable } from "@/components/data/data-table";
import { FormDialog } from "@/components/forms/schema-form";
import { PageHeader } from "@/components/shell/page-header";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toOptions } from "@/lib/options";
import { useSession } from "@/lib/session";
import { DOC_TYPE_FIELDS, toDocTypePayload } from "./type-fields";

interface TypeRow {
  id: string;
  code: string;
  name: string;
  acronym: string | null;
  category: string;
  origin: string;
  externalStandardRef: string | null;
  responsibleDepartment: string;
  applicablePathways: string[];
  supplierVisibility: string;
  status: string;
  nativeFormKey: string | null;
  documentCount: number;
  currentTemplateRevision: { revisionLabel: string } | null;
}

export default function DocumentTypesPage() {
  const { can } = useSession();
  const router = useRouter();
  return (
    <>
      <PageHeader
        title="Document library"
        description="Controlled catalog of document types: ownership, applicability, approval and retention rules, templates and native forms."
        actions={
          can("document_type:manage") && (
            <FormDialog
              trigger={
                <Button>
                  <Plus /> New document type
                </Button>
              }
              title="New document type"
              wide
              columns={2}
              fields={[
                {
                  name: "code",
                  label: "Code",
                  required: true,
                  placeholder: "OPS-10",
                  pattern: {
                    regex: /^[A-Z]{2,5}-\d{2,3}$/,
                    message: "Code must look like ABC-01",
                  },
                },
                ...DOC_TYPE_FIELDS,
              ]}
              defaultValues={{
                origin: "COMPANY_DEFINED",
                supplierVisibility: "INTERNAL_ONLY",
                allowUpload: true,
                pathwayA: true,
                pathwayB: true,
                pathwayC: true,
              }}
              onSubmit={async (payload) => {
                const created = await api<{ id: string }>("/document-types", {
                  method: "POST",
                  body: { code: payload.code, ...toDocTypePayload(payload) },
                });
                toast.success("Document type created");
                router.push(`/document-types/${created.id}`);
              }}
            />
          )
        }
      />
      <DataTable<TypeRow>
        endpoint="/document-types"
        queryKey="document-types"
        savedViewsModule="document-types"
        searchPlaceholder="Code, name or acronym"
        rowHref={(r) => `/document-types/${r.id}`}
        filters={[
          {
            key: "category",
            label: "Category",
            options: toOptions(DOCUMENT_CATEGORY),
          },
          {
            key: "status",
            label: "Status",
            options: toOptions(LIFECYCLE_STATUS),
          },
          {
            key: "pathway",
            label: "Pathway",
            options: SOURCING_PATHWAY.map((p) => ({
              value: p,
              label: `Pathway ${p}`,
            })),
          },
        ]}
        columns={[
          {
            key: "code",
            header: "Code",
            sortKey: "code",
            cell: (r) => <span className="font-mono text-xs">{r.code}</span>,
          },
          {
            key: "name",
            header: "Name",
            wrap: true,
            sortKey: "name",
            cell: (r) => (
              <span>
                {r.name}{" "}
                {r.acronym && (
                  <span className="text-muted-foreground">({r.acronym})</span>
                )}
              </span>
            ),
          },
          {
            key: "category",
            header: "Category",
            cell: (r) => humanize(r.category),
          },
          {
            key: "origin",
            header: "Origin",
            cell: (r) => (
              <span className="text-xs">
                {humanize(r.origin)}
                {r.externalStandardRef && (
                  <span className="block text-muted-foreground">
                    {r.externalStandardRef}
                  </span>
                )}
              </span>
            ),
          },
          {
            key: "dept",
            header: "Responsible",
            cell: (r) => (
              <span className="text-xs">{r.responsibleDepartment}</span>
            ),
          },
          {
            key: "paths",
            header: "Pathways",
            cell: (r) => (
              <span className="flex gap-0.5">
                {r.applicablePathways.map((p) => (
                  <Badge key={p}>{p}</Badge>
                ))}
              </span>
            ),
          },
          {
            key: "form",
            header: "Submission",
            cell: (r) => (
              <span className="text-xs">
                {r.nativeFormKey ? "Native form" : "Upload"}
                {r.currentTemplateRevision &&
                  ` · template ${r.currentTemplateRevision.revisionLabel}`}
              </span>
            ),
          },
          {
            key: "vis",
            header: "Supplier access",
            cell: (r) => (
              <span className="text-xs">{humanize(r.supplierVisibility)}</span>
            ),
          },
          { key: "docs", header: "Records", cell: (r) => r.documentCount },
          {
            key: "status",
            header: "Status",
            cell: (r) => <StatusBadge status={r.status} />,
          },
        ]}
      />
    </>
  );
}
