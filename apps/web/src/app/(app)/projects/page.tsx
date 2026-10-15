"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { ProjectsTable } from "@/components/tables/tables";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/session";

export default function ProjectsPage() {
  const { can } = useSession();
  return (
    <>
      <PageHeader
        title="Sourcing projects"
        description="Product sourcing requests by pathway, with generated document checklists, risk and qualification status."
        actions={
          can("project:write") && (
            <Button asChild>
              <Link href="/projects/new">
                <Plus /> New sourcing project
              </Link>
            </Button>
          )
        }
      />
      <ProjectsTable />
    </>
  );
}
