import { describe, expect, it } from "vitest";
import { canonicalJson, FORM_DEFINITION_SEEDS, validateFormData } from "../src";

const sqq = FORM_DEFINITION_SEEDS.find((f) => f.key === "SQQ")!.schema;

const validSqq = {
  legalName: "Acme Turbo GmbH",
  hasCertifiedQms: "YES",
  certifications: [{ standard: "IATF 16949", certificateNumber: "C-1", expiresAt: "2027-05-01" }],
  inspectionCapabilities: "CMM, balancing, flow bench",
  calibrationProgram: "YES",
  processes: ["CNC_MACHINING", "BALANCING"],
  productTypes: "Turbochargers",
  usesSubTier: "NO",
  changeNotificationCommitment: true,
  preparedBy: "J. Doe",
  preparedDate: "2026-10-01",
};

describe("native form validation", () => {
  it("accepts a complete submission", () => {
    const r = validateFormData(sqq, validSqq, "submit");
    expect(r.issues).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it("enforces required fields only on submit", () => {
    expect(validateFormData(sqq, { legalName: "X" }, "draft").valid).toBe(true);
    const r = validateFormData(sqq, { legalName: "X" }, "submit");
    expect(r.valid).toBe(false);
    expect(r.issues.map((i) => i.path)).toContain("hasCertifiedQms");
  });

  it("applies conditional visibility (hidden fields are dropped and not required)", () => {
    const r = validateFormData(sqq, { ...validSqq, hasCertifiedQms: "NO", qmsDescription: "Internal QMS", certifications: [{ standard: "BAD" }] }, "submit");
    expect(r.valid).toBe(true);
    expect(r.data.certifications).toBeUndefined();
    const r2 = validateFormData(sqq, { ...validSqq, usesSubTier: "YES" }, "submit");
    expect(r2.issues.map((i) => i.path)).toContain("subTierSuppliers");
  });

  it("validates table rows, options and dates", () => {
    const r = validateFormData(sqq, { ...validSqq, certifications: [{ standard: "NOT_A_STANDARD", expiresAt: "2026-02-30" }] }, "submit");
    expect(r.valid).toBe(false);
    expect(r.issues.map((i) => i.path)).toEqual(expect.arrayContaining(["certifications[0].standard", "certifications[0].expiresAt"]));
  });

  it("collects attachment ids and rejects invalid references", () => {
    const id = "01a13d33-851e-73fd-9b41-8a02fcd420b1";
    const ok = validateFormData(sqq, { ...validSqq, supportingFiles: [id] }, "submit");
    expect(ok.attachmentIds).toEqual([id]);
    const bad = validateFormData(sqq, { ...validSqq, supportingFiles: ["../../etc/passwd"] }, "submit");
    expect(bad.valid).toBe(false);
  });

  it("drops unknown keys", () => {
    const r = validateFormData(sqq, { ...validSqq, injected: "<script>" }, "submit");
    expect("injected" in r.data).toBe(false);
  });

  it("canonical JSON is key-order independent", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
  });
});
