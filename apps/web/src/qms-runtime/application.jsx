"use client";
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "../qms/App";
import { ToastProvider } from "../qms/contexts/ToastContext";
import { hydrateSession } from "../qms/lib/api";

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
        <App />
      </ToastProvider>
    </QueryClientProvider>
  );
}
