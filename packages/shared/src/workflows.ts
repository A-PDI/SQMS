/**
 * Default workflow definitions (seeded as version 1; administrators can publish new versions).
 * Steps with the same `stepOrder` run in parallel; increasing stepOrder runs sequentially.
 */
import type { ConditionNode } from "./rules/applicability";

export type WorkflowSubject =
  | "DOCUMENT_REVISION"
  | "PRODUCT_QUALIFICATION"
  | "CHANGE_REQUEST"
  | "SUPPLIER_QUALIFICATION"
  | "DEVIATION"
  | "SOURCING_PROJECT"
  | "NCR_DISPOSITION"
  | "SCAR_CLOSURE";

export interface WorkflowStepSeed {
  stepOrder: number;
  key: string;
  name: string;
  approverType: "ROLE" | "USER" | "RECORD_OWNER";
  approverRoleKey?: string;
  requiredApprovals?: number;
  dueInDays?: number;
  escalateAfterDays?: number;
  escalateToRoleKey?: string;
  /** Optional condition evaluated against the workflow context (e.g. risk level) - step is skipped when false. */
  condition?: ConditionNode;
}

export interface WorkflowDefinitionSeed {
  key: string;
  name: string;
  description: string;
  subjectType: WorkflowSubject;
  steps: WorkflowStepSeed[];
}

const role = (stepOrder: number, key: string, name: string, approverRoleKey: string, extra: Partial<WorkflowStepSeed> = {}): WorkflowStepSeed => ({
  stepOrder,
  key,
  name,
  approverType: "ROLE",
  approverRoleKey,
  requiredApprovals: 1,
  dueInDays: 5,
  escalateAfterDays: 7,
  escalateToRoleKey: "APPROVER",
  ...extra,
});

export const WORKFLOW_DEFINITION_SEEDS: WorkflowDefinitionSeed[] = [
  {
    key: "document-review-standard",
    name: "Document review - Supplier Quality",
    description: "Single review by Supplier Quality.",
    subjectType: "DOCUMENT_REVISION",
    steps: [role(1, "sq-review", "Supplier Quality review", "SUPPLIER_QUALITY")],
  },
  {
    key: "document-review-engineering",
    name: "Document review - Engineering then Quality",
    description: "Sequential review: Engineering, then Supplier Quality.",
    subjectType: "DOCUMENT_REVISION",
    steps: [role(1, "eng-review", "Engineering review", "ENGINEERING"), role(2, "sq-review", "Supplier Quality review", "SUPPLIER_QUALITY")],
  },
  {
    key: "document-review-dual",
    name: "Document review - Engineering and Quality (parallel)",
    description: "Parallel review by Engineering and Supplier Quality.",
    subjectType: "DOCUMENT_REVISION",
    steps: [role(1, "eng-review", "Engineering review", "ENGINEERING"), role(1, "sq-review", "Supplier Quality review", "SUPPLIER_QUALITY")],
  },
  {
    key: "document-review-management",
    name: "Document review - Quality then Management",
    description: "Supplier Quality review followed by management approval.",
    subjectType: "DOCUMENT_REVISION",
    steps: [role(1, "sq-review", "Supplier Quality review", "SUPPLIER_QUALITY"), role(2, "mgmt-approval", "Management approval", "APPROVER", { escalateToRoleKey: "SYSTEM_ADMIN" })],
  },
  {
    key: "sourcing-project-review",
    name: "Sourcing project intake review",
    description: "Engineering and Supplier Quality review the sourcing request, pathway and risk assessment.",
    subjectType: "SOURCING_PROJECT",
    steps: [role(1, "eng-review", "Engineering intake review", "ENGINEERING"), role(1, "sq-review", "Supplier Quality intake review", "SUPPLIER_QUALITY")],
  },
  {
    key: "product-qualification-standard",
    name: "Product approval - standard risk",
    description: "Parallel approval by Engineering and Supplier Quality.",
    subjectType: "PRODUCT_QUALIFICATION",
    steps: [role(1, "eng-approval", "Engineering approval", "ENGINEERING"), role(1, "sq-approval", "Supplier Quality approval", "SUPPLIER_QUALITY")],
  },
  {
    key: "product-qualification-high-risk",
    name: "Product approval - high risk",
    description: "Parallel approval by Engineering and Supplier Quality, then management approval.",
    subjectType: "PRODUCT_QUALIFICATION",
    steps: [
      role(1, "eng-approval", "Engineering approval", "ENGINEERING"),
      role(1, "sq-approval", "Supplier Quality approval", "SUPPLIER_QUALITY"),
      role(2, "mgmt-approval", "Management approval", "APPROVER", { escalateToRoleKey: "SYSTEM_ADMIN" }),
    ],
  },
  {
    key: "change-request-approval",
    name: "Supplier change approval",
    description: "Engineering and Supplier Quality evaluate the change; management approval for HIGH+ risk changes.",
    subjectType: "CHANGE_REQUEST",
    steps: [
      role(1, "eng-approval", "Engineering evaluation", "ENGINEERING"),
      role(1, "sq-approval", "Supplier Quality evaluation", "SUPPLIER_QUALITY"),
      role(2, "mgmt-approval", "Management approval (high risk)", "APPROVER", {
        escalateToRoleKey: "SYSTEM_ADMIN",
        condition: { field: "riskLevel", op: "gte", value: "HIGH" },
      }),
    ],
  },
  {
    key: "supplier-qualification-approval",
    name: "Supplier qualification approval",
    description: "Supplier Quality recommendation followed by management approval.",
    subjectType: "SUPPLIER_QUALIFICATION",
    steps: [role(1, "sq-review", "Supplier Quality recommendation", "SUPPLIER_QUALITY"), role(2, "mgmt-approval", "Management approval", "APPROVER", { escalateToRoleKey: "SYSTEM_ADMIN" })],
  },
  {
    key: "deviation-approval",
    name: "Deviation / concession approval",
    description: "Parallel approval by Engineering and Supplier Quality.",
    subjectType: "DEVIATION",
    steps: [role(1, "eng-approval", "Engineering approval", "ENGINEERING"), role(1, "sq-approval", "Supplier Quality approval", "SUPPLIER_QUALITY")],
  },
];

/** Default selection of product-approval workflow by pathway and risk level (stored as a system setting). */
export const DEFAULT_QUALIFICATION_WORKFLOW_MATRIX: Record<"A" | "B" | "C", Record<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL", string>> = {
  A: { LOW: "product-qualification-standard", MEDIUM: "product-qualification-standard", HIGH: "product-qualification-high-risk", CRITICAL: "product-qualification-high-risk" },
  B: { LOW: "product-qualification-standard", MEDIUM: "product-qualification-standard", HIGH: "product-qualification-high-risk", CRITICAL: "product-qualification-high-risk" },
  C: { LOW: "product-qualification-standard", MEDIUM: "product-qualification-high-risk", HIGH: "product-qualification-high-risk", CRITICAL: "product-qualification-high-risk" },
};
