/**
 * Database-driven document applicability rule engine.
 *
 * Each rule targets one document type and yields REQUIRED, CONDITIONAL or NOT_APPLICABLE when its condition
 * tree matches the project context. For each document type the matching rule with the highest priority wins;
 * ties resolve to the strictest outcome. Document types with no matching rule are NOT_APPLICABLE.
 */

export const RISK_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const CRITICALITY_ORDER = ["LOW", "MEDIUM", "HIGH", "SAFETY_CRITICAL"] as const;
export const SUPPLIER_STATUSES = [
  "PROSPECTIVE",
  "UNDER_EVALUATION",
  "APPROVED",
  "CONDITIONALLY_APPROVED",
  "SUSPENDED",
  "INACTIVE",
] as const;

export type RiskLevelCode = (typeof RISK_ORDER)[number];
export type CriticalityCode = (typeof CRITICALITY_ORDER)[number];
export type SupplierStatusCode = (typeof SUPPLIER_STATUSES)[number];
export type RequirementLevelCode = "REQUIRED" | "CONDITIONAL" | "NOT_APPLICABLE";

export interface ApplicabilityContext {
  pathway: "A" | "B" | "C";
  riskLevel: RiskLevelCode;
  criticality: CriticalityCode;
  supplierStatus: SupplierStatusCode;
  /** Derived: supplier not APPROVED or CONDITIONALLY_APPROVED. */
  newSupplier: boolean;
  engineeringOwnership: "COMPANY" | "SUPPLIER" | "SHARED";
  reverseEngineering: boolean;
  specialProcesses: boolean;
  customerRequirements: boolean;
}

export const CONTEXT_FIELDS: Record<keyof ApplicabilityContext, { label: string; type: "enum" | "boolean"; values?: readonly string[]; ordered?: boolean }> = {
  pathway: { label: "Sourcing pathway", type: "enum", values: ["A", "B", "C"] },
  riskLevel: { label: "Risk level", type: "enum", values: RISK_ORDER, ordered: true },
  criticality: { label: "Product criticality", type: "enum", values: CRITICALITY_ORDER, ordered: true },
  supplierStatus: { label: "Supplier qualification status", type: "enum", values: SUPPLIER_STATUSES },
  newSupplier: { label: "New / unapproved supplier", type: "boolean" },
  engineeringOwnership: { label: "Engineering ownership", type: "enum", values: ["COMPANY", "SUPPLIER", "SHARED"] },
  reverseEngineering: { label: "Reverse engineering required", type: "boolean" },
  specialProcesses: { label: "Special processes involved", type: "boolean" },
  customerRequirements: { label: "Customer-specific requirements apply", type: "boolean" },
};

export type ConditionOperator = "eq" | "neq" | "in" | "nin" | "gte" | "lte";

export interface FieldCondition {
  field: keyof ApplicabilityContext;
  op: ConditionOperator;
  value: string | boolean | string[];
}

export type ConditionNode = FieldCondition | { all: ConditionNode[] } | { any: ConditionNode[] } | { not: ConditionNode };

export interface RuleInput {
  id?: string;
  documentTypeCode: string;
  outcome: RequirementLevelCode;
  priority: number;
  conditions: ConditionNode | Record<string, never>;
  reason: string;
  dueOffsetDays?: number | null;
  defaultAssigneeRoleKey?: string | null;
}

export interface EvaluatedRequirement {
  documentTypeCode: string;
  level: RequirementLevelCode;
  ruleId?: string;
  reason: string;
  dueOffsetDays?: number | null;
  defaultAssigneeRoleKey?: string | null;
}

const LEVEL_STRENGTH: Record<RequirementLevelCode, number> = { NOT_APPLICABLE: 0, CONDITIONAL: 1, REQUIRED: 2 };

function orderIndex(field: keyof ApplicabilityContext, value: string): number {
  const def = CONTEXT_FIELDS[field];
  if (!def.ordered || !def.values) throw new Error(`Field "${field}" does not support ordered comparison`);
  const idx = def.values.indexOf(value);
  if (idx < 0) throw new Error(`Value "${value}" is not valid for field "${field}"`);
  return idx;
}

