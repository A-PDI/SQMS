"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { humanize } from "@sqms/shared";
import { KeyRound, LogOut, Plus, ShieldCheck, Unlock, UserCog } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ActionDialog } from "@/components/common/action-dialog";
import { DataTable } from "@/components/data/data-table";
import { AsyncPicker, type PickerItem } from "@/components/forms/async-picker";
import { FormDialog } from "@/components/forms/schema-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { ErrorAlert } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useSession } from "@/lib/session";

export interface RoleRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  scope: "INTERNAL" | "EXTERNAL";
  isSystem: boolean;
  memberCount: number;
  permissions: string[];
}
interface UserRow {
  id: string;
  email: string;
  displayName: string;
  userType: "INTERNAL" | "EXTERNAL";
  status: string;
  jobTitle: string | null;
  department: string | null;
  phone: string | null;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  failedLoginCount: number;
  mfaRequired: boolean;
  disabledReason: string | null;
  memberships: { id: string; status: string; organization: { id: string; name: string; type: string }; roles: { role: { id: string; key: string; name: string; scope: string } }[] }[];
}

export function useRoles() {
  return useQuery({ queryKey: ["admin-roles"], queryFn: () => api<RoleRow[]>("/admin/roles") });
}

export function UsersPanel() {
  const qc = useQueryClient();
  const roles = useRoles();
  const [rolesFor, setRolesFor] = useState<UserRow | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["admin-users"] });
  const roleOptions = (roles.data ?? []).map((r) => ({ value: r.key, label: r.name }));
  const act = async (path: string, body: Record<string, unknown>, msg: string) => {
    await api(path, { method: "POST", body });
    toast.success(msg);
    refresh();
  };
  return (
    <>
      <DataTable<UserRow>
        endpoint="/admin/users"
        queryKey="admin-users"
        syncUrl={false}
        searchPlaceholder="Name or email"
        filters={[
          { key: "userType", label: "Type", options: [{ value: "INTERNAL", label: "Internal" }, { value: "EXTERNAL", label: "Supplier" }] },
          { key: "status", label: "Status", options: ["INVITED", "ACTIVE", "DISABLED"].map((s) => ({ value: s, label: humanize(s) })) },
          { key: "roleKey", label: "Role", options: roleOptions },
        ]}
        toolbar={<div className="flex gap-2"><CreateLocalUser roles={roles.data ?? []} /><InviteUser roles={roles.data ?? []} /></div>}
        columns={[
          {
            key: "name",
            header: "User",
            cell: (u) => (
              <div>
                <span className="font-medium">{u.displayName}</span>
                <div className="text-xs text-muted-foreground">{u.email}</div>
              </div>
            ),
          },
          { key: "org", header: "Organization", cell: (u) => <span className="text-xs">{u.memberships.map((m) => m.organization.name).join(", ") || "-"}</span> },
          {
            key: "roles",
            header: "Roles",
            cell: (u) => (
              <span className="flex flex-wrap gap-1">
                {u.memberships.flatMap((m) => m.roles.map((r) => <Badge key={`${m.id}-${r.role.key}`}>{r.role.name}</Badge>))}
              </span>
            ),
          },
          {
            key: "status",
            header: "Status",
            cell: (u) => (
              <span className="flex flex-wrap items-center gap-1">
                <StatusBadge status={u.status} />
                {u.lockedUntil && new Date(u.lockedUntil) > new Date() && <Badge tone="danger">Locked</Badge>}
                {u.mfaRequired && <Badge tone="info">MFA</Badge>}
              </span>
            ),
          },
          { key: "login", header: "Last sign-in", cell: (u) => <span className="text-xs">{formatDateTime(u.lastLoginAt)}</span> },
          {
            key: "actions",
            header: "",
            cell: (u) => (
              <span className="flex justify-end gap-0.5">
                <FormDialog
                  trigger={
                    <Button size="icon" variant="ghost" aria-label={`Edit ${u.displayName}`}>
                      <UserCog />
                    </Button>
                  }
                  title={`Edit ${u.displayName}`}
                  fields={[
                    { name: "displayName", label: "Display name", required: true, minLength: 2, maxLength: 160 },
                    { name: "jobTitle", label: "Job title", nullable: true, maxLength: 120 },
                    { name: "department", label: "Department", nullable: true, maxLength: 120 },
                    { name: "phone", label: "Phone", nullable: true, maxLength: 40 },
                  ]}
                  defaultValues={u as unknown as Record<string, unknown>}
                  onSubmit={async (payload) => {
                    await api(`/admin/users/${u.id}`, { method: "PATCH", body: payload });
                    toast.success("User updated");
                    refresh();
                  }}
                />
                <Button size="icon" variant="ghost" aria-label={`Roles of ${u.displayName}`} onClick={() => setRolesFor(u)}>
                  <ShieldCheck />
                </Button>
                {u.lockedUntil && new Date(u.lockedUntil) > new Date() && (
                  <ActionDialog trigger={<Button size="icon" variant="ghost" aria-label="Unlock account"><Unlock /></Button>} title={`Unlock ${u.displayName}`} confirmLabel="Unlock" onConfirm={() => act(`/admin/users/${u.id}/unlock`, {}, "Account unlocked")} />
                )}
                <ActionDialog trigger={<Button size="icon" variant="ghost" aria-label="Sign out all sessions"><LogOut /></Button>} title={`Sign out ${u.displayName} everywhere`} confirmLabel="Revoke sessions" onConfirm={() => act(`/admin/users/${u.id}/revoke-sessions`, {}, "Sessions revoked")} />
                {u.status !== "INVITED" && (
                  <ActionDialog
                    trigger={<Button size="icon" variant="ghost" aria-label={u.status === "ACTIVE" ? "Disable user" : "Enable user"}><KeyRound /></Button>}
                    title={u.status === "ACTIVE" ? `Disable ${u.displayName}` : `Enable ${u.displayName}`}
                    description={u.status === "ACTIVE" ? "The user is signed out and can no longer sign in. Records and history are kept." : undefined}
                    reasonLabel="Reason"
                    confirmVariant={u.status === "ACTIVE" ? "destructive" : "default"}
                    confirmLabel={u.status === "ACTIVE" ? "Disable" : "Enable"}
                    onConfirm={(reason) => act(`/admin/users/${u.id}/status`, { status: u.status === "ACTIVE" ? "DISABLED" : "ACTIVE", reason }, u.status === "ACTIVE" ? "User disabled" : "User enabled")}
                  />
                )}
              </span>
            ),
          },
        ]}
      />
      {rolesFor && <UserRolesDialog user={rolesFor} roles={roles.data ?? []} onClose={() => setRolesFor(null)} onDone={refresh} />}
    </>
  );
}

