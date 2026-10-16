"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, API_BASE, uploadFile, type Page } from "@/lib/api";
import { useApiMutation } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Alert, ErrorAlert } from "@/components/ui/feedback";
import type { Plan } from "./incoming";

type Data = Record<string, any>;
const TYPES = [
  "pfn_checklist",
  "pfn_visual",
  "dimensional",
  "pass_fail_checklist",
  "general_measurements",
  "camshaft_bore",
  "fire_ring_protrusion",
  "groove_specs",
  "valve_recession",
  "vacuum_test",
];
const empty = () => ({
  form_no: "",
  header_schema: [
    "part_number",
    "po_number",
    "description",
    "date_received",
    "inspector_name",
    "lot_serial_no",
  ],
  sections: {
    receiving: {
      title: "A. Receiving & documentation",
      section_type: "pfn_checklist",
      items: [] as Data[],
    },
    visual: {
      title: "B. Visual inspection",
      section_type: "pass_fail_checklist",
      items: [] as Data[],
    },
  },
  characteristics: [] as Data[],
});
export function InspectionPlans() {
  const { can } = useSession();
  const plans = useQuery({
    queryKey: ["inspection-plans"],
    queryFn: () => api<Plan[]>("/inspection-plans"),
  });
  const [selected, setSelected] = useState("");
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [definition, setDefinition] = useState<Data>(empty());
  const [partSearch, setPartSearch] = useState("");
  const [partId, setPartId] = useState("");
  const [preview, setPreview] = useState<Data | null>(null);
  const [fileId, setFileId] = useState("");
  const parts = useQuery({
    queryKey: ["plan-parts", partSearch],
    queryFn: () =>
      api<Page<Data>>("/products", { query: { q: partSearch, pageSize: 100 } }),
  });
  const features = useQuery({
    queryKey: ["plan-features", partId],
    queryFn: () => api<Data[]>(`/parts/${partId}/features`),
    enabled: !!partId,
  });
  const install = useApiMutation(
    () => api("/inspection-plans/install-standard", { method: "POST" }),
    {
      invalidate: [["inspection-plans"]],
      success: "Source plan defaults installed for review",
    },
  );
  const save = useApiMutation(
    () =>
      api(
        selected
          ? `/inspection-plans/${selected}/revisions`
          : "/inspection-plans",
        {
          method: "POST",
          body: selected
            ? { definition: { ...definition, title } }
            : {
                code,
                title,
                definition: { ...definition, form_no: code, title },
              },
        },
      ),
    { invalidate: [["inspection-plans"]], success: "Draft revision created" },
  );
  const release = useApiMutation(
    (id: string) =>
      api(`/inspection-plans/revisions/${id}/release`, { method: "POST" }),
    { invalidate: [["inspection-plans"]], success: "Plan revision released" },
  );
  const importFile = useApiMutation(
    async (file: File) => {
      const f = await uploadFile(file);
      setFileId(f.id);
      return f;
    },
    { success: "Catalogue uploaded; wait for scanning before preview" },
  );
  const importRows = useApiMutation(
    (commit: boolean) =>
      api<Data>("/part-specifications/import", {
        method: "POST",
        body: { fileId, commit },
      }),
    {
      onSuccess: setPreview,
      success: (r) =>
        r.committed ? "Catalogue imported" : "Import preview ready",
    },
  );
  const setSection = (key: string, change: Data) =>
    setDefinition((d) => ({
      ...d,
      sections: { ...d.sections, [key]: { ...d.sections[key], ...change } },
    }));
  return (
    <>
      <PageHeader
        title="Inspection plans"
        description="Review, revise and release definitions for standard, custom and miscellaneous inspections."
        actions={
          can("inspection_plan:manage") ? (
            <Button
              variant="outline"
              disabled={install.isPending}
              onClick={() => install.mutate()}
            >
              Install standard plan drafts
            </Button>
          ) : undefined
        }
      />
      {[
        plans.error,
        install.error,
        save.error,
        release.error,
        importFile.error,
        importRows.error,
      ].map((error, i) => (
        <ErrorAlert key={i} error={error} />
      ))}
      <div className="mb-6 overflow-auto rounded border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="p-3">Plan</th>
              <th>Revision</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(plans.data ?? []).flatMap((p) =>
              p.revisions.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-3">
                    {p.code} · {p.title}
                  </td>
                  <td>{r.revision}</td>
                  <td>{r.status}</td>
                  <td className="space-x-2">
                    {can("inspection_plan:manage") && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelected(p.id);
                            setCode(p.code);
                            setTitle(p.title);
                            setDefinition(structuredClone(r.definition));
                          }}
                        >
                          Revise / customize
                        </Button>
                        {r.status === "DRAFT" && (
                          <Button
                            size="sm"
                            disabled={release.isPending}
                            onClick={() => release.mutate(r.id)}
                          >
                            Release revision
                          </Button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
      {can("inspection_plan:manage") && (
        <section className="space-y-4 rounded border p-5">
          <h2 className="font-semibold">
            {selected
              ? `New revision of ${code}`
              : "Build a custom or miscellaneous plan"}
          </h2>
          <Alert>
            Released definitions remain fixed. Saving creates a draft revision;
            release it after review.
          </Alert>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Plan code">
              <Input
                value={code}
                disabled={!!selected}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
            <Field label="Plan title">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
          </div>
          {Object.entries(definition.sections ?? {}).map(([key, raw]) => {
            const s = raw as Data;
            return (
              <div key={key} className="space-y-3 rounded border p-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Section title">
                    <Input
                      value={s.title}
                      onChange={(e) =>
                        setSection(key, { title: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Section type">
                    <Select
                      value={s.section_type}
                      onChange={(e) =>
                        setSection(key, { section_type: e.target.value })
                      }
                      options={TYPES.map((value) => ({
                        value,
                        label: value.replaceAll("_", " "),
                      }))}
                    />
                  </Field>
                </div>
                {[
                  "camshaft_bore",
                  "fire_ring_protrusion",
                  "groove_specs",
                  "valve_recession",
                  "vacuum_test",
                ].includes(s.section_type) && (
                  <Field
                    label={
                      s.section_type === "camshaft_bore"
                        ? "Bore count"
                        : "Cylinder count"
                    }
                  >
                    <Input
                      type="number"
                      min={1}
                      max={24}
                      value={s.bore_count ?? s.cylinder_count ?? 6}
                      onChange={(e) =>
                        setSection(
                          key,
                          s.section_type === "camshaft_bore"
                            ? { bore_count: Number(e.target.value) }
                            : { cylinder_count: Number(e.target.value) },
                        )
                      }
                    />
                  </Field>
                )}
                {(s.items ?? []).map((row: Data, index: number) => (
                  <div
                    key={row.id}
                    className="grid items-end gap-2 md:grid-cols-4"
                  >
                    <Field label="Feature / inspection item">
                      <Input
                        value={row.measurement ?? row.name ?? ""}
                        onChange={(e) =>
                          setSection(key, {
                            items: s.items.map((r: Data, p: number) =>
                              p === index
                                ? {
                                    ...r,
                                    name: e.target.value,
                                    measurement: e.target.value,
                                  }
                                : r,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field label="Requirement / method">
                      <Input
                        value={row.requirement ?? row.location ?? ""}
                        onChange={(e) =>
                          setSection(key, {
                            items: s.items.map((r: Data, p: number) =>
                              p === index
                                ? {
                                    ...r,
                                    requirement: e.target.value,
                                    location: e.target.value,
                                  }
                                : r,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field label="Specification">
                      <Input
                        value={row.spec ?? ""}
                        onChange={(e) =>
                          setSection(key, {
                            items: s.items.map((r: Data, p: number) =>
                              p === index ? { ...r, spec: e.target.value } : r,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Button
                      variant="outline"
                      onClick={() =>
                        setSection(key, {
                          items: s.items.filter(
                            (_: Data, p: number) => p !== index,
                          ),
                        })
                      }
                    >
                      Remove item
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setSection(key, {
                      items: [
                        ...(s.items ?? []),
                        {
                          id: crypto.randomUUID(),
                          name: "",
                          measurement: "",
                          requirement: "",
                          spec: "",
                          entry: true,
                        },
                      ],
                    })
                  }
                >
                  Add inspection item
                </Button>
              </div>
            );
          })}
          <Button
            variant="outline"
            onClick={() => {
              const key = `section_${Object.keys(definition.sections).length + 1}`;
              setSection(key, {
                title: "Additional inspection",
                section_type: "dimensional",
                items: [],
              });
            }}
          >
            Add section
          </Button>
          <details className="rounded border p-4">
            <summary className="cursor-pointer font-medium">
              Structured characteristics and quality-history identity
            </summary>
            <p className="my-2 text-xs text-muted-foreground">
              Use an engineering-defined physical feature for recurrence across
              FAI and incoming inspections. Drawing balloon numbers are aliases.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                aria-label="Find characteristic part"
                placeholder="Search canonical parts"
                value={partSearch}
                onChange={(e) => setPartSearch(e.target.value)}
              />
              <Select
                value={partId}
                onChange={(e) => setPartId(e.target.value)}
                placeholder="Select part"
                options={(parts.data?.items ?? []).map((p) => ({
                  value: p.id,
                  label: `${p.partNumber} · ${p.description}`,
                }))}
              />
            </div>
            {(definition.characteristics ?? []).map((c: Data, i: number) => {
              const update = (v: Data) =>
                setDefinition((d) => ({
                  ...d,
                  characteristics: d.characteristics.map(
                    (r: Data, p: number) => (p === i ? { ...r, ...v } : r),
                  ),
                }));
              return (
                <div
                  key={i}
                  className="mt-3 grid gap-2 rounded border p-3 md:grid-cols-4"
                >
                  <Field label="Characteristic key">
                    <Input
                      value={c.key}
                      onChange={(e) => update({ key: e.target.value })}
                    />
                  </Field>
                  <Field label="Name">
                    <Input
                      value={c.name ?? ""}
                      onChange={(e) => update({ name: e.target.value })}
                    />
                  </Field>
                  <Field label="Stable physical feature">
                    <Select
                      value={c.featureId ?? ""}
                      onChange={(e) =>
                        update({ featureId: e.target.value || undefined })
                      }
                      placeholder="Unmapped"
                      options={(features.data ?? []).map((f) => ({
                        value: f.id,
                        label: `${f.key} · ${f.name}`,
                      }))}
                    />
                  </Field>
                  <Field label="Units">
                    <Input
                      value={c.unit ?? ""}
                      onChange={(e) => update({ unit: e.target.value })}
                    />
                  </Field>
                  <Field label="Minimum">
                    <Input
                      type="number"
                      step="any"
                      value={c.minimum ?? ""}
                      onChange={(e) =>
                        update({
                          minimum:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        })
                      }
                    />
                  </Field>
                  <Field label="Maximum">
                    <Input
                      type="number"
                      step="any"
                      value={c.maximum ?? ""}
                      onChange={(e) =>
                        update({
                          maximum:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        })
                      }
                    />
                  </Field>
                  <Field label="Measurement method">
                    <Input
                      value={c.method ?? ""}
                      onChange={(e) => update({ method: e.target.value })}
                    />
                  </Field>
                  <label className="self-center text-sm">
                    <input
                      type="checkbox"
                      checked={!!c.shared}
                      onChange={(e) => update({ shared: e.target.checked })}
                    />{" "}
                    Once per receipt
                  </label>
                </div>
              );
            })}
            <Button
              className="mt-3"
              variant="outline"
              onClick={() =>
                setDefinition((d) => ({
                  ...d,
                  characteristics: [
                    ...(d.characteristics ?? []),
                    {
                      key: `C${(d.characteristics ?? []).length + 1}`,
                      name: "",
                      sectionKey: "measurements",
                      unit: "",
                      defectCode: "DIMENSIONAL",
                    },
                  ],
                }))
              }
            >
              Add structured characteristic
            </Button>
          </details>
          <div className="flex gap-3">
            <Button
              disabled={!code.trim() || !title.trim() || save.isPending}
              onClick={() => save.mutate()}
            >
              {selected ? "Create next draft revision" : "Create draft plan"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setSelected("");
                setCode("");
                setTitle("");
                setDefinition(empty());
              }}
            >
              Start another custom plan
            </Button>
          </div>
        </section>
      )}
      {can("inspection_plan:manage", "product:write") && (
        <section className="mt-6 space-y-3 rounded border p-5">
          <h2 className="font-semibold">Part catalogue import / export</h2>
          <p className="text-sm text-muted-foreground">
            XLSX or CSV headers: Part Number, Description, Product Type. Keep
            part numbers as text. Preview identifies ambiguous plan matches.
          </p>
          <a
            className="underline"
            href={`${API_BASE}/part-specifications/export.xlsx`}
          >
            Export catalogue
          </a>
          <Input
            type="file"
            accept=".xlsx,.csv"
            onChange={(e) => {
              if (e.target.files?.[0]) importFile.mutate(e.target.files[0]);
            }}
          />
          <div className="flex gap-3">
            <Button
              disabled={!fileId || importRows.isPending}
              onClick={() => importRows.mutate(false)}
            >
              Preview import
            </Button>
            <Button
              variant="outline"
              disabled={
                !preview ||
                preview.rows?.some((r: Data) => r.error) ||
                preview.committed ||
                importRows.isPending
              }
              onClick={() => importRows.mutate(true)}
            >
              Import reviewed catalogue
            </Button>
          </div>
          {preview && (
            <div className="max-h-80 overflow-auto text-sm">
              {preview.rows?.map((r: Data) => (
                <p key={r.row} className={r.error ? "text-destructive" : ""}>
                  Row {r.row}: {r.partNumber} · {r.productType} ·{" "}
                  {r.error ?? (preview.committed ? "Imported" : "Ready")}
                </p>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
