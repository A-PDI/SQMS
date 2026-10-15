"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { ChangesTable } from "@/components/tables/tables";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/session";

export default function ChangesPage() {
  const { can } = useSession();
  return (
    <>
      <PageHeader
        title="Change requests"
        description="Supplier change requests and product change notifications. Proposed configurations stay separate from the authorized configuration until approval."
        actions={
          can("change:submit") && (
            <Button asChild>
              <Link href="/changes/new">
                <Plus /> New change request
              </Link>
            </Button>
          )
        }
      />
      <ChangesTable />
    </>
  );
}
