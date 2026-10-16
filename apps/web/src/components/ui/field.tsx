"use client";
import { Label as LabelPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className={cn("text-xs font-medium text-foreground", className)} {...props} />;
}

export function Field({ label, htmlFor, error, hint, required, className, children }: { label: string; htmlFor?: string; error?: string; hint?: string; required?: boolean; className?: string; children: React.ReactNode }) {
  const generatedId = React.useId();
  const control = React.isValidElement<{ id?: string }>(children) ? children : null;
  const labelTarget = htmlFor ?? control?.props.id ?? generatedId;
  const content = control && !htmlFor && !control.props.id ? React.cloneElement(control, { id: labelTarget }) : children;
  return (
    <div className={cn("space-y-1", className)}>
      <Label htmlFor={labelTarget}>
        {label}
        {required && <span className="ml-0.5 text-destructive" aria-hidden>*</span>}
      </Label>
      {content}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
