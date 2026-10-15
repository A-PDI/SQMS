import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPLICABILITY_RULES,
  DOCUMENT_TYPE_SEEDS,
  evaluateApplicability,
  evaluateCondition,
  validateCondition,
  type ApplicabilityContext,
} from "../src";

const base: ApplicabilityContext = {
  pathway: "B",
  riskLevel: "LOW",
  criticality: "LOW",
  supplierStatus: "APPROVED",
  newSupplier: false,
  engineeringOwnership: "SUPPLIER",
  reverseEngineering: false,
  specialProcesses: false,
  customerRequirements: false,
};

const levels = (ctx: ApplicabilityContext) =>
  Object.fromEntries(evaluateApplicability(DEFAULT_APPLICABILITY_RULES, ctx).map((r) => [r.documentTypeCode, r.level]));

describe("applicability rule engine", () => {
  it("every default rule references a catalog document type and has a valid condition", () => {
    const codes = new Set(DOCUMENT_TYPE_SEEDS.map((d) => d.code));
    for (const rule of DEFAULT_APPLICABILITY_RULES) {
      expect(codes.has(rule.documentTypeCode)).toBe(true);
      expect(validateCondition(rule.conditions)).toEqual([]);
    }
  });

  it("low-risk pathway B with an approved supplier requires only core documents", () => {
    const l = levels(base);
    expect(l["INT-01"]).toBe("REQUIRED");
    expect(l["INT-02"]).toBe("REQUIRED");
    expect(l["ENG-04"]).toBe("REQUIRED");
    expect(l["ENG-05"]).toBe("REQUIRED");
    expect(l["SUP-01"]).toBe("CONDITIONAL");
    expect(l["VAL-01"]).toBe("CONDITIONAL");
    expect(l["VAL-06"]).toBeUndefined();
    expect(l["VAL-07"]).toBeUndefined();
    expect(l["ENG-06"]).toBeUndefined();
    expect(l["ENG-01"]).toBeUndefined();
  });

  it("pathway C requires delta specification, altered item drawing and functional validation", () => {
    const l = levels({ ...base, pathway: "C", riskLevel: "MEDIUM" });
    expect(l["ENG-06"]).toBe("REQUIRED");
    expect(l["ENG-07"]).toBe("REQUIRED");
    expect(l["VAL-03"]).toBe("REQUIRED");
    expect(l["VAL-02"]).toBe("REQUIRED");
    expect(l["SUP-04"]).toBe("REQUIRED");
    expect(l["VAL-01"]).toBe("REQUIRED");
  });

  it("pathway A with reverse engineering requires REI and DRR but not the TDP checklist", () => {
    const l = levels({ ...base, pathway: "A", engineeringOwnership: "COMPANY", reverseEngineering: true });
    expect(l["ENG-03"]).toBe("REQUIRED");
    expect(l["ENG-02"]).toBe("REQUIRED");
    expect(l["ENG-04"]).toBe("REQUIRED");
    expect(l["ENG-01"]).toBeUndefined();
  });

  it("high risk with a new supplier escalates PPAP-level documentation", () => {
    const l = levels({ ...base, riskLevel: "HIGH", supplierStatus: "PROSPECTIVE", newSupplier: true, specialProcesses: true });
    for (const code of ["SUP-01", "SUP-02", "SUP-03", "SUP-05", "VAL-04", "VAL-05", "VAL-06", "VAL-07", "VAL-08", "ENG-08"]) {
      expect(l[code], code).toBe("REQUIRED");
    }
    expect(l["VAL-09"]).toBe("CONDITIONAL");
  });

  it("safety-critical parts require MSA and capability studies", () => {
    const l = levels({ ...base, criticality: "SAFETY_CRITICAL", riskLevel: "HIGH" });
    expect(l["VAL-09"]).toBe("REQUIRED");
    expect(l["VAL-10"]).toBe("REQUIRED");
  });

  it("higher priority wins; ties resolve to the strictest outcome", () => {
    const rules = [
      { documentTypeCode: "X", outcome: "REQUIRED" as const, priority: 5, conditions: {}, reason: "a" },
      { documentTypeCode: "X", outcome: "NOT_APPLICABLE" as const, priority: 9, conditions: {}, reason: "b" },
      { documentTypeCode: "Y", outcome: "CONDITIONAL" as const, priority: 1, conditions: {}, reason: "c" },
      { documentTypeCode: "Y", outcome: "REQUIRED" as const, priority: 1, conditions: {}, reason: "d" },
    ];
    const r = evaluateApplicability(rules, base);
    expect(r.find((x) => x.documentTypeCode === "X")!.level).toBe("NOT_APPLICABLE");
    expect(r.find((x) => x.documentTypeCode === "Y")!.level).toBe("REQUIRED");
  });

  it("supports nested all/any/not and ordered comparisons", () => {
    expect(evaluateCondition({ all: [{ field: "riskLevel", op: "gte", value: "MEDIUM" }, { not: { field: "pathway", op: "eq", value: "A" } }] }, { ...base, riskLevel: "HIGH" })).toBe(true);
    expect(evaluateCondition({ any: [{ field: "criticality", op: "lte", value: "LOW" }] }, { ...base, criticality: "HIGH" })).toBe(false);
  });

  it("rejects malformed conditions", () => {
    expect(validateCondition({ field: "nope", op: "eq", value: 1 })).not.toEqual([]);
    expect(validateCondition({ field: "pathway", op: "gte", value: "A" })).not.toEqual([]);
    expect(validateCondition({ field: "riskLevel", op: "in", value: "HIGH" })).not.toEqual([]);
    expect(validateCondition({ all: [] })).not.toEqual([]);
  });
});
