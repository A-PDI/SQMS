"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, ErrorAlert } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/password-reset/request", { method: "POST", body: { email } });
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h2 className="text-base font-semibold">Reset your password</h2>
      {sent ? (
        <Alert tone="success">If an active account exists for {email}, a reset link has been sent. The link is valid for one hour.</Alert>
      ) : (
        <>
          {error ? <ErrorAlert error={error} /> : null}
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </Field>
          <Button type="submit" className="w-full" loading={busy}>
            Send reset link
          </Button>
        </>
      )}
      <div className="text-center text-xs">
        <Link href="/login" className="text-accent hover:underline">
          Back to sign in
        </Link>
      </div>
    </form>
  );
}
