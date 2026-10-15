import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">SQ</div>
          <h1 className="text-lg font-semibold">Supplier Quality Management</h1>
        </div>
        <div className="rounded-lg border bg-surface p-6 shadow-sm">{children}</div>
        <p className="mt-6 text-center text-xs text-muted-foreground">Authorized users only. Activity is recorded in the audit trail.</p>
      </div>
    </main>
  );
}