function UserRolesDialog({ user, roles, onClose, onDone }: { user: UserRow; roles: RoleRow[]; onClose: () => void; onDone: () => void }) {
  const membership = user.memberships[0];
  const [selected, setSelected] = useState<string[]>(membership?.roles.map((r) => r.role.key) ?? []);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const available = roles.filter((r) => r.scope === user.userType);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/users/${user.id}/roles`, { method: "PUT", body: { ...(membership ? { organizationId: membership.organization.id } : {}), roleKeys: selected, reason: reason.trim() } });
      toast.success("Roles updated");
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
      <DialogContent title={`Roles of ${user.displayName}`} description={`${membership?.organization.name ?? ""} · ${humanize(user.userType)} user. Changes take effect on the user's next request and are audited.`}>
        {error ? <ErrorAlert error={error} /> : null}
        <div className="space-y-2">
          {available.map((r) => (
            <label key={r.key} className="flex items-start gap-2">
              <Checkbox className="mt-0.5" checked={selected.includes(r.key)} onCheckedChange={(c) => setSelected(c === true ? [...selected, r.key] : selected.filter((k) => k !== r.key))} />
              <span>
                <span className="font-medium">{r.name}</span>
                {r.description && <span className="block text-xs text-muted-foreground">{r.description}</span>}
              </span>
            </label>
          ))}
        </div>
        <Field label="Reason" required htmlFor="ur-reason" hint="At least 5 characters.">
          <Textarea id="ur-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={reason.trim().length < 5} onClick={save}>
            Save roles
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateLocalUser({ roles }: { roles: RoleRow[] }) {
  const { can } = useSession(); const qc = useQueryClient(); const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(""); const [name, setName] = useState(""); const [password, setPassword] = useState(""); const [selected, setSelected] = useState<string[]>([]); const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  if (!can("admin:users", "admin:roles")) return null;
  const create = async () => { setBusy(true); setError(null); try { await api("/admin/users/local", { method: "POST", body: { email, displayName: name, password, roleKeys: selected } }); setPassword(""); setEmail(""); setName(""); setSelected([]); setOpen(false); await qc.invalidateQueries({ queryKey: ["admin-users"] }); toast.success("Local account created"); } catch (e) { setError(e); } finally { setBusy(false); } };
  return <><Button onClick={() => setOpen(true)}>Create local account</Button><Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) setPassword(""); }}><DialogContent title="Create internal local account" description="Provision an employee account directly. Share the initial password through your established internal process."><div className="space-y-3"><Field label="Display name"><Input value={name} onChange={e => setName(e.target.value)} /></Field><Field label="Email / login"><Input type="email" value={email} onChange={e => setEmail(e.target.value)} /></Field><Field label="Initial password" hint="At least 12 characters and three character classes."><Input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></Field><fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Internal roles</legend>{roles.filter(r => r.scope === "INTERNAL").map(r => <label key={r.key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(r.key)} onChange={e => setSelected(s => e.target.checked ? [...s, r.key] : s.filter(k => k !== r.key))} />{r.name}</label>)}</fieldset><ErrorAlert error={error} /></div><DialogFooter><Button variant="outline" onClick={() => { setOpen(false); setPassword(""); }}>Cancel</Button><Button disabled={busy || !email || name.length < 2 || password.length < 12 || !selected.length} onClick={() => void create()}>Create account</Button></DialogFooter></DialogContent></Dialog></>;
}

