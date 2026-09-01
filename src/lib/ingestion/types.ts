/**
 * Evidence ingestion — shared types.
 *
 * This module is dependency-free (no fs, no db, no server-only imports)
 * so it can be imported from both the server ingestion service and
 * `"use client"` UI components. Everything that touches the filesystem
 * or the database lives in the other ingestion modules.
 *
 * The ingestion pipeline, per the P5.2 contract:
 *
 *   input
 *   → file/evidence validation
 *   → corpus/schema validation
 *   → normalization
 *   → deterministic ID assignment
 *   → provenance attachment
 *   → persistence
 *   → ingestion result
 */

/** What the demonstrator asked to ingest. */
export type IngestionSourceInput =
  | { kind: "builtin-corpus" }
  | { kind: "uploaded"; filename?: string; contents: unknown };

export const INGESTION_STAGES = [
  "input",
  "file_validation",
  "schema_validation",
  "normalization",
  "id_assignment",
  "provenance",
  "persistence",
  "result",
] as const;
export type IngestionStage = (typeof INGESTION_STAGES)[number];

/** Human-facing label for each stage (used by the UI progress list). */
export const INGESTION_STAGE_LABELS: Record<IngestionStage, string> = {
  input: "Resolve evidence source",
  file_validation: "Validate file",
  schema_validation: "Validate corpus schema",
  normalization: "Normalize into domain model",
  id_assignment: "Assign deterministic IDs",
  provenance: "Attach & verify provenance",
  persistence: "Persist to investigation store",
  result: "Assemble ingestion result",
};

export type StageStatus = "pending" | "running" | "ok" | "skipped" | "failed";

export interface StageReport {
  stage: IngestionStage;
  status: StageStatus;
  detail: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
}

export const INGESTION_ERROR_CODES = [
  "INVALID_FIXTURE",
  "MALFORMED_EVIDENCE",
  "UNSUPPORTED_EVIDENCE_TYPE",
  "VALIDATION_FAILURE",
  "GROUND_TRUTH_REJECTED",
  "PERSISTENCE_FAILURE",
  "INTERNAL_ERROR",
] as const;
export type IngestionErrorCode = (typeof INGESTION_ERROR_CODES)[number];

/** A structured, user-safe error. Never carries a stack trace or a secret. */
export interface IngestionError {
  code: IngestionErrorCode;
  stage: IngestionStage;
  message: string;
  /** Sanitized detail lines (e.g. Zod issue paths), capped in length. */
  issues?: string[];
}

export interface EvidenceCounts {
  evidenceSources: number;
  evidenceItems: number;
  communications: number;
  financialTransactions: number;
  locations: number;
  evidenceItemsByType: Record<string, number>;
}

export interface IngestionResult {
  status: "ingested" | "already_ingested" | "failed";
  corpus: { name: string; version: string; fingerprint: string } | null;
  investigationId: string | null;
  counts: EvidenceCounts | null;
  persisted: { created: number; skipped: number } | null;
  stages: StageReport[];
  error: IngestionError | null;
  startedAt: string;
  finishedAt: string;
}

/** Server-derived investigation state (only ever `empty` or `loaded`). */
export type InvestigationState =
  | { status: "empty" }
  | { status: "loaded"; summary: InvestigationSummary };

export interface InvestigationSummary {
  investigationId: string;
  name: string;
  status: string;
  corpusName: string;
  corpusVersion: string;
  /** ISO timestamp the corpus was ingested (metadata, not corpus data). */
  ingestedAt: string | null;
  counts: EvidenceCounts;
}

/**
 * The client-side view of the whole workflow: the server-derived
 * `InvestigationState` plus the transient phase of an in-flight run.
 */
export type IngestionPhase =
  | "no_investigation"
  | "in_progress"
  | "completed"
  | "failed";

/** Streamed, newline-delimited events from POST /api/ingestion. */
export type IngestionEvent =
  | { type: "stage"; report: StageReport }
  | { type: "persist_progress"; label: string; done: number; total: number }
  | { type: "result"; result: IngestionResult };
