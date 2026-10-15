import * as React from "react";
import { cn } from "@/lib/utils";

export const inputClass =
  "h-9 w-full rounded-md border bg-surface px-3 text-sm placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:bg-muted aria-[invalid=true]:border-destructive";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(inputClass, className)} {...props} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, rows = 3, ...props }, ref) => (
  <textarea ref={ref} rows={rows} className={cn(inputClass, "h-auto py-2", className)} {...props} />
));
Textarea.displayName = "Textarea";

export interface Option {
  value: string;
  label: string;
}

/** Native select: accessible, keyboard friendly and works with react-hook-form register(). */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & { options: Option[]; placeholder?: string }>(
  ({ className, options, placeholder, ...props }, ref) => (
    <select ref={ref} className={cn(inputClass, "pr-8", className)} {...props}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
);
Select.displayName = "Select";
