import type {
  AuthoringFormSchema,
  FieldRef,
  FormData,
  FormField,
  FormSchema,
  FormValidationIssue,
  FormValidationResult,
  ScalarField,
  VisibleWhen,
} from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELD_TYPES = new Set(["text", "textarea", "email", "url", "number", "date", "select", "radio", "multiselect", "checkbox", "attachment", "table"]);

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

export function isVisible(cond: VisibleWhen | undefined, scope: FormData): boolean {
  if (!cond) return true;
  const v = scope[cond.field];
  if (cond.notEmpty) return !isEmpty(v);
  if (cond.in) return cond.in.includes(v as string | number | boolean);
  if (cond.equals !== undefined) return v === cond.equals;
  return true;
}

function isValidDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function validateScalar(field: ScalarField, raw: unknown, path: string, issues: FormValidationIssue[], enforceRequired: boolean): unknown {
  if (isEmpty(raw) || (field.type === "checkbox" && raw === false && field.required)) {
    if (enforceRequired && field.required) {
      issues.push({ path, message: `${field.label} is required` });
    }
    if (field.type === "checkbox") return raw === true;
    return field.type === "multiselect" ? [] : null;
  }
  switch (field.type) {
    case "text":
    case "textarea":
    case "email":
    case "url": {
      if (typeof raw !== "string") {
        issues.push({ path, message: `${field.label} must be text` });
        return null;
      }
      const value = raw.trim();
      if (field.minLength && value.length < field.minLength) issues.push({ path, message: `${field.label} must be at least ${field.minLength} characters` });
      const max = field.maxLength ?? (field.type === "textarea" ? 20000 : 500);
      if (value.length > max) issues.push({ path, message: `${field.label} must be at most ${max} characters` });
      if (field.type === "email" && !EMAIL.test(value)) issues.push({ path, message: `${field.label} must be a valid email address` });
      if (field.type === "url") {
        try {
          const u = new URL(value);
          if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("protocol");
        } catch {
          issues.push({ path, message: `${field.label} must be a valid http(s) URL` });
        }
      }
      return value;
    }
    case "number": {
      const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN;
      if (!Number.isFinite(n)) {
        issues.push({ path, message: `${field.label} must be a number` });
        return null;
      }
      if (field.integer && !Number.isInteger(n)) issues.push({ path, message: `${field.label} must be a whole number` });
      if (field.min !== undefined && n < field.min) issues.push({ path, message: `${field.label} must be at least ${field.min}` });
      if (field.max !== undefined && n > field.max) issues.push({ path, message: `${field.label} must be at most ${field.max}` });
      return n;
    }
    case "date": {
      if (typeof raw !== "string" || !isValidDate(raw)) {
        issues.push({ path, message: `${field.label} must be a date (YYYY-MM-DD)` });
        return null;
      }
      return raw;
    }
    case "select":
    case "radio": {
      const value = String(raw);
      if (!field.options.some((o) => o.value === value)) {
        issues.push({ path, message: `${field.label} has an invalid selection` });
        return null;
      }
      return value;
    }
    case "multiselect": {
      if (!Array.isArray(raw)) {
        issues.push({ path, message: `${field.label} must be a list` });
        return [];
      }
      const values = raw.map(String);
      const invalid = values.filter((v) => !field.options.some((o) => o.value === v));
      if (invalid.length) issues.push({ path, message: `${field.label} has invalid selections: ${invalid.join(", ")}` });
      if (enforceRequired && field.minItems && values.length < field.minItems) issues.push({ path, message: `${field.label} requires at least ${field.minItems} selections` });
      return [...new Set(values)];
    }
    case "checkbox": {
      if (typeof raw !== "boolean") {
        issues.push({ path, message: `${field.label} must be true or false` });
        return false;
      }
      return raw;
    }
  }
}

function validateField(field: FormField, raw: unknown, path: string, scope: FormData, issues: FormValidationIssue[], attachmentIds: string[], enforceRequired: boolean): unknown {
  if (field.type === "attachment") {
    const list = isEmpty(raw) ? [] : Array.isArray(raw) ? raw : [raw];
    const ids: string[] = [];
    for (const [i, id] of list.entries()) {
      if (typeof id !== "string" || !UUID.test(id)) {
        issues.push({ path: `${path}[${i}]`, message: `${field.label} contains an invalid file reference` });
        continue;
      }
      ids.push(id);
    }
    if (!field.multiple && ids.length > 1) issues.push({ path, message: `${field.label} accepts a single file` });
    if (enforceRequired && field.required && ids.length === 0) issues.push({ path, message: `${field.label} is required` });
    attachmentIds.push(...ids);
    return ids;
  }
  if (field.type === "table") {
    const rows = isEmpty(raw) ? [] : raw;
    if (!Array.isArray(rows)) {
      issues.push({ path, message: `${field.label} must be a list of rows` });
      return [];
    }
    if (enforceRequired && field.required && rows.length === 0) issues.push({ path, message: `${field.label} requires at least one row` });
    if (enforceRequired && field.minRows && rows.length < field.minRows) issues.push({ path, message: `${field.label} requires at least ${field.minRows} rows` });
    const maxRows = field.maxRows ?? 500;
    if (rows.length > maxRows) issues.push({ path, message: `${field.label} allows at most ${maxRows} rows` });
    return rows.slice(0, maxRows).map((row, i) => {
      if (typeof row !== "object" || row === null || Array.isArray(row)) {
        issues.push({ path: `${path}[${i}]`, message: `Row ${i + 1} is invalid` });
        return {};
      }
      const rowData = row as FormData;
      const out: FormData = {};
      for (const col of field.columns) {
        if (!isVisible(col.visibleWhen, rowData)) continue;
        out[col.key] = validateScalar(col, rowData[col.key], `${path}[${i}].${col.key}`, issues, enforceRequired);
      }
      return out;
    });
  }
  void scope;
  return validateScalar(field, raw, path, issues, enforceRequired);
}

