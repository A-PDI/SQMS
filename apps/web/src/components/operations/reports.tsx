"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api, downloadReport } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApiMutation } from "@/lib/hooks";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { ErrorAlert } from "@/components/ui/feedback";
import type { Plan } from "./incoming";
type Data = Record<string, any>;
export function InspectionReports() {
  const { can } = useSession();
  const [filters, setFilters] = useState<Record<string, string>>({
    groupBy: "component",
  });
  const [name, setName] = useState("");
  const query = Object.fromEntries(
    Object.entries(filters).filter(([, v]) => v),
  );
  const report = useQuery({
    queryKey: ["inspection-report", filters],
    queryFn: () => api<Data>("/inspection-reports", { query }),
  });
  const plans = useQuery({
    queryKey: ["inspection-plans"],
    queryFn: () => api<Plan[]>("/inspection-plans"),
  });
  const views = useQuery({
    queryKey: ["saved-views", "inspection-reports"],
    queryFn: () =>
      api<Data[]>("/saved-views", { query: { module: "inspection-reports" } }),
  });
  const save = useApiMutation(
    () =>
      api("/saved-views", {
        method: "POST",
        body: { name, module: "inspection-reports", filters: query },
      }),
    {
      invalidate: [["saved-views", "inspection-reports"]],
      onSuccess: () => setName(""),
      success: "Report filters saved",
    },
  );
  const remove = useApiMutation(
    (id: string) => api(`/saved-views/${id}`, { method: "DELETE" }),
    { invalidate: [["saved-views", "inspection-reports"]] },
  );
  const download = useApiMutation((format: string) =>
    downloadReport(
      "/inspection-reports/export",
      { ...query, format },
      `InspectionReport.${format}`,
    ),
  );
  const change = (key: string, value: string) =>
    setFilters((f) => ({ ...f, [key]: value }));
  return (
    <>
      <PageHeader
        title="Inspection reports"
        description="Custom summaries, detailed exports and saved report filters. Dates filter inspection creation in UTC."
        actions={
          <Link href="/incoming">
            <Button variant="outline">Incoming inspections</Button>
          </Link>
        }
      />
      <div className="mb-5 grid gap-3 md:grid-cols-3">
        <Field label="From">
          <Input
            type="date"
            value={filters.dateFrom || ""}
            onChange={(e) => change("dateFrom", e.target.value)}
          />
        </Field>
        <Field label="Through">
          <Input
            type="date"
            value={filters.dateTo || ""}
            onChange={(e) => change("dateTo", e.target.value)}
          />
        </Field>
        <Field label="Group by">
          <Select
            value={filters.groupBy || "all"}
            onChange={(e) => change("groupBy", e.target.value)}
            options={[
              "all",
              "component",
              "disposition",
              "status",
              "month",
              "week",
              "assignee",
            ].map((value) => ({ value, label: value }))}
          />
        </Field>
        <Field label="Plan">
          <Select
            value={filters.planId || ""}
            onChange={(e) => change("planId", e.target.value)}
            placeholder="All plans"
            options={(plans.data ?? []).map((p) => ({
              value: p.id,
              label: `${p.code} · ${p.title}`,
            }))}
          />
        </Field>
        <Field label="Status">
          <Select
            value={filters.status || ""}
            onChange={(e) => change("status", e.target.value)}
            placeholder="All statuses"
            options={["DRAFT", "IN_PROGRESS", "COMPLETE", "ARCHIVED"].map(
              (value) => ({ value, label: value.replaceAll("_", " ") }),
            )}
          />
        </Field>
        <Field label="Disposition">
          <Select
            value={filters.disposition || ""}
            onChange={(e) => change("disposition", e.target.value)}
            placeholder="All dispositions"
            options={["PASS", "FAIL", "ACCEPTED"].map((value) => ({
              value,
              label: value,
            }))}
          />
        </Field>
      </div>
      {[
        report.error,
        views.error,
        save.error,
        remove.error,
        download.error,
      ].map((error, i) => (
        <ErrorAlert key={i} error={error} />
      ))}
      <div className="mb-4 flex flex-wrap gap-3">
        <Select
          aria-label="Saved reports"
          className="max-w-sm"
          value=""
          placeholder="Load a saved report"
          options={(views.data ?? []).map((v) => ({
            value: v.id,
            label: v.name,
          }))}
          onChange={(e) => {
            const v = views.data?.find((r) => r.id === e.target.value);
            if (v) setFilters(v.filters);
          }}
        />
        <Input
          aria-label="Report name"
          className="max-w-sm"
          placeholder="Save these filters as…"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button
          variant="outline"
          disabled={!name.trim() || save.isPending}
          onClick={() => save.mutate()}
        >
          Save report
        </Button>
        {can("report:export") && (
          <>
            <Button
              disabled={download.isPending}
              onClick={() => download.mutate("xlsx")}
            >
              Excel
            </Button>
            <Button
              variant="outline"
              disabled={download.isPending}
              onClick={() => download.mutate("pdf")}
            >
              PDF summary
            </Button>
          </>
        )}
      </div>
      {report.data && (
        <div className="overflow-auto rounded border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted">
              <tr>
                {[
                  "Group",
                  "Inspections",
                  "Complete",
                  "Pass",
                  "Fail",
                  "Accepted",
                ].map((t) => (
                  <th className="p-3" key={t}>
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...report.data.groups, report.data.totals].map(
                (r: Data, i: number) => (
                  <tr className="border-t" key={i}>
                    {[
                      r.label,
                      r.count,
                      r.complete,
                      r.pass,
                      r.fail,
                      r.accepted,
                    ].map((v, p) => (
                      <td key={p} className="p-3">
                        {v}
                      </td>
                    ))}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
      {!!views.data?.length && (
        <details className="mt-4">
          <summary>Manage my saved reports</summary>
          {views.data.map((v) => (
            <div key={v.id} className="mt-2 flex gap-3 text-sm">
              <span>{v.name}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => remove.mutate(v.id)}
              >
                Remove
              </Button>
            </div>
          ))}
        </details>
      )}
    </>
  );
}
