"use client";

import { useRouter } from "next/navigation";
import { SchemaForm, type FieldSpec } from "@/components/forms/schema-form";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { api } from "@/lib/api";
import { COUNTRY_FIELD } from "@/lib/options";

const FIELDS: FieldSpec[] = [
  { name: "name", label: "Supplier name", required: true, minLength: 2, maxLength: 200 },
  { name: "legalName", label: "Legal name", maxLength: 250 },
  { name: "country", label: "Country", required: true, ...COUNTRY_FIELD },
  { name: "website", label: "Website", type: "url", maxLength: 300 },
  { name: "dunsNumber", label: "DUNS number", maxLength: 20 },
  { name: "taxId", label: "Tax ID", maxLength: 40 },
  { name: "siteCode", label: "First site code", placeholder: "PLANT-01", maxLength: 40, hint: "Optional; more sites can be added later" },
  { name: "siteName", label: "Site name", maxLength: 200, when: (v) => !!v.siteCode },
  { name: "siteCity", label: "Site city", maxLength: 120, when: (v) => !!v.siteCode },
  { name: "siteCountry", label: "Site country", ...COUNTRY_FIELD, when: (v) => !!v.siteCode },
  { name: "notes", label: "Notes", type: "textarea", maxLength: 10000 },
];

export default function NewSupplierPage() {
  const router = useRouter();
  return (
    <>
      <PageHeader title="New supplier" breadcrumbs={[{ href: "/suppliers", label: "Suppliers" }, { label: "New" }]} description="New suppliers start as Prospective; approval happens through a supplier qualification." />
      <Card className="max-w-3xl">
        <CardBody>
          <SchemaForm
            fields={FIELDS}
            submitLabel="Create supplier"
            onCancel={() => router.back()}
            onSubmit={async (p) => {
              const { siteCode, siteName, siteCity, siteCountry, country, ...rest } = p as Record<string, string>;
              const body: Record<string, unknown> = { ...rest, country: country.toUpperCase() };
              if (siteCode) body.sites = [{ siteCode, name: siteName || siteCode, city: siteCity || "-", country: (siteCountry || country).toUpperCase(), isManufacturing: true }];
              const s = await api<{ id: string }>("/suppliers", { method: "POST", body });
              router.push(`/suppliers/${s.id}`);
            }}
          />
        </CardBody>
      </Card>
    </>
  );
}
