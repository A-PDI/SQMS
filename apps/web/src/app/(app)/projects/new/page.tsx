"use client";

import { useQuery } from "@tanstack/react-query";
import { PART_CRITICALITY, PATHWAY_LABELS, PROJECT_MEMBER_ROLE, REQUIREMENT_CATEGORY, RISK_FACTORS, computeRisk, humanize, type RiskResult } from "@sqms/shared";
import { Check, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { AsyncPicker, UserPicker, type PickerItem } from "@/components/forms/async-picker";
import { PageHeader } from "@/components/shell/page-header";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, ErrorAlert, Spinner } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { api } from "@/lib/api";
import { toOptions } from "@/lib/options";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

type Pathway = "A" | "B" | "C";
interface Delta {
  category: string;
  title: string;
  baselineValue: string;
  requiredValue: string;
  acceptanceCriteria: string;
}
interface Member {
  user: PickerItem | null;
  role: string;
  dueDate: string;
  responsibility: string;
}
interface State {
  title: string;
  businessJustification: string;
  description: string;
  annualVolume: string;
  targetDate: string;
  partMode: "existing" | "new";
  part: (PickerItem & { criticality?: string }) | null;
  newPart: { partNumber: string; description: string; criticality: string; application: string };
  supplierMode: "existing" | "new";
  supplier: (PickerItem & { status?: string }) | null;
  siteId: string;
  newSupplier: { name: string; country: string; legalName: string; website: string };
  newSite: { siteCode: string; name: string; city: string; country: string };
  pathway: Pathway | "";
  reverseEngineeringRequired: boolean;
  reverseEngineeringSource: string;
  riskFactors: Record<string, string>;
  riskRationale: string;
  supplierPartNumber: string;
  supplierPartDescription: string;
  customPartNumber: string;
  specialProcesses: boolean;
  specialProcessList: string;
  customerRequirements: boolean;
  technicalRequirements: string;
  baselineInformation: string;
  baseline: Record<string, string>;
  delta: Delta[];
  owner: PickerItem | null;
  members: Member[];
  submitNow: boolean;
}

const STEPS = ["Product", "Supplier & site", "Sourcing pathway", "Reverse engineering", "Risk assessment", "Technical baseline", "Document requirements", "Team & due dates", "Review & submit"];
const USER_FACTORS = RISK_FACTORS.filter((f) => !f.derived && f.key !== "specialProcesses");

const PATHWAY_HELP: Record<Pathway, string> = {
  A: "The company owns or has a controlled design (drawing / technical data package) and contracts a manufacturer to build it. Starts from a physical sample when reverse engineering is required.",
  B: "Buy the supplier's standard product. The approved baseline is the supplier's specification and guaranteed characteristics.",
  C: "A supplier product with company-specified modifications, controlled as the supplier baseline plus a delta specification acknowledged by the supplier.",
};

interface Preview {
  risk: RiskResult;
  policyVersion: number;
  requirements: { documentTypeCode: string; level: string; reason: string; documentType?: { name: string; acronym: string | null; category: string } }[];
}

