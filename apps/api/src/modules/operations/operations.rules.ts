import { createHash } from "node:crypto";
import { BusinessRuleError } from "../../common/errors/app-errors";

export type JsonObject = Record<string, any>;
/** Stable object ordering makes hashes independent of MySQL's JSON key ordering. */
export function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical((value as JsonObject)[k])}`)
    .join(",")}}`;
}
export const digest = (v: unknown) =>
  createHash("sha256").update(canonical(v)).digest("hex");
export const object = (v: unknown): JsonObject =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as JsonObject)
    : {};
export function validateDefinition(value: JsonObject) {
  if (!Object.keys(object(value.sections)).length)
    throw new BusinessRuleError(
      "An inspection plan requires at least one section",
    );
  if (JSON.stringify(value).length > 1_000_000)
    throw new BusinessRuleError(
      "Inspection plan exceeds the definition size limit",
    );
  const keys = new Set<string>();
  if (value.characteristics != null && !Array.isArray(value.characteristics))
    throw new BusinessRuleError("Plan characteristics must be an array");
  for (const c of value.characteristics ?? []) {
    if (!c.key || keys.has(c.key))
      throw new BusinessRuleError(
        "Characteristic keys must be present and unique",
      );
    keys.add(c.key);
    if (
      (c.minimum != null && !Number.isFinite(c.minimum)) ||
      (c.maximum != null && !Number.isFinite(c.maximum))
    )
      throw new BusinessRuleError(
        "Characteristic limits must be finite numbers",
      );
    if (c.minimum != null && c.maximum != null && c.minimum > c.maximum)
      throw new BusinessRuleError("Characteristic minimum exceeds maximum");
  }
}
export function disposition(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}
export function receiptDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new BusinessRuleError("Receipt date must use YYYY-MM-DD");
  const date = new Date(value + "T00:00:00Z");
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new BusinessRuleError("Receipt date is invalid");
  return date;
}
export function inspectionItems(data: JsonObject, count: number): JsonObject[] {
  const items = Array.isArray(data.__items)
    ? data.__items
    : count === 1
      ? [data]
      : [];
  if (
    items.length !== count ||
    items.some((i) => !i || typeof i !== "object" || Array.isArray(i))
  )
    throw new BusinessRuleError(`Expected ${count} inspection items`);
  return items;
}
export function completionDisposition(data: JsonObject, count: number): string {
  const values = inspectionItems(data, count).map((i) =>
    disposition(i.__disposition),
  );
  if (
    values.some(
      (v) =>
        ![
          "PASS",
          "FAIL",
          "ACCEPTED",
          "REJECT",
          "REJECTED",
          "CONDITIONAL",
        ].includes(v),
    )
  )
    throw new BusinessRuleError(
      "Select a disposition for every inspected item",
    );
  if (values.some((v) => ["FAIL", "REJECT", "REJECTED"].includes(v)))
    return "FAIL";
  if (values.some((v) => ["ACCEPTED", "CONDITIONAL"].includes(v)))
    return "ACCEPTED";
  return "PASS";
}
