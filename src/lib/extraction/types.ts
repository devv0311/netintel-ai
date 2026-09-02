/**
 * Evidence extraction — shared types.
 *
 * Dependency-free (no fs, no db, no server-only imports) so it can be
 * imported from both the server extraction service and `"use client"`
 * UI components, matching src/lib/ingestion/types.ts.
 *
 * The extraction pipeline, per docs/contracts/agent-contracts.md and
 * this milestone's brief:
 *
 *   persisted evidence
 *   → select extractable evidence
 *   → parse source content
 *   → extract explicit facts
 *   → validate extracted records
 *   → attach provenance
 *   → persist extracted records
 *   → return extraction result
 *
 * Extraction reads only already-ingested evidence from the investigation
 * store — there is no file/upload input at this stage, unlike ingestion.
 */

export const EXTRACTION_STAGES = [
  "select_evidence",
  "parse_content",
  "extract_facts",
  "validate_records",
  "attach_provenance",
  "persistence",
  "result",
] as const;
export type ExtractionStage = (typeof EXTRACTION_STAGES)[number];

/** Human-facing label for each stage (used by the UI progress list). */
export const EXTRACTION_STAGE_LABELS: Record<ExtractionStage, string> = {
  select_evidence: "Select extractable evidence",
  parse_content: "Parse source content",
  extract_facts: "Extract explicit facts",
  validate_records: "Validate extracted records",
  attach_provenance: "Attach & verify provenance",
  persistence: "Persist extracted records",
  result: "Assemble extraction result",
};

export type StageStatus = "pending" | "running" | "ok" | "skipped" | "failed";

export interface StageReport {
  stage: ExtractionStage;
  status: StageStatus;
  detail: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
}

export const EXTRACTION_ERROR_CODES = [
  "NO_INVESTIGATION",
  "UNSUPPORTED_EVIDENCE_TYPE",
  "VALIDATION_FAILURE",
  "PERSISTENCE_FAILURE",
  "INTERNAL_ERROR",
] as const;
export type ExtractionErrorCode = (typeof EXTRACTION_ERROR_CODES)[number];

/** A structured, user-safe error. Never carries a stack trace or a secret. */
export interface ExtractionError {
  code: ExtractionErrorCode;
  stage: ExtractionStage;
  message: string;
  /** Sanitized detail lines, capped in length. */
  issues?: string[];
}

export interface ExtractionCounts {
  evidenceItemsConsidered: number;
  evidenceItemsExtracted: number;
  recordsByType: Record<string, number>;
}

export interface ExtractionResult {
  status: "extracted" | "already_extracted" | "failed";
  investigationId: string | null;
  counts: ExtractionCounts | null;
  persisted: { created: number; skipped: number } | null;
  warnings: string[];
  stages: StageReport[];
  error: ExtractionError | null;
  startedAt: string;
  finishedAt: string;
}

export interface ExtractionSummary {
  investigationId: string;
  /** ISO timestamp of the last extraction run (metadata, not evidence). */
  extractedAt: string | null;
  totalRecords: number;
  recordsByType: Record<string, number>;
  evidenceItemsExtracted: number;
  evidenceItemsTotal: number;
}

/** Server-derived extraction state. */
export type ExtractionState =
  | { status: "not_available" }
  | { status: "pending" }
  | { status: "extracted"; summary: ExtractionSummary };

/** Streamed, newline-delimited events from POST /api/extraction. */
export type ExtractionEvent =
  | { type: "stage"; report: StageReport }
  | { type: "persist_progress"; label: string; done: number; total: number }
  | { type: "result"; result: ExtractionResult };

/** One representative extracted fact, shaped for the extraction view. */
export interface ExtractedFactView {
  id: string;
  recordType: string;
  factType: string;
  observedValue: unknown;
  evidenceItemId: string;
  evidenceItemType: string;
  classification: string;
  confidence: number;
  provenance: {
    source: string;
    location: string;
    method: string;
    processingHistory: string[];
    timestamp: string;
  };
}

export interface ExtractedFactsPage {
  facts: ExtractedFactView[];
  total: number;
  offset: number;
  limit: number;
}
