"use client";

import { useQuery } from "@tanstack/react-query";
import { humanize } from "@sqms/shared";
import { Search } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { StatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorAlert, Skeleton } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

interface Result {
  type: string;
  id: string;
  title: string;
  subtitle?: string;
  status?: string;
  link: string;
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchResults />
    </Suspense>
  );
}

function SearchResults() {
  const params = useSearchParams();
  const router = useRouter();
  const term = params.get("q")?.trim() ?? "";
  const [input, setInput] = useState(term);
  useEffect(() => setInput(term), [term]);
  const q = useQuery({ queryKey: ["search", term], queryFn: () => api<{ q: string; total: number; results: Result[] }>("/search", { query: { q: term, limit: 20 } }), enabled: term.length >= 2 });
  const groups = new Map<string, Result[]>();
  for (const r of q.data?.results ?? []) groups.set(r.type, [...(groups.get(r.type) ?? []), r]);
  return (
    <>
      <PageHeader title="Search" description="Suppliers, parts, projects, documents, change requests and quality records you are allowed to see." />
      <form
        className="relative mb-4 max-w-xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim().length >= 2) router.push(`/search?q=${encodeURIComponent(input.trim())}`);
        }}
      >
        <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input className="pl-8" value={input} onChange={(e) => setInput(e.target.value)} placeholder="At least 2 characters" aria-label="Search" autoFocus />
      </form>
      {term.length < 2 && <p className="text-muted-foreground">Enter at least two characters.</p>}
      {q.error ? <ErrorAlert error={q.error} /> : null}
      {q.isLoading && term.length >= 2 && <Skeleton className="h-32" />}
      {q.data && q.data.results.length === 0 && (
        <Card>
          <EmptyState title={`No results for "${term}"`} description="Try a part number, supplier name or record number." />
        </Card>
      )}
      <div className="space-y-4">
        {[...groups.entries()].map(([type, rows]) => (
          <Card key={type}>
            <div className="border-b px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {humanize(type.replace(/-/g, "_").toUpperCase())} ({rows.length})
            </div>
            <ul className="divide-y">
              {rows.map((r) => (
                <li key={`${r.type}-${r.id}`} className="flex items-center gap-3 px-4 py-2">
                  <Link href={r.link} className="min-w-0 flex-1 truncate font-medium text-accent hover:underline">
                    {r.title}
                  </Link>
                  {r.subtitle && <span className="hidden truncate text-xs text-muted-foreground sm:block">{r.subtitle}</span>}
                  {r.status && <StatusBadge status={r.status} />}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
