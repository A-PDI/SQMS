"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { StatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Alert, ErrorAlert, PageLoading } from "@/components/ui/feedback";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

interface Overview {
  supplier: { id: string; name: string; supplierNumber: string; status: string } | null;
  tasks: number;
  scarsAwaiting: number;
  scarsOverdue: number;
  changesOpen: number;
  ncrsOpen: number;
  documentsShared: number;
  deviationsOpen: number;
}

function Tile({ label, value, href, alert }: { label: string; value: number; href: string; alert?: boolean }) {
  return (
    <Link href={href}>
      <Card className="h-full p-4 transition-colors hover:border-accent">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-semibold ${alert && value > 0 ? "text-destructive" : ""}`}>{value}</p>
      </Card>
    </Link>
  );
}

/** Supplier portal home (Phase 2). Data is limited server-side to the signed-in user's supplier. */
export default function PortalPage() {
  const { isInternal, me } = useSession();
  const q = useQuery({ queryKey: ["portal-overview"], queryFn: () => api<Overview>("/portal/overview"), enabled: !isInternal });
  if (isInternal) return <Alert title="Supplier portal">This page is the home page for supplier users. Internal users work from the dashboard.</Alert>;
  if (q.isLoading) return <PageLoading />;
  if (q.error || !q.data) return <ErrorAlert error={q.error} />;
  const o = q.data;
  return (
    <>
      <PageHeader title={o.supplier?.name ?? me.organization.name} description={o.supplier ? `Supplier ${o.supplier.supplierNumber}` : undefined} meta={o.supplier && <StatusBadge status={o.supplier.status} />} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Open tasks" value={o.tasks} href="/tasks" />
        <Tile label="Corrective actions awaiting response" value={o.scarsAwaiting} href="/quality/scars" />
        <Tile label="Overdue responses" value={o.scarsOverdue} href="/quality/scars?overdue=true" alert />
        <Tile label="Open nonconformances" value={o.ncrsOpen} href="/quality/ncrs?open=true" />
        <Tile label="Open change requests" value={o.changesOpen} href="/changes" />
        <Tile label="Deviation requests in progress" value={o.deviationsOpen} href="/quality/deviations" />
        <Tile label="Documents shared with you" value={o.documentsShared} href="/documents" />
      </div>
    </>
  );
}
