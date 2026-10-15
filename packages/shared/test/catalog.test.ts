import { describe, expect, it } from "vitest";
import { DOCUMENT_TYPE_SEEDS, FORM_DEFINITION_SEEDS, RETENTION_POLICY_SEEDS, validateFormSchema, WORKFLOW_DEFINITION_SEEDS } from "../src";

const EXPECTED_CODES = [
  "INT-01", "INT-02", "SUP-01", "SUP-02", "SUP-03", "SUP-04", "SUP-05",
  "ENG-01", "ENG-02", "ENG-03", "ENG-04", "ENG-05", "ENG-06", "ENG-07", "ENG-08", "ENG-09",
  "VAL-01", "VAL-02", "VAL-03", "VAL-04", "VAL-05", "VAL-06", "VAL-07", "VAL-08", "VAL-09", "VAL-10", "VAL-11",
  "OPS-01", "OPS-02", "OPS-03", "OPS-04", "OPS-05", "OPS-06", "OPS-07", "OPS-08", "OPS-09",
  "SYS-01",
];

describe("document type catalog", () => {
  it("contains exactly the 37 catalog identifiers", () => {
    expect(DOCUMENT_TYPE_SEEDS).toHaveLength(37);
    expect(DOCUMENT_TYPE_SEEDS.map((d) => d.code)).toEqual(EXPECTED_CODES);
  });

  it("references known workflows, retention policies and forms", () => {
    const workflows = new Set(WORKFLOW_DEFINITION_SEEDS.map((w) => w.key));
    const retention = new Set(RETENTION_POLICY_SEEDS.map((r) => r.code));
    const forms = new Set(FORM_DEFINITION_SEEDS.map((f) => f.key));
    for (const d of DOCUMENT_TYPE_SEEDS) {
      expect(workflows.has(d.workflowKey), `${d.code} workflow`).toBe(true);
      expect(retention.has(d.retentionPolicyCode), `${d.code} retention`).toBe(true);
      if (d.nativeFormKey) expect(forms.has(d.nativeFormKey), `${d.code} form`).toBe(true);
      expect(d.allowUpload).toBe(true);
    }
  });

  it("marks externally standardized artifacts with a reference", () => {
    for (const d of DOCUMENT_TYPE_SEEDS.filter((x) => x.origin !== "COMPANY_DEFINED")) {
      expect(d.externalStandardRef, d.code).toBeTruthy();
    }
    expect(DOCUMENT_TYPE_SEEDS.find((d) => d.code === "VAL-06")!.origin).toBe("EXTERNAL_STANDARD");
    expect(DOCUMENT_TYPE_SEEDS.find((d) => d.code === "INT-01")!.origin).toBe("COMPANY_DEFINED");
  });

  it("seeded form schemas are structurally valid", () => {
    for (const f of FORM_DEFINITION_SEEDS) {
      expect(validateFormSchema(f.schema), f.key).toEqual([]);
    }
  });
});
