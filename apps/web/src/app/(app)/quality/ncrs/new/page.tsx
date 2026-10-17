"use client";

import { NCR_SEVERITY, NCR_SOURCE, humanize } from "@sqms/shared";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { AsyncPicker, UserPicker, type PickerItem } from "@/components/forms/async-picker";
import { SchemaForm, type FieldSpec } from "@/components/forms/schema-form";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { api } from "@/lib/api";
import { toOptions } from "@/lib/options";

const FIELDS: FieldSpec[] = [
  { name: "title", label: "Title", required: true, minLength: 3, maxLength: 250, wide: true },
  { name: "dateIdentified", label: "Date identified", type: "date", required: true },
  { name: "source", label: "Source", type: "select", required: true, options: toOptions(NCR_SOURCE.filter(v => !["FIRST_ARTICLE", "INCOMING_INSPECTION", "ENGINEERING_VALIDATION"].includes(v))) },
  { name: "severity", label: "Severity", type: "select", required: true, options: toOptions(NCR_SEVERITY) },
  { name: "lotNumber", label: "Lot / batch", maxLength: 80 },
  { name: "quantityAffected", label: "Quantity affected", type: "number", required: true, integer: true, min: 1 },
  { name: "quantityInspected", label: "Quantity inspected", type: "number", integer: true, min: 0 },
  { name: "serialNumbers", label: "Serial numbers", type: "textarea", maxLength: 5000 },
  { name: "defectDescription", label: "Defect description", type: "textarea", required: true, minLength: 10, maxLength: 20000 },
  { name: "expectedSpecification", label: "Expected specification", type: "textarea", maxLength: 10000 },
  { name: "actualCondition", label: "Actual condition", type: "textarea", maxLength: 10000 },
  { name: "inspectionResults", label: "Inspection results", type: "textarea", maxLength: 10000 },
  { name: "containmentAction", label: "Immediate containment", type: "textarea", maxLength: 10000 },
  { name: "internalNotes", label: "Internal notes (never shown to suppliers)", type: "textarea", maxLength: 20000 },
  { name: "blocksApproval", label: "Blocks product approval while open", type: "checkbox" },
  { name: "supplierVisible", label: "Visible to the supplier (Phase 2 portal)", type: "checkbox" },
];

interface SupplierProductRow {
  id: string;
  status: string;
  internalPart: { partNumber: string };
  supplier: { name: string };
  supplierPart: { supplierPartNumber: string };
  site: { siteCode: string };
}

export default function NewNcrPage() {
  return (
    <Suspense>
      <NewNcr />
    </Suspense>
  );
}

function NewNcr() {
  const router = useRouter();
  const params = useSearchParams();
  const [source, setSource] = useState<PickerItem | null>(null);
  const [supplier, setSupplier] = useState<PickerItem | null>(null);
  const [part, setPart] = useState<PickerItem | null>(null);
  const [owner, setOwner] = useState<PickerItem | null>(null);
  const qualificationId = params.get("qualificationId");
  const spFromQuery = params.get("supplierProductId");

  return (
    <>
      <PageHeader title="New nonconformance report" breadcrumbs={[{ href: "/quality/ncrs", label: "Nonconformances" }, { label: "New" }]} />
      <Card className="max-w-4xl">
        <CardBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Supplier product" hint="Selecting the approved source fills supplier, part and site.">
              <AsyncPicker<SupplierProductRow>
                endpoint="/supplier-products"
                value={source}
                onChange={setSource}
                map={(r) => ({ id: r.id, label: `${r.internalPart.partNumber} · ${r.supplier.name} @ ${r.site.siteCode}`, sublabel: `${r.supplierPart.supplierPartNumber} · ${humanize(r.status)}` })}
                placeholder={spFromQuery ? "Preselected from link" : "Search part or supplier"}
              />
            </Field>
            <Field label="Owner">
              <UserPicker value={owner} onChange={setOwner} roleKey="SUPPLIER_QUALITY" placeholder="Defaults to you" />
            </Field>
            {!source && !spFromQuery && (
              <>
                <Field label="Supplier, if known">
                  <AsyncPicker<{ id: string; name: string; supplierNumber: string }> endpoint="/suppliers" value={supplier} onChange={setSupplier} map={(s) => ({ id: s.id, label: s.name, sublabel: s.supplierNumber })} />
                </Field>
                <Field label="Part, if known">
                  <AsyncPicker<{ id: string; partNumber: string; description: string }> endpoint="/products" value={part} onChange={setPart} map={(p) => ({ id: p.id, label: p.partNumber, sublabel: p.description })} />
                </Field>
              </>
            )}
          </div>
          <SchemaForm
            columns={2}
            fields={FIELDS}
            defaultValues={{ dateIdentified: new Date().toISOString().slice(0, 10), source: qualificationId ? "QUALIFICATION" : "OTHER", severity: "MAJOR", blocksApproval: true }}
            submitLabel="Create NCR"
            onCancel={() => router.back()}
            onSubmit={async (payload) => {
              const spId = source?.id ?? spFromQuery;
              const created = await api<{ id: string }>("/ncrs", {
                method: "POST",
                body: {
                  ...payload,
                  ...(spId ? { supplierProductId: spId } : { ...(supplier ? { supplierId: supplier.id } : {}), ...(part ? { internalPartId: part.id } : {}) }),
                  ...(owner ? { ownerId: owner.id } : {}),
                  ...(qualificationId ? { qualificationId } : {}),
                },
              });
              toast.success("NCR created");
              router.push(`/quality/ncrs/${created.id}`);
            }}
          />
        </CardBody>
      </Card>
    </>
  );
}
