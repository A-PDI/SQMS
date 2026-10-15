import type { Response } from "express";

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

/** Escapes a CSV cell (RFC 4180) and neutralizes spreadsheet formula injection. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvCell(c.value(r))).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

export function sendCsv(res: Response, filename: string, csv: string): void {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${safe}"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(`﻿${csv}`);
}
