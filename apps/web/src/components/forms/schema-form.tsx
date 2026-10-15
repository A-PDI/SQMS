"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState, type ReactNode } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { ErrorAlert } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea, type Option } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type FieldType = "text" | "textarea" | "email" | "url" | "number" | "date" | "datetime" | "select" | "checkbox" | "password";

export interface FieldSpec {
  name: string;
  label: string;
  type?: FieldType;
  required?: boolean;
  options?: Option[];
  placeholder?: string;
  hint?: string;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  integer?: boolean;
  /** Spans the full form width. */
  wide?: boolean;
  /** Empty values are sent as null (clears the field on update) instead of being omitted. */
  nullable?: boolean;
  /** Field is shown only when the predicate returns true for the current values. */
  when?: (values: Record<string, unknown>) => boolean;
  pattern?: { regex: RegExp; message: string };
}

/** Builds the Zod schema for a field list (client-side checks mirror the server DTOs; the server remains authoritative). */
export function schemaFor(fields: FieldSpec[]) {
  const shape: Record<string, z.ZodType> = {};
  for (const f of fields) {
    const t = f.type ?? "text";
    if (t === "checkbox") {
      shape[f.name] = z.boolean().optional();
      continue;
    }
    if (t === "number") {
      let n = z.number({ message: `${f.label} must be a number` });
      if (f.integer) n = n.int(`${f.label} must be a whole number`);
      if (f.min !== undefined) n = n.min(f.min, `${f.label} must be at least ${f.min}`);
      if (f.max !== undefined) n = n.max(f.max, `${f.label} must be at most ${f.max}`);
      shape[f.name] = z.preprocess((v) => (v === "" || v === null || v === undefined || Number.isNaN(v) ? undefined : Number(v)), f.required ? n : n.optional());
      continue;
    }
    let s = z.string();
    if (f.required) s = s.trim().min(Math.max(1, f.minLength ?? 1), f.minLength && f.minLength > 1 ? `${f.label} must be at least ${f.minLength} characters` : `${f.label} is required`);
    if (f.maxLength) s = s.max(f.maxLength, `${f.label} must be at most ${f.maxLength} characters`);
    if (t === "email") s = s.refine((v) => !v || z.email().safeParse(v).success, `${f.label} must be a valid email`) as unknown as z.ZodString;
    if (t === "url") s = s.refine((v) => !v || /^https?:\/\/\S+$/.test(v), `${f.label} must start with http:// or https://`) as unknown as z.ZodString;
    if (f.pattern) {
      const p = f.pattern;
      s = s.refine((v) => !v || p.regex.test(v), p.message) as unknown as z.ZodString;
    }
    if (!f.required && f.minLength) {
      const ml = f.minLength;
      s = s.refine((v) => !v || v.trim().length >= ml, `${f.label} must be at least ${ml} characters`) as unknown as z.ZodString;
    }
    shape[f.name] = f.required ? s : s.optional();
  }
  return z.object(shape);
}

/** Converts form values to an API payload: trims, drops or nulls empty optional values. */
export function toPayload(fields: FieldSpec[], values: Record<string, unknown>, opts: { visibleOnly?: boolean } = {}) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (opts.visibleOnly !== false && f.when && !f.when(values)) continue;
    let v = values[f.name];
    if (typeof v === "string") v = v.trim();
    if (v === "" || v === undefined || v === null) {
      if (f.nullable) out[f.name] = null;
      continue;
    }
    if (f.type === "datetime" && typeof v === "string") v = new Date(v).toISOString();
    out[f.name] = v;
  }
  return out;
}

export function SchemaForm({
  fields,
  defaultValues,
  onSubmit,
  submitLabel = "Save",
  onCancel,
  columns = 2,
  footer,
  children,
}: {
  fields: FieldSpec[];
  defaultValues?: Record<string, unknown>;
  onSubmit: (payload: Record<string, unknown>, raw: Record<string, unknown>) => Promise<unknown>;
  submitLabel?: string;
  onCancel?: () => void;
  columns?: 1 | 2;
  footer?: (submitting: boolean) => ReactNode;
  children?: ReactNode;
}) {
  const schema = useMemo(() => schemaFor(fields), [fields]);
  const initial = useMemo(() => {
    const v: Record<string, unknown> = {};
    for (const f of fields) {
      const d = defaultValues?.[f.name];
      if (f.type === "checkbox") v[f.name] = Boolean(d);
      else if (f.type === "date") v[f.name] = typeof d === "string" ? d.slice(0, 10) : "";
      else if (f.type === "datetime") v[f.name] = typeof d === "string" ? d.slice(0, 16) : "";
      else v[f.name] = d === null || d === undefined ? "" : f.type === "number" ? d : String(d);
    }
    return v;
  }, [fields, defaultValues]);
  const form = useForm<Record<string, unknown>>({ resolver: zodResolver(schema as z.ZodType<Record<string, unknown>, Record<string, unknown>>), defaultValues: initial });
  const [error, setError] = useState<unknown>(null);
  const values = form.watch();

  const submit = form.handleSubmit(async (raw) => {
    setError(null);
    try {
      await onSubmit(toPayload(fields, raw), raw);
    } catch (e) {
      setError(e);
    }
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {error ? <ErrorAlert error={error} /> : null}
      <div className={cn("grid gap-3", columns === 2 && "sm:grid-cols-2")}>
        {fields.map((f) => {
          if (f.when && !f.when(values)) return null;
          const err = form.formState.errors[f.name]?.message as string | undefined;
          const id = `f-${f.name}`;
          const t = f.type ?? "text";
          const common = { id, "aria-invalid": !!err, placeholder: f.placeholder };
          return (
            <Field key={f.name} label={f.label} htmlFor={id} error={err} hint={f.hint} required={f.required} className={cn((f.wide || t === "textarea") && "sm:col-span-2")}>
              {t === "textarea" ? (
                <Textarea {...common} rows={3} {...form.register(f.name)} />
              ) : t === "select" ? (
                <Select {...common} options={f.options ?? []} placeholder={f.required ? "Select..." : "-"} {...form.register(f.name)} />
              ) : t === "checkbox" ? (
                <Controller control={form.control} name={f.name} render={({ field }) => <Checkbox id={id} checked={!!field.value} onCheckedChange={(c) => field.onChange(c === true)} />} />
              ) : t === "number" ? (
                <Input {...common} type="number" step={f.integer ? 1 : "any"} min={f.min} max={f.max} {...form.register(f.name, { setValueAs: (v) => (v === "" || v === null ? undefined : Number(v)) })} />
              ) : (
                <Input {...common} type={t === "datetime" ? "datetime-local" : t} {...form.register(f.name)} />
              )}
            </Field>
          );
        })}
      </div>
      {children}
      {footer ? (
        footer(form.formState.isSubmitting)
      ) : (
        <div className="flex justify-end gap-2">
          {onCancel && (
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" loading={form.formState.isSubmitting}>
            {submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}

/** A SchemaForm inside a dialog; closes when the submission succeeds. */
export function FormDialog({ trigger, title, description, wide, ...formProps }: { trigger: ReactNode; title: string; description?: string; wide?: boolean } & Parameters<typeof SchemaForm>[0]) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={title} description={description} wide={wide}>
        {open && (
          <SchemaForm
            {...formProps}
            onSubmit={async (payload, raw) => {
              await formProps.onSubmit(payload, raw);
              setOpen(false);
            }}
            footer={(submitting) => (
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" loading={submitting}>
                  {formProps.submitLabel ?? "Save"}
                </Button>
              </DialogFooter>
            )}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
