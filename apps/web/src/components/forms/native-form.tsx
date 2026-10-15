"use client";

import { useQuery } from "@tanstack/react-query";
import { isVisible, type FormData, type FormField, type FormSchema, type FormValidationIssue, type ScalarField } from "@sqms/shared";
import { Download, Plus, Trash2, X } from "lucide-react";
import { FileUpload } from "@/components/common/file-upload";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { api, fileDownloadUrl, type UploadedFile } from "@/lib/api";
import { formatBytes, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Renders a native document form from its stored schema version. Editing produces plain JSON matching the schema;
 * the server validates and normalizes it (draft: types only, submit: required fields too).
 */
export function NativeForm({ schema, value, onChange, readOnly, issues = [] }: { schema: FormSchema; value: FormData; onChange?: (v: FormData) => void; readOnly?: boolean; issues?: FormValidationIssue[] }) {
  const errorFor = (path: string) => issues.find((i) => i.path === path)?.message;
  const set = (key: string, v: unknown) => onChange?.({ ...value, [key]: v });
  return (
    <div className="space-y-5">
      {schema.description && <p className="text-xs text-muted-foreground">{schema.description}</p>}
      {schema.sections
        .filter((s) => isVisible(s.visibleWhen, value))
        .map((section) => (
          <fieldset key={section.key} className="rounded-md border p-4">
            <legend className="px-1 font-medium">{section.title}</legend>
            {section.description && <p className="mb-3 text-xs text-muted-foreground">{section.description}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              {section.fields
                .filter((f) => isVisible(f.visibleWhen, value))
                .map((f) => (
                  <div key={f.key} className={cn((f.type === "textarea" || f.type === "table" || f.type === "attachment" || f.type === "multiselect" || f.type === "radio") && "sm:col-span-2")}>
                    <FieldInput field={f} value={value[f.key]} onChange={(v) => set(f.key, v)} readOnly={readOnly || f.readOnly} error={errorFor(f.key)} issues={issues} />
                  </div>
                ))}
            </div>
          </fieldset>
        ))}
    </div>
  );
}

function FieldInput({ field, value, onChange, readOnly, error, issues }: { field: FormField; value: unknown; onChange: (v: unknown) => void; readOnly?: boolean; error?: string; issues: FormValidationIssue[] }) {
  const id = `nf-${field.key}`;
  if (field.type === "table") {
    const rows = Array.isArray(value) ? (value as FormData[]) : [];
    const setRow = (i: number, key: string, v: unknown) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: v } : r)));
    return (
      <Field label={field.label} hint={field.help} error={error} required={field.required}>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                {field.columns.map((c) => (
                  <th key={c.key} className="px-2 py-1.5 text-left font-medium">
                    {c.label}
                    {c.required && <span className="text-destructive"> *</span>}
                  </th>
                ))}
                {!readOnly && <th className="w-8" />}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={field.columns.length + 1} className="px-2 py-2 text-muted-foreground">
                    No rows.
                  </td>
                </tr>
              )}
              {rows.map((row, i) => (
                <tr key={i} className="border-t align-top">
                  {field.columns.map((c) => (
                    <td key={c.key} className="px-1 py-1">
                      {isVisible(c.visibleWhen, row) ? (
                        <ScalarInput field={c} id={`${id}-${i}-${c.key}`} value={row[c.key]} onChange={(v) => setRow(i, c.key, v)} readOnly={readOnly} compact error={issues.find((x) => x.path === `${field.key}[${i}].${c.key}`)?.message} />
                      ) : null}
                    </td>
                  ))}
                  {!readOnly && (
                    <td className="px-1 py-1">
                      <Button size="icon" variant="ghost" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`Remove row ${i + 1}`}>
                        <X />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!readOnly && (!field.maxRows || rows.length < field.maxRows) && (
          <Button size="sm" variant="outline" className="mt-2" onClick={() => onChange([...rows, {}])}>
            <Plus /> Add row
          </Button>
        )}
      </Field>
    );
  }
  if (field.type === "attachment") {
    const ids = (Array.isArray(value) ? value : value ? [value] : []) as string[];
    return (
      <Field label={field.label} hint={field.help} error={error} required={field.required}>
        <ul className="space-y-1">
          {ids.map((fid) => (
            <AttachmentRow key={fid} fileId={fid} onRemove={readOnly ? undefined : () => onChange(ids.filter((x) => x !== fid))} />
          ))}
          {ids.length === 0 && readOnly && <li className="text-muted-foreground">No files.</li>}
        </ul>
        {!readOnly && (field.multiple || ids.length === 0) && (
          <div className="mt-2">
            <FileUpload multiple={!!field.multiple} label="Upload" onReady={(f) => onChange(field.multiple ? [...ids, f.id] : [f.id])} />
          </div>
        )}
      </Field>
    );
  }
  return (
    <Field label={field.label} htmlFor={id} hint={field.help} error={error} required={field.required}>
      <ScalarInput field={field} id={id} value={value} onChange={onChange} readOnly={readOnly} />
    </Field>
  );
}

