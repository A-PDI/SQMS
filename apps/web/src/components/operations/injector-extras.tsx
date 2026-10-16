"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api, API_BASE } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApiMutation } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Alert, ErrorAlert } from "@/components/ui/feedback";
import { PageHeader } from "@/components/shell/page-header";
type Data = Record<string, any>;
export function QuickRepair({ testId }: { testId: string }) {
  const { can } = useSession();
  const [values, setValues] = useState<Data>({});
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [created, setCreated] = useState("");
  const context = useQuery({
    queryKey: ["quick-repair", testId],
    queryFn: () => api<Data>(`/injector-tests/${testId}/quick-entry`),
    enabled: can("repair:write"),
  });
  const save = useApiMutation(
    () =>
      api<Data>(`/injector-tests/${testId}/quick-entry`, {
        method: "POST",
        body: {
          expectedCaseVersion: context.data?.expectedCaseVersion,
          repairDate: date,
          notes,
          measurements: (context.data?.measurements ?? []).map((d: Data) => ({
            key: d.key,
            ...values[d.key],
          })),
        },
      }),
    {
      invalidate: [
        ["quick-repair", testId],
        ["repairs"],
        ["injector-analytics"],
      ],
      onSuccess: (r) => setCreated(r.caseId),
      success: "Repair measurements recorded",
    },
  );
  const set = (key: string, field: string, value: string) =>
    setValues((v) => ({ ...v, [key]: { ...v[key], [field]: value } }));
  if (!can("repair:write") || !context.data) return null;
  return (
    <details className="my-5 rounded border p-4">
      <summary className="cursor-pointer font-semibold">
        Quick repair entry · attempt {context.data.attemptNumber}
      </summary>
      <ErrorAlert error={save.error} />
      {created ? (
        <Link className="underline" href={`/repairs/${created}`}>
          Open repair history
        </Link>
      ) : context.data.canSave ? (
        <div className="mt-3 space-y-3">
          {context.data.linksPreviousRetest && (
            <Alert>
              The current test will be linked as the previous attempt&apos;s
              unsuccessful retest.
            </Alert>
          )}
          <Field label="Repair date">
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          {context.data.measurements.map((d: Data) => (
            <div key={d.key} className="grid gap-2 md:grid-cols-4">
              <strong className="text-sm">{d.label}</strong>
              <Input
                aria-label={`${d.label} before`}
                placeholder="Before"
                inputMode="decimal"
                value={values[d.key]?.before_value ?? ""}
                onChange={(e) => set(d.key, "before_value", e.target.value)}
              />
              <Input
                aria-label={`${d.label} after`}
                placeholder="After"
                inputMode="decimal"
                value={values[d.key]?.after_value ?? ""}
                onChange={(e) => set(d.key, "after_value", e.target.value)}
              />
              <Select
                aria-label={`${d.label} unit`}
                value={values[d.key]?.unit ?? ""}
                placeholder="Units"
                options={d.units.map((value: string) => ({
                  value,
                  label: value,
                }))}
                onChange={(e) => set(d.key, "unit", e.target.value)}
              />
            </div>
          ))}
          <Field label="Repair notes">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            Record measurements
          </Button>
        </div>
      ) : (
        <p className="mt-3 text-sm">
          {context.data.reason}
          {context.data.caseId && (
            <>
              {" "}
              ·{" "}
              <Link
                className="underline"
                href={`/repairs/${context.data.caseId}`}
              >
                Repair History
              </Link>
            </>
          )}
        </p>
      )}
    </details>
  );
}
export function InjectorSheetExports() {
  const { can } = useSession();
  const [day, setDay] = useState(
    new Date(Date.now() - 86400000).toISOString().slice(0, 10),
  );
  const status = useQuery({
    queryKey: ["injector-sheet-status"],
    queryFn: () => api<Data>("/injector-sheet-exports"),
  });
  const preview = useQuery({
    queryKey: ["injector-sheet-preview", day],
    queryFn: () =>
      api<Data>("/injector-sheet-exports/preview", { query: { day } }),
    enabled: !!day,
  });
  const queue = useApiMutation(
    () =>
      api("/injector-sheet-exports", {
        method: "POST",
        body: { from: day, to: day },
      }),
    {
      invalidate: [["injector-sheet-status"]],
      success: "Daily export reserved for delivery",
    },
  );
  const retry = useApiMutation(
    (id: string) =>
      api(`/injector-sheet-exports/${id}/retry`, { method: "POST" }),
    { invalidate: [["injector-sheet-status"]] },
  );
  return (
    <details className="my-5 rounded border p-4">
      <summary className="cursor-pointer font-semibold">
        Daily passed-injector export
      </summary>
      <p className="my-3 text-sm">
        {status.data?.timeZone} · daily {status.data?.dailyTime} · delivery{" "}
        {status.data?.mode ?? "disabled"}
      </p>
      <div className="flex gap-3">
        <Input
          aria-label="Daily export date"
          type="date"
          className="max-w-xs"
          value={day}
          onChange={(e) => setDay(e.target.value)}
        />
        {can("report:export") && (
          <a
            href={`${API_BASE}/injector-sheet-exports/export.csv?day=${encodeURIComponent(day)}`}
          >
            <Button variant="outline">Download CSV</Button>
          </a>
        )}
        {can("injector:sync") && status.data?.mode !== "disabled" && (
          <Button disabled={queue.isPending} onClick={() => queue.mutate()}>
            Queue this day
          </Button>
        )}
      </div>
      {[status.error, preview.error, queue.error, retry.error].map(
        (error, i) => (
          <ErrorAlert error={error} key={i} />
        ),
      )}
      {preview.data && (
        <>
          <p className="my-3 text-sm">
            {preview.data.rows.length} passed tests. Retests remain separate
            rows.
          </p>
          {!!preview.data.unmappedParts.length && (
            <Alert tone="warning">
              Parts without an explicit PDI alias:{" "}
              {preview.data.unmappedParts.join(", ")}
            </Alert>
          )}
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  {preview.data.columns.map((c: string) => (
                    <th className="p-2" key={c}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.data.rows.map((r: string[], i: number) => (
                  <tr className="border-t" key={i}>
                    {r.map((v, p) => (
                      <td className="p-2" key={p}>
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {status.data?.deliveries.map((e: Data) => (
        <p key={e.id} className="my-2 text-xs">
          {e.day} · {e.status} · {e.attempts} attempts {e.lastError}
          {e.status === "FAILED" && can("injector:sync") && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => retry.mutate(e.id)}
            >
              Retry
            </Button>
          )}
        </p>
      ))}
    </details>
  );
}
export function InjectorAnalytics() {
  const { can } = useSession();
  const [filters, setFilters] = useState<Record<string, string>>({
    interval: "week",
  });
  const query = Object.fromEntries(
    Object.entries(filters).filter(([, v]) => v),
  );
  const report = useQuery({
    queryKey: ["injector-detailed-analytics", filters],
    queryFn: () => api<Data>("/injector-tests/analytics/detail", { query }),
  });
  const r = report.data;
  const set = (key: string, value: string) =>
    setFilters((f) => ({ ...f, [key]: value }));
  return (
    <>
      <PageHeader
        title="Injector analytics"
        description="Test cohorts, repair attempts and observed adjustment associations"
        actions={
          <Link href="/injectors">
            <Button variant="outline">Injector tests</Button>
          </Link>
        }
      />
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="From test date">
          <Input
            type="date"
            value={filters.date_from ?? ""}
            onChange={(e) => set("date_from", e.target.value)}
          />
        </Field>
        <Field label="Through test date">
          <Input
            type="date"
            value={filters.date_to ?? ""}
            onChange={(e) => set("date_to", e.target.value)}
          />
        </Field>
        <Field label="Part">
          <Input
            value={filters.part_number ?? ""}
            onChange={(e) => set("part_number", e.target.value)}
          />
        </Field>
        <Field label="Trend interval">
          <Select
            value={filters.interval}
            onChange={(e) => set("interval", e.target.value)}
            options={["day", "week", "month"].map((value) => ({
              value,
              label: value,
            }))}
          />
        </Field>
      </div>
      <ErrorAlert error={report.error} />
      {can("report:export") && (
        <a
          className="my-4 inline-block"
          href={`${API_BASE}/injector-tests/analytics/export.xlsx?${new URLSearchParams(query)}`}
        >
          <Button>Export analytics workbook</Button>
        </a>
      )}
      {r && (
        <div className="space-y-5">
          {[
            ["Testing", r.testing],
            ["Repairs", r.repairs],
          ].map(([label, metrics]) => (
            <section key={label as string} className="rounded border p-4">
              <h2 className="font-semibold">{label as string}</h2>
              <div className="grid gap-3 md:grid-cols-4">
                {Object.entries(metrics)
                  .filter(([, v]) => typeof v !== "object")
                  .map(([key, value]) => (
                    <p className="text-sm" key={key}>
                      {key.replaceAll("_", " ")}
                      <strong className="block">
                        {value == null
                          ? "Unknown"
                          : typeof value === "number" &&
                              !Number.isInteger(value)
                            ? value.toFixed(1)
                            : String(value)}
                      </strong>
                    </p>
                  ))}
              </div>
            </section>
          ))}
          <section className="overflow-auto rounded border p-4">
            <h2 className="mb-3 font-semibold">Test trend</h2>
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  {["Period", "Units", "Pass", "Fail", "DNF", "Unknown"].map(
                    (h) => (
                      <th key={h} className="p-2">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {r.trend.map((v: Data) => (
                  <tr key={v.period} className="border-t">
                    {[
                      v.period,
                      v.injectors,
                      v.PASS,
                      v.FAIL,
                      v.DNF,
                      v.UNKNOWN,
                    ].map((x, p) => (
                      <td key={p} className="p-2">
                        {x}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <Alert>
            Adjustment associations are observations and require engineering
            review. They do not establish causality.
          </Alert>
          {r.evidence.map((e: Data) => (
            <section key={e.key} className="rounded border p-3 text-sm">
              <strong>
                {e.part_number} · {e.parameter} · {e.direction}
              </strong>
              <p>
                {e.samples} observations · {e.correction_pct?.toFixed(1)}%
                corrected · {e.multi_change} with multiple changes
              </p>
            </section>
          ))}
          <details>
            <summary>Metric definitions & coverage</summary>
            <p className="my-2 text-sm">{JSON.stringify(r.coverage)}</p>
            {r.definitions.map(([label, description]: string[]) => (
              <p className="my-2 text-sm" key={label}>
                <strong>{label}: </strong>
                {description}
              </p>
            ))}
          </details>
        </div>
      )}
    </>
  );
}
