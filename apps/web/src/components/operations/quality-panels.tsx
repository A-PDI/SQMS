"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  api,
  API_BASE,
  fileDownloadUrl,
  filePreviewUrl,
  uploadFile,
} from "@/lib/api";
import { useApiMutation } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Alert, ErrorAlert } from "@/components/ui/feedback";
import { PageHeader } from "@/components/shell/page-header";

type Data = Record<string, any>;
export function FaiNcrAction({
  faiId,
  results,
  title,
}: {
  faiId: string;
  results: { id: string; outcome: string; firstArticleId: string | null }[];
  title: string;
}) {
  const { can } = useSession();
  const [created, setCreated] = useState<string | null>(null);
  const [code, setCode] = useState("DIMENSIONAL");
  const [quantity, setQuantity] = useState(1);
  const [requestKey] = useState(() => crypto.randomUUID());
  const raise = useApiMutation(
    () =>
      api<Data>(`/first-articles/${faiId}/ncrs`, {
        method: "POST",
        body: {
          requestKey,
          title: `FAI nonconformance: ${title}`.slice(0, 250),
          resultIds: results
            .filter((r) => r.firstArticleId === faiId && r.outcome === "FAIL")
            .map((r) => r.id),
          defectCode: code,
          quantityAffected: quantity,
        },
      }),
    {
      success: "NCR created with FAI evidence",
      onSuccess: (n) => setCreated(n.id),
    },
  );
  if (!can("ncr:write")) return null;
  return (
    <details className="mt-2 rounded border p-2">
      <summary className="cursor-pointer text-sm">Raise NCR from FAI</summary>
      <ErrorAlert error={raise.error} />
      {created ? (
        <Link href={`/quality/ncrs/${created}`} className="text-sm underline">
          Open linked NCR
        </Link>
      ) : (
        <div className="my-2 grid gap-2">
          <Field label="Defect classification">
            <Select
              value={code}
              onChange={(e) => setCode(e.target.value)}
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
          <Button
            size="sm"
            variant="outline"
            disabled={raise.isPending || quantity < 1}
            onClick={() => raise.mutate()}
          >
            Create linked NCR
          </Button>
        </div>
      )}
    </details>
  );
}
export function NcrReportPanel({ id }: { id: string }) {
  const { can } = useSession();
  const query = useQuery({
    queryKey: ["ncr", id],
    queryFn: () => api<Data>(`/ncrs/${id}`),
  });
  const n = query.data;
  const recurrence = useQuery({
    queryKey: ["ncr-recurrence", id],
    queryFn: () => api<Data>(`/ncrs/${id}/recurrence`),
  });
  const attachments = useQuery({
    queryKey: ["ncr-report-photos", id],
    queryFn: () =>
      api<Data[]>("/record-attachments", {
        query: { entityType: "NCR", entityId: id },
      }),
    refetchInterval: (q) =>
      q.state.data?.some((a: Data) => a.file.status === "QUARANTINED")
        ? 2000
        : false,
  });
  const [sections, setSections] = useState<Data[] | null>(null);
  const [caption, setCaption] = useState("");
  const [section, setSection] = useState("");
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (n && sections === null) setSections(n.reportSections ?? []);
  }, [n, sections]);
  const save = useApiMutation(
    () =>
      api(`/ncrs/${id}/report-sections`, {
        method: "POST",
        body: {
          expectedVersion: n?.version,
          sections: sections?.map((s) => ({
            id: s.id,
            title: s.title,
            body: s.body,
          })),
        },
      }),
    {
      invalidate: [["ncr", id]],
      success: "NCR report saved",
      onSuccess: () => setSections(null),
    },
  );
  const upload = useApiMutation(
    async (file: File) => {
      const f = await uploadFile(file);
      return api("/record-attachments", {
        method: "POST",
        body: {
          entityType: "NCR",
          entityId: id,
          fileId: f.id,
          description: caption,
          context: section ? { reportSectionId: section } : {},
        },
      });
    },
    {
      invalidate: [["ncr-report-photos", id]],
      success: "NCR photo uploaded for scanning",
    },
  );
  const editCaption = useApiMutation(
    (a: Data) =>
      api(`/record-attachments/${a.id}`, {
        method: "PATCH",
        body: {
          expectedVersion: a.version,
          description: a.description,
          context: a.context ?? {},
        },
      }),
    { invalidate: [["ncr-report-photos", id]], success: "Photo caption saved" },
  );
  const remove = useApiMutation(
    (attachmentId: string) =>
      api(`/record-attachments/${attachmentId}`, { method: "DELETE" }),
    {
      invalidate: [["ncr-report-photos", id]],
      success: "Photo removed from the report",
    },
  );
  const decision = useApiMutation(
    (d: { id: string; status: string }) =>
      api(`/recurrence-reviews/${d.id}/decision`, {
        method: "POST",
        body: { status: d.status, reason },
      }),
    {
      invalidate: [["ncr-recurrence", id]],
      success: "Recurrence decision recorded",
    },
  );
  const [captions, setCaptions] = useState<Record<string, string>>({});
  if (!n) return null;
  const editable =
    can("ncr:write") &&
    ["OPEN", "CONTAINED", "UNDER_INVESTIGATION"].includes(n.status);
  return (
    <section className="mt-6 space-y-4 rounded border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">NCR report & quality history</h2>
        <a href={`${API_BASE}/ncrs/${id}/pdf`}>
          <Button variant="outline">NCR PDF</Button>
        </a>
      </div>
      {n.legacyException && (
        <Alert tone="warning">
          Historical NCR. Missing historical approvals and unresolved context
          are preserved as legacy exceptions.
        </Alert>
      )}
      <div className="flex flex-wrap gap-3 text-sm">
        {n.incomingInspection && (
          <Link
            className="underline"
            href={`/incoming/${n.incomingInspection.id}`}
          >
            Source inspection {n.incomingInspection.number}
          </Link>
        )}
        {n.firstArticle && n.qualification && (
          <Link
            className="underline"
            href={`/qualifications/${n.qualification.id}`}
          >
            FAI origin {n.firstArticle.number}
          </Link>
        )}
      </div>
      {(n.defectLines ?? []).map((d: Data) => (
        <div key={d.id} className="rounded bg-muted p-3 text-sm">
          <strong>
            {d.defectCode} · {d.deviationDirection} · {d.severity}
          </strong>
          <p>{d.actualCondition}</p>
          <p className="text-xs text-muted-foreground">
            {d.featureId
              ? "Physical feature identity recorded"
              : "Characteristic identity needs review"}{" "}
            · Affected quantity {d.quantityAffected}
          </p>
        </div>
      ))}
      {(sections ?? []).map((s, i) => (
        <div key={s.id ?? `new-${i}`} className="space-y-2 rounded border p-3">
          <Field label="Report section title">
            <Input
              disabled={!editable}
              value={s.title}
              onChange={(e) =>
                setSections((prev) =>
                  prev!.map((r, p) =>
                    p === i ? { ...r, title: e.target.value } : r,
                  ),
                )
              }
            />
          </Field>
          <Field label="Report narrative">
            <Textarea
              disabled={!editable}
              rows={5}
              value={s.body}
              onChange={(e) =>
                setSections((prev) =>
                  prev!.map((r, p) =>
                    p === i ? { ...r, body: e.target.value } : r,
                  ),
                )
              }
            />
          </Field>
          {editable && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={i === 0}
                onClick={() =>
                  setSections((prev) => {
                    const rows = [...prev!];
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
                  setSections((prev) => prev!.filter((_, p) => p !== i))
                }
              >
                Remove section
              </Button>
            </div>
          )}
        </div>
      ))}
      {editable && (
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={() =>
              setSections((prev) => [...(prev ?? []), { title: "", body: "" }])
            }
          >
            Add narrative section
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            Save report narrative
          </Button>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {(attachments.data ?? []).map((a) => (
          <div key={a.id} className="space-y-2 rounded border p-3">
            {a.file.status === "CLEAN" &&
              a.file.contentType.startsWith("image/") && (
                <a
                  href={fileDownloadUrl(a.file.id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    className="max-h-48 rounded object-contain"
                    src={filePreviewUrl(a.file.id)}
                    alt={a.description || a.file.originalFilename}
                  />
                </a>
              )}
            <p className="text-xs">
              {a.file.originalFilename} · {a.file.status}
            </p>
            <Textarea
              aria-label="NCR photo caption"
              disabled={!editable}
              value={captions[a.id] ?? a.description ?? ""}
              onChange={(e) =>
                setCaptions((c) => ({ ...c, [a.id]: e.target.value }))
              }
            />
            {editable && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    editCaption.mutate({
                      ...a,
                      description: captions[a.id] ?? a.description ?? "",
                    })
                  }
                >
                  Save caption
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => remove.mutate(a.id)}
                >
                  Remove photo
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
      {editable && (
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="New photo caption">
            <Textarea
              value={caption}
              maxLength={500}
              onChange={(e) => setCaption(e.target.value)}
            />
          </Field>
          <Field label="Photo section">
            <Select
              value={section}
              onChange={(e) => setSection(e.target.value)}
              placeholder="General photos"
              options={(n.reportSections ?? []).map((s: Data) => ({
                value: s.id,
                label: s.title || "Untitled section",
              }))}
            />
          </Field>
          <Field label="Upload supporting photo">
            <Input
              type="file"
              accept="image/png,image/jpeg"
              onChange={(e) => {
                if (e.target.files?.[0]) upload.mutate(e.target.files[0]);
                e.target.value = "";
              }}
            />
          </Field>
        </div>
      )}
      {!!recurrence.data?.candidates?.length && (
        <div className="space-y-3 border-t pt-4">
          <h3 className="font-medium">Candidate recurring defects</h3>
          <Alert>
            Matching history supports review. Recurrence does not by itself
            prove a corrective action failed.
          </Alert>
          {recurrence.data.candidates.map((c: Data) => {
            const review = recurrence.data.reviews.find(
              (r: Data) => r.historicalNcrId === c.ncr.id,
            );
            return (
              <div key={c.ncr.id} className="rounded border p-3 text-sm">
                <Link className="underline" href={`/quality/ncrs/${c.ncr.id}`}>
                  {c.ncr.number} · {c.ncr.title}
                </Link>
                <p>
                  {c.ncr.source} · {c.ncr.status} ·{" "}
                  {review?.status ?? "CANDIDATE"}
                </p>
                <div className="my-2 space-y-1">
                  {c.lines.map((l: Data, i: number) => (
                    <p key={i}>
                      Current condition: {l.currentCondition ?? "Review source"}{" "}
                      · Historical condition: {l.historicalCondition} · Units:{" "}
                      {l.historicalSpecification?.unit ?? "not recorded"}
                    </p>
                  ))}
                  {c.ncr.correctiveActions?.map((a: Data) => (
                    <p key={a.id}>
                      <Link
                        className="underline"
                        href={`/quality/scars/${a.id}`}
                      >
                        {a.number}
                      </Link>{" "}
                      · {a.status} · effectiveness{" "}
                      {a.effectivenessResult ?? "not verified"}
                    </p>
                  ))}
                </div>
                <ul className="list-inside list-disc text-xs">
                  {c.lines
                    .flatMap((l: Data) => l.explanation)
                    .filter(
                      (v: string, i: number, all: string[]) =>
                        all.indexOf(v) === i,
                    )
                    .map((v: string) => (
                      <li key={v}>{v}</li>
                    ))}
                </ul>
                {can("ncr:disposition") && review?.status === "CANDIDATE" && (
                  <div className="mt-3 flex gap-2">
                    <Input
                      aria-label="Recurrence review reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Basis for your decision"
                    />
                    <Button
                      disabled={reason.trim().length < 5 || decision.isPending}
                      onClick={() =>
                        decision.mutate({ id: review.id, status: "CONFIRMED" })
                      }
                    >
                      Confirm recurrence
                    </Button>
                    <Button
                      variant="outline"
                      disabled={reason.trim().length < 5 || decision.isPending}
                      onClick={() =>
                        decision.mutate({ id: review.id, status: "DISMISSED" })
                      }
                    >
                      Dismiss with reason
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <DefectClassification ncr={n} />
      <ScarLinks ncr={n} />
      {[
        save.error,
        upload.error,
        editCaption.error,
        remove.error,
        recurrence.error,
        decision.error,
      ].map((error, i) => (
        <ErrorAlert key={i} error={error} />
      ))}
    </section>
  );
}
export function QualityHistory({
  supplierId,
  partId,
}: {
  supplierId: string;
  partId?: string;
}) {
  const { can } = useSession();
  const allowed = can(
    "supplier:read",
    "qualification:read",
    "inspection:read",
    "ncr:read",
    "scar:read",
    "change:read",
  );
  const query = useQuery({
    enabled: allowed,
    queryKey: ["supplier-quality-history", supplierId, partId],
    queryFn: () =>
      api<Data>(`/suppliers/${supplierId}/quality-history`, {
        query: { internalPartId: partId },
      }),
  });
  const r = query.data;
  if (!allowed) return null;
  if (!r) return <ErrorAlert error={query.error} />;
  return (
    <section className="mt-5 space-y-4 rounded border p-4">
      <h2 className="font-semibold">Connected quality history</h2>
      <p className="text-sm text-muted-foreground">
        Qualification and production history, including closed records.
        Unattributed records remain outside supplier metrics.
      </p>
      {[
        [
          "Supplier evaluations",
          "supplierQualifications",
          "/suppliers/" + supplierId,
        ],
        ["Product qualifications & FAI", "qualifications", "/qualifications/"],
        ["Product approvals", "approvals", "/products/supplier-products/"],
        ["Incoming inspections", "incoming", "/incoming/"],
        ["Nonconformances", "ncrs", "/quality/ncrs/"],
        ["Corrective actions", "scars", "/quality/scars/"],
        ["Engineering changes", "changes", "/changes/"],
      ].map(([label, key, base]) => (
        <div key={key}>
          <h3 className="mb-2 text-sm font-medium">
            {label} · {r[key].length}
          </h3>
          {r[key].map((x: Data) => (
            <p key={x.id} className="text-sm">
              <Link
                className="underline"
                href={
                  key === "supplierQualifications"
                    ? base
                    : `${base}${key === "approvals" ? x.supplierProductId : x.id}`
                }
              >
                {x.number ?? x.title}
              </Link>{" "}
              · {x.status}
            </p>
          ))}
        </div>
      ))}
    </section>
  );
}
export function Drawings() {
  const [q, setQ] = useState("");
  const query = useQuery({
    queryKey: ["drawings", q],
    queryFn: () => api<Data>("/drawings", { query: { q, pageSize: 100 } }),
  });
  return (
    <>
      <PageHeader
        title="Drawings & engineering documents"
        description="Controlled document revisions and preserved historical drawings"
        actions={
          <Link href="/documents/new">
            <Button>Add controlled document</Button>
          </Link>
        }
      />
      <Input
        className="mb-4 max-w-md"
        aria-label="Find drawings by part number"
        placeholder="Part number"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <ErrorAlert error={query.error} />
      <div className="space-y-4">
        {query.data?.items?.map((d: Data) => (
          <section className="rounded border p-4" key={d.id}>
            <Link className="font-medium underline" href={`/documents/${d.id}`}>
              {d.docNumber} · {d.title}
            </Link>
            <p className="my-2 text-sm">
              {d.status} ·{" "}
              {d.releasedRevisionId
                ? "Released revision recorded"
                : "Controlled release pending"}
            </p>
            {d.revisions.map((r: Data) => (
              <div key={r.id} className="mt-2 text-sm">
                <strong>
                  Revision {r.revisionLabel} · {r.status}
                </strong>
                <p>{r.changeSummary}</p>
                {r.files.map((f: Data) => (
                  <p key={f.id}>
                    <a className="underline" href={fileDownloadUrl(f.file.id)}>
                      {f.file.originalFilename}
                    </a>{" "}
                    · {f.file.status}
                  </p>
                ))}
              </div>
            ))}
          </section>
        ))}
      </div>
      {!!query.data?.historical?.length && (
        <section className="mt-5 space-y-3 rounded border p-4">
          <h2 className="font-semibold">Historical drawing files</h2>
          <Alert>
            Original version and current markers are preserved. They do not
            establish a controlled approval.
          </Alert>
          {query.data.historical.map((r: Data) => (
            <p className="text-sm" key={r.sourceId}>
              {r.partNumber} · Version {r.version ?? "unknown"}
              {r.originalCurrent ? " · original current marker" : ""} ·{" "}
              <a className="underline" href={fileDownloadUrl(r.fileId)}>
                {r.filename}
              </a>
            </p>
          ))}
        </section>
      )}
    </>
  );
}

function DefectClassification({ ncr: n }: { ncr: Data }) {
  const { can } = useSession();
  const [feature, setFeature] = useState("");
  const [code, setCode] = useState("OTHER");
  const [direction, setDirection] = useState("UNKNOWN");
  const [condition, setCondition] = useState(n.defectDescription ?? "");
  const [spec, setSpec] = useState(n.expectedSpecification ?? "");
  const [reason, setReason] = useState("");
  const [quantity, setQuantity] = useState(n.quantityAffected ?? 1);
  const features = useQuery({
    queryKey: ["ncr-features", n.internalPartId],
    queryFn: () => api<Data[]>(`/parts/${n.internalPartId}/features`),
    enabled: !!n.internalPartId && can("product:read"),
  });
  const add = useApiMutation(
    () =>
      api(`/ncrs/${n.id}/defect-lines`, {
        method: "POST",
        body: {
          expectedVersion: n.version,
          reason: reason || undefined,
          lines: [
            {
              featureId: feature || undefined,
              defectCode: code,
              deviationDirection: direction,
              severity: n.severity,
              specification: { specification: spec },
              actualCondition: condition,
              quantityAffected: quantity,
            },
          ],
        },
      }),
    {
      invalidate: [
        ["ncr", n.id],
        ["ncr-recurrence", n.id],
      ],
      success: "Reviewed defect classification added",
    },
  );
  const open = ["OPEN", "CONTAINED", "UNDER_INVESTIGATION"].includes(n.status);
  const allowed =
    can("ncr:write") &&
    (open || (!!n.legacyException && can("ncr:disposition")));
  return (
    <div className="space-y-2 border-t pt-3">
      <h3 className="font-medium">Defect lines</h3>
      {n.defectLines?.map((d: Data) => (
        <p key={d.id} className="text-sm">
          {d.defectCode} · {d.deviationDirection} · {d.actualCondition} ·
          quantity {d.quantityAffected} · feature{" "}
          {d.featureId
            ? (features.data?.find((f) => f.id === d.featureId)?.key ??
              d.featureId)
            : "not identified"}
        </p>
      ))}
      {allowed && (
        <details>
          <summary className="cursor-pointer text-sm">
            Add reviewed classification
          </summary>
          <div className="my-3 grid gap-3 md:grid-cols-2">
            <Field label="Stable physical feature">
              <Select
                value={feature}
                onChange={(e) => setFeature(e.target.value)}
                placeholder="Feature not established"
                options={(features.data ?? []).map((f) => ({
                  value: f.id,
                  label: `${f.key} · ${f.name}`,
                }))}
              />
            </Field>
            <Field label="Defect code">
              <Select
                value={code}
                onChange={(e) => setCode(e.target.value)}
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
            <Field label="Deviation direction">
              <Select
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
                options={["ABOVE", "BELOW", "OTHER", "UNKNOWN"].map(
                  (value) => ({ value, label: value }),
                )}
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
            <Field label="Required specification">
              <Textarea
                value={spec}
                onChange={(e) => setSpec(e.target.value)}
              />
            </Field>
            <Field label="Observed condition">
              <Textarea
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
              />
            </Field>
            <Field label="Classification rationale">
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          </div>
          <ErrorAlert error={add.error} />
          <Button
            disabled={
              add.isPending ||
              condition.trim().length < 3 ||
              quantity < 1 ||
              (!open && reason.trim().length < 5)
            }
            onClick={() => add.mutate()}
          >
            Add defect line with audit
          </Button>
        </details>
      )}
    </div>
  );
}
function ScarLinks({ ncr: n }: { ncr: Data }) {
  const { can } = useSession();
  const [scar, setScar] = useState("");
  const [reason, setReason] = useState("");
  const choices = useQuery({
    queryKey: ["scar-link-options", n.supplierId],
    queryFn: () =>
      api<Data>("/scars", {
        query: { supplierId: n.supplierId, pageSize: 200 },
      }),
    enabled: !!n.supplierId && can("scar:read", "scar:write"),
  });
  const link = useApiMutation(
    () =>
      api(`/ncrs/${n.id}/scar-links`, {
        method: "POST",
        body: { scarId: scar, reason },
      }),
    { invalidate: [["ncr", n.id]], success: "Corrective action linked" },
  );
  return (
    <div className="space-y-2 border-t pt-3">
      <h3 className="font-medium">Linked corrective actions</h3>
      {n.scarLinks?.map((l: Data) => (
        <p key={l.scarId} className="text-sm">
          <Link className="underline" href={`/quality/scars/${l.scarId}`}>
            {l.scar?.number ?? l.scarId}
          </Link>{" "}
          · {l.reason}
        </p>
      ))}
      {!!n.supplierId && can("scar:write", "scar:read") && (
        <div className="flex flex-wrap gap-2">
          <Select
            aria-label="Existing corrective action"
            className="max-w-sm"
            value={scar}
            onChange={(e) => setScar(e.target.value)}
            placeholder="Link an existing SCAR for this supplier"
            options={(choices.data?.items ?? []).map((s: Data) => ({
              value: s.id,
              label: `${s.number} · ${s.title}`,
            }))}
          />
          <Input
            aria-label="SCAR link rationale"
            className="max-w-sm"
            placeholder="Why this SCAR covers this NCR"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button
            variant="outline"
            disabled={!scar || reason.trim().length < 5 || link.isPending}
            onClick={() => link.mutate()}
          >
            Link SCAR
          </Button>
        </div>
      )}
      <ErrorAlert error={link.error} />
    </div>
  );
}
