"use client";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  api,
  API_BASE,
  uploadFile,
  fileDownloadUrl,
  type Page,
} from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApiMutation } from "@/lib/hooks";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import {
  Alert,
  EmptyState,
  ErrorAlert,
  PageLoading,
} from "@/components/ui/feedback";
import SectionReceiving from "@/legacy/components/inspection/SectionReceiving";
import SectionVisual from "@/legacy/components/inspection/SectionVisual";
import SectionDimensional from "@/legacy/components/inspection/SectionDimensional";
import SectionChecklist from "@/legacy/components/inspection/SectionChecklist";
import SectionGeneralMeasurements from "@/legacy/components/inspection/SectionGeneralMeasurements";
import SectionCamshaftBore from "@/legacy/components/inspection/SectionCamshaftBore";
import SectionFireRingProtrusion from "@/legacy/components/inspection/SectionFireRingProtrusion";
import SectionGrooveSpecs from "@/legacy/components/inspection/SectionGrooveSpecs";
import SectionValveRecession from "@/legacy/components/inspection/SectionValveRecession";
import SectionVacuumTest from "@/legacy/components/inspection/SectionVacuumTest";
import { UserPicker, type PickerItem } from "@/components/forms/async-picker";
import { RecordPanel } from "@/components/common/collaboration";
import { initSectionData } from "@/legacy/lib/inspection-data";

type Data = Record<string, any>;
export interface Plan {
  id: string;
  code: string;
  title: string;
  revisions: {
    id: string;
    revision: number;
    status: string;
    definition: Data;
  }[];
}
interface Incoming {
  id: string;
  number: string;
  version: number;
  status: string;
  originalPartNumber: string | null;
  originalSupplier: string | null;
  resolutionNotes: string | null;
  itemCount: number;
  items: Data[];
  sectionData: Data;
  header: Data;
  planSnapshot: Data;
  measurements: Data[];
  nonconformances: Data[];
  planRevision: { revision: number; plan: { title: string; code: string } };
}
const SECTIONS: Record<string, ComponentType<any>> = {
  pfn_checklist: SectionReceiving,
  pfn_visual: SectionVisual,
  dimensional: SectionDimensional,
  pass_fail_checklist: SectionChecklist,
  general_measurements: SectionGeneralMeasurements,
  camshaft_bore: SectionCamshaftBore,
  fire_ring_protrusion: SectionFireRingProtrusion,
  groove_specs: SectionGrooveSpecs,
  valve_recession: SectionValveRecession,
  vacuum_test: SectionVacuumTest,
};

