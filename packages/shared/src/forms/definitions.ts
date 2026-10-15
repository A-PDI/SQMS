/**
 * Seeded native form definitions (version 1). Administrators can publish new versions without code changes;
 * existing submissions keep referencing the version they were created with.
 */
import type { AuthoringFormSchema, FieldOption, FormField, FormSchema } from "./types";
import { resolveFormSchema } from "./validate";

const yesNo: FieldOption[] = [
  { value: "YES", label: "Yes" },
  { value: "NO", label: "No" },
];

const pathwayOptions: FieldOption[] = [
  { value: "A", label: "A - Company-controlled design" },
  { value: "B", label: "B - Existing supplier product" },
  { value: "C", label: "C - Modified existing supplier product" },
];

const requirementCategories: FieldOption[] = [
  "DIMENSIONAL", "MATERIAL", "COATING", "HEAT_TREATMENT", "PERFORMANCE", "PROCESS", "INSPECTION", "PACKAGING", "LABELING", "OTHER",
].map((v) => ({ value: v, label: v.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }));

/** Reusable field definitions shared across forms. */
export const FIELD_LIBRARY: Record<string, FormField> = {
  internalPartNumber: { key: "internalPartNumber", label: "Internal part number", type: "text", required: true, maxLength: 60 },
  partDescription: { key: "partDescription", label: "Part description", type: "text", required: true, maxLength: 500 },
  supplierName: { key: "supplierName", label: "Supplier", type: "text", required: true, maxLength: 200 },
  supplierPartNumber: { key: "supplierPartNumber", label: "Supplier part number", type: "text", maxLength: 80 },
  manufacturingSite: { key: "manufacturingSite", label: "Manufacturing site", type: "text", maxLength: 200 },
  configurationRef: { key: "configurationRef", label: "Configuration / revision", type: "text", maxLength: 80 },
  pathway: { key: "pathway", label: "Sourcing pathway", type: "radio", required: true, options: pathwayOptions },
  preparedBy: { key: "preparedBy", label: "Prepared by", type: "text", required: true, maxLength: 160 },
  preparedDate: { key: "preparedDate", label: "Date prepared", type: "date", required: true },
  notes: { key: "notes", label: "Notes", type: "textarea", maxLength: 10000 },
  supportingFiles: { key: "supportingFiles", label: "Supporting files", type: "attachment", multiple: true },
  contactTable: {
    key: "contacts",
    label: "Contacts",
    type: "table",
    columns: [
      { key: "name", label: "Name", type: "text", required: true, maxLength: 160 },
      { key: "function", label: "Function", type: "text", maxLength: 120 },
      { key: "email", label: "Email", type: "email" },
      { key: "phone", label: "Phone", type: "text", maxLength: 40 },
    ],
  },
  certificationTable: {
    key: "certifications",
    label: "Quality system certifications",
    type: "table",
    columns: [
      { key: "standard", label: "Standard", type: "select", required: true, options: [
        { value: "ISO 9001", label: "ISO 9001" },
        { value: "IATF 16949", label: "IATF 16949" },
        { value: "AS9100", label: "AS9100" },
        { value: "ISO 14001", label: "ISO 14001" },
        { value: "ISO 45001", label: "ISO 45001" },
        { value: "OTHER", label: "Other" },
      ] },
      { key: "certificateNumber", label: "Certificate number", type: "text", maxLength: 80 },
      { key: "registrar", label: "Registrar", type: "text", maxLength: 160 },
      { key: "expiresAt", label: "Expiration date", type: "date" },
    ],
  },
};

