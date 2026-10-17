import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: { href?: string; label: string }[];
  meta?: ReactNode;
}) {
  return (
    <div className="mb-4">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav
          className="mb-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
          aria-label="Breadcrumb"
        >
          {breadcrumbs.map((b, i) => (
            <span key={i} className="flex items-center gap-1">
              {b.href ? (
                <Link
                  href={b.href}
                  className="hover:text-foreground hover:underline"
                >
                  {b.label}
                </Link>
              ) : (
                <span>{b.label}</span>
              )}
              {i < breadcrumbs.length - 1 && (
                <ChevronRight className="size-3" />
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-pdi-navy">
            {title}
          </h1>
          {description && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {description}
            </p>
          )}
          {meta && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              {meta}
            </div>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
    </div>
  );
}
