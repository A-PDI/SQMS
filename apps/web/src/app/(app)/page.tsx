"use client";

import { useQuery } from "@tanstack/react-query";
import { humanize } from "@sqms/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ErrorAlert, PageLoading } from "@/components/ui/feedback";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useSession } from "@/lib/session";

interface Dashboard {
  generatedAt: string;
  myWork: { tasksOpen: number; tasksOverdue: number; approvalsPending: number };
  projects: { byStatus: Record<string, number>; byStage: Record<string, number>; overdueRequirements: number };
  suppliers: { byStatus: Record<string, number>; certificationsExpiring60Days: number };
  quality: { openNcrsBySeverity: Record<string, number>; scarsOpen: number; scarsOverdue: number; deviationsOpen: number };
  changes: { byStatus: Record<string, number> };
  documents: { inReview: number };
  approvals: { productApprovalsLast30Days: number };
  recentActivity: { id: string; entityType: string; entityLabel: string | null; summary: string; actorName: string | null; occurredAt: string }[];
}

function Stat({ label, value, href, tone }: { label: string; value: number; href?: string; tone?: "danger" | "warning" }) {
  const body = (
    <Card className="h-full p-4 transition-colors hover:border-accent">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone === "danger" && value > 0 ? "text-destructive" : tone === "warning" && value > 0 ? "text-warning" : ""}`}>{value}</p>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function Breakdown({ title, data, href }: { title: string; data: Record<string, number>; href: string }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  return (
    <Card>
      <CardHeader title={title} actions={<Link href={href} className="text-xs text-accent hover:underline">View all</Link>} />
      <CardBody className="space-y-2">
        {entries.length === 0 && <p className="text-xs text-muted-foreground">Nothing to show.</p>}
        {entries.map(([k, v]) => (
          <div key={k}>
            <div className="flex justify-between text-xs">
              <span>{humanize(k)}</span>
              <span className="font-medium">{v}</span>
            </div>
            <div className="mt-1 h-1.5 rounded bg-muted">
              <div className="h-1.5 rounded bg-accent" style={{ width: `${total ? Math.max(4, (v / total) * 100) : 0}%` }} />
            </div>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

export default function DashboardPage() {
  const { me, isInternal } = useSession();
  const router = useRouter();
  // Supplier users land on the supplier portal; the internal dashboard is never requested for them.
  useEffect(() => {
    if (!isInternal) router.replace("/portal");
  }, [isInternal, router]);
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dashboard>("/dashboard"), refetchInterval: 120_000, enabled: isInternal });
  if (!isInternal || q.isLoading) return <PageLoading />;
  if (q.error || !q.data) return <ErrorAlert error={q.error} />;
  const d = q.data;
  const ncrs = Object.values(d.quality.openNcrsBySeverity).reduce((a, b) => a + b, 0);
  return (
    <>
      <PageHeader title={`Welcome, ${me.displayName.split(" ")[0]}`} description={`Operational overview · updated ${formatDateTime(d.generatedAt)}`} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="My open tasks" value={d.myWork.tasksOpen} href="/tasks" />
        <Stat label="My overdue tasks" value={d.myWork.tasksOverdue} href="/tasks?overdue=true" tone="danger" />
        <Stat label="Approvals waiting on me" value={d.myWork.approvalsPending} href="/approvals" tone="warning" />
        <Stat label="Documents in review" value={d.documents.inReview} href="/documents?status=IN_REVIEW" />
        <Stat label="Overdue checklist items" value={d.projects.overdueRequirements} href="/reports/project-checklists" tone="danger" />
        <Stat label="Certificates expiring (60 d)" value={d.suppliers.certificationsExpiring60Days} href="/reports/expiring-certifications" tone="warning" />
        <Stat label="Open NCRs" value={ncrs} href="/quality/ncrs?open=true" tone="warning" />
        <Stat label="Open SCARs" value={d.quality.scarsOpen} href="/quality/scars" />
        <Stat label="Overdue SCAR responses" value={d.quality.scarsOverdue} href="/quality/scars?overdue=true" tone="danger" />
        <Stat label="Active deviations" value={d.quality.deviationsOpen} href="/quality/deviations" />
        <Stat label="Product approvals (30 d)" value={d.approvals.productApprovalsLast30Days} href="/reports/product-approvals" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Breakdown title="Sourcing projects by stage" data={d.projects.byStage} href="/projects" />
        <Breakdown title="Change requests" data={d.changes.byStatus} href="/changes" />
        <Breakdown title="Suppliers by status" data={d.suppliers.byStatus} href="/suppliers" />
      </div>
      <Card className="mt-4">
        <CardHeader title="Recent activity" />
        <ul className="divide-y">
          {d.recentActivity.map((a) => (
            <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2">
              <span>
                <span className="font-medium">{a.entityLabel ?? humanize(a.entityType)}</span> <span className="text-muted-foreground">· {a.summary}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {a.actorName ?? "System"} · {formatDateTime(a.occurredAt)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