const PSR: AuthoringFormSchema = {
  key: "PSR",
  title: "Product Sourcing Request (INT-01)",
  description: "Captured by the New Sourcing Project wizard.",
  sections: [
    {
      key: "product",
      title: "Product",
      fields: [
        { ref: "internalPartNumber" },
        { ref: "partDescription" },
        { key: "criticality", label: "Product criticality", type: "select", required: true, options: [
          { value: "LOW", label: "Low" }, { value: "MEDIUM", label: "Medium" }, { value: "HIGH", label: "High" }, { value: "SAFETY_CRITICAL", label: "Safety critical" },
        ] },
        { key: "businessJustification", label: "Business justification", type: "textarea", required: true, maxLength: 5000 },
        { key: "annualVolume", label: "Estimated annual volume", type: "number", integer: true, min: 0 },
        { key: "targetDate", label: "Target approval date", type: "date" },
      ],
    },
    {
      key: "supplier",
      title: "Supplier and pathway",
      fields: [
        { ref: "supplierName" },
        { ref: "manufacturingSite" },
        { ref: "supplierPartNumber" },
        { ref: "pathway" },
        { key: "reverseEngineering", label: "Reverse engineering required", type: "checkbox" },
        { key: "engineeringOwnership", label: "Engineering ownership", type: "select", required: true, options: [
          { value: "COMPANY", label: "Company" }, { value: "SUPPLIER", label: "Supplier" }, { value: "SHARED", label: "Shared" },
        ] },
      ],
    },
    {
      key: "technical",
      title: "Technical requirements and baseline",
      fields: [
        { key: "technicalRequirements", label: "Technical requirements", type: "textarea", maxLength: 10000 },
        { key: "baselineInformation", label: "Approved baseline information", type: "textarea", maxLength: 10000 },
        { key: "specialProcesses", label: "Special processes involved", type: "checkbox" },
        { key: "customerRequirements", label: "Customer-specific requirements apply", type: "checkbox" },
      ],
    },
    {
      key: "team",
      title: "Responsible personnel",
      fields: [
        { key: "team", label: "Team", type: "table", columns: [
          { key: "role", label: "Role", type: "text", required: true, maxLength: 60 },
          { key: "name", label: "Name", type: "text", required: true, maxLength: 160 },
          { key: "dueDate", label: "Due date", type: "date" },
        ] },
      ],
    },
  ],
};

const SPRA: AuthoringFormSchema = {
  key: "SPRA",
  title: "Sourcing Path & Risk Assessment (INT-02)",
  description: "Score and risk level are computed by the server from the factor selections.",
  sections: [
    {
      key: "assessment",
      title: "Assessment",
      fields: [
        { key: "modelVersion", label: "Risk model version", type: "text", readOnly: true },
        { key: "factors", label: "Risk factors", type: "table", readOnly: true, columns: [
          { key: "factor", label: "Factor", type: "text" },
          { key: "selection", label: "Selection", type: "text" },
          { key: "points", label: "Points", type: "number" },
        ] },
        { key: "score", label: "Total score", type: "number", readOnly: true },
        { key: "level", label: "Risk level", type: "text", readOnly: true },
        { key: "rationale", label: "Assessor rationale", type: "textarea", maxLength: 5000 },
      ],
    },
  ],
};

const SQQ: AuthoringFormSchema = {
  key: "SQQ",
  title: "Supplier Qualification Questionnaire (SUP-01)",
  sections: [
    {
      key: "company",
      title: "Company information",
      fields: [
        { key: "legalName", label: "Legal entity name", type: "text", required: true, maxLength: 250 },
        { key: "yearEstablished", label: "Year established", type: "number", integer: true, min: 1800, max: 2100 },
        { key: "employees", label: "Number of employees", type: "number", integer: true, min: 0 },
        { key: "ownership", label: "Ownership", type: "select", options: [
          { value: "PRIVATE", label: "Privately held" }, { value: "PUBLIC", label: "Publicly traded" }, { value: "SUBSIDIARY", label: "Subsidiary" },
        ] },
        { key: "website", label: "Website", type: "url" },
        { ref: "contactTable" },
      ],
    },
    {
      key: "quality",
      title: "Quality management system",
      fields: [
        { key: "hasCertifiedQms", label: "Is your quality management system third-party certified?", type: "radio", required: true, options: yesNo },
        { ref: "certificationTable", overrides: { visibleWhen: { field: "hasCertifiedQms", equals: "YES" }, required: true } },
        { key: "qmsDescription", label: "Describe your quality system (if not certified)", type: "textarea", visibleWhen: { field: "hasCertifiedQms", equals: "NO" }, required: true },
        { key: "inspectionCapabilities", label: "Inspection and measurement capabilities (CMM, surface, hardness, flow test, etc.)", type: "textarea", required: true },
        { key: "calibrationProgram", label: "Do you maintain a calibration program traceable to national standards?", type: "radio", required: true, options: yesNo },
      ],
    },
    {
      key: "capabilities",
      title: "Manufacturing capabilities",
      fields: [
        { key: "processes", label: "Manufacturing processes", type: "multiselect", required: true, minItems: 1, options: [
          { value: "CNC_MACHINING", label: "CNC machining" }, { value: "CASTING", label: "Casting" }, { value: "FORGING", label: "Forging" },
          { value: "HEAT_TREATMENT", label: "Heat treatment" }, { value: "COATING", label: "Coating / surface treatment" }, { value: "ASSEMBLY", label: "Assembly" },
          { value: "BALANCING", label: "Balancing" }, { value: "GRINDING", label: "Precision grinding" }, { value: "WELDING", label: "Welding / brazing" },
        ] },
        { key: "productTypes", label: "Product types manufactured", type: "textarea", required: true },
        { key: "annualCapacity", label: "Annual capacity for the requested product family", type: "text", maxLength: 300 },
      ],
    },
    {
      key: "subTier",
      title: "Sub-tier suppliers and special processes",
      fields: [
        { key: "usesSubTier", label: "Do you outsource any operations or special processes?", type: "radio", required: true, options: yesNo },
        { key: "subTierSuppliers", label: "Sub-tier suppliers", type: "table", visibleWhen: { field: "usesSubTier", equals: "YES" }, required: true, columns: [
          { key: "name", label: "Sub-tier supplier", type: "text", required: true, maxLength: 200 },
          { key: "process", label: "Process / operation", type: "text", required: true, maxLength: 200 },
          { key: "location", label: "Location", type: "text", maxLength: 200 },
          { key: "approved", label: "Approved by you", type: "checkbox" },
        ] },
      ],
    },
    {
      key: "changeControl",
      title: "Change control commitment",
      fields: [
        { key: "changeNotificationCommitment", label: "We will notify the customer in writing and obtain approval before changing design, material, process, tooling, location or sub-tier sources of approved products.", type: "checkbox", required: true },
        { ref: "preparedBy" },
        { ref: "preparedDate" },
        { ref: "supportingFiles", overrides: { label: "Certificates and supporting documents" } },
      ],
    },
  ],
};

