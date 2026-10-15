"use client";

import { useQuery } from "@tanstack/react-query";
import { DEVIATION_TYPE, humanize } from "@sqms/shared";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { AsyncPicker, type PickerItem } from "@/components/forms/async-picker";
import { SchemaForm } from "@/components/forms/schema-form";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { api } from "@/lib/api";
import { toOptions } from "@/lib/options";

interface SupplierProductRow {
  id: string;
  status: string;
  internalPart: { partNumber: string };
  supplier: { name: string };
  site: { siteCode: string };
}

export default function NewDeviationPage() {
  return (
    <Suspense>
      <NewDeviation />
    </Suspense>
  );
}

function NewDeviation() {
  const router = useRouter();
  const params = useSearchParams();
  const ncrId = params.get("ncrId");
  const qualificationId = params.get("qualificationId");
  const ncr = useQuery({ queryKey: ["ncr", ncrId], queryFn: () => api<{ number: string; title: string; supplierProductId: string | null; lotNumber: string | null; quantityAffected: number }>(`/ncrs/${ncrId}`), enabled: !!ncrId });
  const [source, setSource] = useState<PickerItem | null>(null);
  if (ncrId && ncr.isLoading) return null;
  return (
    <>
      <PageHeader title="New deviation / concession request" breadcrumbs={[{ href: "/quality/deviations", label: "Deviations" }, { label: "New" }]} description="A deviation authorizes planned departure from requirements before manufacture; a concession accepts already-produced nonconforming product. Both are limited and approved through workflow." />
      <Card className="max-w-3xl">
        <CardBody className="space-y-4">
          {ncr.data && <Alert>Raised against {ncr.data.number}: {ncr.data.title}</Alert>}
          {!ncrId && !qualificationId && (
            <Field label="Affected supplier product" required>
              <AsyncPicker<SupplierProductRow> endpoint="/supplier-products" value={source} onChange={setSource} map={(r) => ({ id: r.id, label: `${r.internalPart.partNumber} · ${r.supplier.name} @ ${r.site.siteCode}`, sublabel: humanize(r.status) })} />
            </Field>
          )}
          <SchemaForm
            columns={2}
            fields={[
              { name: "type", label: "Type", type: "select", required: true, options: toOptions(DEVIATION_TYPE) },
              { name: "title", label: "Title", required: true, minLength: 3, maxLength: 250 },
              { name: "quantityLimit", label: "Quantity limit", type: "number", integer: true, min: 1 },
              { name: "lotNumbers", label: "Lot numbers", maxLength: 5000 },
              { name: "startDate", label: "Start date", type: "date" },
              { name: "endDate", label: "End date", type: "date", hint: "A temporary deviation needs an end date or a quantity limit." },
              { name: "description", label: "Description of the departure", type: "textarea", required: true, minLength: 10, maxLength: 20000 },
              { name: "justification", label: "Justification", type: "textarea", required: true, minLength: 10, maxLength: 20000 },
              { name: "riskAssessment", label: "Risk assessment", type: "textarea", maxLength: 10000 },
              { name: "blocksApproval", label: "Blocks product approval until decided", type: "checkbox" },
            ]}
            defaultValues={{ type: params.get("type") ?? "DEVIATION", blocksApproval: true, quantityLimit: ncr.data?.quantityAffected, lotNumbers: ncr.data?.lotNumber ?? "" }}
            submitLabel="Create draft"
            onCancel={() => router.back()}
            onSubmit={async (payload) => {
              const ref = ncrId ? { ncrId } : qualificationId ? { qualificationId } : source ? { supplierProductId: source.id } : null;
              if (!ref) throw new Error("Select the affected supplier product");
              const created = await api<{ id: string }>("/deviations", { method: "POST", body: { ...payload, ...ref } });
              toast.success("Request created as draft");
              router.push(`/quality/deviations/${created.id}`);
            }}
          />
        </CardBody>
      </Card>
    </>
  );
}
