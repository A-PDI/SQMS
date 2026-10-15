"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Popover } from "radix-ui";
import { useEffect, useState } from "react";
import { inputClass } from "@/components/ui/input";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface PickerItem {
  id: string;
  label: string;
  sublabel?: string;
}

/**
 * Search-as-you-type picker over a list endpoint. `map` turns API rows into display items; the selected item is
 * kept by the caller so labels survive re-renders.
 */
export function AsyncPicker<T>({
  endpoint,
  query,
  map,
  value,
  onChange,
  placeholder = "Search...",
  disabled,
  id,
  invalid,
}: {
  endpoint: string;
  query?: Record<string, unknown>;
  map: (row: T) => PickerItem;
  value: PickerItem | null;
  onChange: (item: PickerItem | null) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term), 250);
    return () => clearTimeout(t);
  }, [term]);
  const q = useQuery({
    queryKey: ["picker", endpoint, query, debounced],
    queryFn: async () => {
      const res = await api<T[] | { items: T[] }>(endpoint, { query: { ...query, q: debounced || undefined, pageSize: 20 } });
      return (Array.isArray(res) ? res : res.items).map(map);
    },
    enabled: open,
  });

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div className="relative">
        <Popover.Trigger asChild disabled={disabled}>
          <button id={id} type="button" className={cn(inputClass, "flex items-center justify-between text-left")} aria-invalid={invalid || undefined}>
            <span className={cn("truncate", !value && "text-muted-foreground")}>{value ? `${value.label}${value.sublabel ? ` · ${value.sublabel}` : ""}` : placeholder}</span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </Popover.Trigger>
        {value && !disabled && (
          <button type="button" className="absolute right-7 top-2.5 text-muted-foreground hover:text-foreground" onClick={() => onChange(null)} aria-label="Clear selection">
            <X className="size-4" />
          </button>
        )}
      </div>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} className="z-50 w-[var(--radix-popover-trigger-width)] min-w-64 rounded-md border bg-surface p-1 shadow-lg">
          <input autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Type to search" className={cn(inputClass, "mb-1 h-8")} aria-label="Search" />
          <ul className="max-h-64 overflow-y-auto" role="listbox">
            {q.isLoading && <li className="px-2 py-1.5 text-xs text-muted-foreground">Searching...</li>}
            {q.data?.length === 0 && <li className="px-2 py-1.5 text-xs text-muted-foreground">No matches</li>}
            {q.data?.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={value?.id === item.id}
                  className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    onChange(item);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mt-0.5 size-4 shrink-0", value?.id === item.id ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-0">
                    <span className="block truncate">{item.label}</span>
                    {item.sublabel && <span className="block truncate text-xs text-muted-foreground">{item.sublabel}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export interface DirectoryUser {
  id: string;
  displayName: string;
  email: string;
  jobTitle: string | null;
  roles: string[];
}

export function UserPicker({ value, onChange, roleKey, placeholder = "Select a person", id }: { value: PickerItem | null; onChange: (i: PickerItem | null) => void; roleKey?: string; placeholder?: string; id?: string }) {
  return <AsyncPicker<DirectoryUser> id={id} endpoint="/directory/users" query={{ roleKey }} value={value} onChange={onChange} placeholder={placeholder} map={(u) => ({ id: u.id, label: u.displayName, sublabel: u.jobTitle ?? u.email })} />;
}