function evaluateField(cond: FieldCondition, ctx: ApplicabilityContext): boolean {
  const actual = ctx[cond.field];
  switch (cond.op) {
    case "eq":
      return actual === cond.value;
    case "neq":
      return actual !== cond.value;
    case "in":
      return Array.isArray(cond.value) && (cond.value as unknown[]).includes(actual);
    case "nin":
      return Array.isArray(cond.value) && !(cond.value as unknown[]).includes(actual);
    case "gte":
      return orderIndex(cond.field, String(actual)) >= orderIndex(cond.field, String(cond.value));
    case "lte":
      return orderIndex(cond.field, String(actual)) <= orderIndex(cond.field, String(cond.value));
    default:
      throw new Error(`Unsupported operator "${(cond as FieldCondition).op}"`);
  }
}

export function isEmptyCondition(node: unknown): boolean {
  return !node || (typeof node === "object" && Object.keys(node as object).length === 0);
}

export function evaluateCondition(node: ConditionNode | Record<string, never>, ctx: ApplicabilityContext): boolean {
  if (isEmptyCondition(node)) return true;
  if ("all" in node) return node.all.every((n) => evaluateCondition(n, ctx));
  if ("any" in node) return node.any.some((n) => evaluateCondition(n, ctx));
  if ("not" in node) return !evaluateCondition(node.not, ctx);
  return evaluateField(node as FieldCondition, ctx);
}

/** Validates a condition tree structure; returns a list of problems (empty when valid). */
export function validateCondition(node: unknown, path = "conditions"): string[] {
  if (isEmptyCondition(node)) return [];
  if (typeof node !== "object" || node === null) return [`${path}: must be an object`];
  const obj = node as Record<string, unknown>;
  if ("all" in obj || "any" in obj) {
    const key = "all" in obj ? "all" : "any";
    const list = obj[key];
    if (!Array.isArray(list) || list.length === 0) return [`${path}.${key}: must be a non-empty array`];
    return list.flatMap((n, i) => validateCondition(n, `${path}.${key}[${i}]`));
  }
  if ("not" in obj) return validateCondition(obj.not, `${path}.not`);
  const field = obj.field as keyof ApplicabilityContext;
  const def = CONTEXT_FIELDS[field];
  if (!def) return [`${path}.field: unknown field "${String(obj.field)}"`];
  const op = obj.op as ConditionOperator;
  if (!["eq", "neq", "in", "nin", "gte", "lte"].includes(op)) return [`${path}.op: unsupported operator "${String(obj.op)}"`];
  const problems: string[] = [];
  const values = Array.isArray(obj.value) ? obj.value : [obj.value];
  if ((op === "in" || op === "nin") && !Array.isArray(obj.value)) problems.push(`${path}.value: must be an array for "${op}"`);
  if ((op === "gte" || op === "lte") && !def.ordered) problems.push(`${path}.op: "${op}" requires an ordered field`);
  for (const v of values) {
    if (def.type === "boolean" && typeof v !== "boolean") problems.push(`${path}.value: must be boolean`);
    if (def.type === "enum" && (typeof v !== "string" || !def.values!.includes(v))) problems.push(`${path}.value: "${String(v)}" is not valid for ${field}`);
  }
  return problems;
}

export function deriveNewSupplier(status: SupplierStatusCode): boolean {
  return status !== "APPROVED" && status !== "CONDITIONALLY_APPROVED";
}

/**
 * Evaluates rules against a context. Returns one entry per document type that has at least one matching rule
 * (including explicit NOT_APPLICABLE results), sorted by document type code.
 */
