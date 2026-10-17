"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, downloadReport, type Page } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApiMutation } from "@/lib/hooks";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { InjectorSheetExports, QuickRepair } from "./injector-extras";
import type { Plan } from "./incoming";
import { Alert, ErrorAlert, PageLoading } from "@/components/ui/feedback";

type Data = Record<string, any>;
export function InjectorTests() {
  const { can, me } = useSession();
  const router = useRouter();
  const [revision, setRevision] = useState("");
  const [stepCodes, setStepCodes] = useState("");
  const [stepStatus, setStepStatus] = useState("fail");
  const [stepMatch, setStepMatch] = useState("any");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [outcome, setOutcome] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Data[]>([]);
  const [vendor, setVendor] = useState("");
  const [format, setFormat] = useState("customer");
  const [preview, setPreview] = useState<Data | null>(null);
  const tests = useQuery({
    queryKey: [
      "injectors",
      q,
      outcome,
      page,
      from,
      to,
      stepCodes,
      stepStatus,
      stepMatch,
    ],
    queryFn: () =>
      api<Page<Data>>("/injector-tests", {
        query: {
          q,
          outcome: outcome || undefined,
          dateFrom: from || undefined,
          dateTo: to || undefined,
          stepCodes: stepCodes || undefined,
          stepStatus,
          stepMatch,
          page,
        },
      }),
  });
  const plans = useQuery({
    queryKey: ["inspection-plans"],
    queryFn: () => api<Plan[]>("/inspection-plans"),
    enabled: can("inspection:write"),
  });
  const bench = useApiMutation(
    () => api<Data>("/injector-tests/sync", { method: "POST", body: {} }),
    {
      invalidate: [["injectors"], ["injector-analytics"]],
      success: "Bench reports synchronized",
    },
  );
  const inspect = useApiMutation(
    () =>
      api<Data>("/injector-tests/inspection", {
        method: "POST",
        body: { ids: selected.map((r) => r.id), planRevisionId: revision },
      }),
    { onSuccess: (r) => router.push(`/incoming/${r.id}`) },
  );
  const analytics = useQuery({
    queryKey: ["injector-analytics"],
    queryFn: () => api<Data>("/injector-tests/analytics"),
  });
  const sync = useApiMutation(
    (reports: Data[]) =>
      api<Data>("/injector-tests/sync-recorded", {
        method: "POST",
        body: { mode: "recorded", reports },
      }),
    {
      invalidate: [["injectors"], ["injector-analytics"]],
      success: (r) =>
        `${r.imported} imported · ${r.updated} updated · ${r.unchanged} unchanged · ${r.excluded.length} excluded`,
    },
  );
  const exportReport = useApiMutation(() =>
    downloadReport(
      "/injector-tests/reports",
      {
        ids: selected.map((r) => r.id),
        vendorName: vendor || undefined,
        format,
      },
      format === "xlsx" ? "InjectorTests.xlsx" : "InjectorReport.pdf",
    ),
  );
  const showPreview = useApiMutation(
    () =>
      api<Data>("/injector-tests/report-preview", {
        method: "POST",
        body: { ids: selected.map((r) => r.id) },
      }),
    { onSuccess: setPreview },
  );
  const loadRecording = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed))
        throw new Error("Recording must be an array of CarbonZapp reports");
      sync.mutate(parsed);
    } catch (e) {
      sync.reset();
      setFileError(e as Error);
    }
  };
  const [fileError, setFileError] = useState<Error | null>(null);
  return (
    <>
      <PageHeader
        title="Injector tests & reports"
        description="Bench results, serial history and selected test reports"
        actions={
          <>
            <Link href="/injectors/analytics">
              <Button variant="outline">Analytics</Button>
            </Link>
            <Link href="/repairs">
              <Button variant="outline">Repair history</Button>
            </Link>
            {can("injector:sync") &&
              ["test-safe", "live"].includes(
                me?.features.carbonZappMode ?? "",
              ) && (
                <Button
                  disabled={bench.isPending}
                  onClick={() => bench.mutate()}
                >
                  Sync bench reports
                </Button>
              )}
          </>
        }
      />
      {analytics.data && (
        <div className="mb-4 grid gap-3 md:grid-cols-4">
          {[
            ["Tests", analytics.data.testCount],
            ["Observed units", analytics.data.physicalUnits],
            ["Passed first observed test", analytics.data.passedFirst],
            ["Passed latest test", analytics.data.passedLatest],
          ].map(([label, value]) => (
            <div key={label} className="rounded border p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-2xl font-semibold">{value}</p>
            </div>
          ))}
        </div>
      )}
      <div className="mb-4 flex gap-3">
        <Input
          aria-label="Find injector tests"
          placeholder="Part, serial or report number"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          className="max-w-md"
        />
        <Select
          aria-label="Injector outcome"
          value={outcome}
          onChange={(e) => {
            setOutcome(e.target.value);
            setPage(1);
          }}
          options={[
            { value: "", label: "All outcomes" },
            ...["pass", "fail", "dnf", "unknown"].map((value) => ({
              value,
              label: value.toUpperCase(),
            })),
          ]}
          className="max-w-40"
        />
      </div>
      <div className="mb-4 flex gap-3">
        <Field label="From test date (Mountain time)">
          <Input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </Field>
        <Field label="Through test date">
          <Input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </Field>
      </div>
      <details className="mb-4 rounded border p-3">
        <summary className="cursor-pointer text-sm">
          Filter by test point
        </summary>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <Field label="Step codes">
            <Input
              placeholder="IVM01, IVM06"
              value={stepCodes}
              onChange={(e) => {
                setStepCodes(e.target.value);
                setPage(1);
              }}
            />
          </Field>
          <Field label="Step outcome">
            <Select
              value={stepStatus}
              onChange={(e) => {
                setStepStatus(e.target.value);
                setPage(1);
              }}
              options={["pass", "fail", "dnf", "unknown", "skip"].map(
                (value) => ({ value, label: value.toUpperCase() }),
              )}
            />
          </Field>
          <Field label="Matching steps">
            <Select
              value={stepMatch}
              onChange={(e) => {
                setStepMatch(e.target.value);
                setPage(1);
              }}
              options={[
                { value: "any", label: "Any selected point" },
                { value: "all", label: "All selected points" },
              ]}
            />
          </Field>
        </div>
      </details>
      {[
        tests.error,
        sync.error,
        exportReport.error,
        showPreview.error,
        bench.error,
        inspect.error,
        fileError,
      ].map((error, i) => (
        <ErrorAlert key={i} error={error} />
      ))}
      {tests.isPending ? (
        <PageLoading />
      ) : (
        <div className="overflow-auto rounded border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted">
              <tr>
                {[
                  "Select",
                  "Part",
                  "Serial",
                  "Test date",
                  "Outcome",
                  "Report / slot",
                ].map((h) => (
                  <th className="p-3" key={h}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tests.data?.items.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.serialNumber ?? r.reportExternalId}`}
                      checked={selected.some((s) => s.id === r.id)}
                      onChange={(e) =>
                        setSelected((prev) =>
                          e.target.checked
                            ? [...prev, r]
                            : prev.filter((s) => s.id !== r.id),
                        )
                      }
                    />
                  </td>
                  <td>{r.partNumber}</td>
                  <td>
                    <Link href={`/injectors/${r.id}`} className="underline">
                      {r.serialNumber || "Unknown serial"}
                    </Link>
                  </td>
                  <td>
                    {r.testAt
                      ? new Date(r.testAt).toLocaleString()
                      : "Time unresolved"}
                  </td>
                  <td
                    className={
                      r.outcome === "fail"
                        ? "font-semibold text-destructive"
                        : ""
                    }
                  >
                    {r.outcome.toUpperCase()}
                  </td>
                  <td>
                    {r.reportExternalId} / {r.slotPosition}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="my-4 flex items-center gap-3">
        <Button
          variant="outline"
          disabled={page === 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </Button>
        <span className="text-sm">
          Page {page} · {tests.data?.total ?? 0} tests
        </span>
        <Button
          variant="outline"
          disabled={
            !tests.data || page * tests.data.pageSize >= tests.data.total
          }
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
      <section className="space-y-3 rounded border p-4">
        <h2 className="font-semibold">
          Report selection · {selected.length} injectors
        </h2>
        <p className="text-xs text-muted-foreground">
          Selection order determines report columns. DNF remains distinct from
          demonstrated failure.
        </p>
        <ol className="space-y-2">
          {selected.map((r, i) => (
            <li key={r.id} className="flex items-center gap-3 text-sm">
              <span>
                {i + 1}. {r.partNumber} · {r.serialNumber}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={i === 0}
                onClick={() =>
                  setSelected((prev) => {
                    const rows = [...prev];
                    [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]];
                    return rows;
                  })
                }
              >
                Move up
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setSelected((prev) => prev.filter((s) => s.id !== r.id))
                }
              >
                Remove
              </Button>
            </li>
          ))}
        </ol>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Vendor / report heading">
            <Input value={vendor} onChange={(e) => setVendor(e.target.value)} />
          </Field>
          <Field label="Report type">
            <Select
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              options={[
                { value: "customer", label: "Custom comparison PDF" },
                {
                  value: "supplier_evaluation",
                  label: "Shipment evaluation PDF",
                },
                { value: "xlsx", label: "Excel workbook" },
              ]}
            />
          </Field>
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            disabled={!selected.length || showPreview.isPending}
            onClick={() => showPreview.mutate()}
          >
            Preview comparison
          </Button>
          {can("report:export") && (
            <Button
              disabled={!selected.length || exportReport.isPending}
              onClick={() => exportReport.mutate()}
            >
              Generate report
            </Button>
          )}
        </div>
        {preview && <ReportPreview data={preview} />}
        {can("inspection:write") && (
          <div className="flex gap-3 border-t pt-3">
            <Select
              aria-label="Fuel injector plan"
              value={revision}
              onChange={(e) => setRevision(e.target.value)}
              placeholder="Released Fuel Injector plan"
              options={(plans.data ?? [])
                .filter((p) => p.code === "PDI-IQI-012")
                .flatMap((p) =>
                  p.revisions
                    .filter((r) => r.status === "RELEASED")
                    .map((r) => ({
                      value: r.id,
                      label: `${p.code} rev ${r.revision}`,
                    })),
                )}
            />
            <Button
              variant="outline"
              disabled={!selected.length || !revision || inspect.isPending}
              onClick={() => inspect.mutate()}
            >
              Create inspection from selection
            </Button>
          </div>
        )}
      </section>
      <InjectorSheetExports />
      {can("injector:sync") && (
        <details className="mt-5 rounded border p-4">
          <summary className="cursor-pointer font-medium">
            Import a recorded CarbonZapp response
          </summary>
          <p className="my-3 text-sm text-muted-foreground">
            Use a recorded or synthetic report array for acceptance testing.
            Identical report/slot pairs are updated safely on rerun.
          </p>
          <Input
            type="file"
            accept=".json"
            aria-label="Recorded CarbonZapp reports"
            onChange={(e) => {
              if (e.target.files?.[0]) {
                setFileError(null);
                void loadRecording(e.target.files[0]);
              }
            }}
          />
        </details>
      )}
    </>
  );
}
function ReportPreview({ data }: { data: Data }) {
  return (
    <div className="mt-3 overflow-auto rounded border text-sm">
      <table className="w-full text-left">
        <thead className="bg-muted">
          <tr>
            <th className="p-2">Test point</th>
            <th>Specification / units</th>
            {(data.injectors ?? []).map((r: Data) => (
              <th className="p-2" key={r.id}>
                {r.partNumber}
                <br />
                {r.serialNumber}
                <br />
                {r.result}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(data.rows ?? []).map((r: Data) => (
            <tr className="border-t" key={r.key}>
              <td className="p-2">{r.label}</td>
              <td>
                {r.specification} {r.unit}
              </td>
              {(r.values ?? []).map((v: Data, i: number) => (
                <td className="p-2" key={i}>
                  {(v.lines ?? []).join(" · ")}
                  <br />
                  <span
                    className={v.status === "fail" ? "text-destructive" : ""}
                  >
                    {v.status?.toUpperCase()}
                  </span>
                  {v.error}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function InjectorDetail({ id }: { id: string }) {
  const { can } = useSession();
  const router = useRouter();
  const query = useQuery({
    queryKey: ["injector", id],
    queryFn: () => api<Data>(`/injector-tests/${id}`),
  });
  const open = useApiMutation(
    () =>
      api<Data>("/injector-repairs", {
        method: "POST",
        body: { testId: id, failureCategories: [] },
      }),
    { onSuccess: (c) => router.push(`/repairs/${c.id}`) },
  );
  if (query.isPending) return <PageLoading />;
  const r = query.data;
  if (!r) return <ErrorAlert error={query.error} />;
  return (
    <>
      <PageHeader
        title={`Injector ${r.serialNumber ?? "Unknown serial"}`}
        description={`${r.partNumber ?? "Unknown part"} · ${r.outcome.toUpperCase()} · ${r.reportExternalId} / ${r.slotPosition}`}
        breadcrumbs={[
          { href: "/injectors", label: "Injector tests" },
          { label: r.serialNumber ?? r.id },
        ]}
        actions={
          can("repair:write") && r.outcome !== "pass" ? (
            <Button onClick={() => open.mutate()} disabled={open.isPending}>
              Open repair case
            </Button>
          ) : undefined
        }
      />
      <ErrorAlert error={open.error} />
      <TestResults report={r.report} />
      <QuickRepair testId={id} />
    </>
  );
}
export function TestResults({ report }: { report: Data }) {
  return (
    <div className="overflow-auto rounded border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted">
          <tr>
            {[
              "Test step",
              "Measurement",
              "Actual",
              "Limits",
              "Units",
              "Outcome",
            ].map((h) => (
              <th className="p-3" key={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(report.tests ?? []).flatMap((s: Data, i: number) =>
            [s.primary, s.secondary]
              .filter(Boolean)
              .map((tank: Data, p: number) => (
                <tr className="border-t" key={`${i}:${p}`}>
                  <td className="p-3">{s.display_name ?? s.name ?? s.code}</td>
                  <td>{tank.tank_name ?? (p ? "Return" : "Delivery")}</td>
                  <td>{tank.average ?? "No test"}</td>
                  <td>
                    {tank.text_green ??
                      `${tank.min_green ?? ""} to ${tank.max_green ?? ""}`}
                  </td>
                  <td>{tank.unit}</td>
                  <td>
                    {String(tank.status ?? s.status ?? "unknown").toUpperCase()}
                  </td>
                </tr>
              )),
          )}
        </tbody>
      </table>
    </div>
  );
}
export function RepairList() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const query = useQuery({
    queryKey: ["repairs", page, q],
    queryFn: () => api<Page<Data>>("/injector-repairs", { query: { page, q } }),
  });
  return (
    <>
      <PageHeader
        title="Injector repairs"
        description="Permanent case, attempt, component-change and retest history"
        actions={
          <Link href="/injectors">
            <Button variant="outline">Injector tests</Button>
          </Link>
        }
      />
      <Input
        aria-label="Find repair cases"
        className="mb-4 max-w-md"
        placeholder="Part or serial"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(1);
        }}
      />
      <ErrorAlert error={query.error} />
      {query.isPending ? (
        <PageLoading />
      ) : (
        <div className="space-y-2">
          {query.data?.items.map((c) => (
            <Link
              href={`/repairs/${c.id}`}
              key={c.id}
              className="block rounded border p-4"
            >
              <strong>
                {c.partNumber} · {c.serialNumber}
              </strong>
              <p className="mt-1 text-sm">
                {c.status.replaceAll("_", " ")} · {c._count.attempts} repair
                attempts
              </p>
            </Link>
          ))}
        </div>
      )}
      <div className="my-4 flex items-center gap-3">
        <Button
          variant="outline"
          disabled={page === 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </Button>
        <span>
          {query.data?.total ?? 0} cases · page {page}
        </span>
        <Button
          variant="outline"
          disabled={
            !query.data || page * query.data.pageSize >= query.data.total
          }
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
    </>
  );
}
export function RepairDetail({ id }: { id: string }) {
  const { can, me } = useSession();
  const query = useQuery({
    queryKey: ["repair", id],
    queryFn: () => api<Data>(`/injector-repairs/${id}`),
  });
  const r = query.data;
  const tests = useQuery({
    queryKey: ["repair-tests", r?.partNumber, r?.serialNumber],
    queryFn: () =>
      api<Page<Data>>("/injector-tests", {
        query: {
          partNumber: r?.partNumber,
          serialNumber: r?.serialNumber,
          pageSize: 200,
        },
      }),
    enabled: !!r,
  });
  const [testId, setTest] = useState("");
  const [repairDate, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [diagnosis, setDiagnosis] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [expected, setExpected] = useState("");
  const [component, setComponent] = useState("Nozzle");
  const [actionType, setAction] = useState("Adjusted");
  const [parameter, setParameter] = useState("");
  const [before, setBefore] = useState("");
  const [after, setAfter] = useState("");
  const [unit, setUnit] = useState("");
  const [changes, setChanges] = useState<Data[]>([]);
  const [observed, setObserved] = useState("");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("HOLD");
  const attempt = useApiMutation(
    () =>
      api(`/injector-repairs/${id}/attempts`, {
        method: "POST",
        body: {
          expectedVersion: r?.version,
          beforeTestId: testId,
          repairDate,
          diagnosis,
          hypothesis,
          expectedOutcome: expected,
          changes,
        },
      }),
    {
      invalidate: [["repair", id], ["repairs"]],
      success: "Repair attempt recorded",
      onSuccess: () => {
        setDiagnosis("");
        setChanges([]);
      },
    },
  );
  const retest = useApiMutation(
    (a: Data) =>
      api(`/injector-repairs/attempts/${a.id}/retest`, {
        method: "POST",
        body: {
          expectedVersion: a.version,
          afterTestId: testId,
          observedOutcome: observed,
        },
      }),
    {
      invalidate: [["repair", id], ["repairs"]],
      success: "Retest linked and deltas recorded",
    },
  );
  const changeStatus = useApiMutation(
    () =>
      api(`/injector-repairs/${id}/status`, {
        method: "POST",
        body: { expectedVersion: r?.version, status, reason },
      }),
    {
      invalidate: [["repair", id], ["repairs"]],
      success: "Repair status updated",
    },
  );
  if (query.isPending) return <PageLoading />;
  if (!r) return <ErrorAlert error={query.error} />;
  return (
    <>
      <PageHeader
        title={`Repair · ${r.partNumber} · ${r.serialNumber}`}
        description={r.status.replaceAll("_", " ")}
        breadcrumbs={[
          { href: "/repairs", label: "Repairs" },
          { label: r.serialNumber },
        ]}
      />
      {[attempt.error, retest.error, changeStatus.error].map((error, i) => (
        <ErrorAlert key={i} error={error} />
      ))}
      {r.attempts.map((a: Data) => (
        <section key={a.id} className="mb-4 space-y-2 rounded border p-4">
          <h2 className="font-semibold">
            Attempt {a.attemptNumber} · {a.outcome} · {a.technician}
          </h2>
          <p className="text-sm">{a.diagnosis}</p>
          <p className="text-sm text-muted-foreground">
            Hypothesis: {a.hypothesis || "Not recorded"} · Expected:{" "}
            {a.expectedOutcome || "Not recorded"}
          </p>
          {a.changes.map((c: Data, i: number) => (
            <p key={i} className="text-sm">
              {c.component} · {c.action_type ?? c.actionType} · {c.parameter} ·{" "}
              {c.before_value ?? c.beforeValue} →{" "}
              {c.after_value ?? c.afterValue} {c.unit}
            </p>
          ))}
          <p className="text-sm">{a.observedOutcome}</p>
          {Array.isArray(a.deltas) && (
            <div className="overflow-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr>
                    {[
                      "Measurement",
                      "Before",
                      "After",
                      "Delta",
                      "Correction effectiveness",
                    ].map((h) => (
                      <th key={h} className="p-2">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {a.deltas.map((d: Data, i: number) => (
                    <tr key={d.key ?? d.step_key ?? i} className="border-t">
                      <td className="p-2">
                        {d.before?.stepName ?? d.step_name ?? d.key}
                      </td>
                      <td>{d.before?.value ?? d.before_value}</td>
                      <td>{d.after?.value ?? d.after_value}</td>
                      <td>
                        {d.absolute ?? d.absolute_delta ?? "Incompatible"}
                      </td>
                      <td>
                        {d.effectiveness == null
                          ? (d.comparisonReason ?? "Unknown")
                          : `${Number(d.effectiveness).toFixed(1)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {a.status === "WAITING_RETEST" && can("repair:write") && (
            <div className="space-y-2">
              <p className="text-sm">
                Choose a later test below, then record the observed outcome.
              </p>
              <Textarea
                aria-label="Observed retest outcome"
                value={observed}
                onChange={(e) => setObserved(e.target.value)}
              />
              <Button
                disabled={
                  !testId || observed.trim().length < 5 || retest.isPending
                }
                onClick={() => retest.mutate(a)}
              >
                Link selected retest
              </Button>
            </div>
          )}
        </section>
      ))}
      {can("repair:write") && !["PASSED", "SCRAPPED"].includes(r.status) && (
        <section className="space-y-3 rounded border p-4">
          <h2 className="font-semibold">Repair entry · {me?.displayName}</h2>
          <Field label="Before-test or later retest">
            <Select
              aria-label="Repair test selection"
              value={testId}
              onChange={(e) => setTest(e.target.value)}
              placeholder="Select a test for this part"
              options={(tests.data?.items ?? []).map((t) => ({
                value: t.id,
                label: `${t.serialNumber} · ${t.testAt ? new Date(t.testAt).toLocaleString() : "Time unresolved"} · ${t.outcome.toUpperCase()}`,
              }))}
            />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Repair date">
              <Input
                type="date"
                value={repairDate}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field label="Diagnosis">
              <Textarea
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
              />
            </Field>
            <Field label="Hypothesis">
              <Textarea
                value={hypothesis}
                onChange={(e) => setHypothesis(e.target.value)}
              />
            </Field>
            <Field label="Expected outcome">
              <Textarea
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
              />
            </Field>
          </div>
          <div className="grid gap-2 md:grid-cols-4">
            <Field label="Component">
              <Select
                value={component}
                onChange={(e) => setComponent(e.target.value)}
                options={[
                  "Nozzle",
                  "Needle",
                  "Control Valve",
                  "Control Ball",
                  "Armature",
                  "Stator",
                  "Solenoid",
                  "Spring",
                  "Nozzle Nut",
                  "Valve Body",
                  "Housing",
                  "Other",
                ].map((value) => ({ value, label: value }))}
              />
            </Field>
            <Field label="Action">
              <Select
                value={actionType}
                onChange={(e) => setAction(e.target.value)}
                options={[
                  "Adjusted",
                  "Replaced",
                  "Reworked",
                  "Cleaned",
                  "Retorqued",
                  "Lapped",
                  "Inspected",
                  "No Change",
                ].map((value) => ({ value, label: value }))}
              />
            </Field>
            <Field label="Parameter">
              <Input
                value={parameter}
                onChange={(e) => setParameter(e.target.value)}
              />
            </Field>
            <Field label="Units">
              <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
            </Field>
            <Field label="Before">
              <Input
                value={before}
                onChange={(e) => setBefore(e.target.value)}
              />
            </Field>
            <Field label="After">
              <Input value={after} onChange={(e) => setAfter(e.target.value)} />
            </Field>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setChanges((c) => [
                ...c,
                {
                  component,
                  action_type: actionType,
                  parameter,
                  before_value: before,
                  after_value: after,
                  unit,
                },
              ]);
              setParameter("");
              setBefore("");
              setAfter("");
            }}
          >
            Add component change
          </Button>
          {changes.map((c, i) => (
            <p key={i} className="text-sm">
              {c.component} · {c.parameter} · {c.before_value} → {c.after_value}{" "}
              {c.unit}
            </p>
          ))}
          <Button
            disabled={
              !testId ||
              !changes.length ||
              diagnosis.trim().length < 3 ||
              attempt.isPending ||
              r.attempts.some((a: Data) => a.status === "WAITING_RETEST")
            }
            onClick={() => attempt.mutate()}
          >
            Record repair attempt
          </Button>
          <div className="flex gap-2 border-t pt-4">
            <Select
              aria-label="Repair status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              options={["OPEN", "HOLD", "ENGINEERING_REVIEW", "SCRAPPED"].map(
                (value) => ({ value, label: value.replaceAll("_", " ") }),
              )}
            />
            <Input
              aria-label="Repair status reason"
              placeholder="Reason for status change"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={reason.trim().length < 5 || changeStatus.isPending}
              onClick={() => changeStatus.mutate()}
            >
              Update status
            </Button>
          </div>
        </section>
      )}
    </>
  );
}
