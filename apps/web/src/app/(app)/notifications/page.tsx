"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { humanize } from "@sqms/shared";
import { CheckCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState, ErrorAlert, Skeleton } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, type Page } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Notification {
  id: string;
  eventType: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}
interface Preferences {
  all: { IN_APP: boolean; EMAIL: boolean };
  events: { group: string; eventType: string; label: string; IN_APP: boolean | null; EMAIL: boolean | null }[];
}

export default function NotificationsPage() {
  const qc = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ["notifications", unreadOnly, page], queryFn: () => api<Page<Notification>>("/notifications", { query: { unread: unreadOnly || undefined, page, pageSize: 25 } }) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["notifications"] });
    void qc.invalidateQueries({ queryKey: ["unread-count"] });
  };
  async function markRead(n: Notification) {
    if (n.readAt) return;
    try {
      await api(`/notifications/${n.id}/read`, { method: "POST" });
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;
  return (
    <>
      <PageHeader
        title="Notifications"
        actions={
          <Button
            variant="outline"
            onClick={() =>
              void api("/notifications/read-all", { method: "POST" })
                .then(() => {
                  toast.success("All notifications marked as read");
                  refresh();
                })
                .catch((e) => toast.error((e as Error).message))
            }
          >
            <CheckCheck /> Mark all read
          </Button>
        }
      />
      <Tabs defaultValue="inbox">
        <TabsList>
          <TabsTrigger value="inbox">Inbox</TabsTrigger>
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
        </TabsList>
        <TabsContent value="inbox">
          <Card>
            <div className="flex items-center gap-2 border-b px-4 py-2">
              <label className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={unreadOnly}
                  onCheckedChange={(c) => {
                    setUnreadOnly(c === true);
                    setPage(1);
                  }}
                />{" "}
                Unread only
              </label>
              {q.data && <span className="ml-auto text-xs text-muted-foreground">{q.data.total} notifications</span>}
            </div>
            {q.error ? <ErrorAlert error={q.error} className="m-4" /> : null}
            {q.isLoading && <Skeleton className="m-4 h-24" />}
            {q.data?.items.length === 0 && <EmptyState title="No notifications" />}
            <ul className="divide-y">
              {q.data?.items.map((n) => (
                <li key={n.id} className={cn("flex gap-3 px-4 py-3", !n.readAt && "bg-blue-50/50")}>
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-accent")} aria-label={n.readAt ? undefined : "Unread"} />
                  <div className="min-w-0 flex-1">
                    {n.link ? (
                      <Link href={n.link} onClick={() => void markRead(n)} className="font-medium hover:text-accent hover:underline">
                        {n.title}
                      </Link>
                    ) : (
                      <p className="font-medium">{n.title}</p>
                    )}
                    {n.body && <p className="text-xs text-muted-foreground">{n.body}</p>}
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(n.createdAt)} · {humanize(n.eventType.replace(/\./g, "_").toUpperCase())}
                    </p>
                  </div>
                  {!n.readAt && (
                    <Button size="sm" variant="ghost" onClick={() => void markRead(n)}>
                      Mark read
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {pages > 1 && (
              <div className="flex items-center justify-end gap-2 border-t px-4 py-2 text-xs">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                Page {page} of {pages}
                <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                  Next
                </Button>
              </div>
            )}
          </Card>
        </TabsContent>
        <TabsContent value="preferences">
          <PreferencesPanel />
        </TabsContent>
      </Tabs>
    </>
  );
}

function PreferencesPanel() {
  const q = useQuery({ queryKey: ["notification-preferences"], queryFn: () => api<Preferences>("/notifications/preferences") });
  const [saving, setSaving] = useState(false);
  async function set(eventType: string, channel: "IN_APP" | "EMAIL", enabled: boolean) {
    setSaving(true);
    try {
      await api("/notifications/preferences", { method: "PUT", body: { items: [{ eventType, channel, enabled }] } });
      await q.refetch();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.error || !q.data) return <ErrorAlert error={q.error} />;
  const p = q.data;
  const groups = [...new Set(p.events.map((e) => e.group))];
  const effective = (v: boolean | null, ch: "IN_APP" | "EMAIL") => (v === null ? p.all[ch] : v);
  return (
    <Card>
      <CardHeader title="Notification preferences" description="Choose how you are told about events. Event settings override the defaults; security notices are always delivered." />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap gap-6">
          {(["IN_APP", "EMAIL"] as const).map((ch) => (
            <label key={ch} className="flex items-center gap-2 font-medium">
              <Checkbox disabled={saving} checked={p.all[ch]} onCheckedChange={(c) => void set("*", ch, c === true)} /> {ch === "IN_APP" ? "In-app (default)" : "Email (default)"}
            </label>
          ))}
        </div>
        <Table>
          <THead>
            <tr>
              <TH>Event</TH>
              <TH className="w-24 text-center">In-app</TH>
              <TH className="w-24 text-center">Email</TH>
            </tr>
          </THead>
          <TBody>
            {groups.flatMap((g) => [
              <TR key={`g-${g}`} className="bg-muted/40 hover:bg-muted/40">
                <TD colSpan={3} className="py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {g}
                </TD>
              </TR>,
              ...p.events
                .filter((e) => e.group === g)
                .map((e) => (
                  <TR key={e.eventType}>
                    <TD>{e.label}</TD>
                    {(["IN_APP", "EMAIL"] as const).map((ch) => (
                      <TD key={ch} className="text-center">
                        <Checkbox disabled={saving} aria-label={`${e.label} ${ch === "IN_APP" ? "in-app" : "email"}`} checked={effective(e[ch], ch)} onCheckedChange={(c) => void set(e.eventType, ch, c === true)} />
                      </TD>
                    ))}
                  </TR>
                )),
            ])}
          </TBody>
        </Table>
      </CardBody>
    </Card>
  );
}