export function evaluateApplicability(rules: RuleInput[], ctx: ApplicabilityContext): EvaluatedRequirement[] {
  const winners = new Map<string, RuleInput>();
  for (const rule of rules) {
    if (!evaluateCondition(rule.conditions, ctx)) continue;
    const current = winners.get(rule.documentTypeCode);
    if (
      !current ||
      rule.priority > current.priority ||
      (rule.priority === current.priority && LEVEL_STRENGTH[rule.outcome] > LEVEL_STRENGTH[current.outcome])
    ) {
      winners.set(rule.documentTypeCode, rule);
    }
  }
  return [...winners.values()]
    .map((r) => ({
      documentTypeCode: r.documentTypeCode,
      level: r.outcome,
      ruleId: r.id,
      reason: r.reason,
      dueOffsetDays: r.dueOffsetDays ?? null,
      defaultAssigneeRoleKey: r.defaultAssigneeRoleKey ?? null,
    }))
    .sort((a, b) => a.documentTypeCode.localeCompare(b.documentTypeCode));
}

// ----------------------------------------------------------------------------------------------
// Default policy (seeded as version 1 of the "sourcing-document-requirements" policy).
// ----------------------------------------------------------------------------------------------

const always = {} as Record<string, never>;
const pathwayIn = (...p: string[]): FieldCondition => ({ field: "pathway", op: "in", value: p });
const riskGte = (l: RiskLevelCode): FieldCondition => ({ field: "riskLevel", op: "gte", value: l });
const critGte = (l: CriticalityCode): FieldCondition => ({ field: "criticality", op: "gte", value: l });
const isTrue = (field: keyof ApplicabilityContext): FieldCondition => ({ field, op: "eq", value: true });
const isFalse = (field: keyof ApplicabilityContext): FieldCondition => ({ field, op: "eq", value: false });

export const DEFAULT_POLICY_KEY = "sourcing-document-requirements";