const SBPS: AuthoringFormSchema = {
  key: "SBPS",
  title: "Supplier Baseline Product Specification (ENG-04)",
  description: "Can be generated from the configuration revision's engineering baseline.",
  sections: [
    {
      key: "identification",
      title: "Product identification",
      fields: [
        { ref: "internalPartNumber" },
        { ref: "supplierName" },
        { ref: "supplierPartNumber", overrides: { required: true } },
        { key: "supplierProductRevision", label: "Supplier product revision", type: "text", maxLength: 40 },
        { ref: "manufacturingSite", overrides: { required: true } },
        { ref: "configurationRef" },
        { key: "baselineType", label: "Baseline type", type: "text", readOnly: true },
      ],
    },
    {
      key: "definition",
      title: "Product definition",
      fields: [
        { key: "drawingNumber", label: "Supplier drawing / specification number", type: "text", maxLength: 80 },
        { key: "drawingRevision", label: "Drawing / specification revision", type: "text", maxLength: 20 },
        { key: "material", label: "Material", type: "text", maxLength: 300 },
        { key: "coating", label: "Coating / surface treatment", type: "text", maxLength: 300 },
        { key: "heatTreatment", label: "Heat treatment", type: "text", maxLength: 300 },
        { key: "keyDimensions", label: "Key dimensions and tolerances", type: "textarea" },
        { key: "performanceRequirements", label: "Performance requirements", type: "textarea" },
        { key: "operatingRequirements", label: "Operating requirements / application limits", type: "textarea" },
      ],
    },
    {
      key: "guaranteed",
      title: "Guaranteed characteristics",
      fields: [
        { key: "guaranteedCharacteristics", label: "Guaranteed characteristics", type: "table", columns: [
          { key: "characteristic", label: "Characteristic", type: "text", required: true, maxLength: 250 },
          { key: "specification", label: "Specification", type: "text", required: true, maxLength: 500 },
          { key: "method", label: "Verification method", type: "text", maxLength: 300 },
        ] },
        { ref: "notes" },
        { ref: "supportingFiles" },
      ],
    },
  ],
};

const DELTA_SPEC: AuthoringFormSchema = {
  key: "DELTA_SPEC",
  title: "Customer-Specific Requirements / Delta Specification (ENG-06)",
  description: "Baseline-plus-delta: only additional or modified requirements are listed.",
  sections: [
    {
      key: "reference",
      title: "Baseline reference",
      fields: [
        { ref: "internalPartNumber" },
        { ref: "supplierName" },
        { key: "baseConfiguration", label: "Base supplier configuration", type: "text", required: true, maxLength: 120 },
        { key: "customConfiguration", label: "Custom configuration / part number", type: "text", maxLength: 120 },
      ],
    },
    {
      key: "requirements",
      title: "Requirements",
      fields: [
        { key: "requirements", label: "Delta requirements", type: "table", required: true, columns: [
          { key: "code", label: "Req.", type: "text", required: true, maxLength: 20 },
          { key: "category", label: "Category", type: "select", required: true, options: requirementCategories },
          { key: "title", label: "Requirement", type: "text", required: true, maxLength: 250 },
          { key: "baselineValue", label: "Supplier baseline", type: "text", maxLength: 2000 },
          { key: "requiredValue", label: "Required", type: "text", required: true, maxLength: 2000 },
          { key: "acceptanceCriteria", label: "Acceptance criteria", type: "text", required: true, maxLength: 2000 },
          { key: "ackStatus", label: "Supplier acknowledgment", type: "text", maxLength: 40 },
        ] },
        { ref: "notes" },
      ],
    },
  ],
};

