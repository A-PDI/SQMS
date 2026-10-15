"use client";

import { useQuery } from "@tanstack/react-query";
import { humanize } from "@sqms/shared";
import { CheckCircle2, MessageCircleQuestion, UserRoundCog, XCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { ActionDialog } from "@/components/common/action-dialog";
import { UserPicker, type PickerItem } from "@/components/forms/async-picker";
import { PageHeader } from "@/components/shell/page-header";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState, ErrorAlert, Skeleton } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useSession } from "@/lib/session";

interface InboxItem {
  id: string;
  version: number;
  stepName: string;
  assigneeRoleKey: string | null;
  assigneeUserId: string | null;
  dueAt: string | null;
  overdue: boolean;
  escalationLevel: number;
  createdAt: string;
  workflowName: string;
  subjectType: string;
  subjectId: string;
  subjectLabel: string | null;
  subjectVersionRef: string | null;
  link: string | null;
  canDecide: boolean;
  ineligibleReason: string | null;
}
interface Decided {
  id: string;
  status: string;
  comment: string | null;
  decidedAt: string;
  decidedSubjectRef: string | null;
  step: { name: string; instance: { subjectType: string; subjectId: string; subjectLabel: string | null; context: { link?: string } | null } };
}

export default function ApprovalsPage() {
  const [overdueOnly, setOverdueOnly] = useState(false);
  const inbox = useQuery({ queryKey: ["approvals-inbox", overdueOnly], queryFn: () => api<InboxItem[]>("/approvals/inbox", { query: { overdue: overdueOnly || undefined } }) });
  const recent = useQuery({ queryKey: ["approvals-recent"], queryFn: () => api<Decided[]>("/approvals/recent") });
  const refresh = () => {
    void inbox.refetch();
    void recent.refetch();
  };
  return (
    <>
      <PageHeader title="Approvals" description="Reviews assigned to you or your roles. Each decision records the exact version of the record approved." />
      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">Pending {inbox.data ? `(${inbox.data.length})` : ""}</TabsTrigger>
          <TabsTrigger value="recent">Decided by me</TabsTrigger>
        </TabsList>
        <TabsContent value="pending">
          <Card>
            <div className="flex items-center gap-2 border-b px-4 py-2">
              <label className="flex items-center gap-2 text-xs">
                <Checkbox checked={overdueOnly} onCheckedChange={(c) => setOverdueOnly(c === true)} /> Overdue only
              </label>
            </div>
            {inbox.error ? <ErrorAlert error={inbox.error} className="m-4" /> : null}
            {inbox.isLoading && <Skeleton className="m-4 h-24" />}
            {inbox.data?.length === 0 && <EmptyState title="Nothing waiting for your decision" description="New review requests also arrive as notifications." />}
            {!!inbox.data?.length && (
              <div className="overflow-x-auto">
                <Table>
                  <THead>
                    <tr>
                      <TH>Record</TH>
                      <TH>Step</TH>
                      <TH>Assigned to</TH>
                      <TH>Due</TH>
                      <TH className="text-right">Decision</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {inbox.data.map((i) => (
                      <TR key={i.id}>
                        <TD className="min-w-64">
                          {i.link ? (
                            <Link href={i.link} className="font-medium text-accent hover:underline">
                              {i.subjectLabel ?? i.subjectId}
                            </Link>
                          ) : (
                            <span className="font-medium">{i.subjectLabel ?? i.subjectId}</span>
                          )}
                          <div className="text-xs text-muted-foreground">
                            {humanize(i.subjectType)} · {i.workflowName}
                            {i.subjectVersionRef && <span className="font-mono"> · ref {i.subjectVersionRef.slice(0, 10)}</span>}
                          </div>
                        </TD>
                        <TD>{i.stepName}</TD>
                        <TD className="text-xs">{i.assigneeUserId ? "You" : i.assigneeRoleKey ? `${humanize(i.assigneeRoleKey)} role` : "-"}</TD>
                        <TD className="text-xs">
                          {formatDateTime(i.dueAt)}
                          {i.overdue && (
                            <Badge tone="danger" className="ml-1">
                              Overdue{i.escalationLevel > 0 ? ` · escalated ${i.escalationLevel}` : ""}
                            </Badge>
                          )}
                        </TD>
                        <TD className="text-right">
                          <div className="flex flex-wrap justify-end gap-1">
                            {i.canDecide ? <DecisionButtons item={i} onDone={refresh} /> : <span className="max-w-56 text-xs text-warning">{i.ineligibleReason ?? "You cannot decide this step"}</span>}
                            <Reassign item={i} onDone={refresh} />
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
          </Card>
        </TabsContent>
        <TabsContent value="recent">
          <Card>
            {recent.error ? <ErrorAlert error={recent.error} className="m-4" /> : null}
            {recent.data?.length === 0 && <EmptyState title="No decisions yet" />}
            {!!recent.data?.length && (
              <Table>
                <THead>
                  <tr>
                    <TH>Record</TH>
                    <TH>Step</TH>
                    <TH>Decision</TH>
                    <TH>Comment</TH>
                    <TH>Decided</TH>
                  </tr>
                </THead>
                <TBody>
                  {recent.data.map((d) => (
                    <TR key={d.id}>
                      <TD>
                        {d.step.instance.context?.link ? (
                          <Link href={d.step.instance.context.link} className="text-accent hover:underline">
                            {d.step.instance.subjectLabel ?? d.step.instance.subjectId}
                          </Link>
                        ) : (
                          (d.step.instance.subjectLabel ?? d.step.instance.subjectId)
                        )}
                        <div className="text-xs text-muted-foreground">{humanize(d.step.instance.subjectType)}</div>
                      </TD>
                      <TD>{d.step.name}</TD>
                      <TD>
                        <StatusBadge status={d.status} />
                      </TD>
                      <TD className="max-w-sm text-xs">{d.comment ?? "-"}</TD>
                      <TD>{formatDateTime(d.decidedAt)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

function DecisionButtons({ item, onDone }: { item: InboxItem; onDone: () => void }) {
  const decide = (decision: "APPROVE" | "REJECT" | "REQUEST_INFO", comment: string) =>
    api(`/approvals/${item.id}/decision`, { method: "POST", body: { decision, expectedVersion: item.version, ...(comment ? { comment } : {}) } }).then(() => {
      toast.success(decision === "APPROVE" ? "Approved" : decision === "REJECT" ? "Rejected" : "Information requested");
      onDone();
    });
  const desc = `${item.subjectLabel ?? ""} · ${item.stepName}`;
  return (
    <>
      <ActionDialog trigger={<Button size="sm"><CheckCircle2 /> Approve</Button>} title="Approve" description={desc} reasonLabel="Comment" reasonRequired={false} confirmLabel="Approve" onConfirm={(c) => decide("APPROVE", c)} />
      <ActionDialog trigger={<Button size="sm" variant="outline"><MessageCircleQuestion /> Request info</Button>} title="Request information" description={`${desc}. The submitter is asked to provide more information.`} reasonLabel="What is needed" confirmLabel="Request information" onConfirm={(c) => decide("REQUEST_INFO", c)} />
      <ActionDialog trigger={<Button size="sm" variant="ghost"><XCircle /> Reject</Button>} title="Reject" description={desc} reasonLabel="Reason for rejection" confirmVariant="destructive" confirmLabel="Reject" onConfirm={(c) => decide("REJECT", c)} />
    </>
  );
}

function Reassign({ item, onDone }: { item: InboxItem; onDone: () => void }) {
  const { can } = useSession();
  const [user, setUser] = useState<PickerItem | null>(null);
  if (!can("approval:reassign") && !item.assigneeUserId) return null;
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="ghost" aria-label="Reassign">
          <UserRoundCog />
        </Button>
      }
      title="Reassign approval"
      description="Delegates this step to another person. The reassignment and reason are recorded."
      reasonLabel="Reason"
      reasonMin={3}
      confirmLabel="Reassign"
      onConfirm={async (reason) => {
        if (!user) throw new Error("Select the new approver");
        await api(`/approvals/${item.id}/reassign`, { method: "POST", body: { toUserId: user.id, reason } });
        toast.success(`Reassigned to ${user.label}`);
        onDone();
      }}
    >
      <Field label="New approver" required>
        <UserPicker value={user} onChange={setUser} roleKey={item.assigneeRoleKey ?? undefined} />
      </Field>
    </ActionDialog>
  );
}
