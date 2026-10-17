"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { FileTypesPanel, NumberingPanel, RetentionPanel, RolesPanel, SettingsPanel } from "@/components/admin/config";
import { PoliciesPanel, WorkflowsPanel } from "@/components/admin/rules";
import { InvitationsPanel, UsersPanel } from "@/components/admin/users";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/ui/feedback";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSession } from "@/lib/session";

const TABS: { key: string; label: string; perm: string; render: () => ReactNode }[] = [
  { key: "users", label: "Users", perm: "admin:users", render: () => <UsersPanel /> },
  { key: "invitations", label: "Invitations", perm: "admin:users", render: () => <InvitationsPanel /> },
  { key: "roles", label: "Roles & permissions", perm: "admin:roles", render: () => <RolesPanel /> },
  { key: "settings", label: "Settings", perm: "admin:settings", render: () => <SettingsPanel /> },
  { key: "numbering", label: "Numbering", perm: "admin:settings", render: () => <NumberingPanel /> },
  { key: "file-types", label: "File types", perm: "admin:settings", render: () => <FileTypesPanel /> },
  { key: "retention", label: "Retention", perm: "admin:settings", render: () => <RetentionPanel /> },
  { key: "workflows", label: "Approval workflows", perm: "admin:workflows", render: () => <WorkflowsPanel /> },
  { key: "policies", label: "Applicability policies", perm: "admin:policies", render: () => <PoliciesPanel /> },
];

export default function AdminPage() {
  return (
    <Suspense>
      <Admin />
    </Suspense>
  );
}

function Admin() {
  const { can } = useSession();
  const params = useSearchParams();
  const router = useRouter();
  const tabs = TABS.filter((t) => can(t.perm));
  const requested = params.get("tab");
  const active = tabs.find((t) => t.key === requested)?.key ?? tabs[0]?.key;
  return (
    <>
      <PageHeader title="Administration" description="Users and access, configuration, approval workflows and document applicability rules. Every change is recorded in the audit trail." />
      {tabs.length === 0 ? (
        <EmptyState title="No administrative permissions" />
      ) : (
        <Tabs value={active} onValueChange={(v) => router.replace(`/admin?tab=${v}`, { scroll: false })}>
          <TabsList>
            {tabs.map((t) => (
              <TabsTrigger key={t.key} value={t.key}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {tabs.map((t) => (
            <TabsContent key={t.key} value={t.key}>
              {t.key === active && t.render()}
            </TabsContent>
          ))}
        </Tabs>
      )}
    </>
  );
}
