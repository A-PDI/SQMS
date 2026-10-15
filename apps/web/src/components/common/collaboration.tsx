"use client";

import { useQuery } from "@tanstack/react-query";
import { humanize } from "@sqms/shared";
import { Download, Eye, Lock, Paperclip, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ErrorAlert, Skeleton } from "@/components/ui/feedback";
import { Select, Textarea } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, fileDownloadUrl, filePreviewUrl, type Page } from "@/lib/api";
import { formatBytes, formatDateTime } from "@/lib/format";
import { useApiMutation } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { FileUpload } from "./file-upload";

interface Comment {
  id: string;
  body: string | null;
  visibility: "INTERNAL" | "SUPPLIER";
  parentId: string | null;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  mine: boolean;
  author: { id: string; displayName: string; userType: string };
}

export function Comments({ entityType, entityId }: { entityType: string; entityId: string }) {
  const { isInternal, can } = useSession();
  const key = ["comments", entityType, entityId];
  const q = useQuery({ queryKey: key, queryFn: () => api<Comment[]>("/comments", { query: { entityType, entityId } }) });
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"INTERNAL" | "SUPPLIER">("INTERNAL");
  const add = useApiMutation(() => api("/comments", { method: "POST", body: { entityType, entityId, body, visibility: isInternal ? visibility : "SUPPLIER" } }), { invalidate: [key], onSuccess: () => setBody("") });
  const del = useApiMutation((id: string) => api(`/comments/${id}`, { method: "DELETE" }), { invalidate: [key], success: "Comment deleted" });
  return (
    <div className="space-y-3">
      {q.error ? <ErrorAlert error={q.error} /> : null}
      {q.isLoading && <Skeleton className="h-16" />}
      {q.data?.length === 0 && <p className="text-xs text-muted-foreground">No comments yet.</p>}
      <ul className="space-y-2">
        {q.data?.map((c) => (
          <li key={c.id} className={`rounded-md border p-2.5 ${c.visibility === "INTERNAL" ? "bg-amber-50/40" : "bg-surface"} ${c.parentId ? "ml-6" : ""}`}>
            <div className="flex items-center gap-2 text-xs">
              <span className="font-medium">{c.author.displayName}</span>
              {c.author.userType === "EXTERNAL" && <Badge tone="info">Supplier</Badge>}
              {c.visibility === "INTERNAL" ? (
                <Badge tone="pending">
                  <Lock className="mr-1 size-3" />
                  Internal
                </Badge>
              ) : (
                <Badge tone="info">
                  <Users className="mr-1 size-3" />
                  Shared with supplier
                </Badge>
              )}
              <span className="text-muted-foreground">{formatDateTime(c.createdAt)}{c.editedAt ? " (edited)" : ""}</span>
              {c.mine && !c.deleted && (
                <button className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => del.mutate(c.id)} aria-label="Delete comment">
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
            <p className="mt-1 whitespace-pre-wrap">{c.deleted ? <em className="text-muted-foreground">Comment deleted</em> : c.body}</p>
          </li>
        ))}
      </ul>
      <div className="space-y-2">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment" rows={2} aria-label="New comment" />
        <div className="flex items-center gap-2">
          {isInternal && (
            <Select
              aria-label="Comment visibility"
              className="h-8 w-auto"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as "INTERNAL" | "SUPPLIER")}
              options={[
                ...(can("comment:internal") ? [{ value: "INTERNAL", label: "Internal only" }] : []),
                { value: "SUPPLIER", label: "Visible to supplier" },
              ]}
            />
          )}
          <Button size="sm" className="ml-auto" disabled={!body.trim()} loading={add.isPending} onClick={() => add.mutate()}>
            Post comment
          </Button>
        </div>
      </div>
    </div>
  );
}

interface ActivityEvent {
  id: string;
  entityType: string;
  entityLabel: string | null;
  actorName: string | null;
  verb: string;
  summary: string;
  visibility: string;
  occurredAt: string;
}

