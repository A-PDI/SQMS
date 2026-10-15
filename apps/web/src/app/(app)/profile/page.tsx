"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { humanize } from "@sqms/shared";
import { useState } from "react";
import { toast } from "sonner";
import { DetailGrid } from "@/components/common/detail-grid";
import { SchemaForm } from "@/components/forms/schema-form";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ErrorAlert } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useSession } from "@/lib/session";

interface SessionRow {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  current: boolean;
}

/** IANA time zones supported by the browser (falls back to a short list on older engines). */
function timeZones(): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (fn) return ["UTC", ...fn("timeZone").filter((z) => z !== "UTC")];
  } catch {
    /* fall through */
  }
  return ["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Mexico_City", "Europe/London", "Europe/Berlin", "Europe/Stockholm", "Asia/Shanghai", "Asia/Kolkata"];
}

export default function ProfilePage() {
  const { me } = useSession();
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => api<SessionRow[]>("/auth/sessions") });
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [pwError, setPwError] = useState<unknown>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const zones = timeZones();

  async function changePassword() {
    setPwError(null);
    if (pw.newPassword.length < 12) return setPwError(new Error("The new password must be at least 12 characters"));
    if (pw.newPassword !== pw.confirm) return setPwError(new Error("The new passwords do not match"));
    setPwBusy(true);
    try {
      await api("/auth/password/change", { method: "POST", body: { currentPassword: pw.currentPassword, newPassword: pw.newPassword } });
      toast.success("Password changed; other sessions were signed out");
      setPw({ currentPassword: "", newPassword: "", confirm: "" });
      void sessions.refetch();
    } catch (e) {
      setPwError(e);
    } finally {
      setPwBusy(false);
    }
  }
  async function revoke(path: string, msg: string) {
    try {
      await api(path, { method: path.endsWith("revoke-others") ? "POST" : "DELETE" });
      toast.success(msg);
      void sessions.refetch();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader title="My profile" description={me.email} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Profile" />
          <CardBody className="space-y-4">
            <DetailGrid
              columns={2}
              items={[
                { label: "Organization", value: me.organization.name },
                { label: "Account type", value: humanize(me.userType) },
                { label: "Roles", value: <span className="flex flex-wrap gap-1">{me.roles.map((r) => <Badge key={r}>{humanize(r)}</Badge>)}</span> },
                { label: "Last sign-in", value: formatDateTime(me.lastLoginAt) },
              ]}
            />
            <SchemaForm
              columns={2}
              fields={[
                { name: "displayName", label: "Display name", required: true, maxLength: 160 },
                { name: "jobTitle", label: "Job title", maxLength: 120 },
                { name: "phone", label: "Phone", maxLength: 40 },
                { name: "timezone", label: "Time zone", type: "select", required: true, options: zones.map((z) => ({ value: z, label: z })), hint: "Dates and times are shown in this zone." },
              ]}
              defaultValues={me as unknown as Record<string, unknown>}
              submitLabel="Save profile"
              onSubmit={async (payload) => {
                await api("/auth/me", { method: "PATCH", body: payload });
                await qc.invalidateQueries({ queryKey: ["me"] });
                toast.success("Profile saved");
              }}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Change password" description="At least 12 characters. Changing the password signs out your other sessions." />
          <CardBody className="space-y-3">
            {pwError ? <ErrorAlert error={pwError} /> : null}
            <Field label="Current password" htmlFor="pw-cur">
              <Input id="pw-cur" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
            </Field>
            <Field label="New password" htmlFor="pw-new">
              <Input id="pw-new" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
            </Field>
            <Field label="Confirm new password" htmlFor="pw-conf">
              <Input id="pw-conf" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            </Field>
            <div className="flex justify-end">
              <Button loading={pwBusy} disabled={!pw.currentPassword || !pw.newPassword} onClick={changePassword}>
                Change password
              </Button>
            </div>
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader
            title="Active sessions"
            description="Sessions expire after inactivity and after an absolute lifetime."
            actions={
              <Button size="sm" variant="outline" onClick={() => void revoke("/auth/sessions/revoke-others", "Other sessions signed out")}>
                Sign out other sessions
              </Button>
            }
          />
          {sessions.error ? <ErrorAlert error={sessions.error} className="m-4" /> : null}
          <Table>
            <THead>
              <tr>
                <TH>Device</TH>
                <TH>IP address</TH>
                <TH>Signed in</TH>
                <TH>Last active</TH>
                <TH>Expires</TH>
                <TH />
              </tr>
            </THead>
            <TBody>
              {sessions.data?.map((s) => (
                <TR key={s.id}>
                  <TD className="max-w-xs truncate text-xs" title={s.userAgent ?? ""}>
                    {s.userAgent ?? "-"} {s.current && <Badge tone="success">This session</Badge>}
                  </TD>
                  <TD className="font-mono text-xs">{s.ipAddress ?? "-"}</TD>
                  <TD className="text-xs">{formatDateTime(s.createdAt)}</TD>
                  <TD className="text-xs">{formatDateTime(s.lastSeenAt)}</TD>
                  <TD className="text-xs">{formatDateTime(s.idleExpiresAt < s.absoluteExpiresAt ? s.idleExpiresAt : s.absoluteExpiresAt)}</TD>
                  <TD className="text-right">
                    {!s.current && (
                      <Button size="sm" variant="ghost" onClick={() => void revoke(`/auth/sessions/${s.id}`, "Session signed out")}>
                        Sign out
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      </div>
    </>
  );
}
