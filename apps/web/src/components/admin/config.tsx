"use client";

import { useQuery } from "@tanstack/react-query";
import { humanize, validateSetting, isSettingKey } from "@sqms/shared";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { FormDialog } from "@/components/forms/schema-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { ErrorAlert, Skeleton } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useRoles, type RoleRow } from "./users";

// ------------------------------------------------------------------ roles & permissions

export function RolesPanel() {
  const roles = useRoles();
  const perms = useQuery({ queryKey: ["admin-permissions"], queryFn: () => api<{ key: string; description: string; externalAllowed: boolean }[]>("/admin/permissions") });
  const [editing, setEditing] = useState<RoleRow | "new" | null>(null);
  if (roles.isLoading || perms.isLoading) return <Skeleton className="h-40" />;
  if (roles.error || perms.error) return <ErrorAlert error={roles.error ?? perms.error} />;
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <Plus /> New role
        </Button>
      </div>
      <Card>
        <Table>
          <THead>
            <tr>
              <TH>Role</TH>
              <TH>Scope</TH>
              <TH>Members</TH>
              <TH>Permissions</TH>
              <TH />
            </tr>
          </THead>
          <TBody>
            {roles.data!.map((r) => (
              <TR key={r.id}>
                <TD className="min-w-48">
                  <span className="font-medium">{r.name}</span> {r.isSystem && <Badge tone="muted">System</Badge>}
                  <div className="font-mono text-[11px] text-muted-foreground">{r.key}</div>
                  {r.description && <div className="text-xs text-muted-foreground">{r.description}</div>}
                </TD>
                <TD>{r.scope === "INTERNAL" ? "Internal" : "Supplier"}</TD>
                <TD>{r.memberCount}</TD>
                <TD className="max-w-xl">
                  <span className="flex flex-wrap gap-1">
                    {r.permissions.map((p) => (
                      <Badge key={p} tone="muted" className="font-mono">
                        {p}
                      </Badge>
                    ))}
                  </span>
                </TD>
                <TD>
                  <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                    Permissions
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
      {editing && <RoleDialog role={editing === "new" ? null : editing} permissions={perms.data!} onClose={() => setEditing(null)} onDone={() => void roles.refetch()} />}
    </div>
  );
}

function RoleDialog({ role, permissions, onClose, onDone }: { role: RoleRow | null; permissions: { key: string; description: string; externalAllowed: boolean }[]; onClose: () => void; onDone: () => void }) {
  const [scope, setScope] = useState<"INTERNAL" | "EXTERNAL">(role?.scope ?? "INTERNAL");
  const [selected, setSelected] = useState<string[]>(role?.permissions ?? []);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const allowed = permissions.filter((p) => scope === "INTERNAL" || p.externalAllowed);
  const groups = useMemo(() => [...new Set(allowed.map((p) => p.key.split(":")[0]))], [allowed]);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const keys = selected.filter((k) => allowed.some((p) => p.key === k));
      if (role) await api(`/admin/roles/${role.id}/permissions`, { method: "PUT", body: { permissionKeys: keys, reason: reason.trim() } });
      else await api("/admin/roles", { method: "POST", body: { key: key.trim(), name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}), scope, permissionKeys: keys } });
      toast.success(role ? "Permissions updated" : "Role created");
      onDone();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const valid = role ? reason.trim().length >= 5 : /^[A-Z_]{2,60}$/.test(key.trim()) && name.trim().length >= 2;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={role ? `Permissions of ${role.name}` : "New role"} description={scope === "EXTERNAL" ? "Supplier roles can only hold permissions that are safe for external users; data stays restricted to the user's own supplier." : undefined} wide>
        {error ? <ErrorAlert error={error} /> : null}
        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          {!role && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Key" required htmlFor="role-key" hint="Upper case, e.g. PURCHASING_LEAD">
                <Input id="role-key" value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} />
              </Field>
              <Field label="Name" required htmlFor="role-name">
                <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Scope" htmlFor="role-scope">
                <select id="role-scope" className="h-9 w-full rounded-md border bg-surface px-2" value={scope} onChange={(e) => setScope(e.target.value as "INTERNAL" | "EXTERNAL")}>
                  <option value="INTERNAL">Internal</option>
                  <option value="EXTERNAL">Supplier</option>
                </select>
              </Field>
              <Field label="Description" htmlFor="role-desc">
                <Input id="role-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
            </div>
          )}
          {groups.map((g) => (
            <fieldset key={g} className="rounded-md border p-3">
              <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{humanize(g.toUpperCase())}</legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {allowed
                  .filter((p) => p.key.startsWith(`${g}:`))
                  .map((p) => (
                    <label key={p.key} className="flex items-start gap-2 text-xs">
                      <Checkbox className="mt-0.5" checked={selected.includes(p.key)} onCheckedChange={(c) => setSelected(c === true ? [...selected, p.key] : selected.filter((k) => k !== p.key))} />
                      <span>
                        <span className="font-mono">{p.key}</span>
                        <span className="block text-muted-foreground">{p.description}</span>
                      </span>
                    </label>
                  ))}
              </div>
            </fieldset>
          ))}
          {role && (
            <Field label="Reason" required htmlFor="role-reason">
              <Textarea id="role-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!valid} onClick={save}>
            {role ? "Save permissions" : "Create role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ system settings

interface Setting {
  key: string;
  value: unknown;
  description: string | null;
  updatedAt: string;
}

export function SettingsPanel() {
  const q = useQuery({ queryKey: ["admin-settings"], queryFn: () => api<Setting[]>("/admin/settings") });
  const [editing, setEditing] = useState<Setting | null>(null);
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.error) return <ErrorAlert error={q.error} />;
  return (
    <>
      <Card>
        <Table>
          <THead>
            <tr>
              <TH>Setting</TH>
              <TH>Value</TH>
              <TH>Updated</TH>
              <TH />
            </tr>
          </THead>
          <TBody>
            {q.data!.map((s) => (
              <TR key={s.key}>
                <TD className="min-w-56">
                  <span className="font-mono text-xs">{s.key}</span>
                  {s.description && <div className="text-xs text-muted-foreground">{s.description}</div>}
                </TD>
                <TD className="max-w-md">
                  <pre className="whitespace-pre-wrap break-all font-mono text-[11px]">{JSON.stringify(s.value, null, typeof s.value === "object" && s.value !== null ? 1 : 0)}</pre>
                </TD>
                <TD className="text-xs">{formatDateTime(s.updatedAt)}</TD>
                <TD>
                  <Button size="sm" variant="outline" onClick={() => setEditing(s)}>
                    Edit
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
      {editing && <SettingDialog setting={editing} onClose={() => setEditing(null)} onDone={() => void q.refetch()} />}
    </>
  );
}

function SettingDialog({ setting, onClose, onDone }: { setting: Setting; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState(JSON.stringify(setting.value, null, 2));
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function save() {
    setError(null);
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      setProblems(["The value is not valid JSON"]);
      return;
    }
    if (isSettingKey(setting.key)) {
      const check = validateSetting(setting.key, value);
      if (!check.ok) {
        setProblems(check.issues);
        return;
      }
    }
    setProblems([]);
    setBusy(true);
    try {
      await api(`/admin/settings/${encodeURIComponent(setting.key)}`, { method: "PUT", body: { value } });
      toast.success("Setting saved");
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
      <DialogContent title={setting.key} description={setting.description ?? undefined} wide>
        {error ? <ErrorAlert error={error} /> : null}
        <Field label="Value (JSON)" htmlFor="setting-json" error={problems.join("; ") || undefined}>
          <Textarea id="setting-json" className="font-mono text-xs" rows={12} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={save}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface NumberingRow {
  key: string;
  prefix: string;
  pattern: string;
  padding: number;
  nextValue: number;
  resetPolicy: string;
  currentPeriod: string | null;
}

export function NumberingPanel() {
  const q = useQuery({ queryKey: ["admin-numbering"], queryFn: () => api<NumberingRow[]>("/admin/numbering") });
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.error) return <ErrorAlert error={q.error} />;
  return (
    <Card>
      <CardHeader title="Record numbering" description="Prefixes and patterns for new record numbers. Existing numbers never change; sequences are not reset here." />
      <Table>
        <THead>
          <tr>
            <TH>Record</TH>
            <TH>Prefix</TH>
            <TH>Pattern</TH>
            <TH>Padding</TH>
            <TH>Next</TH>
            <TH>Reset</TH>
            <TH />
          </tr>
        </THead>
        <TBody>
          {q.data!.map((n) => (
            <TR key={n.key}>
              <TD>{humanize(n.key)}</TD>
              <TD className="font-mono text-xs">{n.prefix}</TD>
              <TD className="font-mono text-xs">{n.pattern}</TD>
              <TD>{n.padding}</TD>
              <TD>{n.nextValue}</TD>
              <TD className="text-xs">
                {humanize(n.resetPolicy)}
                {n.currentPeriod && ` (${n.currentPeriod})`}
              </TD>
              <TD>
                <FormDialog
                  trigger={<Button size="sm" variant="outline">Edit</Button>}
                  title={`Numbering for ${humanize(n.key)}`}
                  fields={[
                    { name: "prefix", label: "Prefix", required: true, pattern: { regex: /^[A-Z0-9]{1,10}$/, message: "1-10 upper-case letters or digits" } },
                    { name: "pattern", label: "Pattern", required: true, maxLength: 60, hint: "Tokens: {prefix}, {yyyy}, {seq}" },
                    { name: "padding", label: "Sequence padding", type: "number", integer: true, min: 1, max: 10 },
                  ]}
                  defaultValues={n as unknown as Record<string, unknown>}
                  onSubmit={async (payload) => {
                    await api(`/admin/numbering/${n.key}`, { method: "PATCH", body: payload });
                    toast.success("Numbering updated");
                    void q.refetch();
                  }}
                />
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}

interface FileTypeRow {
  id: string;
  extension: string;
  label: string;
  category: string;
  mimeTypes: string[];
  maxSizeMb: number | null;
  previewable: boolean;
  enabled: boolean;
}

export function FileTypesPanel() {
  const q = useQuery({ queryKey: ["admin-file-types"], queryFn: () => api<FileTypeRow[]>("/admin/file-types") });
  async function toggle(f: FileTypeRow) {
    try {
      await api(`/admin/file-types/${f.id}`, { method: "PATCH", body: { enabled: !f.enabled } });
      toast.success(`.${f.extension} ${f.enabled ? "disabled" : "enabled"}`);
      void q.refetch();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.error) return <ErrorAlert error={q.error} />;
  return (
    <Card>
      <CardHeader title="Allowed file types" description="Uploads are checked by extension, declared type and file signature, then scanned for malware. Executables and scripts can never be enabled." />
      <Table>
        <THead>
          <tr>
            <TH>Extension</TH>
            <TH>Type</TH>
            <TH>Category</TH>
            <TH>Max size</TH>
            <TH>Preview</TH>
            <TH>Enabled</TH>
            <TH />
          </tr>
        </THead>
        <TBody>
          {q.data!.map((f) => (
            <TR key={f.id}>
              <TD className="font-mono text-xs">.{f.extension}</TD>
              <TD className="text-xs">
                {f.label}
                <div className="text-muted-foreground">{f.mimeTypes.join(", ")}</div>
              </TD>
              <TD>{humanize(f.category)}</TD>
              <TD>{f.maxSizeMb ? `${f.maxSizeMb} MB` : "Default"}</TD>
              <TD>{f.previewable ? "Yes" : "No"}</TD>
              <TD>
                <Checkbox checked={f.enabled} onCheckedChange={() => void toggle(f)} aria-label={`Allow .${f.extension}`} />
              </TD>
              <TD>
                <FormDialog
                  trigger={<Button size="sm" variant="outline">Limit</Button>}
                  title={`Size limit for .${f.extension}`}
                  fields={[{ name: "maxSizeMb", label: "Maximum size (MB)", type: "number", integer: true, min: 1, max: 2048, hint: "Leave empty to use the global limit." }]}
                  defaultValues={f as unknown as Record<string, unknown>}
                  onSubmit={async (payload) => {
                    await api(`/admin/file-types/${f.id}`, { method: "PATCH", body: { maxSizeMb: payload.maxSizeMb ?? null } });
                    toast.success("Limit updated");
                    void q.refetch();
                  }}
                />
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}

interface RetentionRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  trigger: string;
  retentionMonths: number | null;
  dispositionAction: string | null;
  isActive: boolean;
  documentTypes: { code: string; name: string }[];
}

export function RetentionPanel() {
  const q = useQuery({ queryKey: ["admin-retention"], queryFn: () => api<RetentionRow[]>("/admin/retention-policies") });
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.error) return <ErrorAlert error={q.error} />;
  return (
    <Card>
      <CardHeader title="Retention policies" description="Retention periods are set by your records management and legal teams; none are assumed by the system. Policies without a period are retained indefinitely until configured." />
      <CardBody className="p-0">
        <Table>
          <THead>
            <tr>
              <TH>Policy</TH>
              <TH>Trigger</TH>
              <TH>Period</TH>
              <TH>Disposition</TH>
              <TH>Document types</TH>
              <TH />
            </tr>
          </THead>
          <TBody>
            {q.data!.map((r) => (
              <TR key={r.id}>
                <TD className="min-w-48">
                  <span className="font-medium">{r.name}</span>
                  <div className="font-mono text-[11px] text-muted-foreground">{r.code}</div>
                  {r.description && <div className="text-xs text-muted-foreground">{r.description}</div>}
                </TD>
                <TD className="text-xs">{humanize(r.trigger)}</TD>
                <TD>{r.retentionMonths ? `${r.retentionMonths} months` : <span className="text-xs text-warning">Not configured</span>}</TD>
                <TD className="text-xs">{r.dispositionAction ?? "-"}</TD>
                <TD className="text-xs">{r.documentTypes.map((t) => t.code).join(", ")}</TD>
                <TD>
                  <FormDialog
                    trigger={<Button size="sm" variant="outline">Configure</Button>}
                    title={r.name}
                    fields={[
                      { name: "trigger", label: "Retention starts", type: "select", options: ["FROM_CREATION", "FROM_RELEASE", "FROM_SUPERSESSION", "FROM_CLOSURE", "UNDEFINED"].map((v) => ({ value: v, label: humanize(v) })) },
                      { name: "retentionMonths", label: "Retention period (months)", type: "number", integer: true, min: 1, max: 1200 },
                      { name: "dispositionAction", label: "Disposition action", nullable: true, maxLength: 120 },
                      { name: "description", label: "Description", type: "textarea", nullable: true, maxLength: 5000 },
                      { name: "reason", label: "Reason for change", type: "textarea", required: true, minLength: 5, maxLength: 500 },
                    ]}
                    defaultValues={{ ...r, reason: "" } as unknown as Record<string, unknown>}
                    onSubmit={async (payload) => {
                      await api(`/admin/retention-policies/${r.id}`, { method: "PATCH", body: { ...payload, retentionMonths: payload.retentionMonths ?? null } });
                      toast.success("Retention policy updated");
                      void q.refetch();
                    }}
                  />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardBody>
    </Card>
  );
}
