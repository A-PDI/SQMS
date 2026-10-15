import { humanize, statusTone, type StatusTone } from "@sqms/shared";
import * as React from "react";
import { cn } from "@/lib/utils";

const TONES: Record<StatusTone, string> = {
  neutral: "bg-muted text-foreground border-border",
  info: "bg-blue-50 text-info border-blue-200",
  pending: "bg-amber-50 text-warning border-amber-200",
  success: "bg-emerald-50 text-success border-emerald-200",
  warning: "bg-orange-50 text-warning border-orange-200",
  danger: "bg-red-50 text-destructive border-red-200",
  muted: "bg-muted text-muted-foreground border-border",
};

export function Badge({ tone = "neutral", className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: StatusTone }) {
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-medium leading-none", TONES[tone], className)} {...props} />;
}

/** Status pill using the shared status-to-tone mapping. */
export function StatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  if (!status) return <span className="text-muted-foreground">-</span>;
  return (
    <Badge tone={statusTone(status)} className={className}>
      {humanize(status)}
    </Badge>
  );
}
