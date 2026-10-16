export type LegacyRow = Record<string, any>;
export interface Intake {
  formatVersion: 1;
  datasetId: string;
  sourceSha256: string;
  sourceTimezone: string | null;
  profile: Record<string, unknown>;
  tables: Record<string, LegacyRow[]>;
  files: {
    entity: string;
    sourceId: string;
    status: string;
    relativePath?: string;
    sizeBytes?: number;
    sha256?: string;
    reason?: string;
  }[];
}
export interface ReviewedMapping {
  targetId: string;
  reviewedById: string;
  reason: string;
}
export interface MigrationMappings {
  /** Identity collisions require an explicit reviewed account mapping. Existing account credentials/grants stay intact. */
  users?: Record<string, ReviewedMapping>;
  roles: Record<
    string,
    { roleKeys: string[]; reviewedById: string; reason: string }
  >;
  parts?: Record<string, ReviewedMapping>;
  /** Explicit per-record mappings; never infer a supplier from a part number. */
  records?: Record<
    string,
    {
      supplierProductId?: string;
      internalPartId?: string;
      supplierId?: string;
      reviewedById: string;
      reason: string;
    }
  >;
  /** Exact source keys whose test edits may be overwritten, each with a reviewed rationale. */
  overwriteTestEdits?: Record<string, { reviewedById: string; reason: string }>;
  /** Timestamps without a zone are interpreted only after the source timezone was established. */
  timestampOverrides?: Record<string, string>;
  drawingDocumentTypeId?: ReviewedMapping;
}
export interface DisposableTarget {
  purpose: "disposable-qms-migration";
  datasetId: string;
  sourceSystem: string;
  databaseHost: string;
  databaseName: string;
  storageEndpoint: string;
  storageBucket: string;
  redisHost: string;
  redisDatabase: number;
}
export type MigrationOutcome =
  | "MAPPED"
  | "UNRESOLVED"
  | "UNCHANGED"
  | "EXCLUDED"
  | "CONFLICT"
  | "FAILED";
export interface MigrationReport {
  datasetId: string;
  sourceHash: string;
  mode: string;
  fixtureOnly: boolean;
  records: {
    entity: string;
    sourceId: string;
    outcome: MigrationOutcome;
    reason?: string;
    targetId?: string;
  }[];
  totals: Record<string, number>;
  sourceCounts: Record<string, number>;
  targetCounts: Record<string, number>;
  durationMs: number;
  sourceTimezone: string;
  unresolvedMappings?: number;
  scanEnqueueFailures?: number;
  sourceProfile?: Record<string, unknown>;
  businessChecks?: import("./reconciliation").SemanticCheck[];
  attachments?: {
    sourceId: string;
    fileId: string;
    status: string;
    bytesMatch: boolean;
    readable: boolean;
  }[];
}
