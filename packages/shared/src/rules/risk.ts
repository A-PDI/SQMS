/**
 * Sourcing Path & Risk Assessment (SPRA) scoring model.
 *
 * Company-defined, transparent additive model. The server recomputes score and level from the submitted
 * factor selections; clients never supply the score. The model version is stored with each assessment.
 * Thresholds and weights are company policy and can be revised by publishing a new model version.
 */
import type { CriticalityCode, RiskLevelCode, SupplierStatusCode } from "./applicability";

export const RISK_MODEL_VERSION = "SPRA-1";

export interface RiskFactorOption {
  value: string;
  label: string;
  points: number;
}

export interface RiskFactorDefinition {
  key: string;
  label: string;
  help: string;
  /** Derived factors are computed from project data and cannot be overridden by the assessor. */
  derived: boolean;
  options: RiskFactorOption[];
}

export const RISK_FACTORS: RiskFactorDefinition[] = [
  {
    key: "criticality",
    label: "Product criticality",
    help: "From the product master.",
    derived: true,
    options: [
      { value: "LOW", label: "Low", points: 0 },
      { value: "MEDIUM", label: "Medium", points: 2 },
      { value: "HIGH", label: "High", points: 4 },
      { value: "SAFETY_CRITICAL", label: "Safety critical", points: 6 },
    ],
  },
  {
    key: "supplierStatus",
    label: "Supplier qualification status",
    help: "From the supplier record.",
    derived: true,
    options: [
      { value: "APPROVED", label: "Approved", points: 0 },
      { value: "CONDITIONALLY_APPROVED", label: "Conditionally approved", points: 1 },
      { value: "UNDER_EVALUATION", label: "Under evaluation", points: 3 },
      { value: "PROSPECTIVE", label: "Prospective", points: 3 },
      { value: "INACTIVE", label: "Inactive", points: 4 },
      { value: "SUSPENDED", label: "Suspended", points: 5 },
    ],
  },
  {
    key: "pathway",
    label: "Sourcing pathway",
    help: "A = company design, B = existing supplier product, C = modified supplier product.",
    derived: true,
    options: [
      { value: "B", label: "B - existing supplier product", points: 0 },
      { value: "C", label: "C - modified supplier product", points: 2 },
      { value: "A", label: "A - company-controlled design", points: 2 },
    ],
  },
  {
    key: "reverseEngineering",
    label: "Reverse engineering",
    help: "Project starts from a physical sample without a controlled drawing.",
    derived: true,
    options: [
      { value: "false", label: "No", points: 0 },
      { value: "true", label: "Yes", points: 3 },
    ],
  },
  {
    key: "specialProcesses",
    label: "Special processes",
    help: "Heat treatment, coating, plating, welding, NDT or similar.",
    derived: false,
    options: [
      { value: "false", label: "None", points: 0 },
      { value: "true", label: "Involved", points: 2 },
    ],
  },
  {
    key: "manufacturingComplexity",
    label: "Manufacturing complexity",
    help: "Tight tolerances, multi-operation machining, assemblies.",
    derived: false,
    options: [
      { value: "LOW", label: "Low", points: 0 },
      { value: "MEDIUM", label: "Medium", points: 1 },
      { value: "HIGH", label: "High", points: 3 },
    ],
  },
  {
    key: "technologyNovelty",
    label: "Technology novelty",
    help: "Is the product or process new to the supplier or to the company?",
    derived: false,
    options: [
      { value: "ESTABLISHED", label: "Established", points: 0 },
      { value: "NEW_TO_SUPPLIER", label: "New to supplier", points: 2 },
      { value: "NEW_TO_COMPANY", label: "New to company / industry", points: 3 },
    ],
  },
  {
    key: "supplyChain",
    label: "Supply chain exposure",
    help: "Logistics distance, lead time and regional risk.",
    derived: false,
    options: [
      { value: "LOW", label: "Low", points: 0 },
      { value: "MEDIUM", label: "Moderate", points: 1 },
      { value: "HIGH", label: "High", points: 2 },
    ],
  },
  {
    key: "singleSource",
    label: "Single source",
    help: "No alternate approved source exists.",
    derived: false,
    options: [
      { value: "false", label: "No", points: 0 },
      { value: "true", label: "Yes", points: 2 },
    ],
  },
  {
    key: "regulatoryImpact",
    label: "Emissions / regulatory impact",
    help: "Part affects emissions, safety compliance or warranty-critical function.",
    derived: false,
    options: [
      { value: "false", label: "No", points: 0 },
      { value: "true", label: "Yes", points: 2 },
    ],
  },
  {
    key: "fieldHistory",
    label: "Field / quality history",
    help: "Known failures for this part family or supplier.",
    derived: false,
    options: [
      { value: "NONE", label: "None known", points: 0 },
      { value: "SOME", label: "Some issues", points: 2 },
      { value: "SIGNIFICANT", label: "Significant issues", points: 3 },
    ],
  },
];

export const RISK_THRESHOLDS: { level: RiskLevelCode; minScore: number }[] = [
  { level: "CRITICAL", minScore: 16 },
  { level: "HIGH", minScore: 11 },
  { level: "MEDIUM", minScore: 6 },
  { level: "LOW", minScore: 0 },
];

export interface RiskDerivedInputs {
  criticality: CriticalityCode;
  supplierStatus: SupplierStatusCode;
  pathway: "A" | "B" | "C";
  reverseEngineering: boolean;
}

export type RiskSelections = Record<string, string>;

export interface RiskResult {
  modelVersion: string;
  score: number;
  level: RiskLevelCode;
  factors: { key: string; label: string; value: string; valueLabel: string; points: number }[];
  overrides: string[];
}

export class RiskModelError extends Error {}

/** Computes the SPRA score. Throws RiskModelError when a required selection is missing or invalid. */
export function computeRisk(derived: RiskDerivedInputs, selections: RiskSelections): RiskResult {
  const values: Record<string, string> = {
    ...selections,
    criticality: derived.criticality,
    supplierStatus: derived.supplierStatus,
    pathway: derived.pathway,
    reverseEngineering: String(derived.reverseEngineering),
  };
  const factors = RISK_FACTORS.map((def) => {
    const value = values[def.key];
    const option = def.options.find((o) => o.value === value);
    if (!option) {
      throw new RiskModelError(`Risk factor "${def.label}" requires one of: ${def.options.map((o) => o.value).join(", ")}`);
    }
    return { key: def.key, label: def.label, value: option.value, valueLabel: option.label, points: option.points };
  });
  const score = factors.reduce((sum, f) => sum + f.points, 0);
  let level = RISK_THRESHOLDS.find((t) => score >= t.minScore)!.level;
  const overrides: string[] = [];
  // Policy floor: safety-critical products are never assessed below HIGH risk.
  if (derived.criticality === "SAFETY_CRITICAL" && (level === "LOW" || level === "MEDIUM")) {
    level = "HIGH";
    overrides.push("Safety-critical product: minimum risk level HIGH.");
  }
  return { modelVersion: RISK_MODEL_VERSION, score, level, factors, overrides };
}
