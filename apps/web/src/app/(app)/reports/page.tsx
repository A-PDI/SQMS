"use client";

import { useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { ErrorAlert, Skeleton } from "@/components/ui/feedback";
import { api } from "@/lib/api";

export default function ReportsPage() {
  const q = useQuery({ queryKey: ["reports"], queryFn: () => api<{ key: string; title: string; description: string }[]>("/reports") });
  return (
    <>
      <PageHeader title="Reports" description="Operational reports generated from live data. Every report can be exported to CSV." />
      {q.error ? <ErrorAlert error={q.error} /> : null}
      {q.isLoading && <Skeleton className="h-32" />}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {q.data?.map((r) => (
          <Link key={r.key} href={`/reports/${r.key}`} className="group">
            <Card className="h-full transition-colors group-hover:border-accent">
              <CardBody className="flex gap-3">
                <BarChart3 className="mt-0.5 size-5 shrink-0 text-accent" />
                <div>
                  <p className="font-medium group-hover:text-accent">{r.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{r.description}</p>
                </div>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
