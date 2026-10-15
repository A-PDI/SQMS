"use client";

import { useQuery } from "@tanstack/react-query";
import { statusTone } from "@sqms/shared";
import { Download } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { AsyncPicker, type PickerItem } from "@/components/forms/async-picker";
import { PageHeader } from "@/components/shell/page-header";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorAlert, Skeleton } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { api, csvUrl } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useSession } from "@/lib/session";

type Row = Record<string, unknown> & { id: string };
interface Report {
  key: string;
  title: string;
  generatedAt: string;
  columns: { key: string; header: string }[];
  rows: Row[];
}

/** Where a report row leads (first column becomes a link). */
const ROW_LINKS: Record<string, (r: Row) => string | null> = {
  "approved-suppliers": (r) => `/suppliers/${r.id}`,
  "supplier-scorecard": (r) => `/suppliers/${r.id}`,
  "project-checklists": (r) => `/projects/${r.id}`,
  "expiring-certifications": (r) => `/suppliers/${String(r.supplierId)}`,
  "quality-open-items": (r) => (r.kind === "NCR" ? `/quality/ncrs/${r.id}` : r.kind === "SCAR" ? `/quality/scars/${r.id}` : `/quality/deviations/${r.id}`),
};
const STATUS_KEYS = new Set(["status", "supplierStatus", "severity", "risk"]);

export default function ReportPage() {
  const { key } = useParams<{ key: string }>();
  const { can } = useSession();
  const [supplier, setSupplier] = useState<PickerItem | null>(null);
  const [days, setDays] = useState("90");
  const query = { supplierId: supplier?.id, ...(key === "expiring-certifications" && /^\d+$/.test(days) ? { days: Number(days) } : {}) };
  const q = useQuery({ queryKey: ["report", key, query], queryFn: () => api<Report>(`/reports/${key}`, { query }) });
  const link = ROW_LINKS[key];

  return (
    <>
      <PageHeader
        title={q.data?.title ?? "Report"}
        breadcrumbs={[{ href: "/reports", label: "Reports" }, { label: q.data?.title ?? key }]}
        description={q.data ? `Generated ${formatDateTime(q.data.generatedAt)} · ${q.data.rows.length} rows` : undefined}
        actions={
          can("report:export") && (
            <Button asChild variant="outline">
              <a href={csvUrl(`/reports/${key}/export.csv`, query)} download>
                <Download /> Export CSV
              </a>
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Supplier" className="w-72">
          <AsyncPicker<{ id: string; name: string; supplierNumber: string }> endpoint="/suppliers" value={supplier} onChange={setSupplier} map={(s) => ({ id: s.id, label: s.name, sublabel: s.supplierNumber })} placeholder="All suppliers" />
        </Field>
        {key === "expiring-certifications" && (
          <Field label="Expiring within (days)" htmlFor="rep-days" className="w-44">
            <Input id="rep-days" type="number" min={1} max={730} value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>
        )}
      </div>
      <Card>
        {q.error ? <ErrorAlert error={q.error} className="m-4" /> : null}
        {q.isLoading && <Skeleton className="m-4 h-40" />}
        {q.data && q.data.rows.length === 0 && <EmptyState title="No rows" description="Nothing matches the current filters." />}
        {q.data && q.data.rows.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <tr>
                  {q.data.columns.map((c) => (
                    <TH key={c.key}>{c.header}</TH>
                  ))}
                </tr>
              </THead>
              <TBody>
                {q.data.rows.map((r) => (
                  <TR key={`${r.id}-${String(r.kind ?? "")}`}>
                    {q.data!.columns.map((c, i) => {
                      const v = r[c.key];
                      const text = v === null || v === undefined || v === "" ? "-" : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);
                      const href = i === 0 && link ? link(r) : null;
                      return (
                        <TD key={c.key} className="text-xs">
                          {href ? (
                            <Link className="font-medium text-accent hover:underline" href={href}>
                              {text}
                            </Link>
                          ) : STATUS_KEYS.has(c.key) && typeof v === "string" && statusTone(v) !== "neutral" ? (
                            <StatusBadge status={v} />
                          ) : (
                            text
                          )}
                        </TD>
                      );
                    })}
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </Card>
    </>
  );
}