const CCM: AuthoringFormSchema = {
  key: "CCM",
  title: "Critical Characteristics & Acceptance Matrix (ENG-08)",
  sections: [
    {
      key: "matrix",
      title: "Characteristics",
      fields: [
        { ref: "internalPartNumber" },
        { ref: "configurationRef" },
        { key: "characteristics", label: "Characteristics", type: "table", required: true, columns: [
          { key: "charNumber", label: "No.", type: "text", required: true, maxLength: 20 },
          { key: "name", label: "Characteristic", type: "text", required: true, maxLength: 250 },
          { key: "classification", label: "Class", type: "select", required: true, options: [
            { value: "CRITICAL", label: "Critical" }, { value: "SIGNIFICANT", label: "Significant" }, { value: "MAJOR", label: "Major" }, { value: "MINOR", label: "Minor" },
          ] },
          { key: "specification", label: "Specification", type: "text", maxLength: 500 },
          { key: "measurementMethod", label: "Method", type: "text", maxLength: 300 },
          { key: "inspectionFrequency", label: "Frequency", type: "text", maxLength: 200 },
          { key: "acceptanceCriteria", label: "Acceptance", type: "text", maxLength: 2000 },
        ] },
      ],
    },
  ],
};

const PSAR: AuthoringFormSchema = {
  key: "PSAR",
  title: "Product & Supplier Approval Record (VAL-11)",
  description: "Generated by the system from the approval package snapshot.",
  sections: [
    {
      key: "approval",
      title: "Approval",
      fields: [
        { key: "approvalNumber", label: "Approval number", type: "text", readOnly: true },
        { ref: "internalPartNumber" },
        { ref: "supplierName" },
        { ref: "supplierPartNumber" },
        { ref: "manufacturingSite" },
        { ref: "configurationRef" },
        { key: "qualificationNumber", label: "Qualification", type: "text", readOnly: true },
        { key: "approvedAt", label: "Approval date", type: "date", readOnly: true },
        { key: "restrictions", label: "Approval restrictions", type: "textarea" },
      ],
    },
    {
      key: "evidence",
      title: "Evidence",
      fields: [
        { key: "documents", label: "Approved document revisions", type: "table", readOnly: true, columns: [
          { key: "documentType", label: "Type", type: "text" },
          { key: "docNumber", label: "Document", type: "text" },
          { key: "revision", label: "Revision", type: "text" },
          { key: "contentHash", label: "Content hash", type: "text" },
        ] },
        { key: "approvers", label: "Approvals", type: "table", readOnly: true, columns: [
          { key: "step", label: "Step", type: "text" },
          { key: "approver", label: "Approver", type: "text" },
          { key: "decidedAt", label: "Date", type: "text" },
        ] },
        { key: "snapshotHash", label: "Approval package hash", type: "text", readOnly: true },
      ],
    },
  ],
};

const AUTHORING: AuthoringFormSchema[] = [PSR, SPRA, SQQ, SBPS, DELTA_SPEC, CCM, PSAR];

export const FORM_DEFINITION_SEEDS: { key: string; name: string; documentTypeCode: string; schema: FormSchema }[] = [
  { key: "PSR", name: "Product Sourcing Request", documentTypeCode: "INT-01", schema: resolveFormSchema(PSR, FIELD_LIBRARY) },
  { key: "SPRA", name: "Sourcing Path & Risk Assessment", documentTypeCode: "INT-02", schema: resolveFormSchema(SPRA, FIELD_LIBRARY) },
  { key: "SQQ", name: "Supplier Qualification Questionnaire", documentTypeCode: "SUP-01", schema: resolveFormSchema(SQQ, FIELD_LIBRARY) },
  { key: "SBPS", name: "Supplier Baseline Product Specification", documentTypeCode: "ENG-04", schema: resolveFormSchema(SBPS, FIELD_LIBRARY) },
  { key: "DELTA_SPEC", name: "Customer-Specific Requirements / Delta Specification", documentTypeCode: "ENG-06", schema: resolveFormSchema(DELTA_SPEC, FIELD_LIBRARY) },
  { key: "CCM", name: "Critical Characteristics & Acceptance Matrix", documentTypeCode: "ENG-08", schema: resolveFormSchema(CCM, FIELD_LIBRARY) },
  { key: "PSAR", name: "Product & Supplier Approval Record", documentTypeCode: "VAL-11", schema: resolveFormSchema(PSAR, FIELD_LIBRARY) },
];

export const AUTHORING_FORM_SCHEMAS = AUTHORING;
