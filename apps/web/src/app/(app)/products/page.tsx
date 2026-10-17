"use client";

import { PART_CRITICALITY, PART_STATUS } from "@sqms/shared";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/data/data-table";
import { FormDialog } from "@/components/forms/schema-form";
import { PageHeader } from "@/components/shell/page-header";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toOptions } from "@/lib/options";
import { useSession } from "@/lib/session";

interface PartRow {
  id: string;
  partNumber: string;
  description: string;
  criticality: string;
  status: string;
  designOwnership: string;
  approvedSourceCount: number;
  openNcrCount: number;
  openChangeCount: number;
}

const PART_FIELDS = [
  {
    name: "partNumber",
    label: "Internal part number",
    required: true,
    minLength: 2,
    maxLength: 60,
  },
  {
    name: "description",
    label: "Description",
    required: true,
    minLength: 2,
    maxLength: 500,
  },
  {
    name: "criticality",
    label: "Criticality",
    type: "select" as const,
    options: toOptions(PART_CRITICALITY),
  },
  {
    name: "designOwnership",
    label: "Design ownership",
    type: "select" as const,
    options: toOptions(["COMPANY", "SUPPLIER", "SHARED"]),
  },
  { name: "engineeringRevision", label: "Engineering revision", maxLength: 20 },
  { name: "unitOfMeasure", label: "Unit of measure", maxLength: 10 },
  {
    name: "application",
    label: "Application",
    type: "textarea" as const,
    maxLength: 5000,
  },
];

export default function ProductsPage() {
  const { can } = useSession();
  const router = useRouter();
  return (
    <>
      <PageHeader
        title="Products"
        description="Internal part master with approved supplier sources and configurations."
        actions={
          can("product:write") && (
            <FormDialog
              trigger={
                <Button>
                  <Plus /> New part
                </Button>
              }
              title="New internal part"
              description="Parts are usually created from the sourcing project wizard; use this for parts without a project."
              fields={PART_FIELDS}
              defaultValues={{ criticality: "MEDIUM", unitOfMeasure: "EA" }}
              onSubmit={async (p) => {
                const part = await api<{ id: string }>("/products", {
                  method: "POST",
                  body: p,
                });
                router.push(`/products/${part.id}`);
              }}
            />
          )
        }
      />
      <DataTable<PartRow>
        tableLabel="Parts"
        endpoint="/products"
        queryKey="products"
        savedViewsModule="products"
        exportPath="/products/export.csv"
        searchPlaceholder="Part number or description"
        rowHref={(r) => `/products/${r.id}`}
        filters={[
          { key: "status", label: "Status", options: toOptions(PART_STATUS) },
          {
            key: "criticality",
            label: "Criticality",
            options: toOptions(PART_CRITICALITY),
          },
        ]}
        columns={[
          {
            key: "pn",
            header: "Part number",
            sortKey: "partNumber",
            className: "font-mono text-xs",
            cell: (r) => r.partNumber,
          },
          {
            key: "desc",
            header: "Description",
            sortKey: "description",
            wrap: true,
            cell: (r) => r.description,
          },
          {
            key: "crit",
            header: "Criticality",
            sortKey: "criticality",
            cell: (r) => <StatusBadge status={r.criticality} />,
          },
          {
            key: "status",
            header: "Status",
            sortKey: "status",
            cell: (r) => <StatusBadge status={r.status} />,
          },
          {
            key: "src",
            header: "Approved sources",
            cell: (r) =>
              r.approvedSourceCount > 0 ? (
                <Badge tone="success">{r.approvedSourceCount}</Badge>
              ) : (
                <span className="text-muted-foreground">0</span>
              ),
          },
          {
            key: "ncr",
            header: "Open NCRs",
            cell: (r) => r.openNcrCount || "-",
          },
          {
            key: "chg",
            header: "Open changes",
            cell: (r) => r.openChangeCount || "-",
          },
        ]}
      />
    </>
  );
}
