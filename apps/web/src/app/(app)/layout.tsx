"use client";

import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { PageLoading } from "@/components/ui/feedback";
import { SessionProvider } from "@/lib/session";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider
      fallback={
        <div className="p-8">
          <PageLoading />
        </div>
      }
    >
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
