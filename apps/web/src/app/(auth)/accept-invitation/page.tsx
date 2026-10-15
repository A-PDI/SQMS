"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, ErrorAlert, Spinner } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

interface Invitation {
  email: string;
  displayName: string | null;
  organizationName: string;
  roles: string[];
  expiresAt: string;
}

function AcceptForm() {
  const token = useSearchParams().get("token") ?? "";
  const inv = useQuery({ queryKey: ["invitation", token], queryFn: () => api<Invitation>("/auth/invitations/lookup", { query: { token } }), enabled: !!token });
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError(new Error("The passwords do not match"));
    setBusy(true);
    setError(null);
    try {
      await api("/auth/invitations/accept", { method: "POST", body: { token, password, displayName: name || undefined } });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!token) return <Alert tone="danger">This invitation link is incomplete.</Alert>;
  if (inv.isLoading) return <Spinner />;
  if (inv.error) return <ErrorAlert error={inv.error} />;
  if (done)
    return (
      <div className="space-y-3">
        <Alert tone="success">Your account is ready.</Alert>
        <Button asChild className="w-full">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    );
  return (
    <form onSubmit={submit} className="space-y-4">
      <h2 className="text-base font-semibold">Accept invitation</h2>
      <p className="text-xs text-muted-foreground">
        {inv.data?.email} is invited to <strong>{inv.data?.organizationName}</strong> as {inv.data?.roles.join(", ")}. Expires {formatDateTime(inv.data?.expiresAt)}.
      </p>
      {error ? <ErrorAlert error={error} /> : null}
      <Field label="Your name" htmlFor="name">
        <Input id="name" value={name} placeholder={inv.data?.displayName ?? ""} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Password" htmlFor="pw" hint="At least 12 characters.">
        <Input id="pw" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="Confirm password" htmlFor="pw2">
        <Input id="pw2" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      <Button type="submit" className="w-full" loading={busy}>
        Create account
      </Button>
    </form>
  );
}

export default function AcceptInvitationPage() {
  return (
    <Suspense>
      <AcceptForm />
    </Suspense>
  );
}
