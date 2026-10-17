import * as React from "react";
import { cn } from "@/lib/utils";

export const inputClass =
  "workspace-control w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-500 min-h-9 focus:outline-none focus:ring-1 focus:ring-pdi-navy focus:border-pdi-navy disabled:bg-gray-100 disabled:cursor-not-allowed aria-[invalid=true]:border-destructive";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(inputClass, className)} {...props} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, rows = 3, ...props }, ref) => (
  <textarea
    ref={ref}
    rows={rows}
    className={cn(inputClass, "h-auto py-2", className)}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export interface Option {
  value: string;
  label: string;
}

/** Native select: accessible, keyboard friendly and works with react-hook-form register(). */
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & {
    options: Option[];
    placeholder?: string;
  }
>(({ className, options, placeholder, ...props }, ref) => (
  <select ref={ref} className={cn(inputClass, "pr-8", className)} {...props}>
    {placeholder !== undefined && <option value="">{placeholder}</option>}
    {options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </select>
));
Select.displayName = "Select";
