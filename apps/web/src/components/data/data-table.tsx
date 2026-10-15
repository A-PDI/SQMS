"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ArrowUpDown, Bookmark, ChevronLeft, ChevronRight, Download, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState, ErrorAlert, Skeleton } from "@/components/ui/feedback";
import { Input, Select, type Option } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { api, csvUrl, errorMessage, type Page } from "@/lib/api";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** API sort field (must be allowed by the endpoint). */
  sortKey?: string;
  className?: string;
}

export interface FilterDef {
  key: string;
  label: string;
  options: Option[];
}

interface Props<T> {
  endpoint: string;
  queryKey: string;
  columns: Column<T>[];
  filters?: FilterDef[];
  /** Fixed query parameters (e.g. scope). */
  baseQuery?: Record<string, unknown>;
  exportPath?: string;
  savedViewsModule?: string;
  rowHref?: (row: T) => string;
  searchPlaceholder?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  toolbar?: ReactNode;
  pageSize?: number;
  /** Keep list state in the URL (default) or locally (for tables embedded in tabs). */
  syncUrl?: boolean;
  compact?: boolean;
}


function DataTableInner<T extends { id: string }>(props: Props<T>) {
  const { endpoint, queryKey, columns, filters = [], baseQuery, exportPath, savedViewsModule, rowHref, searchPlaceholder = "Search", emptyTitle = "No records found", emptyDescription, toolbar } = props;
  const router = useRouter();
  const pathname = usePathname();
  const urlParams = useSearchParams();
  const [localParams, setLocalParams] = useState(() => new URLSearchParams());
  const syncUrl = props.syncUrl !== false;
  const params = syncUrl ? urlParams : localParams;
  const navigate = (sp: URLSearchParams) => {
    if (syncUrl) router.replace(`${pathname}${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
    else setLocalParams(new URLSearchParams(sp));
  };
  const { can } = useSession();
  const qc = useQueryClient();

  const state = useMemo(() => {
    const f: Record<string, string> = {};
    for (const d of filters) {
      const v = params.get(d.key);
      if (v) f[d.key] = v;
    }
    return {
      page: Number(params.get("page") ?? 1) || 1,
      pageSize: Number(params.get("pageSize") ?? props.pageSize ?? 25) || 25,
      q: params.get("q") ?? "",
      sort: params.get("sort") ?? "",
      order: (params.get("order") as "asc" | "desc" | null) ?? undefined,
      filters: f,
    };
  }, [params, filters, props.pageSize]);

  const [search, setSearch] = useState(state.q);
  useEffect(() => setSearch(state.q), [state.q]);

  const update = (patch: Record<string, string | number | undefined | null>, resetPage = true) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null || v === "") sp.delete(k);
      else sp.set(k, String(v));
    }
    if (resetPage && !("page" in patch)) sp.delete("page");
    navigate(sp);
  };

  const query = { ...baseQuery, ...state.filters, page: state.page, pageSize: state.pageSize, q: state.q || undefined, sort: state.sort || undefined, order: state.order };
  const list = useQuery({ queryKey: [queryKey, query, endpoint], queryFn: () => api<Page<T>>(endpoint, { query }), placeholderData: keepPreviousData });

  const views = useQuery({
    queryKey: ["saved-views", savedViewsModule],
    queryFn: () => api<{ id: string; name: string; filters: Record<string, string>; sort: string | null; isShared: boolean; user: { displayName: string } }[]>("/saved-views", { query: { module: savedViewsModule } }),
    enabled: !!savedViewsModule,
  });
  const saveView = useMutation({
    mutationFn: (name: string) => api("/saved-views", { method: "POST", body: { module: savedViewsModule, name, filters: { ...state.filters, ...(state.q ? { q: state.q } : {}) }, sort: state.sort ? `${state.sort}:${state.order ?? "desc"}` : undefined } }),
    onSuccess: () => {
      toast.success("View saved");
      void qc.invalidateQueries({ queryKey: ["saved-views", savedViewsModule] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const applyView = (v: { filters: Record<string, string>; sort: string | null }) => {
    const sp = new URLSearchParams();
    for (const [k, val] of Object.entries(v.filters)) if (val) sp.set(k, String(val));
    if (v.sort) {
      const [s, o] = v.sort.split(":");
      sp.set("sort", s);
      if (o) sp.set("order", o);
    }
    navigate(sp);
  };

  const toggleSort = (key: string) => {
    if (state.sort !== key) update({ sort: key, order: "asc" });
    else update({ sort: key, order: state.order === "asc" ? "desc" : "asc" });
  };

  const activeFilters = Object.keys(state.filters).length + (state.q ? 1 : 0);
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <form
          className="relative w-full max-w-xs"
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: search.trim() });
          }}
        >
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={searchPlaceholder} className="pl-8" aria-label="Search list" />
        </form>
        {filters.map((f) => (
          <Select key={f.key} aria-label={f.label} className="h-9 w-auto min-w-36" value={state.filters[f.key] ?? ""} onChange={(e) => update({ [f.key]: e.target.value })} options={f.options} placeholder={`${f.label}: all`} />
        ))}
        {activeFilters > 0 && (
          <Button variant="ghost" size="sm" onClick={() => navigate(new URLSearchParams())}>
            <X /> Clear
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {toolbar}
          {savedViewsModule && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Bookmark /> Views
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Saved views</DropdownMenuLabel>
                {(views.data ?? []).length === 0 && <DropdownMenuItem disabled>No saved views</DropdownMenuItem>}
                {(views.data ?? []).map((v) => (
                  <DropdownMenuItem key={v.id} onSelect={() => applyView(v)}>
                    {v.name}
                    {v.isShared && <span className="ml-auto text-[10px] text-muted-foreground">shared</span>}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    const name = window.prompt("Name for this view");
                    if (name?.trim()) saveView.mutate(name.trim());
                  }}
                >
                  Save current filters...
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {exportPath && can("report:export") && (
            <Button variant="outline" size="sm" asChild>
              <a href={csvUrl(exportPath, { ...baseQuery, ...state.filters, q: state.q || undefined })} download>
                <Download /> CSV
              </a>
            </Button>
          )}
        </div>
      </div>
      {list.error ? (
        <div className="p-3">
          <ErrorAlert error={list.error} />
        </div>
      ) : (
        <Table>
          <THead>
            <tr>
              {columns.map((c) => (
                <TH key={c.key} className={c.className}>
                  {c.sortKey ? (
                    <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(c.sortKey!)} aria-label={`Sort by ${c.header}`}>
                      {c.header}
                      {state.sort === c.sortKey ? state.order === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
                    </button>
                  ) : (
                    c.header
                  )}
                </TH>
              ))}
            </tr>
          </THead>
          <TBody>
            {list.isLoading &&
              Array.from({ length: 6 }).map((_, i) => (
                <TR key={i}>
                  {columns.map((c) => (
                    <TD key={c.key}>
                      <Skeleton className="h-4 w-full max-w-40" />
                    </TD>
                  ))}
                </TR>
              ))}
            {data?.items.map((row) => (
              <TR key={row.id} className={cn(rowHref && "cursor-pointer")} onClick={rowHref ? (e) => !(e.target as HTMLElement).closest("a,button") && router.push(rowHref(row)) : undefined}>
                {columns.map((c, i) => (
                  <TD key={c.key} className={c.className}>
                    {i === 0 && rowHref ? (
                      <Link href={rowHref(row)} className="font-medium text-accent hover:underline">
                        {c.cell(row)}
                      </Link>
                    ) : (
                      c.cell(row)
                    )}
                  </TD>
                ))}
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {data && data.items.length === 0 && <EmptyState title={emptyTitle} description={activeFilters ? "Try clearing filters or changing the search." : emptyDescription} />}
      {data && data.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
          <span>
            {(data.page - 1) * data.pageSize + 1}-{Math.min(data.total, data.page * data.pageSize)} of {data.total}
            {list.isFetching && " · refreshing"}
          </span>
          <div className="flex items-center gap-2">
            <Select aria-label="Rows per page" className="h-8 w-auto" value={String(state.pageSize)} onChange={(e) => update({ pageSize: e.target.value })} options={["10", "25", "50", "100"].map((v) => ({ value: v, label: `${v} / page` }))} />
            <Button variant="outline" size="icon" disabled={state.page <= 1} onClick={() => update({ page: state.page - 1 }, false)} aria-label="Previous page">
              <ChevronLeft />
            </Button>
            <span>
              Page {state.page} of {pages}
            </span>
            <Button variant="outline" size="icon" disabled={state.page >= pages} onClick={() => update({ page: state.page + 1 }, false)} aria-label="Next page">
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export function DataTable<T extends { id: string }>(props: Props<T>) {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <DataTableInner {...props} />
    </Suspense>
  );
}

export const opts = (values: readonly string[], label?: (v: string) => string): Option[] => values.map((v) => ({ value: v, label: label ? label(v) : v.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }));

