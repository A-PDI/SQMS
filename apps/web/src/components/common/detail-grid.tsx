import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface DetailItem {
  label: string;
  value: ReactNode;
  wide?: boolean;
}

export function DetailGrid({ items, columns = 3, className }: { items: (DetailItem | false | null | undefined)[]; columns?: 2 | 3 | 4; className?: string }) {
  const cols = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" }[columns];
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3", cols, className)}>
      {items.filter(Boolean).map((i) => {
        const item = i as DetailItem;
        return (
          <div key={item.label} className={cn(item.wide && "sm:col-span-full")}>
            <dt className="text-xs text-muted-foreground">{item.label}</dt>
            <dd className="mt-0.5 whitespace-pre-wrap break-words">{item.value === null || item.value === undefined || item.value === "" ? <span className="text-muted-foreground">-</span> : item.value}</dd>
          </div>
        );
      })}
    </dl>
  );
}
