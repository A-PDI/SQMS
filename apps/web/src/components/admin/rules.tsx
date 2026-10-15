"use client";

import { useQuery } from "@tanstack/react-query";
import { humanize } from "@sqms/shared";
import { useState } from "react";
import { toast } from "sonner";
import { ActionDialog } from "@/components/common/action-dialog";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { ErrorAlert, Skeleton } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Select, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { api, ApiError } from "@/lib/api";
import { describeCondition, formatDateTime } from "@/lib/format";

// ------------------------------------------------------------------ approval workflows

interface Step {
  stepOrder: number;
  key: string;
  name: string;
  approverType: string;
  approverRoleKey: string | null;
  approverUserId: string | null;
  requiredApprovals: number;
  dueInDays: number | null;
  escalateAfterDays: number | null;
  escalateToRoleKey: string | null;
  allowDelegation: boolean;
  condition: unknown;
}
interface WorkflowRow {
  key: string;
  current: { id: string; version: number; name: string; description: string | null; subjectType: string; steps: Step[]; _count: { instances: number } } | null;
  versions: { id: string; version: number; isActive: boolean; instances: number }[];
}

export function WorkflowsPanel() {
  const q = useQuery({ queryKey: ["admin-workflows"], queryFn: () => api<WorkflowRow[]>("/admin/workflows") });
  const [editing, setEditing] = useState<WorkflowRow | null>(null);
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.error) return <ErrorAlert error={q.error} />;
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Publishing a new version affects new approvals only; workflows already in progress keep the version they started with.</p>
      {q.data!.map((w) => (
        <Card key={w.key}>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                {w.current?.name ?? w.key} <Badge tone="muted">v{w.current?.version}</Badge> <Badge>{humanize(w.current?.subjectType ?? "")}</Badge>
              </span>
            }
            description={`${w.key} · ${w.current?.description ?? ""} · ${w.versions.length} version(s), ${w.versions.reduce((a, v) => a + v.instances, 0)} approvals run`}
            actions={
              w.current && (
                <Button size="sm" variant="outline" onClick={() => setEditing(w)}>
                  New version
                </Button>
              )
            }
          />
          <Table>
            <THead>
              <tr>
                <TH>#</TH>
                <TH>Step</TH>
                <TH>Approver</TH>
                <TH>Approvals</TH>
                <TH>Due</TH>
                <TH>Escalation</TH>
                <TH>Condition</TH>
              </tr>
            </THead>
            <TBody>
              {w.current?.steps.map((s) => (
                <TR key={s.key}>
                  <TD>{s.stepOrder}</TD>
                  <TD>
                    {s.name}
                    <div className="font-mono text-[11px] text-muted-foreground">{s.key}</div>
                  </TD>
                  <TD className="text-xs">{s.approverType === "ROLE" ? `${humanize(s.approverRoleKey ?? "")} role` : s.approverType === "USER" ? "Named user" : "Record owner"}</TD>
                  <TD>{s.requiredApprovals}</TD>
                  <TD className="text-xs">{s.dueInDays ? `${s.dueInDays} days` : "-"}</TD>
                  <TD className="text-xs">{s.escalateAfterDays ? `after ${s.escalateAfterDays} days to ${humanize(s.escalateToRoleKey ?? "")}` : "-"}</TD>
                  <TD className="font-mono text-[11px]">{s.condition ? describeCondition(s.condition) : "always"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      ))}
      {editing && <WorkflowVersionDialog w={editing} onClose={() => setEditing(null)} onDone={() => void q.refetch()} />}
    </div>
  );
}

function WorkflowVersionDialog({ w, onClose, onDone }: { w: WorkflowRow; onClose: () => void; onDone: () => void }) {
  const initial = {
    name: w.current!.name,
    description: w.current!.description ?? undefined,
    steps: w.current!.steps.map((s) => ({
      stepOrder: s.stepOrder,
      key: s.key,
      name: s.name,
      approverType: s.approverType,
      ...(s.approverRoleKey ? { approverRoleKey: s.approverRoleKey } : {}),
      ...(s.approverUserId ? { approverUserId: s.approverUserId } : {}),
      requiredApprovals: s.requiredApprovals,
      ...(s.dueInDays ? { dueInDays: s.dueInDays } : {}),
      ...(s.escalateAfterDays ? { escalateAfterDays: s.escalateAfterDays } : {}),
      ...(s.escalateToRoleKey ? { escalateToRoleKey: s.escalateToRoleKey } : {}),
      allowDelegation: s.allowDelegation,
      ...(s.condition ? { condition: s.condition } : {}),
    })),
  };
  const [text, setText] = useState(JSON.stringify(initial, null, 2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function publish() {
    setError(null);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      setError(new Error("The definition is not valid JSON"));
      return;
    }
    setBusy(true);
    try {
      await api(`/admin/workflows/${w.key}/versions`, { method: "POST", body });
      toast.success("New workflow version published");
      onDone();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`New version of ${w.key}`} description="Steps: stepOrder, key, name, approverType (ROLE | USER | RECORD_OWNER), approverRoleKey / approverUserId, requiredApprovals, dueInDays, escalateAfterDays, escalateToRoleKey, allowDelegation, optional condition such as {field: riskLevel, op: gte, value: HIGH}." wide>
        {error ? <ErrorAlert error={error} /> : null}
        <Textarea className="font-mono text-xs" rows={20} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="Workflow definition JSON" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={publish}>
            Publish version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ applicability policies

interface PolicyRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  versions: { id: string; version: number; status: string; notes: string | null; activatedAt: string | null; retiredAt: string | null }[];
}
interface Rule {
  id: string;
  outcome: string;
  priority: number;
  conditions: unknown;
  reason: string;
  dueOffsetDays: number | null;
  defaultAssigneeRoleKey: string | null;
  documentType: { code: string; name: string };
}
interface PolicyVersion {
  id: string;
  version: number;
  status: string;
  notes: string | null;
  activatedAt: string | null;
  policy: { id: string; key: string; name: string };
  rules: Rule[];
  contextFields: Record<string, { label: string; type: "enum" | "boolean"; values?: string[] }>;
}

export function PoliciesPanel() {
  const q = useQuery({ queryKey: ["admin-policies"], queryFn: () => api<PolicyRow[]>("/admin/applicability-policies") });
  const [versionId, setVersionId] = useState<string | null>(null);
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.error) return <ErrorAlert error={q.error} />;
  const policies = q.data!;
  const selected = versionId ?? policies[0]?.versions.find((v) => v.status === "ACTIVE")?.id ?? policies[0]?.versions[0]?.id ?? null;
  return (
    <div className="space-y-4">
      {policies.map((p) => (
        <Card key={p.id}>
          <CardHeader
            title={p.name}
            description={p.description ?? p.key}
            actions={
              <ActionDialog
                trigger={<Button size="sm" variant="outline">New draft version</Button>}
                title="New draft policy version"
                description="Copies the rules of the active version into a draft you can edit and test. Projects keep the version they were generated with."
                reasonLabel="Notes"
                reasonRequired={false}
                confirmLabel="Create draft"
                onConfirm={async (notes) => {
                  const active = p.versions.find((v) => v.status === "ACTIVE");
                  const created = await api<{ id: string }>(`/admin/applicability-policies/${p.id}/versions`, { method: "POST", body: { ...(active ? { fromVersionId: active.id } : {}), ...(notes ? { notes } : {}) } });
                  toast.success("Draft version created");
                  await q.refetch();
                  setVersionId(created.id);
                }}
              />
            }
          />
          <CardBody className="flex flex-wrap gap-2">
            {p.versions.map((v) => (
              <button key={v.id} onClick={() => setVersionId(v.id)} className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${v.id === selected ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                v{v.version} <span className="opacity-80">· {humanize(v.status)}</span>
              </button>
            ))}
          </CardBody>
        </Card>
      ))}
      {selected && <PolicyVersionView key={selected} id={selected} onChanged={() => void q.refetch()} />}
    </div>
  );
}

function PolicyVersionView({ id, onChanged }: { id: string; onChanged: () => void }) {
  const q = useQuery({ queryKey: ["admin-policy-version", id], queryFn: () => api<PolicyVersion>(`/admin/applicability-policies/versions/${id}`) });
  const [editing, setEditing] = useState(false);
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.error || !q.data) return <ErrorAlert error={q.error} />;
  const v = q.data;
  const refresh = () => {
    void q.refetch();
    onChanged();
  };
  return (
    <>
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              Version {v.version} <StatusBadge status={v.status} />
            </span>
          }
          description={`${v.rules.length} rules${v.activatedAt ? ` · activated ${formatDateTime(v.activatedAt)}` : ""}${v.notes ? ` · ${v.notes}` : ""}`}
          actions={
            v.status === "DRAFT" && (
              <>
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                  Edit rules
                </Button>
                <ActionDialog
                  trigger={<Button size="sm">Activate</Button>}
                  title={`Activate version ${v.version}`}
                  description="New checklists will use this version. The previously active version is retired; existing projects keep their recorded version."
                  reasonLabel="Reason"
                  confirmLabel="Activate"
                  onConfirm={async (reason) => {
                    await api(`/admin/applicability-policies/versions/${v.id}/activate`, { method: "POST", body: { reason } });
                    toast.success("Policy version activated");
                    refresh();
                  }}
                />
              </>
            )
          }
        />
        <div className="max-h-[480px] overflow-y-auto">
          <Table>
            <THead>
              <tr>
                <TH>Document</TH>
                <TH>Outcome</TH>
                <TH>Priority</TH>
                <TH>Condition</TH>
                <TH>Reason</TH>
                <TH>Due</TH>
                <TH>Assignee</TH>
              </tr>
            </THead>
            <TBody>
              {v.rules.map((r) => (
                <TR key={r.id}>
                  <TD className="text-xs">
                    <span className="font-mono">{r.documentType.code}</span> {r.documentType.name}
                  </TD>
                  <TD>
                    <StatusBadge status={r.outcome} />
                  </TD>
                  <TD>{r.priority}</TD>
                  <TD className="max-w-xs font-mono text-[11px]">{describeCondition(r.conditions)}</TD>
                  <TD className="max-w-xs text-xs">{r.reason}</TD>
                  <TD className="text-xs">{r.dueOffsetDays != null ? `+${r.dueOffsetDays}d` : "-"}</TD>
                  <TD className="text-xs">{r.defaultAssigneeRoleKey ? humanize(r.defaultAssigneeRoleKey) : "-"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      </Card>
      <EvaluateSandbox version={v} />
      {editing && <RulesEditor version={v} onClose={() => setEditing(false)} onDone={refresh} />}
    </>
  );
}

function RulesEditor({ version, onClose, onDone }: { version: PolicyVersion; onClose: () => void; onDone: () => void }) {
  const initial = version.rules.map((r) => ({ documentTypeCode: r.documentType.code, outcome: r.outcome, priority: r.priority, conditions: r.conditions ?? {}, reason: r.reason, ...(r.dueOffsetDays != null ? { dueOffsetDays: r.dueOffsetDays } : {}), ...(r.defaultAssigneeRoleKey ? { defaultAssigneeRoleKey: r.defaultAssigneeRoleKey } : {}) }));
  const [text, setText] = useState(JSON.stringify(initial, null, 2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function save() {
    setError(null);
    let rules: unknown;
    try {
      rules = JSON.parse(text);
      if (!Array.isArray(rules)) throw new Error("not an array");
    } catch {
      setError(new Error("The rules must be a JSON array"));
      return;
    }
    setBusy(true);
    try {
      await api(`/admin/applicability-policies/versions/${version.id}/rules`, { method: "PUT", body: { rules } });
      toast.success("Rules saved");
      onDone();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Rules of draft version ${version.version}`} description={`Each rule: documentTypeCode, outcome (REQUIRED | CONDITIONAL | NOT_APPLICABLE), priority, conditions ({} = always; {field, op: eq|neq|in|nin|gte|lte, value}; {all: [...]}, {any: [...]}, {not: ...}), reason, dueOffsetDays, defaultAssigneeRoleKey. Fields: ${Object.keys(version.contextFields).join(", ")}.`} wide>
        {error ? <ErrorAlert error={error} /> : null}
        {error instanceof ApiError && error.problems.length > 0 && (
          <ul className="list-disc pl-5 text-xs text-destructive">
            {error.problems.slice(0, 15).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <Textarea className="font-mono text-xs" rows={22} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="Rules JSON" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={save}>
            Save rules
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EvaluateSandbox({ version }: { version: PolicyVersion }) {
  const fields = Object.entries(version.contextFields);
  const [ctx, setCtx] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(([k, f]) => [k, f.type === "boolean" ? "false" : (f.values?.[0] ?? "")])));
  const [result, setResult] = useState<{ documentTypeCode: string; level: string; reason: string }[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    setError(null);
    try {
      const context = Object.fromEntries(fields.map(([k, f]) => [k, f.type === "boolean" ? ctx[k] === "true" : ctx[k]]));
      const r = await api<{ requirements: { documentTypeCode: string; level: string; reason: string }[] }>("/admin/applicability-policies/evaluate", { method: "POST", body: { versionId: version.id, context } });
      setResult(r.requirements);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader title="Test this version" description="Evaluate the rules for a hypothetical project before activating a draft." />
      <CardBody className="space-y-3">
        {error ? <ErrorAlert error={error} /> : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {fields.map(([k, f]) => (
            <Field key={k} label={f.label} htmlFor={`ev-${k}`}>
              <Select id={`ev-${k}`} value={ctx[k]} onChange={(e) => setCtx({ ...ctx, [k]: e.target.value })} options={f.type === "boolean" ? [{ value: "false", label: "No" }, { value: "true", label: "Yes" }] : (f.values ?? []).map((x) => ({ value: x, label: humanize(x) }))} />
            </Field>
          ))}
        </div>
        <Button variant="outline" loading={busy} onClick={run}>
          Evaluate
        </Button>
        {result && (
          <Table>
            <THead>
              <tr>
                <TH>Document</TH>
                <TH>Level</TH>
                <TH>Reason</TH>
              </tr>
            </THead>
            <TBody>
              {result.map((r) => (
                <TR key={r.documentTypeCode}>
                  <TD className="font-mono text-xs">{r.documentTypeCode}</TD>
                  <TD>
                    <StatusBadge status={r.level} />
                  </TD>
                  <TD className="text-xs">{r.reason}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}
