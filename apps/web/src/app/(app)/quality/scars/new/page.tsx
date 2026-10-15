"use client";

import { NCR_SEVERITY } from "@sqms/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { AsyncPicker, type PickerItem } from "@/components/forms/async-picker";
import { SchemaForm } from "@/components/forms/schema-form";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { api } from "@/lib/api";
import { toOptions } from "@/lib/options";

const plus = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

export default function NewScarPage() {
  const router = useRouter();
  const [supplier, setSupplier] = useState<PickerItem | null>(null);
  return (
    <>
      <PageHeader title="New corrective action request" breadcrumbs={[{ href: "/quality/scars", label: "Corrective actions" }, { label: "New" }]} description="For SCARs arising from an NCR, use Raise SCAR on the NCR so the defect details are carried over." />
      <Card className="max-w-3xl">
        <CardBody className="space-y-4">
          <Field label="Supplier" required>
            <AsyncPicker<{ id: string; name: string; supplierNumber: string }> endpoint="/suppliers" value={supplier} onChange={setSupplier} map={(s) => ({ id: s.id, label: s.name, sublabel: s.supplierNumber })} />
          </Field>
          <SchemaForm
            columns={2}
            fields={[
              { name: "title", label: "Title", required: true, minLength: 3, maxLength: 250, wide: true },
              { name: "severity", label: "Severity", type: "select", required: true, options: toOptions(NCR_SEVERITY) },
              { name: "containmentDueDate", label: "Containment due", type: "date" },
              { name: "responseDueDate", label: "8D response due", type: "date", required: true },
              { name: "effectivenessDueDate", label: "Effectiveness check due", type: "date" },
              { name: "problemDescription", label: "Problem description", type: "textarea", required: true, minLength: 10, maxLength: 20000 },
              { name: "requirements", label: "Requirements / specification", type: "textarea", maxLength: 10000 },
              { name: "internalNotes", label: "Internal notes (never shown to suppliers)", type: "textarea", maxLength: 20000 },
            ]}
            defaultValues={{ severity: "MAJOR", containmentDueDate: plus(3), responseDueDate: plus(14) }}
            submitLabel="Create draft SCAR"
            onCancel={() => router.back()}
            onSubmit={async (payload) => {
              if (!supplier) throw new Error("Select the supplier");
              const created = await api<{ id: string }>("/scars", { method: "POST", body: { ...payload, supplierId: supplier.id } });
              toast.success("SCAR created");
              router.push(`/quality/scars/${created.id}`);
            }}
          />
        </CardBody>
      </Card>
    </>
  );
}