export default function NewProjectWizard() {
  const router = useRouter();
  const { me } = useSession();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [s, setS] = useState<State>(() => ({
    title: "",
    businessJustification: "",
    description: "",
    annualVolume: "",
    targetDate: "",
    partMode: "new",
    part: null,
    newPart: { partNumber: "", description: "", criticality: "MEDIUM", application: "" },
    supplierMode: "existing",
    supplier: null,
    siteId: "",
    newSupplier: { name: "", country: "", legalName: "", website: "" },
    newSite: { siteCode: "", name: "", city: "", country: "" },
    pathway: "",
    reverseEngineeringRequired: false,
    reverseEngineeringSource: "",
    riskFactors: Object.fromEntries(USER_FACTORS.map((f) => [f.key, f.options[0].value])),
    riskRationale: "",
    supplierPartNumber: "",
    supplierPartDescription: "",
    customPartNumber: "",
    specialProcesses: false,
    specialProcessList: "",
    customerRequirements: false,
    technicalRequirements: "",
    baselineInformation: "",
    baseline: {},
    delta: [],
    owner: { id: me.id, label: me.displayName },
    members: [],
    submitNow: true,
  }));
  const set = (patch: Partial<State>) => setS((x) => ({ ...x, ...patch }));

  const sites = useQuery({
    queryKey: ["supplier-sites", s.supplier?.id],
    queryFn: () => api<{ id: string; siteCode: string; name: string; status: string }[]>(`/suppliers/${s.supplier!.id}/sites`),
    enabled: s.supplierMode === "existing" && !!s.supplier,
  });

  const criticality = s.partMode === "existing" ? (s.part?.criticality ?? "MEDIUM") : s.newPart.criticality;
  const supplierStatus = s.supplierMode === "existing" ? (s.supplier?.status ?? "PROSPECTIVE") : "PROSPECTIVE";
  const risk = useMemo(() => {
    if (!s.pathway) return null;
    try {
      return computeRisk({ criticality: criticality as never, supplierStatus: supplierStatus as never, pathway: s.pathway, reverseEngineering: s.reverseEngineeringRequired }, { ...s.riskFactors, specialProcesses: String(s.specialProcesses) });
    } catch {
      return null;
    }
  }, [s.pathway, criticality, supplierStatus, s.reverseEngineeringRequired, s.riskFactors, s.specialProcesses]);

  const previewBody = {
    pathway: s.pathway,
    reverseEngineeringRequired: s.reverseEngineeringRequired,
    specialProcesses: s.specialProcesses,
    customerRequirements: s.customerRequirements || s.pathway === "C",
    riskFactors: s.riskFactors,
    ...(s.partMode === "existing" && s.part ? { internalPartId: s.part.id } : { criticality }),
    ...(s.supplierMode === "existing" && s.supplier ? { supplierId: s.supplier.id } : {}),
  };
  const preview = useQuery({ queryKey: ["project-preview", previewBody], queryFn: () => api<Preview>("/sourcing-projects/preview", { method: "POST", body: previewBody }), enabled: step === 6 && !!s.pathway });

  /** Client-side step checks (the API validates everything again). */
  function stepProblems(i: number): string[] {
    const p: string[] = [];
    if (i === 0) {
      if (s.title.trim().length < 3) p.push("Enter a project title");
      if (s.businessJustification.trim().length < 5) p.push("Enter the business justification");
      if (s.partMode === "existing" && !s.part) p.push("Select the product");
      if (s.partMode === "new" && (s.newPart.partNumber.trim().length < 2 || s.newPart.description.trim().length < 2)) p.push("Enter the new part number and description");
    }
    if (i === 1) {
      if (s.supplierMode === "existing" && !s.supplier) p.push("Select the supplier");
      if (s.supplierMode === "existing" && s.supplier && !s.siteId) p.push("Select the manufacturing site");
      if (s.supplierMode === "new") {
        if (s.newSupplier.name.trim().length < 2) p.push("Enter the supplier name");
        if (!/^[A-Za-z]{2}$/.test(s.newSupplier.country)) p.push("Enter the supplier country (two-letter code)");
        if (!s.newSite.siteCode.trim() || !s.newSite.name.trim() || !s.newSite.city.trim() || !/^[A-Za-z]{2}$/.test(s.newSite.country)) p.push("Complete the manufacturing site (code, name, city, country)");
      }
    }
    if (i === 2 && !s.pathway) p.push("Select a sourcing pathway");
    if (i === 3 && s.reverseEngineeringRequired && !s.reverseEngineeringSource.trim()) p.push("Identify the physical sample used for reverse engineering");
    if (i === 5) {
      if (s.pathway !== "A" && s.supplierPartNumber.trim().length < 1) p.push("Enter the supplier part number");
      if (s.pathway === "C" && s.delta.length === 0) p.push("Pathway C needs at least one customer-specific (delta) requirement");
      for (const [n, d] of s.delta.entries()) if (!d.title.trim() || !d.requiredValue.trim() || !d.acceptanceCriteria.trim()) p.push(`Complete delta requirement ${n + 1} (title, required value, acceptance criteria)`);
    }
    if (i === 7 && s.members.some((m) => !m.user)) p.push("Select a person for every team member row");
    return p;
  }
  const problems = stepProblems(step);
  const visibleSteps = STEPS.map((label, i) => ({ label, i })).filter((x) => x.i !== 3 || s.pathway === "A");

  function next() {
    setError(null);
    if (problems.length) return;
    let n = step + 1;
    if (n === 3 && s.pathway !== "A") n = 4;
    setStep(Math.min(n, STEPS.length - 1));
  }
  function back() {
    let n = step - 1;
    if (n === 3 && s.pathway !== "A") n = 2;
    setStep(Math.max(0, n));
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const baseline: Record<string, string> = {};
      for (const [k, v] of Object.entries(s.baseline)) if (v.trim()) baseline[k] = v.trim();
      if (s.reverseEngineeringRequired) baseline.reverseEngineeringSource = s.reverseEngineeringSource.trim();
      const body = {
        title: s.title.trim(),
        businessJustification: s.businessJustification.trim(),
        description: s.description.trim() || undefined,
        annualVolume: s.annualVolume ? Number(s.annualVolume) : undefined,
        targetDate: s.targetDate || undefined,
        ...(s.partMode === "existing" ? { internalPartId: s.part!.id } : { newPart: { ...s.newPart, application: s.newPart.application || undefined } }),
        ...(s.supplierMode === "existing"
          ? { supplierId: s.supplier!.id, siteId: s.siteId }
          : {
              newSupplier: { name: s.newSupplier.name, country: s.newSupplier.country.toUpperCase(), legalName: s.newSupplier.legalName || undefined, website: s.newSupplier.website || undefined },
              newSite: { ...s.newSite, country: s.newSite.country.toUpperCase(), isManufacturing: true },
            }),
        pathway: s.pathway,
        reverseEngineeringRequired: s.reverseEngineeringRequired,
        riskFactors: s.riskFactors,
        riskRationale: s.riskRationale || undefined,
        ...(s.pathway !== "A" ? { newSupplierPart: { supplierPartNumber: s.supplierPartNumber.trim(), description: s.supplierPartDescription.trim() || s.title.trim() } } : {}),
        customPartNumber: s.pathway === "C" && s.customPartNumber.trim() ? s.customPartNumber.trim() : undefined,
        specialProcesses: s.specialProcesses,
        specialProcessList: s.specialProcesses ? s.specialProcessList || undefined : undefined,
        customerRequirements: s.customerRequirements,
        technicalRequirements: s.technicalRequirements || undefined,
        baselineInformation: s.baselineInformation || undefined,
        baseline: Object.keys(baseline).length ? baseline : undefined,
        deltaRequirements: s.pathway === "C" ? s.delta.map((d) => ({ ...d, baselineValue: d.baselineValue || undefined })) : undefined,
        ownerId: s.owner?.id,
        members: s.members.filter((m) => m.user).map((m) => ({ userId: m.user!.id, role: m.role, dueDate: m.dueDate || undefined, responsibility: m.responsibility || undefined })),
      };
      const project = await api<{ id: string; version: number }>("/sourcing-projects", { method: "POST", body });
      if (s.submitNow) await api(`/sourcing-projects/${project.id}/submit`, { method: "POST", body: { expectedVersion: project.version } });
      router.push(`/projects/${project.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="New sourcing project" breadcrumbs={[{ href: "/projects", label: "Sourcing projects" }, { label: "New" }]} description="The checklist of required documents is generated from the active applicability policy." />
      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <ol className="space-y-1 text-sm" aria-label="Wizard steps">
          {visibleSteps.map(({ label, i }, idx) => (
            <li key={label}>
              <button
                type="button"
                className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left", i === step ? "bg-primary text-primary-foreground" : i < step ? "text-foreground hover:bg-muted" : "text-muted-foreground")}
                onClick={() => i < step && setStep(i)}
                disabled={i > step}
                aria-current={i === step ? "step" : undefined}
              >
                <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px]", i < step && "border-success bg-success text-white")}>{i < step ? <Check className="size-3" /> : idx + 1}</span>
                {label}
              </button>
            </li>
          ))}
        </ol>
        <Card>
          <CardBody className="space-y-4">
            <h2 className="text-base font-semibold">
              Step {visibleSteps.findIndex((x) => x.i === step) + 1}: {STEPS[step]}
            </h2>
            {step === 0 && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Project title" required htmlFor="title" className="sm:col-span-2">
                    <Input id="title" value={s.title} onChange={(e) => set({ title: e.target.value })} maxLength={250} />
                  </Field>
                  <Field label="Business justification" required htmlFor="just" className="sm:col-span-2">
                    <Textarea id="just" value={s.businessJustification} onChange={(e) => set({ businessJustification: e.target.value })} />
                  </Field>
                  <Field label="Estimated annual volume" htmlFor="vol">
                    <Input id="vol" type="number" min={0} value={s.annualVolume} onChange={(e) => set({ annualVolume: e.target.value })} />
                  </Field>
                  <Field label="Target approval date" htmlFor="target">
                    <Input id="target" type="date" value={s.targetDate} onChange={(e) => set({ targetDate: e.target.value })} />
                  </Field>
                </div>
                <Choice value={s.partMode} onChange={(v) => set({ partMode: v as State["partMode"] })} options={[{ value: "new", label: "New part" }, { value: "existing", label: "Existing part" }]} />
                {s.partMode === "existing" ? (
                  <Field label="Product" required>
                    <AsyncPicker<{ id: string; partNumber: string; description: string; criticality: string }> endpoint="/products" value={s.part} onChange={(p) => set({ part: p })} placeholder="Search part number or description" map={(r) => ({ id: r.id, label: r.partNumber, sublabel: r.description, criticality: r.criticality } as PickerItem)} />
                  </Field>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Internal part number" required htmlFor="pn">
                      <Input id="pn" value={s.newPart.partNumber} onChange={(e) => set({ newPart: { ...s.newPart, partNumber: e.target.value } })} />
                    </Field>
                    <Field label="Criticality" required htmlFor="crit">
                      <Select id="crit" value={s.newPart.criticality} onChange={(e) => set({ newPart: { ...s.newPart, criticality: e.target.value } })} options={toOptions(PART_CRITICALITY)} />
                    </Field>
                    <Field label="Description" required htmlFor="pdesc" className="sm:col-span-2">
                      <Input id="pdesc" value={s.newPart.description} onChange={(e) => set({ newPart: { ...s.newPart, description: e.target.value } })} />
                    </Field>
                    <Field label="Application" htmlFor="app" className="sm:col-span-2">
                      <Textarea id="app" rows={2} value={s.newPart.application} onChange={(e) => set({ newPart: { ...s.newPart, application: e.target.value } })} />
                    </Field>
                  </div>
                )}
              </div>
            )}

            {step === 1 && (
              <div className="space-y-4">
                <Choice value={s.supplierMode} onChange={(v) => set({ supplierMode: v as State["supplierMode"], siteId: "" })} options={[{ value: "existing", label: "Existing supplier" }, { value: "new", label: "New prospective supplier" }]} />
                {s.supplierMode === "existing" ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Supplier" required>
                      <AsyncPicker<{ id: string; name: string; supplierNumber: string; status: string }> endpoint="/suppliers" value={s.supplier} onChange={(x) => set({ supplier: x, siteId: "" })} placeholder="Search supplier" map={(r) => ({ id: r.id, label: r.name, sublabel: `${r.supplierNumber} · ${humanize(r.status)}`, status: r.status } as PickerItem)} />
                    </Field>
                    <Field label="Manufacturing site" required htmlFor="site">
                      {sites.isLoading ? <Spinner /> : <Select id="site" value={s.siteId} onChange={(e) => set({ siteId: e.target.value })} placeholder="Select site" options={(sites.data ?? []).map((x) => ({ value: x.id, label: `${x.siteCode} · ${x.name}` }))} disabled={!s.supplier} />}
                    </Field>
                    {s.supplier && !["APPROVED", "CONDITIONALLY_APPROVED"].includes(s.supplier.status ?? "") && <Alert tone="warning" className="sm:col-span-2">This supplier is not approved yet. The checklist will include supplier onboarding documents and a supplier qualification is needed before product approval.</Alert>}
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Supplier name" required htmlFor="sname">
                      <Input id="sname" value={s.newSupplier.name} onChange={(e) => set({ newSupplier: { ...s.newSupplier, name: e.target.value } })} />
                    </Field>
                    <Field label="Country (ISO code)" required htmlFor="scountry">
                      <Input id="scountry" maxLength={2} value={s.newSupplier.country} onChange={(e) => set({ newSupplier: { ...s.newSupplier, country: e.target.value.toUpperCase() } })} />
                    </Field>
                    <Field label="Legal name" htmlFor="slegal">
                      <Input id="slegal" value={s.newSupplier.legalName} onChange={(e) => set({ newSupplier: { ...s.newSupplier, legalName: e.target.value } })} />
                    </Field>
                    <Field label="Website" htmlFor="sweb">
                      <Input id="sweb" type="url" value={s.newSupplier.website} onChange={(e) => set({ newSupplier: { ...s.newSupplier, website: e.target.value } })} placeholder="https://" />
                    </Field>
                    <Field label="Site code" required htmlFor="sitecode">
                      <Input id="sitecode" value={s.newSite.siteCode} onChange={(e) => set({ newSite: { ...s.newSite, siteCode: e.target.value } })} />
                    </Field>
                    <Field label="Site name" required htmlFor="sitename">
                      <Input id="sitename" value={s.newSite.name} onChange={(e) => set({ newSite: { ...s.newSite, name: e.target.value } })} />
                    </Field>
                    <Field label="Site city" required htmlFor="sitecity">
                      <Input id="sitecity" value={s.newSite.city} onChange={(e) => set({ newSite: { ...s.newSite, city: e.target.value } })} />
                    </Field>
                    <Field label="Site country" required htmlFor="sitecountry">
                      <Input id="sitecountry" maxLength={2} value={s.newSite.country} onChange={(e) => set({ newSite: { ...s.newSite, country: e.target.value.toUpperCase() } })} />
                    </Field>
                  </div>
                )}
              </div>
            )}

            {step === 2 && (
              <div className="grid gap-3 md:grid-cols-3">
                {(["A", "B", "C"] as Pathway[]).map((p) => (
                  <button key={p} type="button" onClick={() => set({ pathway: p, reverseEngineeringRequired: p === "A" ? s.reverseEngineeringRequired : false })} className={cn("rounded-lg border p-4 text-left hover:border-accent", s.pathway === p && "border-primary ring-2 ring-primary/30")} aria-pressed={s.pathway === p}>
                    <p className="font-semibold">Pathway {PATHWAY_LABELS[p]}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{PATHWAY_HELP[p]}</p>
                  </button>
                ))}
              </div>
            )}

            {step === 3 && (
              <div className="space-y-3">
                <label className="flex items-center gap-2">
                  <Checkbox checked={s.reverseEngineeringRequired} onCheckedChange={(c) => set({ reverseEngineeringRequired: c === true })} />
                  Only a physical sample is available; the design must be reverse engineered
                </label>
                {s.reverseEngineeringRequired && (
                  <>
                    <Alert tone="info">The supplier-proposed definition stays preliminary until the Reverse Engineering Intake (ENG-03) and Design Review & Engineering Release (ENG-02) are accepted; only then can engineering accept it as the controlled design.</Alert>
                    <Field label="Physical sample / source" required htmlFor="resrc">
                      <Input id="resrc" value={s.reverseEngineeringSource} onChange={(e) => set({ reverseEngineeringSource: e.target.value })} placeholder="e.g. Field return S/N 12345, OEM part 123-456" />
                    </Field>
                  </>
                )}
              </div>
            )}

            {step === 4 && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Product criticality (from product)">
                    <Input value={humanize(criticality)} disabled />
                  </Field>
                  <Field label="Supplier status (from supplier)">
                    <Input value={humanize(supplierStatus)} disabled />
                  </Field>
                  {USER_FACTORS.map((f) => (
                    <Field key={f.key} label={f.label} hint={f.help} htmlFor={`rf-${f.key}`}>
                      <Select id={`rf-${f.key}`} value={s.riskFactors[f.key]} onChange={(e) => set({ riskFactors: { ...s.riskFactors, [f.key]: e.target.value } })} options={f.options.map((o) => ({ value: o.value, label: `${o.label} (+${o.points})` }))} />
                    </Field>
                  ))}
                  <Field label="Rationale" htmlFor="rationale" className="sm:col-span-2">
                    <Textarea id="rationale" value={s.riskRationale} onChange={(e) => set({ riskRationale: e.target.value })} />
                  </Field>
                </div>
                {risk && <RiskSummary risk={risk} />}
              </div>
            )}

            {step === 5 && (
              <div className="space-y-4">
                {s.pathway !== "A" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Supplier part number" required htmlFor="spn">
                      <Input id="spn" value={s.supplierPartNumber} onChange={(e) => set({ supplierPartNumber: e.target.value })} />
                    </Field>
                    <Field label="Supplier part description" htmlFor="spd">
                      <Input id="spd" value={s.supplierPartDescription} onChange={(e) => set({ supplierPartDescription: e.target.value })} />
                    </Field>
                    {s.pathway === "C" && (
                      <Field label="Custom supplier part number for the modified configuration" htmlFor="cpn" hint="Recommended so the modified product is distinguishable from the supplier's standard product" className="sm:col-span-2">
                        <Input id="cpn" value={s.customPartNumber} onChange={(e) => set({ customPartNumber: e.target.value })} />
                      </Field>
                    )}
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  {s.pathway === "A" ? (
                    <>
                      <Field label="Drawing number" htmlFor="dwg">
                        <Input id="dwg" value={s.baseline.drawingNumber ?? ""} onChange={(e) => set({ baseline: { ...s.baseline, drawingNumber: e.target.value } })} />
                      </Field>
                      <Field label="Drawing revision" htmlFor="dwgrev">
                        <Input id="dwgrev" value={s.baseline.drawingRevision ?? ""} onChange={(e) => set({ baseline: { ...s.baseline, drawingRevision: e.target.value } })} />
                      </Field>
                      <Field label="Material" htmlFor="mat">
                        <Input id="mat" value={s.baseline.material ?? ""} onChange={(e) => set({ baseline: { ...s.baseline, material: e.target.value } })} />
                      </Field>
                    </>
                  ) : (
                    <>
                      <Field label="Supplier specification number" htmlFor="spec">
                        <Input id="spec" value={s.baseline.specificationNumber ?? ""} onChange={(e) => set({ baseline: { ...s.baseline, specificationNumber: e.target.value } })} />
                      </Field>
                      <Field label="Specification revision" htmlFor="specrev">
                        <Input id="specrev" value={s.baseline.specificationRevision ?? ""} onChange={(e) => set({ baseline: { ...s.baseline, specificationRevision: e.target.value } })} />
                      </Field>
                      <Field label="Guaranteed characteristics" htmlFor="guar" className="sm:col-span-2">
                        <Textarea id="guar" value={s.baseline.guaranteedCharacteristics ?? ""} onChange={(e) => set({ baseline: { ...s.baseline, guaranteedCharacteristics: e.target.value } })} />
                      </Field>
                    </>
                  )}
                  <Field label="Technical requirements" htmlFor="tech" className="sm:col-span-2">
                    <Textarea id="tech" value={s.technicalRequirements} onChange={(e) => set({ technicalRequirements: e.target.value })} />
                  </Field>
                </div>
                <div className="flex flex-wrap gap-6">
                  <label className="flex items-center gap-2">
                    <Checkbox checked={s.specialProcesses} onCheckedChange={(c) => set({ specialProcesses: c === true })} /> Special processes involved (heat treatment, coating, welding...)
                  </label>
                  <label className="flex items-center gap-2">
                    <Checkbox checked={s.customerRequirements || s.pathway === "C"} disabled={s.pathway === "C"} onCheckedChange={(c) => set({ customerRequirements: c === true })} /> Customer-specific requirements apply
                  </label>
                </div>
                {s.specialProcesses && (
                  <Field label="Special processes" htmlFor="splist">
                    <Input id="splist" value={s.specialProcessList} onChange={(e) => set({ specialProcessList: e.target.value })} />
                  </Field>
                )}
                {s.pathway === "C" && <DeltaEditor delta={s.delta} onChange={(delta) => set({ delta })} />}
              </div>
            )}

            {step === 6 && (
              <div className="space-y-3">
                {preview.isLoading && <Spinner />}
                {preview.error ? <ErrorAlert error={preview.error} /> : null}
                {preview.data && (
                  <>
                    <RiskSummary risk={preview.data.risk} />
                    <p className="text-xs text-muted-foreground">Generated from applicability policy version {preview.data.policyVersion}. Conditional items can be waived later with a documented justification; required items need the corresponding authority to waive.</p>
                    <Table>
                      <THead>
                        <tr>
                          <TH>Code</TH>
                          <TH>Document</TH>
                          <TH>Level</TH>
                          <TH>Why</TH>
                        </tr>
                      </THead>
                      <TBody>
                        {preview.data.requirements.map((r) => (
                          <TR key={r.documentTypeCode}>
                            <TD className="font-mono text-xs">{r.documentTypeCode}</TD>
                            <TD>{r.documentType?.name}</TD>
                            <TD>
                              <StatusBadge status={r.level} />
                            </TD>
                            <TD className="text-xs text-muted-foreground">{r.reason}</TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  </>
                )}
              </div>
            )}

            {step === 7 && (
              <div className="space-y-3">
                <Field label="Project owner">
                  <UserPicker value={s.owner} onChange={(u) => set({ owner: u })} />
                </Field>
                <p className="text-xs text-muted-foreground">Checklist items are assigned to team members by role; due dates on members become the due dates of their document tasks.</p>
                {s.members.map((m, i) => (
                  <div key={i} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[1fr_180px_150px_1fr_auto]">
                    <UserPicker value={m.user} onChange={(u) => set({ members: s.members.map((x, j) => (j === i ? { ...x, user: u } : x)) })} />
                    <Select aria-label="Role" value={m.role} onChange={(e) => set({ members: s.members.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)) })} options={toOptions(PROJECT_MEMBER_ROLE.filter((r) => r !== "OWNER"))} />
                    <Input aria-label="Due date" type="date" value={m.dueDate} onChange={(e) => set({ members: s.members.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)) })} />
                    <Input aria-label="Responsibility" placeholder="Responsibility" value={m.responsibility} onChange={(e) => set({ members: s.members.map((x, j) => (j === i ? { ...x, responsibility: e.target.value } : x)) })} />
                    <Button variant="ghost" size="icon" aria-label="Remove member" onClick={() => set({ members: s.members.filter((_, j) => j !== i) })}>
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => set({ members: [...s.members, { user: null, role: "ENGINEERING", dueDate: "", responsibility: "" }] })}>
                  <Plus /> Add team member
                </Button>
              </div>
            )}

            {step === 8 && (
              <div className="space-y-3">
                <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  <Summary label="Title" value={s.title} />
                  <Summary label="Product" value={s.partMode === "existing" ? s.part?.label : `${s.newPart.partNumber} (new) · ${s.newPart.description}`} />
                  <Summary label="Supplier" value={s.supplierMode === "existing" ? s.supplier?.label : `${s.newSupplier.name} (new prospective)`} />
                  <Summary label="Pathway" value={s.pathway ? `${PATHWAY_LABELS[s.pathway]}${s.reverseEngineeringRequired ? " · reverse engineering" : ""}` : "-"} />
                  <Summary label="Risk" value={risk ? `${humanize(risk.level)} (score ${risk.score})` : "-"} />
                  <Summary label="Team" value={[s.owner?.label && `${s.owner.label} (owner)`, ...s.members.map((m) => m.user && `${m.user.label} (${humanize(m.role)})`)].filter(Boolean).join(", ")} />
                </dl>
                <label className="flex items-center gap-2">
                  <Checkbox checked={s.submitNow} onCheckedChange={(c) => set({ submitNow: c === true })} /> Submit the Product Sourcing Request and risk assessment for intake review now
                </label>
              </div>
            )}

            {problems.length > 0 && step !== 8 && (
              <Alert tone="warning" title="Complete this step to continue">
                <ul className="list-disc pl-4">
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </Alert>
            )}
            {error ? <ErrorAlert error={error} /> : null}
            <div className="flex justify-between border-t pt-4">
              <Button variant="outline" onClick={back} disabled={step === 0 || busy}>
                Back
              </Button>
              {step < STEPS.length - 1 ? (
                <Button onClick={next} disabled={problems.length > 0}>
                  Continue
                </Button>
              ) : (
                <Button onClick={create} loading={busy}>
                  Create project
                </Button>
              )}
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function Choice({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="inline-flex rounded-md border p-0.5" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} className={cn("rounded px-3 py-1 text-sm", value === o.value ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function RiskSummary({ risk }: { risk: RiskResult }) {
  return (
    <div className="rounded-md border bg-muted/40 p-3">
      <p className="flex items-center gap-2 font-medium">
        Computed risk <StatusBadge status={risk.level} /> <span className="text-muted-foreground">score {risk.score} · model {risk.modelVersion}</span>
      </p>
      <div className="mt-2 flex flex-wrap gap-1">
        {risk.factors.map((f) => (
          <Badge key={f.key} tone={f.points > 0 ? "pending" : "muted"}>
            {f.label}: {f.valueLabel} (+{f.points})
          </Badge>
        ))}
      </div>
      {risk.overrides.map((o) => (
        <p key={o} className="mt-1 text-xs text-warning">
          {o}
        </p>
      ))}
    </div>
  );
}

function DeltaEditor({ delta, onChange }: { delta: Delta[]; onChange: (d: Delta[]) => void }) {
  const upd = (i: number, patch: Partial<Delta>) => onChange(delta.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  return (
    <div className="space-y-2">
      <p className="font-medium">Customer-specific (delta) requirements</p>
      <p className="text-xs text-muted-foreground">Each modification of the supplier standard product. The supplier must acknowledge every requirement in writing.</p>
      {delta.map((d, i) => (
        <div key={i} className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
          <Field label="Category">
            <Select value={d.category} onChange={(e) => upd(i, { category: e.target.value })} options={toOptions(REQUIREMENT_CATEGORY)} />
          </Field>
          <Field label="Title" required>
            <Input value={d.title} onChange={(e) => upd(i, { title: e.target.value })} />
          </Field>
          <Field label="Supplier baseline value">
            <Input value={d.baselineValue} onChange={(e) => upd(i, { baselineValue: e.target.value })} />
          </Field>
          <Field label="Required value" required>
            <Input value={d.requiredValue} onChange={(e) => upd(i, { requiredValue: e.target.value })} />
          </Field>
          <Field label="Acceptance criteria" required className="sm:col-span-2">
            <Textarea rows={2} value={d.acceptanceCriteria} onChange={(e) => upd(i, { acceptanceCriteria: e.target.value })} />
          </Field>
          <div className="sm:col-span-2">
            <Button variant="ghost" size="sm" onClick={() => onChange(delta.filter((_, j) => j !== i))}>
              <Trash2 /> Remove
            </Button>
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => onChange([...delta, { category: "OTHER", title: "", baselineValue: "", requiredValue: "", acceptanceCriteria: "" }])}>
        <Plus /> Add requirement
      </Button>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{value || "-"}</dd>
    </div>
  );
}