function InviteUser({ roles }: { roles: RoleRow[] }) {
  const { me } = useSession();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"INTERNAL" | "EXTERNAL">("INTERNAL");
  const [supplier, setSupplier] = useState<PickerItem | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const portalOff = !me.features.supplierPortal;
  async function invite() {
    setBusy(true);
    setError(null);
    try {
      let organizationId: string | undefined;
      if (kind === "EXTERNAL") {
        if (!supplier) throw new Error("Select the supplier the user belongs to");
        organizationId = (await api<{ organizationId: string }>(`/suppliers/${supplier.id}`)).organizationId;
      }
      await api("/admin/invitations", { method: "POST", body: { email: email.trim(), ...(name.trim() ? { displayName: name.trim() } : {}), ...(organizationId ? { organizationId } : {}), roleKeys: selected } });
      toast.success(`Invitation sent to ${email.trim()}`);
      setOpen(false);
      setEmail("");
      setName("");
      setSelected([]);
      void qc.invalidateQueries({ queryKey: ["admin-invitations"] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus /> Invite user
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Invite user" description="The invitation link is emailed and expires; the user sets their own password.">
          {error ? <ErrorAlert error={error} /> : null}
          <div className="space-y-3">
            <Field label="Email" required htmlFor="inv-email">
              <Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Display name" htmlFor="inv-name">
              <Input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="User type" htmlFor="inv-kind" hint={kind === "EXTERNAL" && portalOff ? "Supplier logins are disabled in Phase 1; the invitation can be accepted only after the portal is enabled." : undefined}>
              <Select
                id="inv-kind"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as "INTERNAL" | "EXTERNAL");
                  setSelected([]);
                }}
                options={[
                  { value: "INTERNAL", label: "Internal employee" },
                  { value: "EXTERNAL", label: "Supplier user" },
                ]}
              />
            </Field>
            {kind === "EXTERNAL" && (
              <Field label="Supplier" required>
                <AsyncPicker<{ id: string; name: string; supplierNumber: string }> endpoint="/suppliers" value={supplier} onChange={setSupplier} map={(s) => ({ id: s.id, label: s.name, sublabel: s.supplierNumber })} />
              </Field>
            )}
            <fieldset>
              <legend className="mb-1 text-xs font-medium">Roles</legend>
              <div className="space-y-1">
                {roles
                  .filter((r) => r.scope === kind)
                  .map((r) => (
                    <label key={r.key} className="flex items-center gap-2">
                      <Checkbox checked={selected.includes(r.key)} onCheckedChange={(c) => setSelected(c === true ? [...selected, r.key] : selected.filter((k) => k !== r.key))} /> {r.name}
                    </label>
                  ))}
              </div>
            </fieldset>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={busy} disabled={!/^\S+@\S+\.\S+$/.test(email.trim()) || selected.length === 0} onClick={invite}>
              Send invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface InvitationRow {
  id: string;
  email: string;
  status: string;
  roles: { role: { key: string; name: string } }[];
  expiresAt: string;
  createdAt: string;
  organization: { name: string } | null;
  invitedBy: { displayName: string } | null;
}

export function InvitationsPanel() {
  const qc = useQueryClient();
  return (
    <DataTable<InvitationRow>
      endpoint="/admin/invitations"
      queryKey="admin-invitations"
      syncUrl={false}
      searchPlaceholder="Email"
      filters={[{ key: "status", label: "Status", options: ["PENDING", "ACCEPTED", "REVOKED", "EXPIRED"].map((s) => ({ value: s, label: humanize(s) })) }]}
      columns={[
        { key: "email", header: "Email", cell: (i) => i.email },
        { key: "org", header: "Organization", cell: (i) => i.organization?.name ?? "-" },
        { key: "roles", header: "Roles", cell: (i) => <span className="flex flex-wrap gap-1">{i.roles.map((r) => <Badge key={r.role.key}>{r.role.name}</Badge>)}</span> },
        { key: "status", header: "Status", cell: (i) => <StatusBadge status={i.status} /> },
        { key: "expires", header: "Expires", cell: (i) => <span className="text-xs">{formatDateTime(i.expiresAt)}</span> },
        { key: "by", header: "Invited by", cell: (i) => <span className="text-xs">{i.invitedBy?.displayName ?? "-"}</span> },
        {
          key: "actions",
          header: "",
          cell: (i) =>
            i.status === "PENDING" ? (
              <ActionDialog
                trigger={<Button size="sm" variant="ghost">Revoke</Button>}
                title={`Revoke invitation for ${i.email}`}
                confirmVariant="destructive"
                confirmLabel="Revoke"
                onConfirm={async () => {
                  await api(`/admin/invitations/${i.id}/revoke`, { method: "POST" });
                  toast.success("Invitation revoked");
                  void qc.invalidateQueries({ queryKey: ["admin-invitations"] });
                }}
              />
            ) : null,
        },
      ]}
    />
  );
}
