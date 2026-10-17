import * as React from "react";
import { cn } from "@/lib/utils";

export function Table({
  className,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div
      className="w-full overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-pdi-navy"
      role="region"
      aria-label={`${props["aria-label"] ?? "Records"} table`}
      tabIndex={0}
    >
      <table
        className={cn("w-full border-collapse text-sm tabular-nums", className)}
        {...props}
      />
    </div>
  );
}
export function THead(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className="bg-gray-50 text-left text-xs text-gray-600" {...props} />
  );
}
export function TBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}
export function TR({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "border-b last:border-b-0 hover:bg-pdi-teal-light/25",
        className,
      )}
      {...props}
    />
  );
}
export function TH({
  className,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn("whitespace-nowrap px-3 py-2 font-semibold", className)}
      {...props}
    />
  );
}
export function TD({
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-3 py-2 align-top", className)} {...props} />;
}
