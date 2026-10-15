import { Label as LabelPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className={cn("text-xs font-medium text-foreground", className)} {...props} />;
}

export function Field({ label, htmlFor, error, hint, required, className, children }: { label: string; htmlFor?: string; error?: string; hint?: string; required?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("space-y-1", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="ml-0.5 text-destructive" aria-hidden>*</span>}
      </Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
