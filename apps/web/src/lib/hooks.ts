"use client";

import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage } from "./api";

/** Mutation with success toast and cache invalidation; errors are surfaced to the caller and toasted. */
export function useApiMutation<TVars = void, TResult = unknown>(fn: (vars: TVars) => Promise<TResult>, opts: { invalidate?: QueryKey[]; success?: string | ((r: TResult) => string); onSuccess?: (r: TResult, vars: TVars) => void; silentError?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r, vars) => {
      if (opts.success) toast.success(typeof opts.success === "function" ? opts.success(r) : opts.success);
      await Promise.all((opts.invalidate ?? []).map((k) => qc.invalidateQueries({ queryKey: k })));
      opts.onSuccess?.(r, vars);
    },
    onError: (e) => {
      if (!opts.silentError) toast.error(errorMessage(e));
    },
  });
}
