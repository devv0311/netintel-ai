/**
 * Dossier / report — shared types. Dependency-free at runtime (no fs,
 * no db, no server-only imports) so it can be imported from both the
 * server dossier service and "use client" UI components, matching
 * src/lib/corroboration/types.ts and src/lib/copilot/types.ts.
 *
 * The dossier pipeline, per docs/requirements.md §4 ("Investigation
 * Copilot → Dossier / Report") and blueprint Workstream H:
 *
 *   load persisted case state & derived intelligence
 *   → assemble the case summary & evidence inventory
 *   → assemble key entities & key relationships
 *   → assemble analytical signals & corroboration
 *   → assemble contradictions & investigative leads
 *   → collect supported Copilot material (never required to be live)
 *   → compose the report, its classification census and its limitations
 *   → validate against the dossier contract
 *   → verify every finding resolves to a persisted record
 *   → persist the dossier
 *   → return a structured dossier result
 *
 * The dossier reads only already-persisted state through the repository
 * and the existing per-stage summary layers, plus the existing Copilot
 * service for its excerpts. It never reads a file, an upload, or
 * `evidence/ground-truth/`, and it never writes to an upstream domain
 * table — it only writes `dossiers`.
 */

import type {
  Dossier,
  DossierCopilotExcerpt,
  DossierCounts,
  DossierFinding,
  DossierSection,
  DossierSectionKind,
} from "@/lib/domain/dossier";

export type { Dossier, DossierCopilotExcerpt, DossierCounts, DossierFinding, DossierSection, DossierSectionKind };

export const DOSSIER_STAGES = [
  "load_case_state",
  "assemble_summary",
  "assemble_entities",
  "assemble_signals",
  "assemble_contradictions",
  "collect_copilot",
  "compose_report",
  "validate_report",
  "verify_traceability",
  "persistence",
  "result",
] as const;
export type DossierStage = (typeof DOSSIER_STAGES)[number];

export const DOSSIER_STAGE_LABELS: Record<DossierStage, string> = {
  load_case_state: "Load persisted case state & derived intelligence",
  assemble_summary: "Assemble case summary & evidence inventory",
  assemble_entities: "Assemble key entities & key relationships",
  assemble_signals: "Assemble analytical signals & corroboration",
  assemble_contradictions: "Assemble contradictions & investigative leads",
  collect_copilot: "Collect supported Copilot material",
  compose_report: "Compose report, classification census & limitations",
  validate_report: "Validate against the dossier contract",
  verify_traceability: "Verify every finding resolves to a persisted record",
  persistence: "Persist the dossier",
  result: "Assemble dossier result",
};

export type StageStatus = "pending" | "running" | "ok" | "skipped" | "failed";

export interface StageReport {
  stage: DossierStage;
  status: StageStatus;
  detail: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
}

export const DOSSIER_ERROR_CODES = [
  "NO_INVESTIGATION",
  "NO_GRAPH",
  /** Analytics and/or corroboration have not run against the current graph version. */
  "NO_DERIVED_INTELLIGENCE",
  /** The case holds too little to report on — distinct from "assembled, found nothing". */
  "INSUFFICIENT_EVIDENCE",
  "VALIDATION_FAILURE",
  /** A finding could not be classified or traced back to a persisted row (blueprint H2: fail loudly, never emit a partial report). */
  "TRACEABILITY_FAILURE",
  "PERSISTENCE_FAILURE",
  "INTERNAL_ERROR",
] as const;
export type DossierErrorCode = (typeof DOSSIER_ERROR_CODES)[number];

/** A structured, user-safe error. Never carries a stack trace, a filesystem path, or a secret. */
export interface DossierError {
  code: DossierErrorCode;
  stage: DossierStage;
  message: string;
  issues?: string[];
}

export interface DossierPersisted {
  created: number;
  skipped: number;
}

export interface DossierResult {
  /**
   * `already_generated` means an identical report for this exact case
   * state already existed and was reused — regeneration is idempotent,
   * not a no-op that pretends to have written something.
   */
  status: "generated" | "already_generated" | "failed";
  dossierId: string | null;
  reportVersion: string | null;
  investigationId: string | null;
  graphVersion: string | null;
  counts: DossierCounts | null;
  persisted: DossierPersisted | null;
  warnings: string[];
  stages: StageReport[];
  error: DossierError | null;
  startedAt: string;
  finishedAt: string;
}

export interface DossierSummary {
  dossierId: string;
  investigationId: string;
  investigationName: string;
  title: string;
  /** The graph version this report was generated against. */
  graphVersion: string;
  reportVersion: string;
  generatedAt: string;
  counts: DossierCounts;
  aiSynthesisAvailable: boolean;
  aiSynthesisNote: string;
}

/**
 * `stale` is its own state rather than a flag on `generated`: a report
 * describing a superseded graph version is still a real, readable
 * report (it is kept for audit) but it is no longer a description of
 * the case as it now stands, and the UI must say so rather than present
 * it as current.
 */
export type DossierState =
  | { status: "not_available"; reason: string }
  | { status: "pending"; investigationId: string; investigationName: string; graphVersion: string }
  | { status: "generated"; summary: DossierSummary }
  | { status: "stale"; summary: DossierSummary; currentGraphVersion: string };

export type DossierEvent =
  | { type: "stage"; report: StageReport }
  | { type: "result"; result: DossierResult };

// --- investigator-facing views -----------------------------------------

/** A reference resolved to something an investigator can read, for the provenance index. */
export interface ResolvedReference {
  id: string;
  kind:
    | "evidence_source"
    | "evidence_item"
    | "extracted_record"
    | "entity"
    | "location"
    | "resolution_decision"
    | "communication_event"
    | "relationship"
    | "analytical_signal"
    | "corroboration_finding";
  label: string;
  /** Which existing screen can show this id, when one can. */
  view: "evidence" | "graph" | "analytics" | "corroboration" | null;
  /** The entity id to focus when navigating, when the reference resolves to one. */
  focusEntityId: string | null;
}

export interface DossierDetail {
  dossier: Dossier;
  /** Whether `dossier.graphVersion` is still the investigation's current graph version. */
  stale: boolean;
  currentGraphVersion: string;
  /** Resolved labels for every id the report references, keyed by id. */
  references: Record<string, ResolvedReference>;
}
