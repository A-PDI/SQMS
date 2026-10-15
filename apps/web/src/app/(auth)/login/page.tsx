"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { ErrorAlert } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api, setCsrfToken } from "@/lib/api";

const schema = z.object({ email: z.email("Enter a valid email address"), password: z.string().min(1, "Enter your password") });
type Values = z.infer<typeof schema>;

/** Only same-site relative paths are accepted as post-login destinations. */
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : "/";
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await api<{ csrfToken: string }>("/auth/login", { method: "POST", body: values });
      setCsrfToken(res.csrfToken);
      await qc.invalidateQueries({ queryKey: ["me"] });
      router.replace(safeNext(params.get("next")));
    } catch (err) {
      setError(err);
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <h2 className="text-base font-semibold">Sign in</h2>
      {error ? <ErrorAlert error={error} /> : null}
      <Field label="Email" htmlFor="email" error={formState.errors.email?.message}>
        <Input id="email" type="email" autoComplete="username" autoFocus {...register("email")} aria-invalid={!!formState.errors.email} />
      </Field>
      <Field label="Password" htmlFor="password" error={formState.errors.password?.message}>
        <Input id="password" type="password" autoComplete="current-password" {...register("password")} aria-invalid={!!formState.errors.password} />
      </Field>
      <Button type="submit" className="w-full" loading={formState.isSubmitting}>
        Sign in
      </Button>
      <div className="text-center text-xs">
        <Link href="/forgot-password" className="text-accent hover:underline">
          Forgot your password?
        </Link>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
