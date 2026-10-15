/** File-type policy defaults and filename sanitization (server-side enforcement uses the database allow-list). */

export type FileCategoryCode = "DOCUMENT" | "SPREADSHEET" | "DATA" | "IMAGE" | "CAD" | "ARCHIVE" | "OTHER";

export interface AllowedFileTypeSeed {
  extension: string;
  label: string;
  category: FileCategoryCode;
  /** Canonical content type served for downloads (the client-declared type is never trusted). */
  mimeTypes: string[];
  maxSizeMb: number | null;
  previewable: boolean;
}

export const ALLOWED_FILE_TYPE_SEEDS: AllowedFileTypeSeed[] = [
  { extension: "pdf", label: "PDF document", category: "DOCUMENT", mimeTypes: ["application/pdf"], maxSizeMb: 100, previewable: true },
  { extension: "docx", label: "Word document", category: "DOCUMENT", mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"], maxSizeMb: 50, previewable: false },
  { extension: "xlsx", label: "Excel workbook", category: "SPREADSHEET", mimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], maxSizeMb: 50, previewable: false },
  { extension: "csv", label: "CSV data", category: "DATA", mimeTypes: ["text/csv"], maxSizeMb: 50, previewable: false },
  { extension: "jpg", label: "JPEG image", category: "IMAGE", mimeTypes: ["image/jpeg"], maxSizeMb: 30, previewable: true },
  { extension: "jpeg", label: "JPEG image", category: "IMAGE", mimeTypes: ["image/jpeg"], maxSizeMb: 30, previewable: true },
  { extension: "png", label: "PNG image", category: "IMAGE", mimeTypes: ["image/png"], maxSizeMb: 30, previewable: true },
  { extension: "tif", label: "TIFF image", category: "IMAGE", mimeTypes: ["image/tiff"], maxSizeMb: 100, previewable: false },
  { extension: "tiff", label: "TIFF image", category: "IMAGE", mimeTypes: ["image/tiff"], maxSizeMb: 100, previewable: false },
  { extension: "step", label: "STEP CAD model", category: "CAD", mimeTypes: ["model/step"], maxSizeMb: 250, previewable: false },
  { extension: "stp", label: "STEP CAD model", category: "CAD", mimeTypes: ["model/step"], maxSizeMb: 250, previewable: false },
  { extension: "iges", label: "IGES CAD model", category: "CAD", mimeTypes: ["model/iges"], maxSizeMb: 250, previewable: false },
  { extension: "igs", label: "IGES CAD model", category: "CAD", mimeTypes: ["model/iges"], maxSizeMb: 250, previewable: false },
  { extension: "dxf", label: "DXF drawing", category: "CAD", mimeTypes: ["image/vnd.dxf"], maxSizeMb: 250, previewable: false },
  { extension: "dwg", label: "DWG drawing", category: "CAD", mimeTypes: ["image/vnd.dwg"], maxSizeMb: 250, previewable: false },
  { extension: "zip", label: "ZIP archive", category: "ARCHIVE", mimeTypes: ["application/zip"], maxSizeMb: 250, previewable: false },
];

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** Extracts a lower-case extension without the dot, or "" when none. */
export function fileExtension(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const idx = base.lastIndexOf(".");
  if (idx <= 0 || idx === base.length - 1) return "";
  return base.slice(idx + 1).toLowerCase();
}

/**
 * Produces a safe display/download filename: strips directories and control characters, normalizes unicode,
 * replaces characters outside a conservative set, and bounds the length while preserving the extension.
 */
export function sanitizeFilename(filename: string, maxLength = 180): string {
  const base = (filename.split(/[\\/]/).pop() ?? "").normalize("NFKC");
  // eslint-disable-next-line no-control-regex
  let cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[^A-Za-z0-9._\- ()+]/g, "_").replace(/\s+/g, " ").replace(/_+/g, "_").trim();
  cleaned = cleaned.replace(/^\.+/, "");
  const ext = fileExtension(cleaned);
  let stem = ext ? cleaned.slice(0, -(ext.length + 1)) : cleaned;
  if (!stem || RESERVED.test(stem)) stem = `file_${stem || "upload"}`;
  const suffix = ext ? `.${ext}` : "";
  if (stem.length + suffix.length > maxLength) stem = stem.slice(0, Math.max(1, maxLength - suffix.length));
  return `${stem}${suffix}`;
}

/**
 * Content signature check of the first bytes against the declared extension. Returns false when the content
 * clearly does not match (e.g. an executable renamed to .pdf). Text-based formats must not contain NUL bytes.
 */
export function signatureMatches(extension: string, head: Uint8Array): boolean {
  const startsWith = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);
  const ascii = (s: string, offset = 0) => [...s].every((c, i) => head[offset + i] === c.charCodeAt(0));
  const isText = () => !head.slice(0, Math.min(head.length, 4096)).includes(0);
  switch (extension) {
    case "pdf":
      return ascii("%PDF-");
    case "png":
      return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "jpg":
    case "jpeg":
      return startsWith(0xff, 0xd8, 0xff);
    case "tif":
    case "tiff":
      return startsWith(0x49, 0x49, 0x2a, 0x00) || startsWith(0x4d, 0x4d, 0x00, 0x2a);
    case "zip":
    case "docx":
    case "xlsx":
      return startsWith(0x50, 0x4b, 0x03, 0x04) || startsWith(0x50, 0x4b, 0x05, 0x06);
    case "dwg":
      return ascii("AC10") || ascii("AC1");
    case "step":
    case "stp":
      return isText() && new TextDecoder().decode(head.slice(0, 200)).trimStart().startsWith("ISO-10303-21");
    case "csv":
    case "dxf":
    case "iges":
    case "igs":
      return isText();
    default:
      // Administrator-added types without a known signature: accept (still subject to malware scanning).
      return true;
  }
}
