"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { DeviationsTable } from "@/components/tables/tables";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/session";

export default function Page() {
  const { can } = useSession();
  return (
    <>
      <PageHeader
        title="Deviations and concessions"
        description="Temporary deviations and concessions, limited by date or quantity, approved through workflow."
        actions={
          can("deviation:write") && (
            <Button asChild>
              <Link href="/quality/deviations/new">
                <Plus /> New request
              </Link>
            </Button>
          )
        }
      />
      <DeviationsTable />
    </>
  );
}
