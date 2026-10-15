"use client";

import { PageHeader } from "@/components/shell/page-header";
import { QualificationsTable } from "@/components/tables/tables";

export default function QualificationsPage() {
  return (
    <>
      <PageHeader title="Product qualifications" description="Evaluation and approval of a specific configuration revision from a specific supplier site. Opened from sourcing projects and change requests." />
      <QualificationsTable />
    </>
  );
}
