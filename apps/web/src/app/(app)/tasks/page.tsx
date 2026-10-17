"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PRIORITY, TASK_STATUS, humanize } from "@sqms/shared";
import { Check, Play, Plus, X } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { DataTable } from "@/components/data/data-table";
import { FormDialog } from "@/components/forms/schema-form";
import { PageHeader } from "@/components/shell/page-header";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { entityHref } from "@/lib/links";
import { toOptions } from "@/lib/options";
import { useSession } from "@/lib/session";

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  type: string;
  status: string;
  priority: string;
  assigneeRoleKey: string | null;
  dueAt: string | null;
  entityType: string | null;
  entityId: string | null;
  entityLabel: string | null;
  approvalAssignmentId: string | null;
  assignee: { id: string; displayName: string } | null;
  createdBy: { id: string; displayName: string } | null;
  overdue: boolean;
}

export default function TasksPage() {
  const { can, isInternal } = useSession();
  const qc = useQueryClient();
  const summary = useQuery({
    queryKey: ["tasks-summary"],
    queryFn: () =>
      api<{ open: number; overdue: number; approvals: number }>(
        "/tasks/summary",
      ),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["tasks"] });
    void summary.refetch();
  };
  async function setStatus(t: TaskRow, status: string) {
    try {
      await api(`/tasks/${t.id}`, { method: "PATCH", body: { status } });
      toast.success(`Task ${humanize(status).toLowerCase()}`);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return (
    <>
      <PageHeader
        title="Tasks"
        description="Work assigned to you or your roles: document submissions, reviews, approvals and follow-ups."
        actions={
          isInternal &&
          can("task:write") && (
            <FormDialog
              trigger={
                <Button>
                  <Plus /> New task
                </Button>
              }
              title="New task"
              columns={2}
              fields={[
                {
                  name: "title",
                  label: "Title",
                  required: true,
                  minLength: 3,
                  maxLength: 300,
                  wide: true,
                },
                {
                  name: "type",
                  label: "Type",
                  type: "select",
                  required: true,
                  options: toOptions([
                    "ACTION",
                    "REVIEW",
                    "INFO_REQUEST",
                    "FOLLOW_UP",
                  ]),
                },
                {
                  name: "priority",
                  label: "Priority",
                  type: "select",
                  options: toOptions(PRIORITY),
                },
                {
                  name: "assigneeRoleKey",
                  label: "Assign to role",
                  type: "select",
                  options: toOptions([
                    "SOURCING",
                    "ENGINEERING",
                    "SUPPLIER_QUALITY",
                    "APPROVER",
                    "ADMIN",
                  ]),
                },
                { name: "dueAt", label: "Due", type: "datetime" },
                {
                  name: "description",
                  label: "Description",
                  type: "textarea",
                  maxLength: 10000,
                },
              ]}
              defaultValues={{ type: "ACTION", priority: "NORMAL" }}
              onSubmit={async (payload) => {
                const body = {
                  ...payload,
                  ...(payload.dueAt
                    ? { dueAt: new Date(String(payload.dueAt)).toISOString() }
                    : {}),
                };
                await api("/tasks", { method: "POST", body });
                toast.success("Task created");
                refresh();
              }}
            />
          )
        }
      />
      {summary.data && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Card>
            <CardBody className="py-3">
              <p className="text-xs text-muted-foreground">Open</p>
              <p className="text-xl font-semibold">{summary.data.open}</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="py-3">
              <p className="text-xs text-muted-foreground">Overdue</p>
              <p
                className={`text-xl font-semibold ${summary.data.overdue ? "text-destructive" : ""}`}
              >
                {summary.data.overdue}
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="py-3">
              <p className="text-xs text-muted-foreground">Approvals waiting</p>
              <p className="text-xl font-semibold">
                {summary.data.approvals}{" "}
                {summary.data.approvals > 0 && (
                  <Link
                    className="text-xs font-normal text-accent hover:underline"
                    href="/approvals"
                  >
                    Open inbox
                  </Link>
                )}
              </p>
            </CardBody>
          </Card>
        </div>
      )}
      <DataTable<TaskRow>
        endpoint="/tasks"
        queryKey="tasks"
        savedViewsModule="tasks"
        searchPlaceholder="Search tasks"
        filters={[
          {
            key: "scope",
            label: "Scope",
            options: [
              { value: "mine", label: "Assigned to me" },
              { value: "created", label: "Created by me" },
              ...(isInternal ? [{ value: "all", label: "All tasks" }] : []),
            ],
          },
          { key: "status", label: "Status", options: toOptions(TASK_STATUS) },
          {
            key: "overdue",
            label: "Overdue",
            options: [{ value: "true", label: "Overdue only" }],
          },
        ]}
        columns={[
          {
            key: "title",
            header: "Task",
            wrap: true,
            sortKey: "title",
            cell: (t) => (
              <div className="min-w-56">
                <span className="font-medium">{t.title}</span>
                {t.description && (
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {t.description}
                  </p>
                )}
              </div>
            ),
          },
          { key: "type", header: "Type", cell: (t) => humanize(t.type) },
          {
            key: "record",
            header: "Record",
            cell: (t) => {
              const href =
                t.type === "APPROVAL"
                  ? "/approvals"
                  : entityHref(t.entityType, t.entityId);
              return href ? (
                <Link className="text-accent hover:underline" href={href}>
                  {t.entityLabel ?? humanize(t.entityType ?? "")}
                </Link>
              ) : (
                (t.entityLabel ?? "-")
              );
            },
          },
          {
            key: "assignee",
            header: "Assigned to",
            cell: (t) => (
              <span className="text-xs">
                {t.assignee?.displayName ??
                  (t.assigneeRoleKey
                    ? `${humanize(t.assigneeRoleKey)} role`
                    : "Supplier")}
              </span>
            ),
          },
          {
            key: "priority",
            header: "Priority",
            sortKey: "priority",
            cell: (t) => (
              <Badge
                tone={
                  t.priority === "URGENT"
                    ? "danger"
                    : t.priority === "HIGH"
                      ? "warning"
                      : "muted"
                }
              >
                {humanize(t.priority)}
              </Badge>
            ),
          },
          {
            key: "due",
            header: "Due",
            sortKey: "dueAt",
            cell: (t) => (
              <span
                className={`text-xs ${t.overdue ? "text-destructive" : ""}`}
              >
                {formatDateTime(t.dueAt)}
                {t.overdue && " (overdue)"}
              </span>
            ),
          },
          {
            key: "status",
            header: "Status",
            sortKey: "status",
            cell: (t) => <StatusBadge status={t.status} />,
          },
          {
            key: "actions",
            header: "",
            cell: (t) =>
              t.type === "APPROVAL" ||
              t.type === "DOCUMENT_SUBMISSION" ? null : (
                <span className="flex justify-end gap-1">
                  {t.status === "OPEN" && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Start task"
                      onClick={() => void setStatus(t, "IN_PROGRESS")}
                    >
                      <Play />
                    </Button>
                  )}
                  {(t.status === "OPEN" || t.status === "IN_PROGRESS") && (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Mark done"
                        onClick={() => void setStatus(t, "DONE")}
                      >
                        <Check />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Cancel task"
                        onClick={() => void setStatus(t, "CANCELLED")}
                      >
                        <X />
                      </Button>
                    </>
                  )}
                </span>
              ),
          },
        ]}
      />
    </>
  );
}
