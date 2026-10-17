"use client";

import type { ReactNode } from "react";
import { QmsShell } from "@/qms-runtime/entry";
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
      <QmsShell>{children}</QmsShell>
    </SessionProvider>
  );
}
