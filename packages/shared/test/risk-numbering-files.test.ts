import { describe, expect, it } from "vitest";
import { computeRisk, formatSequenceNumber, revisionLabel, RiskModelError, sanitizeFilename, signatureMatches, validateNumberingPattern } from "../src";

const sel = { specialProcesses: "false", manufacturingComplexity: "LOW", technologyNovelty: "ESTABLISHED", supplyChain: "LOW", singleSource: "false", regulatoryImpact: "false", fieldHistory: "NONE" };

describe("risk model", () => {
  it("scores low risk for an approved supplier standard product", () => {
    const r = computeRisk({ criticality: "LOW", supplierStatus: "APPROVED", pathway: "B", reverseEngineering: false }, sel);
    expect(r.score).toBe(0);
    expect(r.level).toBe("LOW");
  });

  it("accumulates points to HIGH / CRITICAL", () => {
    const r = computeRisk({ criticality: "HIGH", supplierStatus: "PROSPECTIVE", pathway: "C", reverseEngineering: false }, { ...sel, specialProcesses: "true", manufacturingComplexity: "MEDIUM" });
    expect(r.score).toBe(4 + 3 + 2 + 2 + 1);
    expect(r.level).toBe("HIGH");
    const c = computeRisk({ criticality: "SAFETY_CRITICAL", supplierStatus: "SUSPENDED", pathway: "A", reverseEngineering: true }, sel);
    expect(c.level).toBe("CRITICAL");
  });

  it("applies the safety-critical floor", () => {
    const r = computeRisk({ criticality: "SAFETY_CRITICAL", supplierStatus: "APPROVED", pathway: "B", reverseEngineering: false }, sel);
    expect(r.score).toBe(6);
    expect(r.level).toBe("HIGH");
    expect(r.overrides.length).toBe(1);
  });

  it("rejects missing or invalid selections", () => {
    expect(() => computeRisk({ criticality: "LOW", supplierStatus: "APPROVED", pathway: "B", reverseEngineering: false }, { ...sel, fieldHistory: "BOGUS" })).toThrow(RiskModelError);
  });
});

describe("numbering", () => {
  it("formats patterns", () => {
    const d = new Date(Date.UTC(2026, 9, 15));
    expect(formatSequenceNumber("{prefix}-{yyyy}-{seq}", "NCR", 7, 4, d)).toBe("NCR-2026-0007");
    expect(formatSequenceNumber("{prefix}{seq}", "V", 10001, 5, d)).toBe("V10001");
    expect(validateNumberingPattern("{prefix}-{x}")).not.toBeNull();
    expect(validateNumberingPattern("{prefix}-{yy}-{seq}")).toBeNull();
  });

  it("produces revision letters", () => {
    expect([1, 2, 26, 27, 28].map(revisionLabel)).toEqual(["A", "B", "Z", "AA", "AB"]);
  });
});

describe("file safety", () => {
  it("sanitizes filenames", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Users\\x\\Drawing Rev<B>.pdf")).toBe("Drawing Rev_B_.pdf");
    expect(sanitizeFilename("con.pdf")).toBe("file_con.pdf");
    expect(sanitizeFilename("a".repeat(300) + ".step").length).toBeLessThanOrEqual(180);
  });

  it("checks content signatures", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(signatureMatches("pdf", enc("%PDF-1.7\n"))).toBe(true);
    expect(signatureMatches("pdf", new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toBe(false);
    expect(signatureMatches("step", enc("ISO-10303-21;\nHEADER;"))).toBe(true);
    expect(signatureMatches("csv", new Uint8Array([0x61, 0x00, 0x62]))).toBe(false);
  });
});