export function ActivityTimeline({ entityType, entityId }: { entityType: string; entityId: string }) {
  const q = useQuery({ queryKey: ["activity", entityType, entityId], queryFn: () => api<Page<ActivityEvent>>(`/activity/${entityType}/${entityId}`, { query: { pageSize: 100 } }) });
  if (q.isLoading) return <Skeleton className="h-24" />;
  if (q.error) return <ErrorAlert error={q.error} />;
  if (!q.data?.items.length) return <p className="text-xs text-muted-foreground">No activity yet.</p>;
  return (
    <ol className="relative space-y-3 border-l pl-4">
      {q.data.items.map((a) => (
        <li key={a.id}>
          <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border-2 border-surface bg-accent" />
          <p>
            {a.entityType !== entityType && a.entityLabel && <span className="font-medium">{a.entityLabel} · </span>}
            {a.summary}
          </p>
          <p className="text-xs text-muted-foreground">
            {a.actorName ?? "System"} · {formatDateTime(a.occurredAt)} · {humanize(a.verb)}
          </p>
        </li>
      ))}
    </ol>
  );
}

interface WorkflowHistory {
  id: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  subjectVersionRef: string | null;
  outcomeComment: string | null;
  definition: { key: string; version: number; name: string };
  startedBy: { displayName: string } | null;
  steps: {
    id: string;
    stepOrder: number;
    name: string;
    status: string;
    dueAt: string | null;
    assignments: { id: string; status: string; comment: string | null; decidedAt: string | null; assigneeRoleKey: string | null; assignee: { displayName: string } | null; decidedBy: { displayName: string } | null; decidedSubjectRef: string | null; reassignReason: string | null }[];
  }[];
}

export function ApprovalHistory({ subjectType, subjectId }: { subjectType: string; subjectId: string }) {
  const q = useQuery({ queryKey: ["approval-history", subjectType, subjectId], queryFn: () => api<WorkflowHistory[]>("/approvals/history", { query: { subjectType, subjectId } }) });
  if (q.isLoading) return <Skeleton className="h-24" />;
  if (q.error) return <ErrorAlert error={q.error} />;
  if (!q.data?.length) return <p className="text-xs text-muted-foreground">No approval workflow has been started.</p>;
  return (
    <div className="space-y-3">
      {q.data.map((w) => (
        <div key={w.id} className="rounded-md border">
          <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs">
            <span className="font-medium">
              {w.definition.name} (v{w.definition.version})
            </span>
            <StatusBadge status={w.status} />
            <span className="text-muted-foreground">
              Started {formatDateTime(w.startedAt)} by {w.startedBy?.displayName ?? "system"}
              {w.completedAt && ` · completed ${formatDateTime(w.completedAt)}`}
            </span>
            {w.subjectVersionRef && <span className="ml-auto font-mono text-[10px] text-muted-foreground" title="Exact version approved">ref {w.subjectVersionRef.slice(0, 12)}</span>}
          </div>
          <ul className="divide-y">
            {w.steps.map((s) => (
              <li key={s.id} className="px-3 py-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Step {s.stepOrder}</span>
                  <span className="font-medium">{s.name}</span>
                  <StatusBadge status={s.status} />
                  {s.dueAt && s.status === "ACTIVE" && <span className="text-muted-foreground">due {formatDateTime(s.dueAt)}</span>}
                </div>
                {s.assignments.map((a) => (
                  <div key={a.id} className="mt-1 pl-4 text-xs">
                    <StatusBadge status={a.status} /> {a.decidedBy?.displayName ?? a.assignee?.displayName ?? (a.assigneeRoleKey ? humanize(a.assigneeRoleKey) : "")}
                    {a.decidedAt && <span className="text-muted-foreground"> · {formatDateTime(a.decidedAt)}</span>}
                    {a.comment && <p className="mt-0.5 text-foreground/80">“{a.comment}”</p>}
                    {a.reassignReason && <p className="mt-0.5 text-muted-foreground">Reassigned: {a.reassignReason}</p>}
                  </div>
                ))}
              </li>
            ))}
          </ul>
          {w.outcomeComment && <p className="border-t px-3 py-2 text-xs">Outcome: {w.outcomeComment}</p>}
        </div>
      ))}
    </div>
  );
}

interface Attachment {
  id: string;
  description: string | null;
  visibility: string;
  addedAt: string;
  file: { id: string; safeFilename: string; sizeBytes: number; status: string; contentType: string; category: string };
}

