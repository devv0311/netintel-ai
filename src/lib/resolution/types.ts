/**
 * Entity resolution — shared types.
 *
 * Dependency-free (no fs, no db, no server-only imports) so it can be
 * imported from both the server resolution service and `"use client"`
 * UI components, matching src/lib/extraction/types.ts.
 *
 * The resolution pipeline, per docs/contracts/agent-contracts.md (Agent
 * 2) and this milestone's brief:
 *
 *   persisted extracted records
 *   → select resolvable records
 *   → canonicalize identifier entities (phone/imei/vehicle/bank_account)
 *   → cluster person identities via shared identifiers
 *   → resolve every mention to a canonical entity (or flag ambiguous)
 *   → validate resolution outputs
 *   → attach & verify provenance
 *   → persist entities/aliases/resolution decisions
 *   → return resolution result
 *
 * Resolution reads only already-persisted extracted records (via the
 * repository layer) — no file, no upload, no ground truth.
 */

export const RESOLUTION_STAGES = [
  "select_records",
  "canonicalize_identifiers",
  "cluster_identities",
  "resolve_mentions",
  "validate_decisions",
  "attach_provenance",
  "persistence",
  "result",
] as const;
export type ResolutionStage = (typeof RESOLUTION_STAGES)[number];

export const RESOLUTION_STAGE_LABELS: Record<ResolutionStage, string> = {
  select_records: "Select extracted records",
  canonicalize_identifiers: "Canonicalize identifier entities",
  cluster_identities: "Cluster identities via shared identifiers",
  resolve_mentions: "Resolve every mention to a canonical entity",
  validate_decisions: "Validate resolution outputs",
  attach_provenance: "Attach & verify provenance",
  persistence: "Persist entities, aliases & decisions",
  result: "Assemble resolution result",
};

export type StageStatus = "pending" | "running" | "ok" | "skipped" | "failed";

export interface StageReport {
  stage: ResolutionStage;
  status: StageStatus;
  detail: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
}

export const RESOLUTION_ERROR_CODES = [
  "NO_INVESTIGATION",
  "NO_EXTRACTED_RECORDS",
  "VALIDATION_FAILURE",
  "PERSISTENCE_FAILURE",
  "INTERNAL_ERROR",
] as const;
export type ResolutionErrorCode = (typeof RESOLUTION_ERROR_CODES)[number];

/** A structured, user-safe error. Never carries a stack trace or a secret. */
export interface ResolutionError {
  code: ResolutionErrorCode;
  stage: ResolutionStage;
  message: string;
  issues?: string[];
}

export interface ResolutionCounts {
  extractedRecordsConsidered: number;
  entitiesByKind: Record<string, number>;
  aliasesCreated: number;
  decisionsByType: Record<string, number>;
  ambiguousDecisions: number;
}

export interface ResolutionPersisted {
  entitiesCreated: number;
  entitiesSkipped: number;
  aliasesCreated: number;
  aliasesSkipped: number;
  decisionsCreated: number;
  decisionsSkipped: number;
}

export interface ResolutionResult {
  status: "resolved" | "already_resolved" | "failed";
  investigationId: string | null;
  counts: ResolutionCounts | null;
  persisted: ResolutionPersisted | null;
  warnings: string[];
  stages: StageReport[];
  error: ResolutionError | null;
  startedAt: string;
  finishedAt: string;
}

export interface ResolutionSummary {
  investigationId: string;
  resolvedAt: string | null;
  totalEntities: number;
  entitiesByKind: Record<string, number>;
  totalAliases: number;
  totalDecisions: number;
  decisionsByType: Record<string, number>;
  ambiguousDecisions: number;
}

export type ResolutionState =
  | { status: "not_available" }
  | { status: "pending" }
  | { status: "resolved"; summary: ResolutionSummary };

export type ResolutionEvent =
  | { type: "stage"; report: StageReport }
  | { type: "persist_progress"; label: string; done: number; total: number }
  | { type: "result"; result: ResolutionResult };

/** One representative canonical entity, shaped for the resolution view. */
export interface ResolvedEntityView {
  id: string;
  kind: string;
  canonicalLabel: string;
  aliases: string[];
  decisionCount: number;
  hasAmbiguousDecision: boolean;
  confidence: number;
  provenance: {
    source: string;
    location: string;
    method: string;
    processingHistory: string[];
    timestamp: string;
  };
}

export interface ResolvedEntitiesPage {
  entities: ResolvedEntityView[];
  total: number;
  offset: number;
  limit: number;
}

/** Full detail for one canonical entity — every contributing decision/mention. */
export interface EntityDetailDecisionView {
  id: string;
  extractedRecordIds: string[];
  resolutionType: string;
  status: string;
  candidateEntityIds: string[];
  conflicts: string[];
  reason: string;
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

export interface EntityDetail {
  id: string;
  kind: string;
  canonicalLabel: string;
  aliases: string[];
  decisions: EntityDetailDecisionView[];
}
