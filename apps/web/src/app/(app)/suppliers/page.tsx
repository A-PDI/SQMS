"use client";

import { SUPPLIER_STATUS } from "@sqms/shared";
import { Plus } from "lucide-react";
import Link from "next/link";
import { DataTable } from "@/components/data/data-table";
import { PageHeader } from "@/components/shell/page-header";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { countryName, toOptions } from "@/lib/options";
import { useSession } from "@/lib/session";

interface SupplierRow {
  id: string;
  supplierNumber: string;
  name: string;
  country: string;
  status: string;
  siteCount: number;
  approvedProductCount: number;
  openNcrCount: number;
  pendingChangeCount: number;
  openScarCount: number;
  nextCertificationExpiry: { standard: string; expiresAt: string } | null;
}

export default function SuppliersPage() {
  const { can } = useSession();
  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Supplier master, sites, certifications and qualification status."
        actions={
          can("supplier:write") && (
            <Button asChild>
              <Link href="/suppliers/new">
                <Plus /> New supplier
              </Link>
            </Button>
          )
        }
      />
      <DataTable<SupplierRow>
        endpoint="/suppliers"
        queryKey="suppliers"
        savedViewsModule="suppliers"
        exportPath="/suppliers/export.csv"
        searchPlaceholder="Name, number, DUNS"
        rowHref={(r) => `/suppliers/${r.id}`}
        filters={[{ key: "status", label: "Status", options: toOptions(SUPPLIER_STATUS) }]}
        columns={[
          { key: "name", header: "Supplier", sortKey: "name", cell: (r) => r.name },
          { key: "number", header: "Number", sortKey: "supplierNumber", cell: (r) => <span className="font-mono text-xs">{r.supplierNumber}</span> },
          { key: "status", header: "Status", sortKey: "status", cell: (r) => <StatusBadge status={r.status} /> },
          { key: "country", header: "Country", sortKey: "country", cell: (r) => countryName(r.country) },
          { key: "sites", header: "Sites", cell: (r) => r.siteCount },
          { key: "approved", header: "Approved products", cell: (r) => r.approvedProductCount },
          {
            key: "quality",
            header: "Open quality items",
            cell: (r) => (
              <span className="flex gap-1">
                {r.openNcrCount > 0 && <Badge tone="warning">{r.openNcrCount} NCR</Badge>}
                {r.openScarCount > 0 && <Badge tone="pending">{r.openScarCount} SCAR</Badge>}
                {r.pendingChangeCount > 0 && <Badge tone="info">{r.pendingChangeCount} change</Badge>}
                {!r.openNcrCount && !r.openScarCount && !r.pendingChangeCount && <span className="text-muted-foreground">-</span>}
              </span>
            ),
          },
          { key: "cert", header: "Next certificate expiry", cell: (r) => (r.nextCertificationExpiry ? `${r.nextCertificationExpiry.standard} · ${formatDate(r.nextCertificationExpiry.expiresAt)}` : "-") },
        ]}
      />
    </>
  );
}
