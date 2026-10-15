"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Alert, ErrorAlert } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError(new Error("The passwords do not match"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/auth/password-reset/confirm", { method: "POST", body: { token, newPassword: password } });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!token) return <Alert tone="danger">This reset link is incomplete. Request a new one.</Alert>;
  if (done)
    return (
      <div className="space-y-3">
        <Alert tone="success">Your password was changed. All existing sessions were signed out.</Alert>
        <Button asChild className="w-full">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    );
  return (
    <form onSubmit={submit} className="space-y-4">
      <h2 className="text-base font-semibold">Choose a new password</h2>
      {error ? <ErrorAlert error={error} /> : null}
      <Field label="New password" htmlFor="pw" hint="At least 12 characters; avoid common or reused passwords.">
        <Input id="pw" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="Confirm password" htmlFor="pw2">
        <Input id="pw2" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      <Button type="submit" className="w-full" loading={busy}>
        Set password
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
