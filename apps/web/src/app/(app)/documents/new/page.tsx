"use client";

import { useQuery } from "@tanstack/react-query";
import { humanize } from "@sqms/shared";
import { Paperclip, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { FileUpload } from "@/components/common/file-upload";
import { AsyncPicker, type PickerItem } from "@/components/forms/async-picker";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Alert, ErrorAlert } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { api, type UploadedFile } from "@/lib/api";
import { useSession } from "@/lib/session";

interface DocType {
  id: string;
  code: string;
  name: string;
  acronym: string | null;
  category: string;
  instructions: string | null;
  allowUpload: boolean;
  nativeFormKey: string | null;
  nativeModule: string | null;
  supplierVisibility: string;
  currentTemplateRevision: { id: string; revisionLabel: string; files?: { file: { id: string; safeFilename: string } }[] } | null;
}

export default function NewDocumentPage() {
  return (
    <Suspense>
      <NewDocument />
    </Suspense>
  );
}

function NewDocument() {
  const router = useRouter();
  const params = useSearchParams();
  const { isInternal } = useSession();
  const [type, setType] = useState<PickerItem | null>(null);
  const typeId = type?.id ?? params.get("documentTypeId");
  const typeQ = useQuery({ queryKey: ["document-type", typeId], queryFn: () => api<DocType>(`/document-types/${typeId}`), enabled: !!typeId });
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [supplier, setSupplier] = useState<PickerItem | null>(null);
  const [method, setMethod] = useState<"NATIVE_FORM" | "UPLOAD" | null>(null);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const t = typeQ.data;
  const nativeAvailable = !!t?.nativeFormKey && !t.nativeModule;
  const effectiveMethod = method ?? (nativeAvailable ? "NATIVE_FORM" : "UPLOAD");

  async function create() {
    setError(null);
    if (!t) return;
    if (title.trim().length < 3) {
      setError(new Error("Title must be at least 3 characters"));
      return;
    }
    setBusy(true);
    try {
      const created = await api<{ document: { id: string } }>("/documents", {
        method: "POST",
        body: {
          documentTypeId: t.id,
          title: title.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(isInternal && supplier ? { supplierId: supplier.id } : {}),
          submissionMethod: effectiveMethod,
          ...(effectiveMethod === "NATIVE_FORM" ? { formData: {} } : {}),
          ...(effectiveMethod === "UPLOAD" && files.length ? { fileIds: files.map((f) => f.id) } : {}),
          ...(supplier && isInternal ? { links: [{ entityType: "SUPPLIER", entityId: supplier.id, linkRole: "REFERENCE" }] } : {}),
        },
      });
      toast.success("Document created");
      router.push(`/documents/${created.document.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="New document" breadcrumbs={[{ href: "/documents", label: "Document records" }, { label: "New" }]} description="Documents fulfilling a sourcing or change checklist are best created from that checklist so they are linked automatically." />
      <Card className="max-w-3xl">
        <CardBody className="space-y-4">
          {error ? <ErrorAlert error={error} /> : null}
          <Field label="Document type" required>
            <AsyncPicker<DocType>
              endpoint="/document-types"
              query={{ status: "ACTIVE" }}
              value={type ?? (t ? { id: t.id, label: `${t.code} ${t.name}` } : null)}
              onChange={(v) => {
                setType(v);
                setMethod(null);
              }}
              map={(d) => ({ id: d.id, label: `${d.code} ${d.name}${d.acronym ? ` (${d.acronym})` : ""}`, sublabel: humanize(d.category) })}
              placeholder="Search the document library"
            />
          </Field>
          {t && (
            <>
              {t.instructions && <Alert title="Instructions">{t.instructions}</Alert>}
              {t.nativeModule && <Alert tone="warning">This record is normally produced by the {humanize(t.nativeModule).toLowerCase()} module. Only an uploaded submission can be created here.</Alert>}
              {!isInternal && t.supplierVisibility !== "SUPPLIER_CONTRIBUTE" && <Alert tone="danger">Suppliers cannot author this document type.</Alert>}
              <Field label="Title" required htmlFor="doc-title">
                <Input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} placeholder={`${t.acronym ?? t.code} - ...`} />
              </Field>
              <Field label="Description" htmlFor="doc-desc">
                <Textarea id="doc-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />
              </Field>
              {isInternal && (
                <Field label="Supplier" hint="The supplier this record concerns (optional).">
                  <AsyncPicker<{ id: string; name: string; supplierNumber: string }> endpoint="/suppliers" value={supplier} onChange={setSupplier} map={(s) => ({ id: s.id, label: s.name, sublabel: s.supplierNumber })} placeholder="Search supplier" />
                </Field>
              )}
              {nativeAvailable && t.allowUpload && (
                <fieldset className="space-y-1">
                  <legend className="text-xs font-medium">Submission method</legend>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="method" checked={effectiveMethod === "NATIVE_FORM"} onChange={() => setMethod("NATIVE_FORM")} /> Complete the native form in SQMS
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="method" checked={effectiveMethod === "UPLOAD"} onChange={() => setMethod("UPLOAD")} /> Upload a completed document
                  </label>
                </fieldset>
              )}
              {effectiveMethod === "UPLOAD" && (
                <div className="space-y-2">
                  <p className="text-xs font-medium">Files</p>
                  {files.length > 0 && (
                    <ul className="space-y-1">
                      {files.map((f, i) => (
                        <li key={f.id} className="flex items-center gap-2 text-xs">
                          <Paperclip className="size-3.5" /> {f.safeFilename} {i === 0 && <span className="text-muted-foreground">(primary)</span>}
                          <button className="text-muted-foreground hover:text-destructive" onClick={() => setFiles(files.filter((x) => x.id !== f.id))} aria-label={`Remove ${f.safeFilename}`}>
                            <X className="size-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <FileUpload onReady={(f) => setFiles((list) => [...list, f])} />
                  <p className="text-xs text-muted-foreground">Files can also be attached after creation. The first file becomes the primary document.</p>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => router.back()}>
                  Cancel
                </Button>
                <Button loading={busy} disabled={title.trim().length < 3 || (!t.allowUpload && effectiveMethod === "UPLOAD")} onClick={create}>
                  Create document
                </Button>
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </>
  );
}
