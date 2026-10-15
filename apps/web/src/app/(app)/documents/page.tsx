"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { DocumentsTable } from "@/components/tables/tables";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/session";

export default function DocumentsPage() {
  const { can } = useSession();
  return (
    <>
      <PageHeader
        title="Document records"
        description="Controlled documents with revision history, review status and released revisions."
        actions={
          can("document:write") && (
            <Button asChild>
              <Link href="/documents/new">
                <Plus /> New document
              </Link>
            </Button>
          )
        }
      />
      <DocumentsTable />
    </>
  );
}
