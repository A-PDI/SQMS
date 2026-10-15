"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { NcrTable } from "@/components/tables/tables";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/session";

export default function Page() {
  const { can } = useSession();
  return (
    <>
      <PageHeader
        title="Nonconformances"
        description="Nonconformance reports with containment, investigation and disposition. Internal notes are never shown to suppliers."
        actions={
          can("ncr:write") && (
            <Button asChild>
              <Link href="/quality/ncrs/new">
                <Plus /> New NCR
              </Link>
            </Button>
          )
        }
      />
      <NcrTable />
    </>
  );
}
