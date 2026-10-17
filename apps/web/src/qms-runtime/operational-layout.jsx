"use client";

import { useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { AppShell } from "../components/shell/app-shell";
import { PageLoading } from "../components/ui/feedback";
import { SessionProvider } from "../lib/session";
import { ToastContainer } from "../qms/components/ui/toast";
import { useToast } from "../qms/hooks/useToast";
import { setSession } from "../qms/lib/auth";
import { isOperationalPath } from "./routes";

export default function OperationalLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toasts, dismiss } = useToast();
  useEffect(() => {
    const unauthorized = () => {
      setSession(null, null);
      window.location.assign("/login");
    };
    window.addEventListener("sqms:unauthorized", unauthorized);
    return () => window.removeEventListener("sqms:unauthorized", unauthorized);
  }, []);
  function navigateTo(href) {
    if (isOperationalPath(new URL(href, window.location.origin).pathname))
      navigate(href);
    else window.location.assign(href);
  }
  return (
    <SessionProvider
      fallback={
        <div className="p-8">
          <PageLoading />
        </div>
      }
    >
      <AppShell routing={{ pathname: location.pathname, navigate: navigateTo }}>
        <Outlet />
      </AppShell>
      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </SessionProvider>
  );
}
