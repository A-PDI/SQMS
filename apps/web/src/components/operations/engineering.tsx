"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApiMutation } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Alert, ErrorAlert } from "@/components/ui/feedback";
import type { Plan } from "./incoming";
type Data = Record<string, any>;
export function EngineeringFeatures({
  partId,
  revisions,
}: {
  partId: string;
  revisions: { id: string; label: string }[];
}) {
  const { can } = useSession();
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [feature, setFeature] = useState("");
  const [revision, setRevision] = useState("");
  const [characteristic, setCharacteristic] = useState("");
  const [balloon, setBalloon] = useState("");
  const [compatibility, setCompatibility] = useState("UNCERTAIN");
  const [reason, setReason] = useState("");
  const features = useQuery({
    queryKey: ["part-features", partId],
    queryFn: () => api<Data[]>(`/parts/${partId}/features`),
  });
  const detail = useQuery({
    queryKey: ["feature-map-revision", revision],
    queryFn: () => api<Data>(`/product-configurations/revisions/${revision}`),
    enabled: !!revision,
  });
  const create = useApiMutation(
    () =>
      api("/features", {
        method: "POST",
        body: { internalPartId: partId, key, name },
      }),
    {
      invalidate: [["part-features", partId]],
      success: "Stable feature created",
      onSuccess: () => {
        setKey("");
        setName("");
      },
    },
  );
  const map = useApiMutation(
    () =>
      api("/feature-revision-mappings", {
        method: "POST",
        body: {
          featureId: feature,
          configurationRevisionId: revision,
          characteristicId: characteristic || undefined,
          balloonAlias: balloon || undefined,
          compatibility,
          reason,
        },
      }),
    {
      invalidate: [["part-features", partId]],
      success: "Reviewed revision mapping recorded",
    },
  );
  return (
    <section className="my-4 space-y-3 rounded border p-4">
      <h2 className="font-semibold">
        Physical feature identity & revision comparisons
      </h2>
      <p className="text-sm text-muted-foreground">
        Use a permanent feature key for the physical feature. Balloon numbers
        are revision aliases. Uncertain and incompatible mappings remain
        visible.
      </p>
      {[features.error, create.error, map.error].map((error, i) => (
        <ErrorAlert key={i} error={error} />
      ))}
      {features.data?.map((f) => (
        <div className="border-t pt-2 text-sm" key={f.id}>
          <strong>
            {f.key} · {f.name}
          </strong>
          {f.revisionMappings.map((m: Data) => (
            <p key={m.id}>
              {revisions.find((r) => r.id === m.configurationRevisionId)
                ?.label ?? m.configurationRevisionId}{" "}
              · balloon {m.balloonAlias || "not specified"} · {m.compatibility}{" "}
              · {m.reason}
            </p>
          ))}
        </div>
      ))}
      {can("configuration:write") && (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Permanent feature key">
              <Input value={key} onChange={(e) => setKey(e.target.value)} />
            </Field>
            <Field label="Physical feature name">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Button
              className="self-end"
              disabled={
                key.trim().length < 2 ||
                name.trim().length < 3 ||
                create.isPending
              }
              onClick={() => create.mutate()}
            >
              Add feature
            </Button>
          </div>
          <div className="grid gap-3 border-t pt-3 md:grid-cols-2">
            <Field label="Feature">
              <Select
                value={feature}
                onChange={(e) => setFeature(e.target.value)}
                placeholder="Choose a stable feature"
                options={(features.data ?? []).map((f) => ({
                  value: f.id,
                  label: `${f.key} · ${f.name}`,
                }))}
              />
            </Field>
            <Field label="Configuration revision">
              <Select
                value={revision}
                onChange={(e) => {
                  setRevision(e.target.value);
                  setCharacteristic("");
                }}
                placeholder="Choose a revision"
                options={revisions.map((r) => ({
                  value: r.id,
                  label: r.label,
                }))}
              />
            </Field>
            <Field label="FAI characteristic, if defined">
              <Select
                value={characteristic}
                onChange={(e) => setCharacteristic(e.target.value)}
                placeholder="No FAI characteristic link"
                options={(detail.data?.characteristics ?? []).map(
                  (c: Data) => ({
                    value: c.id,
                    label: `${c.charNumber} · ${c.name}`,
                  }),
                )}
              />
            </Field>
            <Field label="Drawing balloon alias">
              <Input
                value={balloon}
                onChange={(e) => setBalloon(e.target.value)}
              />
            </Field>
            <Field label="Comparison compatibility">
              <Select
                value={compatibility}
                onChange={(e) => setCompatibility(e.target.value)}
                options={["COMPATIBLE", "INCOMPATIBLE", "UNCERTAIN"].map(
                  (value) => ({ value, label: value }),
                )}
              />
            </Field>
            <Field label="Engineering review rationale">
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          </div>
          <Button
            disabled={
              !feature || !revision || reason.trim().length < 5 || map.isPending
            }
            onClick={() => map.mutate()}
          >
            Record revision mapping
          </Button>
        </>
      )}
    </section>
  );
}
export function PartSpecifications({ partId }: { partId: string }) {
  const { can } = useSession();
  const [revision, setRevision] = useState("");
  const [data, setData] = useState<Data>({});
  const plans = useQuery({
    queryKey: ["inspection-plans"],
    queryFn: () => api<Plan[]>("/inspection-plans"),
    enabled: can("inspection:read"),
  });
  const specs = useQuery({
    queryKey: ["part-specifications", partId],
    queryFn: () =>
      api<Data[]>("/part-specifications", {
        query: { internalPartId: partId },
      }),
    enabled: can("inspection:read"),
  });
  const selected = specs.data?.find((s) => s.planRevisionId === revision);
  const plan = (plans.data ?? [])
    .flatMap((p) => p.revisions)
    .find((r) => r.id === revision);
  useEffect(() => {
    setData(structuredClone(selected?.data ?? {}));
  }, [revision, selected?.id, selected?.version]);
  const save = useApiMutation(
    () =>
      api("/part-specifications", {
        method: "POST",
        body: {
          internalPartId: partId,
          planRevisionId: revision,
          data,
          expectedVersion: selected?.version,
        },
      }),
    {
      invalidate: [["part-specifications", partId]],
      success: "Part specification revision saved",
    },
  );
  if (!can("inspection:read")) return null;
  return (
    <section className="my-4 space-y-3 rounded border p-4">
      <h2 className="font-semibold">Part inspection specifications</h2>
      <Alert>
        New inspections freeze these specifications. Existing results keep their
        original snapshot.
      </Alert>
      <Field label="Inspection plan revision">
        <Select
          value={revision}
          onChange={(e) => setRevision(e.target.value)}
          placeholder="Choose a plan revision"
          options={(plans.data ?? []).flatMap((p) =>
            p.revisions.map((r) => ({
              value: r.id,
              label: `${p.code} · rev ${r.revision} · ${r.status}`,
            })),
          )}
        />
      </Field>
      {plan && (
        <div className="grid gap-3 md:grid-cols-2">
          {Object.entries(plan.definition.sections ?? {}).flatMap(
            ([key, raw]) =>
              ((raw as Data).items ?? []).map((row: Data) => (
                <Field
                  key={`${key}.${row.id}`}
                  label={`${(raw as Data).title} · ${row.measurement ?? row.name ?? row.id}`}
                >
                  <Input
                    disabled={!can("inspection_plan:manage")}
                    value={data[`${key}.${row.id}`] ?? row.spec ?? ""}
                    onChange={(e) =>
                      setData((d) => ({
                        ...d,
                        [`${key}.${row.id}`]: e.target.value,
                      }))
                    }
                  />
                </Field>
              )),
          )}
          {(plan.definition.characteristics ?? []).map((c: Data) => (
            <div key={c.key} className="rounded border p-3">
              <strong className="text-sm">{c.name ?? c.key}</strong>
              {["minimum", "maximum", "unit", "method", "specification"].map(
                (field) => (
                  <Field key={field} label={field}>
                    <Input
                      disabled={!can("inspection_plan:manage")}
                      type={
                        ["minimum", "maximum"].includes(field)
                          ? "number"
                          : "text"
                      }
                      step="any"
                      value={
                        data.characteristics?.[c.key]?.[field] ?? c[field] ?? ""
                      }
                      onChange={(e) =>
                        setData((d) => ({
                          ...d,
                          characteristics: {
                            ...d.characteristics,
                            [c.key]: {
                              ...d.characteristics?.[c.key],
                              [field]: ["minimum", "maximum"].includes(field)
                                ? e.target.value === ""
                                  ? null
                                  : Number(e.target.value)
                                : e.target.value,
                            },
                          },
                        }))
                      }
                    />
                  </Field>
                ),
              )}
            </div>
          ))}
        </div>
      )}
      <ErrorAlert error={save.error ?? specs.error} />
      {can("inspection_plan:manage") && (
        <Button
          disabled={!revision || save.isPending}
          onClick={() => save.mutate()}
        >
          Save part specifications
        </Button>
      )}
    </section>
  );
}
