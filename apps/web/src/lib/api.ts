/** Browser API client: same-origin cookie session, CSRF header on unsafe methods, consistent error objects. */
import { qs } from "./utils";

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
  correlationId?: string | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly correlationId?: string | null,
  ) {
    super(message);
  }

  /** Field-level problems from validation failures, business rules and approval gates, for display. */
  get problems(): string[] {
    const d = this.details as Record<string, unknown> | undefined;
    if (!d) return [];
    const out: string[] = [];
    if (Array.isArray(d.fields)) out.push(...(d.fields as string[]));
    if (Array.isArray(d.problems)) out.push(...(d.problems as string[]));
    if (Array.isArray(d.issues)) out.push(...(d.issues as (string | { path?: string; message: string })[]).map((i) => (typeof i === "string" ? i : `${i.path ? `${i.path}: ` : ""}${i.message}`)));
    if (Array.isArray(d.missing)) out.push(`Missing: ${(d.missing as string[]).join(", ")}`);
    if (Array.isArray(d.checks)) for (const c of d.checks as { label: string; details?: string[] }[]) out.push(`${c.label}${c.details?.length ? `: ${c.details.join("; ")}` : ""}`);
    return out;
  }
}

let csrfToken: string | null = null;
export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
export const API_BASE = "/api/v1";

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, unknown>;
  signal?: AbortSignal;
}

async function parseError(res: Response): Promise<ApiError> {
  let body: { error?: ApiErrorBody } | null = null;
  try {
    body = (await res.json()) as { error?: ApiErrorBody };
  } catch {
    /* non-JSON error */
  }
  const e = body?.error;
  return new ApiError(res.status, e?.code ?? `HTTP_${res.status}`, e?.message ?? res.statusText ?? "Request failed", e?.details, e?.correlationId);
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (UNSAFE.has(method) && csrfToken) headers["X-CSRF-Token"] = csrfToken;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}${qs(opts.query)}`, { method, headers, credentials: "same-origin", body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, signal: opts.signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, "NETWORK_ERROR", "The server could not be reached. Check your connection and try again.");
  }
  if (res.status === 401 && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("sqms:unauthorized"));
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export interface UploadedFile {
  id: string;
  originalFilename: string;
  safeFilename: string;
  extension: string;
  contentType: string;
  category: string;
  sizeBytes: number;
  sha256: string;
  status: string;
  scannedAt: string | null;
}

/** Streams a file as multipart/form-data (never base64) with upload progress. */
export function uploadFile(file: File, onProgress?: (percent: number) => void, signal?: AbortSignal): Promise<UploadedFile> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/files`);
    xhr.withCredentials = true;
    if (csrfToken) xhr.setRequestHeader("X-CSRF-Token", csrfToken);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new ApiError(0, "NETWORK_ERROR", "Upload failed: the server could not be reached"));
    xhr.onabort = () => reject(new ApiError(0, "ABORTED", "Upload cancelled"));
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as UploadedFile);
      else {
        const e = (body as { error?: ApiErrorBody } | null)?.error;
        reject(new ApiError(xhr.status, e?.code ?? `HTTP_${xhr.status}`, e?.message ?? "Upload failed", e?.details, e?.correlationId));
      }
    };
    signal?.addEventListener("abort", () => xhr.abort());
    const form = new FormData();
    form.append("file", file, file.name);
    xhr.send(form);
  });
}

export const fileDownloadUrl = (fileId: string) => `${API_BASE}/files/${fileId}/download`;
export const filePreviewUrl = (fileId: string) => `${API_BASE}/files/${fileId}/preview`;
export const csvUrl = (path: string, query?: Record<string, unknown>) => `${API_BASE}${path}${qs(query)}`;

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