function ScalarInput({ field, id, value, onChange, readOnly, compact, error }: { field: ScalarField; id: string; value: unknown; onChange: (v: unknown) => void; readOnly?: boolean; compact?: boolean; error?: string }) {
  if (readOnly) return <span className={cn("block whitespace-pre-wrap break-words", compact ? "px-1 py-1" : "py-1")}>{display(field, value)}</span>;
  const cls = cn(compact && "h-8 text-xs", error && "border-destructive");
  const str = value === null || value === undefined ? "" : String(value);
  switch (field.type) {
    case "textarea":
      return <Textarea id={id} className={cls} value={str} onChange={(e) => onChange(e.target.value)} rows={compact ? 2 : 3} maxLength={field.maxLength} aria-invalid={!!error} title={error} />;
    case "number":
      return (
        <div className="flex items-center gap-1">
          <Input id={id} className={cls} type="number" step={field.integer ? 1 : "any"} min={field.min} max={field.max} value={str} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} aria-invalid={!!error} title={error} />
          {field.unit && <span className="text-xs text-muted-foreground">{field.unit}</span>}
        </div>
      );
    case "date":
      return <Input id={id} className={cls} type="date" value={str} onChange={(e) => onChange(e.target.value || null)} aria-invalid={!!error} title={error} />;
    case "select":
      return <Select id={id} className={cls} value={str} onChange={(e) => onChange(e.target.value || null)} options={field.options} placeholder="-" aria-invalid={!!error} title={error} />;
    case "radio":
      return (
        <div role="radiogroup" aria-labelledby={id} className="flex flex-wrap gap-x-4 gap-y-1">
          {field.options.map((o) => (
            <label key={o.value} className="flex items-center gap-1.5">
              <input type="radio" name={id} value={o.value} checked={str === o.value} onChange={() => onChange(o.value)} />
              {o.label}
            </label>
          ))}
        </div>
      );
    case "multiselect": {
      const list = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {field.options.map((o) => (
            <label key={o.value} className="flex items-center gap-1.5">
              <Checkbox checked={list.includes(o.value)} onCheckedChange={(c) => onChange(c === true ? [...list, o.value] : list.filter((x) => x !== o.value))} />
              {o.label}
            </label>
          ))}
        </div>
      );
    }
    case "checkbox":
      return (
        <label className="flex items-center gap-2 py-1">
          <Checkbox id={id} checked={value === true} onCheckedChange={(c) => onChange(c === true)} /> <span className="text-xs text-muted-foreground">Yes</span>
        </label>
      );
    default:
      return <Input id={id} className={cls} type={field.type === "email" ? "email" : field.type === "url" ? "url" : "text"} value={str} maxLength={field.maxLength} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} title={error} />;
  }
}

function display(field: ScalarField, value: unknown): string {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return "-";
  switch (field.type) {
    case "checkbox":
      return value === true ? "Yes" : "No";
    case "select":
    case "radio":
      return field.options.find((o) => o.value === value)?.label ?? String(value);
    case "multiselect":
      return (value as string[]).map((v) => field.options.find((o) => o.value === v)?.label ?? v).join(", ");
    case "date":
      return formatDate(String(value));
    case "number":
      return `${value}${field.unit ? ` ${field.unit}` : ""}`;
    default:
      return String(value);
  }
}

function AttachmentRow({ fileId, onRemove }: { fileId: string; onRemove?: () => void }) {
  const q = useQuery({ queryKey: ["file", fileId], queryFn: () => api<UploadedFile>(`/files/${fileId}`) });
  return (
    <li className="flex items-center gap-2 rounded border px-2 py-1 text-xs">
      <span className="min-w-0 flex-1 truncate">{q.data ? q.data.safeFilename : q.error ? "File unavailable" : "Loading..."}</span>
      {q.data && <span className="text-muted-foreground">{formatBytes(q.data.sizeBytes)}</span>}
      {q.data?.status === "CLEAN" && (
        <a href={fileDownloadUrl(fileId)} className="text-accent" aria-label="Download">
          <Download className="size-3.5" />
        </a>
      )}
      {onRemove && (
        <button onClick={onRemove} className="text-muted-foreground hover:text-destructive" aria-label="Remove file">
          <Trash2 className="size-3.5" />
        </button>
      )}
    </li>
  );
}