export const DEFAULT_APPLICABILITY_RULES: RuleInput[] = [
  { documentTypeCode: "INT-01", outcome: "REQUIRED", priority: 10, conditions: always, reason: "Every sourcing project requires a Product Sourcing Request.", dueOffsetDays: 0, defaultAssigneeRoleKey: "SOURCING" },
  { documentTypeCode: "INT-02", outcome: "REQUIRED", priority: 10, conditions: always, reason: "Every sourcing project requires a sourcing path & risk assessment.", dueOffsetDays: 0, defaultAssigneeRoleKey: "SUPPLIER_QUALITY" },

  { documentTypeCode: "SUP-01", outcome: "CONDITIONAL", priority: 10, conditions: always, reason: "Approved supplier: confirm questionnaire is current.", dueOffsetDays: 14, defaultAssigneeRoleKey: "SUPPLIER_QUALITY" },
  { documentTypeCode: "SUP-01", outcome: "REQUIRED", priority: 20, conditions: isTrue("newSupplier"), reason: "Supplier is not yet approved.", dueOffsetDays: 14, defaultAssigneeRoleKey: "SUPPLIER_QUALITY" },
  { documentTypeCode: "SUP-02", outcome: "CONDITIONAL", priority: 10, conditions: isTrue("newSupplier"), reason: "New supplier: capability assessment recommended.", dueOffsetDays: 30, defaultAssigneeRoleKey: "SUPPLIER_QUALITY" },
  { documentTypeCode: "SUP-02", outcome: "REQUIRED", priority: 20, conditions: { all: [isTrue("newSupplier"), riskGte("HIGH")] }, reason: "New supplier on a high-risk project.", dueOffsetDays: 30, defaultAssigneeRoleKey: "SUPPLIER_QUALITY" },
  { documentTypeCode: "SUP-03", outcome: "CONDITIONAL", priority: 10, conditions: always, reason: "Approved supplier: confirm quality agreement is current.", dueOffsetDays: 30, defaultAssigneeRoleKey: "SUPPLIER_QUALITY" },
  { documentTypeCode: "SUP-03", outcome: "REQUIRED", priority: 20, conditions: isTrue("newSupplier"), reason: "Supplier is not yet approved.", dueOffsetDays: 30, defaultAssigneeRoleKey: "SUPPLIER_QUALITY" },
  { documentTypeCode: "SUP-04", outcome: "CONDITIONAL", priority: 10, conditions: always, reason: "Confirm confidentiality coverage.", dueOffsetDays: 7, defaultAssigneeRoleKey: "SOURCING" },
  { documentTypeCode: "SUP-04", outcome: "REQUIRED", priority: 20, conditions: { any: [pathwayIn("A", "C"), { field: "engineeringOwnership", op: "in", value: ["COMPANY", "SHARED"] }] }, reason: "Company engineering data will be shared with the supplier.", dueOffsetDays: 7, defaultAssigneeRoleKey: "SOURCING" },
  { documentTypeCode: "SUP-05", outcome: "CONDITIONAL", priority: 10, conditions: riskGte("HIGH"), reason: "High-risk project: disclose sub-tier sources.", dueOffsetDays: 21, defaultAssigneeRoleKey: "SUPPLIER_QUALITY" },
  { documentTypeCode: "SUP-05", outcome: "REQUIRED", priority: 20, conditions: isTrue("specialProcesses"), reason: "Special processes are involved.", dueOffsetDays: 21, defaultAssigneeRoleKey: "SUPPLIER_QUALITY" },

  { documentTypeCode: "ENG-01", outcome: "REQUIRED", priority: 20, conditions: { all: [pathwayIn("A"), isFalse("reverseEngineering")] }, reason: "Pathway A with a controlled drawing / TDP.", dueOffsetDays: 14, defaultAssigneeRoleKey: "ENGINEERING" },
  { documentTypeCode: "ENG-02", outcome: "CONDITIONAL", priority: 10, conditions: pathwayIn("C"), reason: "Pathway C: design review of modifications recommended.", dueOffsetDays: 30, defaultAssigneeRoleKey: "ENGINEERING" },
  { documentTypeCode: "ENG-02", outcome: "REQUIRED", priority: 20, conditions: { any: [pathwayIn("A"), { all: [pathwayIn("C"), riskGte("HIGH")] }, isTrue("reverseEngineering")] }, reason: "Engineering release of the design definition is required.", dueOffsetDays: 30, defaultAssigneeRoleKey: "ENGINEERING" },
  { documentTypeCode: "ENG-03", outcome: "REQUIRED", priority: 20, conditions: isTrue("reverseEngineering"), reason: "Project starts from a physical sample without a controlled drawing.", dueOffsetDays: 7, defaultAssigneeRoleKey: "ENGINEERING" },
  { documentTypeCode: "ENG-04", outcome: "REQUIRED", priority: 20, conditions: { any: [pathwayIn("B", "C"), isTrue("reverseEngineering")] }, reason: "Supplier product baseline / proposed definition is required.", dueOffsetDays: 21, defaultAssigneeRoleKey: "ENGINEERING" },
  { documentTypeCode: "ENG-05", outcome: "CONDITIONAL", priority: 10, conditions: always, reason: "Record the supplier part cross-reference.", dueOffsetDays: 21, defaultAssigneeRoleKey: "ENGINEERING" },
  { documentTypeCode: "ENG-05", outcome: "REQUIRED", priority: 20, conditions: pathwayIn("B", "C"), reason: "Supplier part number and configuration must be cross-referenced.", dueOffsetDays: 21, defaultAssigneeRoleKey: "ENGINEERING" },
  { documentTypeCode: "ENG-06", outcome: "CONDITIONAL", priority: 10, conditions: isTrue("customerRequirements"), reason: "Customer-specific requirements apply.", dueOffsetDays: 21, defaultAssigneeRoleKey: "ENGINEERING" },
  { documentTypeCode: "ENG-06", outcome: "REQUIRED", priority: 20, conditions: pathwayIn("C"), reason: "Pathway C modifications require a delta specification.", dueOffsetDays: 21, defaultAssigneeRoleKey: "ENGINEERING" },
  { documentTypeCode: "ENG-07", outcome: "CONDITIONAL", priority: 10, conditions: { all: [pathwayIn("B"), critGte("HIGH")] }, reason: "High-criticality selected item.", dueOffsetDays: 30, defaultAssigneeRoleKey: "ENGINEERING" },
  { documentTypeCode: "ENG-07", outcome: "REQUIRED", priority: 20, conditions: pathwayIn("C"), reason: "Altered item requires a controlled drawing.", dueOffsetDays: 30, defaultAssigneeRoleKey: "ENGINEERING" },
  { documentTypeCode: "ENG-08", outcome: "CONDITIONAL", priority: 10, conditions: always, reason: "Identify any critical characteristics.", dueOffsetDays: 21, defaultAssigneeRoleKey: "ENGINEERING" },
  { documentTypeCode: "ENG-08", outcome: "REQUIRED", priority: 20, conditions: { any: [critGte("HIGH"), riskGte("HIGH")] }, reason: "High criticality or risk requires a critical characteristics matrix.", dueOffsetDays: 21, defaultAssigneeRoleKey: "ENGINEERING" },

  { documentTypeCode: "VAL-01", outcome: "CONDITIONAL", priority: 10, conditions: always, reason: "Low risk: a simplified validation plan may suffice.", dueOffsetDays: 30, defaultAssigneeRoleKey: "SUPPLIER_QUALITY" },
  { documentTypeCode: "VAL-01", outcome: "REQUIRED", priority: 20, conditions: riskGte("MEDIUM"), reason: "Risk MEDIUM or above requires a qualification & validation plan.", dueOffsetDays: 30, defaultAssigneeRoleKey: "SUPPLIER_QUALITY" },
  { documentTypeCode: "VAL-02", outcome: "CONDITIONAL", priority: 10, conditions: always, reason: "Sample inspection recommended.", dueOffsetDays: 45, defaultAssigneeRoleKey: "SUPPLIER_QUALITY" },
  { documentTypeCode: "VAL-02", outcome: "REQUIRED", priority: 20, conditions: { any: [pathwayIn("A", "C"), riskGte("MEDIUM")] }, reason: "First-article inspection required for pathway A/C or risk MEDIUM+.", dueOffsetDays: 45, defaultAssigneeRoleKey: "SUPPLIER_QUALITY" },
  { documentTypeCode: "VAL-03", outcome: "CONDITIONAL", priority: 10, conditions: always, reason: "Functional testing per validation plan.", dueOffsetDays: 60, defaultAssigneeRoleKey: "ENGINEERING" },
  { documentTypeCode: "VAL-03", outcome: "REQUIRED", priority: 20, conditions: { any: [pathwayIn("C"), critGte("HIGH")] }, reason: "Modifications / high criticality require functional validation.", dueOffsetDays: 60, defaultAssigneeRoleKey: "ENGINEERING" },
  { documentTypeCode: "VAL-04", outcome: "CONDITIONAL", priority: 10, conditions: always, reason: "Provide material certificates where specified.", dueOffsetDays: 45, defaultAssigneeRoleKey: "SUPPLIER_QUALITY" },
  { documentTypeCode: "VAL-04", outcome: "REQUIRED", priority: 20, conditions: isTrue("specialProcesses"), reason: "Special processes require material / process certificates.", dueOffsetDays: 45, defaultAssigneeRoleKey: "SUPPLIER_QUALITY" },
  { documentTypeCode: "VAL-05", outcome: "CONDITIONAL", priority: 10, conditions: riskGte("MEDIUM"), reason: "Determine whether PPAP elements apply.", dueOffsetDays: 14, defaultAssigneeRoleKey: "SUPPLIER_QUALITY" },
  { documentTypeCode: "VAL-05", outcome: "REQUIRED", priority: 20, conditions: riskGte("HIGH"), reason: "High risk requires PPAP applicability determination.", dueOffsetDays: 14, defaultAssigneeRoleKey: "SUPPLIER_QUALITY" },
  { documentTypeCode: "VAL-06", outcome: "CONDITIONAL", priority: 10, conditions: riskGte("MEDIUM"), reason: "Part submission warrant if PPAP applies.", dueOffsetDays: 60, defaultAssigneeRoleKey: "SUPPLIER_QUALITY" },
  { documentTypeCode: "VAL-06", outcome: "REQUIRED", priority: 20, conditions: riskGte("HIGH"), reason: "High risk requires a part submission warrant.", dueOffsetDays: 60, defaultAssigneeRoleKey: "SUPPLIER_QUALITY" },
  { documentTypeCode: "VAL-07", outcome: "CONDITIONAL", priority: 10, conditions: riskGte("MEDIUM"), reason: "Process FMEA recommended.", dueOffsetDays: 45, defaultAssigneeRoleKey: "SUPPLIER_QUALITY" },
  { documentTypeCode: "VAL-07", outcome: "REQUIRED", priority: 20, conditions: { any: [riskGte("HIGH"), critGte("SAFETY_CRITICAL")] }, reason: "High risk / safety-critical requires a process FMEA.", dueOffsetDays: 45, defaultAssigneeRoleKey: "SUPPLIER_QUALITY" },
  { documentTypeCode: "VAL-08", outcome: "CONDITIONAL", priority: 10, conditions: riskGte("MEDIUM"), reason: "Production control plan recommended.", dueOffsetDays: 45, defaultAssigneeRoleKey: "SUPPLIER_QUALITY" },
  { documentTypeCode: "VAL-08", outcome: "REQUIRED", priority: 20, conditions: riskGte("HIGH"), reason: "High risk requires a production control plan.", dueOffsetDays: 45, defaultAssigneeRoleKey: "SUPPLIER_QUALITY" },
  { documentTypeCode: "VAL-09", outcome: "CONDITIONAL", priority: 10, conditions: riskGte("HIGH"), reason: "MSA recommended for critical gauges.", dueOffsetDays: 60, defaultAssigneeRoleKey: "SUPPLIER_QUALITY" },
  { documentTypeCode: "VAL-09", outcome: "REQUIRED", priority: 20, conditions: { any: [riskGte("CRITICAL"), critGte("SAFETY_CRITICAL")] }, reason: "Critical risk / safety-critical requires MSA.", dueOffsetDays: 60, defaultAssigneeRoleKey: "SUPPLIER_QUALITY" },
  { documentTypeCode: "VAL-10", outcome: "CONDITIONAL", priority: 10, conditions: riskGte("HIGH"), reason: "Capability study recommended.", dueOffsetDays: 60, defaultAssigneeRoleKey: "SUPPLIER_QUALITY" },
  { documentTypeCode: "VAL-10", outcome: "REQUIRED", priority: 20, conditions: { any: [riskGte("CRITICAL"), critGte("SAFETY_CRITICAL")] }, reason: "Critical risk / safety-critical requires a capability study.", dueOffsetDays: 60, defaultAssigneeRoleKey: "SUPPLIER_QUALITY" },

  { documentTypeCode: "OPS-01", outcome: "CONDITIONAL", priority: 10, conditions: always, reason: "Define receiving inspection.", dueOffsetDays: 60, defaultAssigneeRoleKey: "SUPPLIER_QUALITY" },
  { documentTypeCode: "OPS-01", outcome: "REQUIRED", priority: 20, conditions: riskGte("MEDIUM"), reason: "Risk MEDIUM+ requires an incoming inspection plan.", dueOffsetDays: 60, defaultAssigneeRoleKey: "SUPPLIER_QUALITY" },
];

/** Maps change-impact flags to the document types required before a change can be approved. */
export const CHANGE_VALIDATION_DOCUMENTS: Record<string, { code: string; reason: string }[]> = {
  requiresFai: [{ code: "VAL-02", reason: "Change requires a new first-article inspection." }],
  requiresPartialRequalification: [{ code: "VAL-01", reason: "Change requires a (partial) requalification plan." }],
  requiresFunctionalTest: [{ code: "VAL-03", reason: "Change requires functional / performance testing." }],
  requiresMaterialCertificates: [{ code: "VAL-04", reason: "Change requires new material / coating certificates." }],
  requiresControlPlanUpdate: [{ code: "VAL-08", reason: "Change requires an updated control plan." }],
  requiresSpecificationRevision: [{ code: "ENG-09", reason: "Change requires a specification / revision change record." }],
};