export function IncomingList() {
  const { can, me } = useSession();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const rows = useQuery({
    queryKey: ["incoming", q, status, mine, page],
    queryFn: () =>
      api<Page<Incoming>>("/incoming-inspections", {
        query: {
          q,
          status: status || undefined,
          assignedToId: mine ? me?.id : undefined,
          page,
        },
      }),
  });
  const alerts = useQuery({
    queryKey: ["incoming-alerts"],
    queryFn: () => api<Data[]>("/incoming-inspections/alerts"),
  });
  const acknowledge = useApiMutation(
    (id: string) =>
      api(`/incoming-inspections/alerts/${id}/acknowledge`, { method: "POST" }),
    { invalidate: [["incoming-alerts"]], success: "Alert acknowledged" },
  );
  return (
    <>
      <PageHeader
        title="Incoming inspection"
        description="Receiving, per-item results and quality history"
        actions={
          <>
            <Link href="/incoming/alerts">
              <Button variant="outline">Quality alerts</Button>
            </Link>
            {can("report:read") && (
              <Link href="/incoming/reports">
                <Button variant="outline">Reports</Button>
              </Link>
            )}
            {can("inspection_plan:manage") && (
              <Link href="/inspection-plans">
                <Button variant="outline">Inspection plans</Button>
              </Link>
            )}
            {can("inspection:write") && (
              <Link href="/incoming/new">
                <Button>New inspection</Button>
              </Link>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          aria-label="Search inspections"
          placeholder="Part, serial, supplier or inspection number"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          className="max-w-md"
        />
        <Select
          aria-label="Inspection status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: "", label: "All statuses" },
            ...["DRAFT", "IN_PROGRESS", "COMPLETE"].map((value) => ({
              value,
              label: value.replaceAll("_", " "),
            })),
          ]}
          className="max-w-44"
        />
        <label className="text-sm">
          <input
            type="checkbox"
            checked={mine}
            onChange={(e) => setMine(e.target.checked)}
          />{" "}
          Assigned to me
        </label>
      </div>
      {!!alerts.data?.filter((a) => !a.acknowledgedAt).length && (
        <Alert
          tone="warning"
          title={`${alerts.data.filter((a) => !a.acknowledgedAt).length} quality alerts awaiting review`}
        />
      )}
      <ErrorAlert error={acknowledge.error} />
      <div className="my-3 space-y-2">
        {alerts.data
          ?.filter((a) => !a.acknowledgedAt)
          .slice(0, 20)
          .map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-3 rounded border p-3 text-sm"
            >
              {a.inspection ? (
                <Link
                  className="underline"
                  href={`/incoming/${a.inspection.id}`}
                >
                  {a.inspection.number} · {a.inspection.originalPartNumber}
                </Link>
              ) : (
                <span>Historical alert · {a.originalPartNumber}</span>
              )}
              <span>{a.type.replaceAll("_", " ")}</span>
              {can("inspection:write") && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => acknowledge.mutate(a.id)}
                >
                  Acknowledge
                </Button>
              )}
            </div>
          ))}
      </div>
      <ErrorAlert error={rows.error} />
      {rows.isPending ? (
        <PageLoading />
      ) : !rows.data?.items.length ? (
        <EmptyState title="No inspections found" />
      ) : (
        <div className="mt-3 overflow-auto rounded border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted">
              <tr>
                {["Inspection", "Part", "Supplier", "Plan", "Status"].map(
                  (h) => (
                    <th key={h} className="p-3">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.data.items.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-3">
                    <Link
                      className="text-primary underline"
                      href={`/incoming/${r.id}`}
                    >
                      {r.number}
                    </Link>
                  </td>
                  <td>{r.originalPartNumber || "Unresolved"}</td>
                  <td>{r.originalSupplier || "Unattributed"}</td>
                  <td>{r.planRevision.plan.code}</td>
                  <td>{r.status.replaceAll("_", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 flex items-center gap-3">
        <Button
          variant="outline"
          disabled={page === 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </Button>
        <span className="text-sm">
          Page {page} · {rows.data?.total ?? 0} inspections
        </span>
        <Button
          variant="outline"
          disabled={!rows.data || page * rows.data.pageSize >= rows.data.total}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
    </>
  );
}
export function NewIncoming() {
  const router = useRouter();
  const { me } = useSession();
  const plans = useQuery({
    queryKey: ["inspection-plans"],
    queryFn: () => api<Plan[]>("/inspection-plans"),
  });
  const [search, setSearch] = useState("");
  const approvals = useQuery({
    queryKey: ["receipt-approvals", search],
    queryFn: () =>
      api<Page<Data>>("/product-approvals", {
        query: { status: ["ACTIVE"], q: search, pageSize: 100 },
      }),
  });
  const [revision, setRevision] = useState("");
  const [approvalId, setApproval] = useState("");
  const [part, setPart] = useState("");
  const [supplier, setSupplier] = useState("");
  const [reason, setReason] = useState("");
  const [count, setCount] = useState(1);
  const [po, setPo] = useState("");
  const [received, setReceived] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const create = useApiMutation(
    () =>
      api<Incoming>("/incoming-inspections", {
        method: "POST",
        body: {
          planRevisionId: revision,
          productApprovalId: approvalId || undefined,
          originalPartNumber: part || undefined,
          originalSupplier: supplier || undefined,
          resolutionNotes: reason || undefined,
          itemCount: count,
          header: {
            po_number: po,
            date_received: received,
            inspector_name: me?.displayName,
          },
        },
      }),
    { onSuccess: (r) => router.push(`/incoming/${r.id}`) },
  );
  return (
    <>
      <PageHeader
        title="New incoming inspection"
        breadcrumbs={[
          { href: "/incoming", label: "Incoming" },
          { label: "New" },
        ]}
      />
      <form
        className="grid max-w-3xl gap-4 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field label="Released inspection plan" required>
          <Select
            required
            aria-label="Released inspection plan"
            value={revision}
            onChange={(e) => setRevision(e.target.value)}
            placeholder="Choose a plan"
            options={(plans.data ?? []).flatMap((p) =>
              p.revisions
                .filter((r) => r.status === "RELEASED")
                .map((r) => ({
                  value: r.id,
                  label: `${p.code} · ${p.title} · rev ${r.revision}`,
                })),
            )}
          />
        </Field>
        <Field label="Items / serials to inspect" required>
          <Input
            aria-label="Item count"
            type="number"
            min={1}
            max={500}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
        </Field>
        <Field label="Find supplier-product approval">
          <Input
            aria-label="Search approvals"
            placeholder="Part or approval number"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Field>
        <Field label="Approval for this receipt">
          <Select
            value={approvalId}
            onChange={(e) => setApproval(e.target.value)}
            placeholder="Unresolved / no known approval"
            options={(approvals.data?.items ?? []).map((a) => ({
              value: a.id,
              label: `${a.internalPart.partNumber} · ${a.supplierProduct.supplier.name} · ${a.supplierProduct.site.name} · rev ${a.configurationRevision.revisionLabel}`,
            }))}
          />
        </Field>
        {!approvalId && (
          <>
            <Field label="Original part number">
              <Input value={part} onChange={(e) => setPart(e.target.value)} />
            </Field>
            <Field label="Original supplier, if known">
              <Input
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
              />
            </Field>
            <Field label="Reason approval is unresolved" required>
              <Textarea
                required
                minLength={5}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <Alert tone="warning">
              This receipt will remain unresolved. Inspection completion does
              not authorize material release.
            </Alert>
          </>
        )}
        <Field label="Purchase order">
          <Input value={po} onChange={(e) => setPo(e.target.value)} />
        </Field>
        <Field label="Date received">
          <Input
            type="date"
            value={received}
            onChange={(e) => setReceived(e.target.value)}
          />
        </Field>
        <div className="md:col-span-2">
          <ErrorAlert error={create.error} />
          <Button type="submit" disabled={!revision || create.isPending}>
            Create inspection
          </Button>
        </div>
      </form>
    </>
  );
}
export function IncomingEditor({ id }: { id: string }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["incoming-record", id],
    queryFn: () => api<Incoming>(`/incoming-inspections/${id}`),
    refetchOnWindowFocus: false,
  });
  const r = query.data;
  const [data, setData] = useState<Data | null>(null);
  const [header, setHeader] = useState<Data>({});
  const [version, setVersion] = useState(0);
  const [item, setItem] = useState(0);
  const [reason, setReason] = useState("");
  const [values, setValues] = useState<Data>({});
  const [ncrTitle, setNcrTitle] = useState("Incoming characteristic failure");
  const [defectCode, setDefectCode] = useState("DIMENSIONAL");
  const [quantity, setQuantity] = useState(1);
  const [ncrKey, setNcrKey] = useState(() => crypto.randomUUID());
  const [createdNcr, setCreatedNcr] = useState<string | null>(null);
  const ncrCommand = useRef<Data | null>(null);
  const [assigned, setAssigned] = useState<PickerItem | null>(null);
  useEffect(() => {
    if (r && data === null) {
      setData(structuredClone(r.sectionData));
      setHeader(r.header);
      setVersion(r.version);
      setValues(
        Object.fromEntries(
          r.measurements.map((m) => [
            `${m.itemId == null ? "shared" : r.items.find((i) => i.id === m.itemId)?.position}:${m.characteristicKey}`,
            { value: m.value, textValue: m.textValue, outcome: m.outcome },
          ]),
        ),
      );
    }
  }, [r, data]);
  const attachments = useQuery({
    queryKey: ["incoming-evidence", id],
    queryFn: () =>
      api<Data[]>("/record-attachments", {
        query: { entityType: "INCOMING_INSPECTION", entityId: id },
      }),
    refetchInterval: (q) =>
      q.state.data?.some((a: Data) => a.file.status === "QUARANTINED")
        ? 2000
        : false,
  });
  const history = useQuery({
    queryKey: ["incoming-recurrence", id, r?.version],
    queryFn: () =>
      api<Data>(`/incoming-inspections/${id}/recurrence-candidates`),
    enabled: can("ncr:read"),
  });
  const update = async () => {
    const chars: Data[] = r?.planSnapshot.characteristics ?? [];
    const measurements = chars.flatMap((c) =>
      Array.from({ length: c.shared ? 1 : (r?.itemCount ?? 1) }, (_, pos) => {
        const key = `${c.shared ? "shared" : pos}:${c.key}`;
        const v = values[key] ?? {};
        const row =
          c.legacyItemId == null
            ? null
            : (c.shared
                ? data?.__shared?.[c.sectionKey]
                : (data?.__items ?? [data])[pos]?.[c.sectionKey]
              )?.find((row: Data) => String(row.id) === String(c.legacyItemId));
        const raw = row ? row[c.valueField ?? "actual1"] : v.value;
        return {
          characteristicKey: c.key,
          itemPosition: c.shared ? undefined : pos,
          value: raw === "" || raw == null ? undefined : Number(raw),
          textValue: v.textValue || undefined,
          outcome: v.outcome || "NOT_INSPECTED",
        };
      }),
    );
    const saved = await api<Incoming>(`/incoming-inspections/${id}`, {
      method: "PATCH",
      body: {
        expectedVersion: version,
        assignedToId: assigned?.id,
        header,
        sectionData: data,
        measurements: chars.length ? measurements : undefined,
      },
    });
    setVersion(saved.version);
    return saved;
  };
  const saved = useApiMutation(update, {
    invalidate: [["incoming-record", id]],
    success: "Inspection saved",
  });
  const complete = useApiMutation(
    async () => {
      const s = await update();
      return api<Incoming>(`/incoming-inspections/${id}/complete`, {
        method: "POST",
        body: { expectedVersion: s.version },
      });
    },
    {
      invalidate: [["incoming-record", id], ["incoming"]],
      onSuccess: (s) => {
        setVersion(s.version);
        setData(null);
      },
      success: "Inspection completed",
    },
  );
  const reopen = useApiMutation(
    () =>
      api<Incoming>(`/incoming-inspections/${id}/reopen`, {
        method: "POST",
        body: { expectedVersion: r?.version, reason },
      }),
    {
      invalidate: [["incoming-record", id]],
      onSuccess: (s) => {
        setVersion(s.version);
        setReason("");
        setData(null);
      },
      success: "Inspection reopened",
    },
  );
  const upload = useApiMutation(
    async ({
      file,
      sectionKey,
      rowId,
      position,
    }: {
      file: File;
      sectionKey?: string;
      rowId?: string;
      position?: number;
    }) => {
      const f = await uploadFile(file);
      return api("/record-attachments", {
        method: "POST",
        body: {
          entityType: "INCOMING_INSPECTION",
          entityId: id,
          fileId: f.id,
          context: { sectionKey, rowId, itemPosition: position ?? item },
        },
      });
    },
    {
      invalidate: [["incoming-evidence", id]],
      success: "Evidence uploaded for scanning",
    },
  );
  const remove = useApiMutation(
    (attachmentId: string) =>
      api(`/record-attachments/${attachmentId}`, { method: "DELETE" }),
    { invalidate: [["incoming-evidence", id]] },
  );
  const legacyHistory = useQuery({
    queryKey: ["incoming-legacy-history", id],
    queryFn: () => api<Data[]>(`/incoming-inspections/${id}/legacy-history`),
  });
  const raise = useApiMutation(
    async () => {
      if (
        !ncrCommand.current &&
        r?.status !== "COMPLETE" &&
        can("inspection:write")
      )
        await update();
      if (!ncrCommand.current) {
        const current = await api<Incoming>(`/incoming-inspections/${id}`);
        ncrCommand.current = {
          requestKey: ncrKey,
          title: ncrTitle,
          resultIds: current.measurements
            .filter((m) => m.outcome === "FAIL")
            .map((m) => m.id),
          itemPositions: (current.sectionData.__items ?? [current.sectionData])
            .map((item: Data, p: number) =>
              ["FAIL", "ACCEPTED"].includes(item.__disposition) ? p : -1,
            )
            .filter((p: number) => p >= 0),
          quantityAffected: quantity,
          defectCode,
          severity: "MAJOR",
        };
      }
      return api<Data>(`/incoming-inspections/${id}/ncrs`, {
        method: "POST",
        body: ncrCommand.current,
      });
    },
    {
      invalidate: [["incoming-record", id]],
      onSuccess: (n) => {
        setCreatedNcr(n.id);
        setNcrKey(crypto.randomUUID());
      },
      success: "NCR raised with source evidence",
    },
  );
  if (query.isPending || !data)
    return (
      <>
        <ErrorAlert error={query.error} />
        <PageLoading />
      </>
    );
  if (!r) return <ErrorAlert error={query.error} />;
  const readOnly = r.status === "COMPLETE" || !can("inspection:write");
  const sections = data.__admin_sections ?? r.planSnapshot.sections ?? {};
  const list: Data[] = Array.isArray(data.__items) ? data.__items : [data];
  const activeItem = list[item] ?? {};
  const setItemField = (key: string, value: unknown) =>
    setData((prev) => {
      const copy = structuredClone(prev!);
      if (Array.isArray(copy.__items))
        copy.__items[item] = { ...copy.__items[item], [key]: value };
      else copy[key] = value;
      return copy;
    });
  const currentEvidence = (attachments.data ?? [])
    .filter(
      (a) => a.context?.itemPosition == null || a.context.itemPosition === item,
    )
    .map((a) => ({
      ...a,
      section_key: a.context?.sectionKey,
      item_id: a.context?.rowId,
    }));
  return (
    <>
      <PageHeader
        title={r.planRevision.plan.title}
        description={`${r.originalPartNumber ?? "Unresolved part"} · ${r.originalSupplier ?? "Unattributed supplier"} · ${r.status.replaceAll("_", " ")}`}
        breadcrumbs={[
          { href: "/incoming", label: "Incoming" },
          { label: r.number },
        ]}
        actions={
          <a href={`${API_BASE}/incoming-inspections/${id}/pdf`}>
            <Button variant="outline">Inspection PDF</Button>
          </a>
        }
      />
      {!readOnly && (
        <Field label="Assign inspector">
          <UserPicker
            value={assigned}
            onChange={setAssigned}
            placeholder="Keep current assignment or choose an inspector"
          />
        </Field>
      )}
      {r.resolutionNotes && (
        <Alert tone="warning" title="Receipt history needs review">
          {r.resolutionNotes}
        </Alert>
      )}
      <div className="my-4 grid gap-3 md:grid-cols-3">
        {[
          ...new Set([
            "po_number",
            "date_received",
            "inspector_name",
            "description",
            "lot_serial_no",
            "lot_size",
            ...(r.planSnapshot.header_schema ?? []).filter(
              (k: unknown) =>
                typeof k === "string" &&
                !["part_number", "supplier"].includes(k),
            ),
          ]),
        ].map((k) => (
          <Field key={k} label={k.replaceAll("_", " ")}>
            <Input
              value={String(header[k] ?? "")}
              disabled={readOnly}
              onChange={(e) =>
                setHeader((h) => ({ ...h, [k]: e.target.value }))
              }
            />
          </Field>
        ))}
      </div>
      <div
        className="mb-4 flex flex-wrap gap-2"
        role="tablist"
        aria-label="Inspection items"
      >
        {list.map((i, p) => (
          <Button
            key={p}
            variant={item === p ? "default" : "outline"}
            role="tab"
            aria-selected={item === p}
            onClick={() => setItem(p)}
          >
            Item {p + 1}
            {i.__serial_no ? ` · ${i.__serial_no}` : ""}
          </Button>
        ))}
      </div>
      <Field label="This item's serial number">
        <Input
          value={activeItem.__serial_no ?? ""}
          disabled={readOnly}
          onChange={(e) => setItemField("__serial_no", e.target.value)}
        />
      </Field>
      <div className="mt-4 space-y-4 rounded border bg-white p-4 text-gray-900">
        {Object.entries(sections).map(([key, section]) => {
          const s = section as Data;
          const Component = SECTIONS[s.section_type];
          const shared =
            key === "receiving" ||
            String(s.title).toUpperCase().includes("RECEIVING");
          const initial = initSectionData({ [key]: s }) as Data;
          const sectionData = shared
            ? (data.__shared?.[key] ?? activeItem[key] ?? initial[key])
            : (activeItem[key] ?? initial[key]);
          return (
            <details key={key} open className="rounded border p-3">
              <summary className="mb-3 cursor-pointer font-semibold">
                {s.title}
                {shared ? " · completed once for the receipt" : ""}
              </summary>
              {Component ? (
                <Component
                  section={s}
                  data={sectionData}
                  readOnly={readOnly}
                  allowNA={shared}
                  sectionKey={key}
                  attachments={currentEvidence}
                  onChange={(v: unknown) =>
                    shared
                      ? setData((prev) => ({
                          ...prev,
                          __shared: { ...prev?.__shared, [key]: v },
                        }))
                      : setItemField(key, v)
                  }
                  onUploadItem={(
                    file: File,
                    sectionKey: string,
                    rowId: string,
                  ) =>
                    upload.mutate({
                      file,
                      sectionKey,
                      rowId: String(rowId),
                      position: item,
                    })
                  }
                  onDeleteItem={(a: string) => remove.mutate(a)}
                />
              ) : (
                <Alert tone="warning">
                  This historical section needs a compatible editor. Its
                  original answers remain in the inspection PDF and migration
                  snapshot.
                </Alert>
              )}
            </details>
          );
        })}
      </div>
      {(r.planSnapshot.characteristics ?? [])
        .filter((c: Data) => c.legacyItemId == null)
        .map((c: Data) => {
          const key = `${c.shared ? "shared" : item}:${c.key}`;
          const val = values[key] ?? {};
          return (
            <div
              className="mt-4 grid gap-3 rounded border p-3 md:grid-cols-3"
              key={key}
            >
              <div>
                <strong>{c.name ?? c.key}</strong>
                <p className="text-xs">
                  {c.specification ??
                    `${c.minimum ?? ""} to ${c.maximum ?? ""}`}{" "}
                  {c.unit}
                </p>
              </div>
              <Field label="Measured value">
                <Input
                  type="number"
                  step="any"
                  value={val.value ?? ""}
                  disabled={readOnly}
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      [key]: { ...val, value: e.target.value },
                    }))
                  }
                />
              </Field>
              <Field label="Qualitative result">
                <Select
                  disabled={readOnly}
                  value={val.outcome ?? "NOT_INSPECTED"}
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      [key]: { ...val, outcome: e.target.value },
                    }))
                  }
                  options={["NOT_INSPECTED", "PASS", "FAIL"].map((value) => ({
                    value,
                    label: value.replaceAll("_", " "),
                  }))}
                />
              </Field>
            </div>
          );
        })}
      <div className="my-4 grid gap-3 md:grid-cols-2">
        <Field label="Item disposition">
          <Select
            disabled={readOnly}
            value={activeItem.__disposition ?? ""}
            onChange={(e) => setItemField("__disposition", e.target.value)}
            placeholder="Select disposition"
            options={["PASS", "FAIL", "ACCEPTED"].map((value) => ({
              value,
              label: value,
            }))}
          />
        </Field>
        <Field label="Disposition notes">
          <Textarea
            disabled={readOnly}
            value={activeItem.__disposition_notes ?? ""}
            onChange={(e) =>
              setItemField("__disposition_notes", e.target.value)
            }
          />
        </Field>
      </div>
      {!readOnly && (
        <Field label="Item evidence">
          <Input
            type="file"
            onChange={(e) => {
              if (e.target.files?.[0])
                upload.mutate({ file: e.target.files[0], position: item });
              e.target.value = "";
            }}
          />
        </Field>
      )}
      <ul className="my-3 space-y-1 text-sm">
        {(attachments.data ?? []).map((a) => (
          <li key={a.id}>
            <a className="underline" href={fileDownloadUrl(a.file.id)}>
              {a.file.originalFilename}
            </a>{" "}
            · {a.file.status}
            {a.context?.itemPosition != null
              ? ` · Item ${a.context.itemPosition + 1}`
              : ""}
          </li>
        ))}
      </ul>
      {[
        saved.error,
        complete.error,
        reopen.error,
        upload.error,
        remove.error,
        raise.error,
      ].map((error, i) => (
        <ErrorAlert key={i} error={error} />
      ))}
      <div className="my-4 flex gap-3">
        {!readOnly && (
          <>
            <Button disabled={saved.isPending} onClick={() => saved.mutate()}>
              Save inspection
            </Button>
            {can("inspection:complete") && (
              <Button
                variant="outline"
                disabled={complete.isPending}
                onClick={() => complete.mutate()}
              >
                Complete inspection
              </Button>
            )}
          </>
        )}
        {r.status === "COMPLETE" && can("inspection:reopen") && (
          <>
            <Input
              aria-label="Reopening reason"
              placeholder="Reason to reopen"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="max-w-md"
            />
            <Button
              disabled={reason.trim().length < 5 || reopen.isPending}
              onClick={() => reopen.mutate()}
            >
              Reopen with reason
            </Button>
          </>
        )}
      </div>
      {!!history.data?.candidates?.length && (
        <section className="my-4 rounded border p-4">
          <h2 className="font-semibold">Related historical defects</h2>
          <p className="mb-2 text-xs">
            Candidates require Quality review. Closed FAI NCRs remain part of
            this history.
          </p>
          {history.data.candidates.map((m: Data) => (
            <p key={m.ncr.id}>
              <Link className="underline" href={`/quality/ncrs/${m.ncr.id}`}>
                {m.ncr.number}
              </Link>{" "}
              · {m.ncr.source} · {m.ncr.status} · {m.ncr.title}
            </p>
          ))}
        </section>
      )}
      {can("ncr:write") &&
        (r.measurements.some((m) => m.outcome === "FAIL") ||
          list.some((i) => ["FAIL", "ACCEPTED"].includes(i.__disposition))) && (
          <section className="my-4 space-y-3 rounded border p-4">
            <h2 className="font-semibold">Raise NCR from this inspection</h2>
            {createdNcr ? (
              <Link className="underline" href={`/quality/ncrs/${createdNcr}`}>
                Open linked NCR
              </Link>
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-3">
                  <Field label="NCR title">
                    <Input
                      aria-label="NCR title"
                      value={ncrTitle}
                      onChange={(e) => setNcrTitle(e.target.value)}
                    />
                  </Field>
                  <Field label="Defect classification">
                    <Select
                      value={defectCode}
                      onChange={(e) => setDefectCode(e.target.value)}
                      options={[
                        "DIMENSIONAL",
                        "FLOW",
                        "LEAK",
                        "MATERIAL",
                        "VISUAL",
                        "FUNCTIONAL",
                        "DOCUMENTATION",
                        "OTHER",
                      ].map((value) => ({ value, label: value }))}
                    />
                  </Field>
                  <Field label="Affected quantity">
                    <Input
                      type="number"
                      min={1}
                      value={quantity}
                      onChange={(e) => setQuantity(Number(e.target.value))}
                    />
                  </Field>
                </div>
                <Button
                  disabled={
                    raise.isPending || ncrTitle.length < 3 || quantity < 1
                  }
                  onClick={() => raise.mutate()}
                >
                  Save results & raise NCR
                </Button>
              </>
            )}
          </section>
        )}
      <RecordPanel
        entityType="INCOMING_INSPECTION"
        entityId={id}
        attachments={false}
      />
      {!!legacyHistory.data?.length && (
        <section className="my-4 space-y-2 rounded border p-4">
          <h2 className="font-semibold">Imported notes & activity</h2>
          <p className="text-xs text-muted-foreground">
            Original legacy history, separate from SQMS audit events. Original
            timestamp text is retained.
          </p>
          {legacyHistory.data.map((h) => (
            <div
              key={`${h.entity}:${h.sourceId}`}
              className="border-t pt-2 text-sm"
            >
              <p>
                {h.snapshot.created_at} ·{" "}
                {h.snapshot.user_name ??
                  h.snapshot.author_name ??
                  "Historical user"}{" "}
                · {h.snapshot.action ?? "Note"}
              </p>
              <p className="whitespace-pre-wrap">
                {h.snapshot.note ??
                  h.snapshot.body ??
                  h.snapshot.content ??
                  h.snapshot.notes ??
                  h.snapshot.message}
              </p>
            </div>
          ))}
        </section>
      )}
      {r.nonconformances.map((n) => (
        <p key={n.id}>
          <Link className="underline" href={`/quality/ncrs/${n.id}`}>
            {n.number}
          </Link>{" "}
          · {n.status}
        </p>
      ))}
    </>
  );
}
