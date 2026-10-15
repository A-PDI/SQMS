"use client";

import { DropdownMenu as Menu } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;

export function DropdownMenuContent({ className, align = "end", ...props }: React.ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content align={align} sideOffset={4} className={cn("z-50 min-w-44 rounded-md border bg-surface p-1 shadow-lg", className)} {...props} />
    </Menu.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof Menu.Item>) {
  return <Menu.Item className={cn("flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-muted data-[disabled]:opacity-50 [&_svg]:size-4", className)} {...props} />;
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof Menu.Label>) {
  return <Menu.Label className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)} {...props} />;
}

export function DropdownMenuSeparator() {
  return <Menu.Separator className="my-1 h-px bg-border" />;
}
