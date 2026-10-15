"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { api, ApiError, setCsrfToken } from "./api";
import { setUserTimeZone } from "./format";

export interface Branding {
  companyName?: string;
  productName?: string;
  shortName?: string;
  primaryColor?: string;
  accentColor?: string;
  logoFileId?: string | null;
}

export interface Me {
  id: string;
  email: string;
  displayName: string;
  timezone: string;
  jobTitle: string | null;
  phone?: string | null;
  lastLoginAt?: string | null;
  userType: "INTERNAL" | "EXTERNAL";
  organization: { id: string; name: string; type: "INTERNAL" | "SUPPLIER" };
  supplierId: string | null;
  roles: string[];
  permissions: string[];
  csrfToken: string;
  features: { supplierPortal: boolean };
  branding: Branding;
}

interface SessionValue {
  me: Me;
  can: (...permissions: string[]) => boolean;
  canAny: (...permissions: string[]) => boolean;
  isInternal: boolean;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useMeQuery() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const me = await api<Me>("/auth/me");
      setCsrfToken(me.csrfToken);
      setUserTimeZone(me.timezone);
      return me;
    },
    retry: (count, err) => !(err instanceof ApiError && err.status === 401) && count < 2,
    staleTime: 60_000,
  });
}

export function applyBranding(b: Branding | undefined) {
  if (typeof document === "undefined" || !b) return;
  const root = document.documentElement;
  const hex = /^#[0-9a-fA-F]{6}$/;
  if (b.primaryColor && hex.test(b.primaryColor)) root.style.setProperty("--primary", b.primaryColor);
  if (b.accentColor && hex.test(b.accentColor)) {
    root.style.setProperty("--accent", b.accentColor);
    root.style.setProperty("--ring", b.accentColor);
  }
}

/** Requires an authenticated session for everything below it; redirects to the login page otherwise. */
export function SessionProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const { data: me, error, isLoading } = useMeQuery();

  useEffect(() => {
    const onUnauthorized = () => {
      qc.clear();
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    };
    window.addEventListener("sqms:unauthorized", onUnauthorized);
    return () => window.removeEventListener("sqms:unauthorized", onUnauthorized);
  }, [qc, router, pathname]);

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [error, router, pathname]);

  useEffect(() => applyBranding(me?.branding), [me?.branding]);

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      setCsrfToken(null);
      qc.clear();
      router.replace("/login");
    }
  }, [qc, router]);

  const value = useMemo<SessionValue | null>(() => {
    if (!me) return null;
    const perms = new Set(me.permissions);
    return {
      me,
      can: (...p) => p.every((x) => perms.has(x)),
      canAny: (...p) => p.some((x) => perms.has(x)),
      isInternal: me.userType === "INTERNAL",
      logout,
    };
  }, [me, logout]);

  if (isLoading || !value) {
    if (error && !(error instanceof ApiError && error.status === 401)) {
      return (
        <div className="flex min-h-screen items-center justify-center p-6 text-center">
          <div>
            <p className="text-base font-medium">Unable to load your session.</p>
            <p className="mt-1 text-muted-foreground">{error instanceof Error ? error.message : "Please try again."}</p>
          </div>
        </div>
      );
    }
    return <>{fallback}</>;
  }
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error("useSession must be used inside SessionProvider");
  return v;
}
