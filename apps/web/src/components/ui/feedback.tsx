import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import * as React from "react";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return <span className={cn("inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent text-muted-foreground", className)} role="status" aria-label="Loading" />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-muted", className)} />;
}

export function PageLoading() {
  return (
    <div className="space-y-3 p-1" aria-busy>
      <Skeleton className="h-7 w-64" />
      <Skeleton className="h-4 w-full max-w-96" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

const ALERT = {
  info: { cls: "border-blue-200 bg-blue-50 text-info", Icon: Info },
  success: { cls: "border-emerald-200 bg-emerald-50 text-success", Icon: CheckCircle2 },
  warning: { cls: "border-amber-200 bg-amber-50 text-warning", Icon: AlertTriangle },
  danger: { cls: "border-red-200 bg-red-50 text-destructive", Icon: XCircle },
} as const;

export function Alert({ tone = "info", title, children, className }: { tone?: keyof typeof ALERT; title?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  const { cls, Icon } = ALERT[tone];
  return (
    <div className={cn("flex gap-2 rounded-md border px-3 py-2 text-sm", cls, className)} role={tone === "danger" ? "alert" : "status"}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title && "mt-0.5", "text-foreground/90")}>{children}</div>}
      </div>
    </div>
  );
}

/** Renders an API error with any rule violations / gate failures it carries. */
export function ErrorAlert({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : "Something went wrong";
  const problems = error instanceof ApiError ? error.problems : [];
  const ref = error instanceof ApiError && error.correlationId ? ` (reference ${error.correlationId.slice(0, 8)})` : "";
  return (
    <Alert tone="danger" title={message} className={className}>
      {problems.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4">
          {problems.slice(0, 20).map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
      {ref && <p className="mt-1 text-xs text-muted-foreground">{ref.trim()}</p>}
    </Alert>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-md text-xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