/**
 * Validates and normalizes form data against a schema.
 * mode "draft" checks types/format only; mode "submit" also enforces required fields.
 * Unknown keys and fields hidden by visibility conditions are dropped.
 */
export function validateFormData(schema: FormSchema, input: unknown, mode: "draft" | "submit"): FormValidationResult {
  const issues: FormValidationIssue[] = [];
  const attachmentIds: string[] = [];
  const data: FormData = {};
  const source: FormData = typeof input === "object" && input !== null && !Array.isArray(input) ? (input as FormData) : {};
  if (input !== undefined && input !== null && source !== input) issues.push({ path: "", message: "Form data must be an object" });
  const enforce = mode === "submit";
  for (const section of schema.sections) {
    if (!isVisible(section.visibleWhen, source)) continue;
    for (const field of section.fields) {
      if (!isVisible(field.visibleWhen, source)) continue;
      data[field.key] = validateField(field, source[field.key], field.key, source, issues, attachmentIds, enforce);
    }
  }
  return { valid: issues.length === 0, issues, data, attachmentIds: [...new Set(attachmentIds)] };
}

/** Structural validation of a schema definition (used when administrators publish a new form version). */
export function validateFormSchema(schema: unknown): string[] {
  const problems: string[] = [];
  if (typeof schema !== "object" || schema === null) return ["Schema must be an object"];
  const s = schema as FormSchema;
  if (!s.key || typeof s.key !== "string") problems.push("Schema key is required");
  if (!s.title || typeof s.title !== "string") problems.push("Schema title is required");
  if (!Array.isArray(s.sections) || s.sections.length === 0) return [...problems, "At least one section is required"];
  const keys = new Set<string>();
  const checkField = (f: FormField, where: string, allowComplex: boolean) => {
    if (!f || typeof f !== "object") return problems.push(`${where}: field must be an object`);
    if (!f.key || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(f.key)) problems.push(`${where}: invalid field key "${String(f.key)}"`);
    if (!f.label) problems.push(`${where}.${f.key}: label is required`);
    if (!FIELD_TYPES.has(f.type)) problems.push(`${where}.${f.key}: unsupported type "${String(f.type)}"`);
    if (!allowComplex && (f.type === "table" || f.type === "attachment")) problems.push(`${where}.${f.key}: ${f.type} is not allowed inside a table`);
    if ((f.type === "select" || f.type === "radio" || f.type === "multiselect") && (!Array.isArray(f.options) || f.options.length === 0)) {
      problems.push(`${where}.${f.key}: options are required`);
    }
    if (f.type === "table") {
      if (!Array.isArray(f.columns) || f.columns.length === 0) problems.push(`${where}.${f.key}: columns are required`);
      else f.columns.forEach((c) => checkField(c, `${where}.${f.key}`, false));
    }
    return undefined;
  };
  for (const section of s.sections) {
    if (!section.key || !section.title) problems.push("Each section needs a key and title");
    if (!Array.isArray(section.fields)) {
      problems.push(`Section ${section.key}: fields must be an array`);
      continue;
    }
    for (const f of section.fields) {
      checkField(f, `Section ${section.key}`, true);
      if (keys.has(f.key)) problems.push(`Duplicate field key "${f.key}"`);
      keys.add(f.key);
    }
  }
  return problems;
}

/** Resolves library references in an authoring schema into a self-contained schema suitable for storage. */
export function resolveFormSchema(authoring: AuthoringFormSchema, library: Record<string, FormField>): FormSchema {
  return {
    ...authoring,
    sections: authoring.sections.map((section) => ({
      ...section,
      fields: section.fields.map((f) => {
        if (!("ref" in f)) return f;
        const ref = f as FieldRef;
        const base = library[ref.ref];
        if (!base) throw new Error(`Unknown field library reference "${ref.ref}"`);
        return { ...base, ...(ref.overrides ?? {}) } as FormField;
      }),
    })),
  };
}

/** Deterministic JSON serialization (sorted keys) used for content hashing. */
export function canonicalJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}
