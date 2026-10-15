/** Human-readable identifier formatting. Sequences are stored and incremented atomically in the database. */

export interface NumberingSequenceSeed {
  key: string;
  prefix: string;
  pattern: string;
  padding: number;
  resetPolicy: "NEVER" | "YEARLY";
  startAt?: number;
}

export const NUMBERING_SEQUENCE_SEEDS: NumberingSequenceSeed[] = [
  { key: "SUPPLIER", prefix: "V", pattern: "{prefix}{seq}", padding: 5, resetPolicy: "NEVER", startAt: 10001 },
  { key: "SOURCING_PROJECT", prefix: "SP", pattern: "{prefix}-{yyyy}-{seq}", padding: 4, resetPolicy: "YEARLY" },
  { key: "DOCUMENT", prefix: "DOC", pattern: "{prefix}-{yyyy}-{seq}", padding: 5, resetPolicy: "YEARLY" },
  { key: "DOCUMENT_RELEASE", prefix: "REL", pattern: "{prefix}-{yyyy}-{seq}", padding: 5, resetPolicy: "YEARLY" },
  { key: "CONFIGURATION", prefix: "CFG", pattern: "{prefix}-{seq}", padding: 5, resetPolicy: "NEVER" },
  { key: "SUPPLIER_QUALIFICATION", prefix: "SQ", pattern: "{prefix}-{yyyy}-{seq}", padding: 4, resetPolicy: "YEARLY" },
  { key: "PRODUCT_QUALIFICATION", prefix: "PQ", pattern: "{prefix}-{yyyy}-{seq}", padding: 4, resetPolicy: "YEARLY" },
  { key: "FIRST_ARTICLE", prefix: "FAI", pattern: "{prefix}-{yyyy}-{seq}", padding: 4, resetPolicy: "YEARLY" },
  { key: "APPROVAL_PACKAGE", prefix: "APK", pattern: "{prefix}-{yyyy}-{seq}", padding: 4, resetPolicy: "YEARLY" },
  { key: "PRODUCT_APPROVAL", prefix: "PA", pattern: "{prefix}-{yyyy}-{seq}", padding: 4, resetPolicy: "YEARLY" },
  { key: "CHANGE_REQUEST", prefix: "SCR", pattern: "{prefix}-{yyyy}-{seq}", padding: 4, resetPolicy: "YEARLY" },
  { key: "DEVIATION", prefix: "DCR", pattern: "{prefix}-{yyyy}-{seq}", padding: 4, resetPolicy: "YEARLY" },
  { key: "NCR", prefix: "NCR", pattern: "{prefix}-{yyyy}-{seq}", padding: 4, resetPolicy: "YEARLY" },
  { key: "SCAR", prefix: "SCAR", pattern: "{prefix}-{yyyy}-{seq}", padding: 4, resetPolicy: "YEARLY" },
];

export const NUMBERING_TOKENS = ["{prefix}", "{yyyy}", "{yy}", "{seq}"] as const;

export function validateNumberingPattern(pattern: string): string | null {
  if (!pattern.includes("{seq}")) return "Pattern must contain {seq}";
  const unknown = pattern.match(/\{[^}]*\}/g)?.filter((t) => !(NUMBERING_TOKENS as readonly string[]).includes(t)) ?? [];
  if (unknown.length) return `Unknown tokens: ${unknown.join(", ")}`;
  if (pattern.length > 60) return "Pattern is too long";
  return null;
}

export function formatSequenceNumber(pattern: string, prefix: string, seq: number, padding: number, date: Date): string {
  const yyyy = String(date.getUTCFullYear());
  return pattern
    .replaceAll("{prefix}", prefix)
    .replaceAll("{yyyy}", yyyy)
    .replaceAll("{yy}", yyyy.slice(2))
    .replaceAll("{seq}", String(seq).padStart(padding, "0"));
}

/** Period key for yearly resets. */
export function sequencePeriod(resetPolicy: "NEVER" | "YEARLY", date: Date): string | null {
  return resetPolicy === "YEARLY" ? String(date.getUTCFullYear()) : null;
}

/** Converts a revision number (1-based) to a letter label: 1 -> A, 26 -> Z, 27 -> AA. */
export function revisionLabel(n: number): string {
  if (!Number.isInteger(n) || n < 1) throw new Error("Revision number must be a positive integer");
  let s = "";
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}
