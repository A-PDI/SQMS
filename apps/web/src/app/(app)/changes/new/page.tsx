"use client";

import { useQuery } from "@tanstack/react-query";
import { CHANGE_CATEGORY, humanize } from "@sqms/shared";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { AsyncPicker, type PickerItem } from "@/components/forms/async-picker";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, ErrorAlert } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { api } from "@/lib/api";

interface SupplierProduct {
  id: string;
  status: string;
  supplierId: string;
  internalPart: { partNumber: string; description: string };
  supplier: { id: string; name: string };
  supplierPart: { supplierPartNumber: string };
  site: { id: string; siteCode: string; name: string };
  configurations: { id: string; configCode: string; name: string; currentApprovedRevisionId: string | null; revisions: { id: string; revisionLabel: string; status: string }[] }[];
}

export default function NewChangePage() {
  return (
    <Suspense>
      <NewChange />
    </Suspense>
  );
}

function NewChange() {
  const router = useRouter();
  const params = useSearchParams();
  const [picked, setPicked] = useState<PickerItem | null>(null);
  const spId = picked?.id ?? params.get("supplierProductId");
  const sp = useQuery({ queryKey: ["supplier-product", spId], queryFn: () => api<SupplierProduct>(`/supplier-products/${spId}`), enabled: !!spId });
  const sites = useQuery({ queryKey: ["supplier-sites", sp.data?.supplierId], queryFn: () => api<{ id: string; siteCode: string; name: string; status: string }[]>(`/suppliers/${sp.data!.supplierId}/sites`), enabled: !!sp.data });
  const [v, setV] = useState({ title: "", reason: "", description: "", affectedCharacteristics: "", proposedImplementationDate: "", inventoryImpact: "", wipImpact: "", riskAssessment: "", currentRevisionId: "", proposedSiteId: "" });
  const [categories, setCategories] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const approvedRevisions = (sp.data?.configurations ?? []).filter((c) => c.currentApprovedRevisionId).map((c) => ({ value: c.currentApprovedRevisionId!, label: `${c.configCode} ${c.name} (rev ${c.revisions.find((r) => r.id === c.currentApprovedRevisionId)?.revisionLabel ?? "?"})` }));
  const problems = [
    !sp.data && "Select the approved supplier product affected",
    v.title.trim().length < 3 && "Title (at least 3 characters)",
    categories.length === 0 && "At least one change category",
    v.reason.trim().length < 5 && "Reason (at least 5 characters)",
    v.description.trim().length < 10 && "Description (at least 10 characters)",
    categories.includes("LOCATION") && !v.proposedSiteId && "Proposed manufacturing site for a location change",
  ].filter(Boolean) as string[];

  async function create() {
    setError(null);
    setBusy(true);
    try {
      const opt = (k: keyof typeof v) => (v[k].trim() ? { [k]: v[k].trim() } : {});
      const created = await api<{ id: string }>("/change-requests", {
        method: "POST",
        body: {
          supplierProductId: sp.data!.id,
          title: v.title.trim(),
          categories,
          reason: v.reason.trim(),
          description: v.description.trim(),
          ...opt("affectedCharacteristics"),
          ...opt("proposedImplementationDate"),
          ...opt("inventoryImpact"),
          ...opt("wipImpact"),
          ...opt("riskAssessment"),
          ...(v.currentRevisionId ? { currentRevisionId: v.currentRevisionId } : {}),
          ...(categories.includes("LOCATION") && v.proposedSiteId ? { proposedSiteId: v.proposedSiteId } : {}),
        },
      });
      toast.success("Change request created as draft");
      router.push(`/changes/${created.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="New change request" breadcrumbs={[{ href: "/changes", label: "Change requests" }, { label: "New" }]} description="Any change to design, material, process, tooling, location or sub-tier sources of an approved product needs approval before shipment." />
      <Card className="max-w-4xl">
        <CardBody className="space-y-4">
          {error ? <ErrorAlert error={error} /> : null}
          <Field label="Affected supplier product" required hint="Only approved sources can be changed.">
            <AsyncPicker<SupplierProduct>
              endpoint="/supplier-products"
              query={{ status: ["APPROVED", "CONDITIONALLY_APPROVED"] }}
              value={picked ?? (sp.data ? { id: sp.data.id, label: `${sp.data.internalPart.partNumber} · ${sp.data.supplier.name} @ ${sp.data.site.siteCode}` } : null)}
              onChange={setPicked}
              map={(r) => ({ id: r.id, label: `${r.internalPart.partNumber} · ${r.supplier.name} @ ${r.site.siteCode}`, sublabel: `${r.supplierPart.supplierPartNumber} · ${humanize(r.status)}` })}
              placeholder="Search part or supplier"
            />
          </Field>
          {sp.error ? <ErrorAlert error={sp.error} /> : null}
          {sp.data && sp.data.status !== "APPROVED" && sp.data.status !== "CONDITIONALLY_APPROVED" && <Alert tone="warning">This source is {humanize(sp.data.status).toLowerCase()}; change requests apply to approved sources.</Alert>}
          {approvedRevisions.length > 1 && (
            <Field label="Affected configuration" required htmlFor="cr-rev">
              <Select id="cr-rev" value={v.currentRevisionId} onChange={set("currentRevisionId")} options={approvedRevisions} placeholder="Select..." />
            </Field>
          )}
          <Field label="Title" required htmlFor="cr-title">
            <Input id="cr-title" value={v.title} onChange={set("title")} maxLength={250} />
          </Field>
          <fieldset>
            <legend className="mb-1 text-xs font-medium">
              Change categories <span className="text-destructive">*</span>
            </legend>
            <div className="grid gap-1 sm:grid-cols-3">
              {CHANGE_CATEGORY.map((c) => (
                <label key={c} className="flex items-center gap-2">
                  <Checkbox checked={categories.includes(c)} onCheckedChange={(on) => setCategories(on === true ? [...categories, c] : categories.filter((x) => x !== c))} /> {humanize(c)}
                </label>
              ))}
            </div>
          </fieldset>
          {categories.includes("LOCATION") && (
            <Field label="Proposed manufacturing site" required htmlFor="cr-site" hint="The supplier's other site that would manufacture the product.">
              <Select id="cr-site" value={v.proposedSiteId} onChange={set("proposedSiteId")} placeholder="Select..." options={(sites.data ?? []).filter((s) => s.id !== sp.data?.site.id).map((s) => ({ value: s.id, label: `${s.siteCode} ${s.name} (${humanize(s.status)})` }))} />
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Reason for change" required htmlFor="cr-reason">
              <Textarea id="cr-reason" value={v.reason} onChange={set("reason")} />
            </Field>
            <Field label="Proposed implementation date" htmlFor="cr-date">
              <Input id="cr-date" type="date" value={v.proposedImplementationDate} onChange={set("proposedImplementationDate")} />
            </Field>
          </div>
          <Field label="Description of the change" required htmlFor="cr-desc" hint="What changes, from what to what, and how it is controlled.">
            <Textarea id="cr-desc" rows={5} value={v.description} onChange={set("description")} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Affected characteristics" htmlFor="cr-chars">
              <Textarea id="cr-chars" value={v.affectedCharacteristics} onChange={set("affectedCharacteristics")} />
            </Field>
            <Field label="Supplier risk assessment" htmlFor="cr-risk">
              <Textarea id="cr-risk" value={v.riskAssessment} onChange={set("riskAssessment")} />
            </Field>
            <Field label="Inventory impact" htmlFor="cr-inv">
              <Textarea id="cr-inv" value={v.inventoryImpact} onChange={set("inventoryImpact")} />
            </Field>
            <Field label="Work-in-process impact" htmlFor="cr-wip">
              <Textarea id="cr-wip" value={v.wipImpact} onChange={set("wipImpact")} />
            </Field>
          </div>
          {problems.length > 0 && (
            <p className="text-xs text-muted-foreground">Still needed: {problems.join("; ")}.</p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button loading={busy} disabled={problems.length > 0} onClick={create}>
              Create draft
            </Button>
          </div>
        </CardBody>
      </Card>
    </>
  );
}
