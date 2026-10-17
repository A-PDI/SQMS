"use client";
import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "../qms/App";
import Layout from "../qms/components/Layout";
import { ToastProvider } from "../qms/contexts/ToastContext";
import { hydrateSession, presentUser } from "../qms/lib/api";
import { setSession } from "../qms/lib/auth";
import { setCsrfToken } from "../lib/api";
import { useSession } from "../lib/session";

const originalPaths =
  /^(\/$|\/login$|\/my-inspections$|\/inspections(?:\/|$)|\/ncrs(?:\/|$)|\/quality-alerts$|\/drawings$|\/reports$|\/admin$|\/injector-tests$|\/injector-reports$)/;
function Boundary({ children, shell = false }) {
  function click(e) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    const anchor = e.target.closest("a[href]");
    if (!anchor || anchor.target || anchor.download) return;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    if (shell || !originalPaths.test(url.pathname)) {
      e.preventDefault();
      e.stopPropagation();
      window.location.assign(url.href);
    }
  }
  return (
    <div className="contents" onClickCapture={click}>
      {children}
    </div>
  );
}
export default function Application() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 0,
            refetchOnWindowFocus: true,
            retry: 1,
          },
        },
      }),
  );
  useEffect(() => {
    let active = true;
    hydrateSession()
      .catch((err) => {
        if (err.response?.status !== 401 && active)
          setError("Unable to reach the server. Please try again.");
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);
  if (!ready) return null;
  if (error) return <div className="p-6 text-red-700">{error}</div>;
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <Boundary>
          <App />
        </Boundary>
      </ToastProvider>
    </QueryClientProvider>
  );
}
function ShellRouteBridge() {
  const location = useLocation();
  useEffect(() => {
    if (originalPaths.test(location.pathname))
      window.location.assign(
        location.pathname + location.search + location.hash,
      );
  }, [location]);
  return null;
}
export function QmsShell({ children }) {
  const { me } = useSession();
  setSession(presentUser(me), me.csrfToken);
  setCsrfToken(me.csrfToken);
  return (
    <ToastProvider>
      <Boundary shell>
        <BrowserRouter>
          <ShellRouteBridge />
          <Routes>
            <Route element={<Layout />}>
              <Route path="*" element={children} />
            </Route>
          </Routes>
        </BrowserRouter>
      </Boundary>
    </ToastProvider>
  );
}
