"use client";

import { Tabs as TabsPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

export function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "flex max-w-full gap-x-1 overflow-x-auto border-b",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "workspace-control -mb-px shrink-0 whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary data-[state=active]:border-pdi-teal data-[state=active]:font-medium data-[state=active]:text-pdi-navy",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn("pt-4 outline-none", className)}
      {...props}
    />
  );
}
