"use client";

import { Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, errorMessage, uploadFile, type UploadedFile } from "@/lib/api";
import { formatBytes } from "@/lib/format";

interface Item {
  key: string;
  name: string;
  size: number;
  progress: number;
  status: "uploading" | "scanning" | "clean" | "failed";
  error?: string;
  file?: UploadedFile;
  abort?: AbortController;
}

/**
 * Streams files to the API (multipart, with progress), then waits for malware scanning. Only files that scanned
 * CLEAN are reported through onReady; quarantined or rejected files are never offered for attachment.
 */
export function FileUpload({ onReady, multiple = true, accept, label = "Upload files" }: { onReady: (file: UploadedFile) => void | Promise<void>; multiple?: boolean; accept?: string; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const patch = (key: string, p: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));

  async function waitForScan(key: string, id: string) {
    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      const f = await api<UploadedFile>(`/files/${id}`);
      if (f.status === "CLEAN") return f;
      if (["INFECTED", "REJECTED", "SCAN_FAILED"].includes(f.status)) throw new Error(f.status === "INFECTED" ? "Malware detected; the file was quarantined" : `File ${f.status.toLowerCase().replace("_", " ")}`);
      patch(key, { status: "scanning" });
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error("Scanning is taking longer than expected; check the file later");
  }

  async function start(files: FileList | File[]) {
    for (const f of Array.from(files)) {
      const key = `${f.name}-${f.size}-${Date.now()}-${Math.random()}`;
      const abort = new AbortController();
      setItems((list) => [...list, { key, name: f.name, size: f.size, progress: 0, status: "uploading", abort }]);
      try {
        const uploaded = await uploadFile(f, (p) => patch(key, { progress: p }), abort.signal);
        patch(key, { status: "scanning", progress: 100 });
        const clean = await waitForScan(key, uploaded.id);
        patch(key, { status: "clean", file: clean });
        await onReady(clean);
      } catch (e) {
        patch(key, { status: "failed", error: errorMessage(e) });
      }
    }
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) void start(multiple ? e.dataTransfer.files : [e.dataTransfer.files[0]]);
        }}
        className={`flex flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-5 text-center text-xs text-muted-foreground ${dragging ? "border-accent bg-blue-50" : ""}`}
      >
        <Upload className="size-5" />
        <span>Drag files here or</span>
        <Button size="sm" variant="outline" onClick={() => input.current?.click()}>
          {label}
        </Button>
        <span>Files are scanned for malware before they can be used.</span>
        <input
          ref={input}
          type="file"
          className="hidden"
          multiple={multiple}
          accept={accept}
          onChange={(e) => {
            if (e.target.files?.length) void start(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {items.length > 0 && (
        <ul className="mt-2 space-y-1">
          {items.map((i) => (
            <li key={i.key} className="flex items-center gap-2 rounded border px-2 py-1 text-xs">
              <span className="min-w-0 flex-1 truncate" title={i.name}>
                {i.name} <span className="text-muted-foreground">({formatBytes(i.size)})</span>
              </span>
              {i.status === "uploading" && (
                <span className="flex w-28 items-center gap-1">
                  <span className="h-1.5 flex-1 rounded bg-muted">
                    <span className="block h-1.5 rounded bg-accent" style={{ width: `${i.progress}%` }} />
                  </span>
                  {i.progress}%
                </span>
              )}
              {i.status === "scanning" && <StatusBadge status="QUARANTINED" />}
              {i.status === "clean" && <StatusBadge status="CLEAN" />}
              {i.status === "failed" && <span className="text-destructive">{i.error}</span>}
              {i.status === "uploading" && (
                <button className="text-muted-foreground hover:text-foreground" onClick={() => i.abort?.abort()} aria-label={`Cancel upload of ${i.name}`}>
                  <X className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
