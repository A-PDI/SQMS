/** Display formatting. Timestamps are stored in UTC and rendered in the user's time zone. */
let userTimeZone: string | undefined;
export function setUserTimeZone(tz: string | undefined) {
  userTimeZone = tz && tz !== "UTC" ? tz : tz === "UTC" ? "UTC" : undefined;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: userTimeZone }).format(d);
}

/** Calendar dates (DATE columns) are shown without time-zone shifting. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const s = typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function toDateInput(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "";
}

export function formatBytes(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function relativeDays(value: string | null | undefined): string {
  if (!value) return "";
  const days = Math.round((new Date(value).getTime() - Date.now()) / 86_400_000);
  if (days === 0) return "today";
  return days > 0 ? `in ${days} d` : `${-days} d ago`;
}