export function Attachments({ entityType, entityId, canEdit = true }: { entityType: string; entityId: string; canEdit?: boolean }) {
  const { isInternal } = useSession();
  const key = ["attachments", entityType, entityId];
  const q = useQuery({ queryKey: key, queryFn: () => api<Attachment[]>("/record-attachments", { query: { entityType, entityId } }) });
  const [visibility, setVisibility] = useState<"INTERNAL" | "SUPPLIER">("INTERNAL");
  const add = useApiMutation((fileId: string) => api("/record-attachments", { method: "POST", body: { entityType, entityId, fileId, visibility: isInternal ? visibility : "SUPPLIER" } }), { invalidate: [key], success: "File attached" });
  const remove = useApiMutation((id: string) => api(`/record-attachments/${id}`, { method: "DELETE" }), { invalidate: [key], success: "Attachment removed" });
  return (
    <div className="space-y-3">
      {q.error ? <ErrorAlert error={q.error} /> : null}
      {q.data?.length === 0 && <p className="text-xs text-muted-foreground">No attachments.</p>}
      <ul className="divide-y rounded-md border empty:hidden">
        {q.data?.map((a) => (
          <li key={a.id} className="flex items-center gap-2 px-3 py-2 text-xs">
            <Paperclip className="size-3.5 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{a.file.safeFilename}</span>
            <span className="text-muted-foreground">{formatBytes(a.file.sizeBytes)}</span>
            {a.visibility === "SUPPLIER" && <Badge tone="info">Supplier visible</Badge>}
            <StatusBadge status={a.file.status} />
            {a.file.status === "CLEAN" && (
              <>
                {(a.file.contentType === "application/pdf" || a.file.category === "IMAGE") && (
                  <a href={filePreviewUrl(a.file.id)} target="_blank" rel="noopener noreferrer" className="text-accent" aria-label="Preview">
                    <Eye className="size-3.5" />
                  </a>
                )}
                <a href={fileDownloadUrl(a.file.id)} className="text-accent" aria-label="Download">
                  <Download className="size-3.5" />
                </a>
              </>
            )}
            {canEdit && (
              <button className="text-muted-foreground hover:text-destructive" onClick={() => remove.mutate(a.id)} aria-label="Remove attachment">
                <Trash2 className="size-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="space-y-2">
          {isInternal && (
            <Select aria-label="Attachment visibility" className="h-8 w-auto" value={visibility} onChange={(e) => setVisibility(e.target.value as "INTERNAL" | "SUPPLIER")} options={[{ value: "INTERNAL", label: "Internal only" }, { value: "SUPPLIER", label: "Visible to supplier" }]} />
          )}
          <FileUpload label="Attach files" onReady={(f) => add.mutateAsync(f.id).then(() => undefined)} />
        </div>
      )}
    </div>
  );
}

/** Standard collaboration panel used on record pages. */
export function RecordPanel({ entityType, entityId, workflowSubjectType, attachments = true, canAttach = true }: { entityType: string; entityId: string; workflowSubjectType?: string; attachments?: boolean; canAttach?: boolean }) {
  return (
    <Card>
      <Tabs defaultValue="comments">
        <CardHeader title="Collaboration" className="border-b-0 pb-0" />
        <CardBody className="pt-1">
          <TabsList>
            <TabsTrigger value="comments">Comments</TabsTrigger>
            <TabsTrigger value="activity">History</TabsTrigger>
            {workflowSubjectType && <TabsTrigger value="approvals">Approvals</TabsTrigger>}
            {attachments && <TabsTrigger value="attachments">Attachments</TabsTrigger>}
          </TabsList>
          <TabsContent value="comments">
            <Comments entityType={entityType} entityId={entityId} />
          </TabsContent>
          <TabsContent value="activity">
            <ActivityTimeline entityType={entityType} entityId={entityId} />
          </TabsContent>
          {workflowSubjectType && (
            <TabsContent value="approvals">
              <ApprovalHistory subjectType={workflowSubjectType} subjectId={entityId} />
            </TabsContent>
          )}
          {attachments && (
            <TabsContent value="attachments">
              <Attachments entityType={entityType} entityId={entityId} canEdit={canAttach} />
            </TabsContent>
          )}
        </CardBody>
      </Tabs>
    </Card>
  );
}


