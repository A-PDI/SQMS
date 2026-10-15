"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { ScarTable } from "@/components/tables/tables";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/session";

export default function Page() {
  const { can } = useSession();
  return (
    <>
      <PageHeader
        title="Corrective actions"
        description="Supplier corrective action requests (8D) with response review, effectiveness verification and escalation."
        actions={
          can("scar:write") && (
            <Button asChild>
              <Link href="/quality/scars/new">
                <Plus /> New SCAR
              </Link>
            </Button>
          )
        }
      />
      <ScarTable />
    </>
  );
}
