import { DOCUMENT_CATEGORY, SUPPLIER_VISIBILITY } from "@sqms/shared";
import type { FieldSpec } from "@/components/forms/schema-form";
import { toOptions } from "@/lib/options";

/** Governance fields of a document type (shared by the create and edit dialogs). */
export const DOC_TYPE_FIELDS: FieldSpec[] = [
  { name: "name", label: "Name", required: true, minLength: 3, maxLength: 200 },
  { name: "acronym", label: "Acronym", maxLength: 30, nullable: true },
  { name: "category", label: "Category", type: "select", required: true, options: toOptions(DOCUMENT_CATEGORY) },
  { name: "origin", label: "Origin", type: "select", required: true, options: toOptions(["COMPANY_DEFINED", "EXTERNAL_STANDARD", "COMPANY_DEFINED_STANDARD_ALIGNED"]) },
  { name: "externalStandardRef", label: "External standard reference", maxLength: 300, nullable: true, hint: "Cite the standard; do not reproduce copyrighted content." },
  { name: "responsibleDepartment", label: "Responsible department", required: true, minLength: 2, maxLength: 120 },
  { name: "typicalPreparer", label: "Typical preparer", required: true, minLength: 2, maxLength: 160 },
  { name: "ownerRoleKey", label: "Owner role key", maxLength: 60, nullable: true, placeholder: "SUPPLIER_QUALITY" },
  { name: "workflowKey", label: "Review workflow key", maxLength: 80, nullable: true, placeholder: "document-review-standard" },
  { name: "approverRoleKeys", label: "Approver role keys", hint: "Comma-separated, e.g. SUPPLIER_QUALITY, ENGINEERING", maxLength: 600 },
  { name: "supplierVisibility", label: "Supplier visibility", type: "select", required: true, options: toOptions(SUPPLIER_VISIBILITY) },
  { name: "nativeFormKey", label: "Native form key", maxLength: 60, nullable: true },
  { name: "pathwayA", label: "Applies to Pathway A", type: "checkbox" },
  { name: "pathwayB", label: "Applies to Pathway B", type: "checkbox" },
  { name: "pathwayC", label: "Applies to Pathway C", type: "checkbox" },
  { name: "allowUpload", label: "Accept uploaded submissions", type: "checkbox" },
  { name: "description", label: "Description", type: "textarea", required: true, minLength: 5, maxLength: 5000 },
  { name: "purpose", label: "Purpose", type: "textarea", maxLength: 5000, nullable: true },
  { name: "applicabilityConditions", label: "Applicability conditions", type: "textarea", maxLength: 5000, nullable: true },
  { name: "riskRuleSummary", label: "Risk rule summary", type: "textarea", maxLength: 5000, nullable: true },
  { name: "approvalRequirements", label: "Approval requirements", type: "textarea", maxLength: 5000, nullable: true },
  { name: "instructions", label: "Instructions", type: "textarea", maxLength: 10000, nullable: true },
];

/** Converts the flat dialog values into the API payload (pathway checkboxes and role list). */
export function toDocTypePayload(v: Record<string, unknown>) {
  const { pathwayA, pathwayB, pathwayC, approverRoleKeys, code: _code, ...rest } = v;
  const roles = String(approverRoleKeys ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return {
    ...rest,
    applicablePathways: [pathwayA && "A", pathwayB && "B", pathwayC && "C"].filter(Boolean),
    approverRoleKeys: [...new Set(roles)],
  };
}

/** Flattens an API document type into dialog default values. */
export function docTypeDefaults(t: Record<string, unknown>) {
  const paths = (t.applicablePathways as string[] | undefined) ?? [];
  return { ...t, pathwayA: paths.includes("A"), pathwayB: paths.includes("B"), pathwayC: paths.includes("C"), approverRoleKeys: ((t.approverRoleKeys as string[] | undefined) ?? []).join(", ") };
}
