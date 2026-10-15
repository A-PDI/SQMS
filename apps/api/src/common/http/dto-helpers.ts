import { applyDecorators } from "@nestjs/common";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsInt, IsOptional, Matches, Min } from "class-validator";
import { BusinessRuleError } from "../errors/app-errors";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar date in YYYY-MM-DD (stored as a DATE column, interpreted in UTC). */
export function IsDateOnly(optional = false) {
  const decorators = [Matches(ISO_DATE, { message: "must be a date in YYYY-MM-DD format" })];
  return optional
    ? applyDecorators(ApiPropertyOptional({ example: "2026-12-31" }), IsOptional(), ...decorators)
    : applyDecorators(ApiProperty({ example: "2026-12-31" }), ...decorators);
}

export function toDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw new BusinessRuleError(`Invalid date ${value}`);
  return d;
}

/** Optimistic concurrency token required for updates of controlled records. */
export function ExpectedVersion() {
  return applyDecorators(ApiProperty({ description: "Version of the record as last read (optimistic concurrency)" }), IsInt(), Min(0));
}

/** Converts empty strings to null so optional text fields can be cleared. */
export const EmptyToNull = () => Transform(({ value }) => (typeof value === "string" && value.trim() === "" ? null : value));

/** Accepts repeated query keys (?status=A&status=B) or comma-separated values (?status=A,B). */
export const ToArray = () =>
  Transform(({ value }) => {
    if (value === undefined || value === null || value === "") return undefined;
    const list = Array.isArray(value) ? value : String(value).split(",");
    return list.map((v) => String(v).trim()).filter(Boolean);
  });

/** Parses "true"/"false" query values. */
export const ToBoolean = () => Transform(({ value }) => (value === undefined || value === "" ? undefined : value === true || value === "true" || value === "1"));
