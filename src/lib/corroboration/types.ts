/**
 * Spatial/temporal corroboration — shared types. Dependency-free (no
 * fs, no db, no server-only imports) so it can be imported from both
 * the server corroboration service and "use client" UI components,
 * matching src/lib/analytics/types.ts.
 *
 * The corroboration synthesis pipeline, per Agent 5
 * (docs/contracts/agent-contracts.md) and this milestone's brief:
 *
 *   load graph state (entities, locations, relationships, comm events,
 *     extracted event mentions, graph version)
 *   → build a deterministic activity index (who/where/when, from
 *     persisted observable data only)
 *   → compute spatial corroboration (co-location, haversine proximity)
 *   → compute temporal corroboration (shared time windows)
 *   → compute spatiotemporal corroboration (repeated overlap +
 *     travel-speed contradictions)
 *   → classify each finding (corroborated_fact vs algorithmic_signal)
 *   → validate finding candidates
 *   → attach & verify provenance
 *   → persist corroboration findings
 *   → return a structured corroboration result
 *
 * Corroboration reads only already-persisted observable state (via the
 * repository layer) — no file, no upload, no ground truth. It never
 * invents a coordinate or a timestamp, and it never claims causation
 * from proximity. Every finding is classified either `corroborated_fact`
 * (independent multi-source agreement) or `algorithmic_signal`
 * (algorithmically derived) — never `observed_fact`.
 */

import type {
  CorroborationClassification,
  CorroborationFindingType,
  CorroborationKind,
} from "@/lib/domain/corroboration";

export const CORROBORATION_STAGES = [
  "load_graph_state",
  "build_activity_index",
  "compute_spatial",
  "compute_temporal",
  "compute_spatiotemporal",
  "classify_findings",
  "validate_findings",
  "attach_provenance",
  "persistence",
  "result",
] as const;
export type CorroborationStage = (typeof CORROBORATION_STAGES)[number];

export const CORROBORATION_STAGE_LABELS: Record<CorroborationStage, string> = {
  load_graph_state: "Load graph state & observable activity",
  build_activity_index: "Build deterministic activity index",
  compute_spatial: "Compute spatial corroboration (co-location & proximity)",
  compute_temporal: "Compute temporal corroboration (shared windows)",
  compute_spatiotemporal: "Compute spatiotemporal overlap & contradictions",
  classify_findings: "Classify corroborated facts vs algorithmic signals",
  validate_findings: "Validate finding candidates",
  attach_provenance: "Attach & verify provenance",
  persistence: "Persist corroboration findings",
  result: "Assemble corroboration result",
};

export type StageStatus = "pending" | "running" | "ok" | "skipped" | "failed";

export interface StageReport {
  stage: CorroborationStage;
  status: StageStatus;
  detail: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
}

export const CORROBORATION_ERROR_CODES = [
  "NO_INVESTIGATION",
  "NO_GRAPH",
  "INSUFFICIENT_SPATIAL_TEMPORAL_DATA",
  "VALIDATION_FAILURE",
  "PERSISTENCE_FAILURE",
  "INTERNAL_ERROR",
] as const;
export type CorroborationErrorCode = (typeof CORROBORATION_ERROR_CODES)[number];

/** A structured, user-safe error. Never carries a stack trace or a secret. */
export interface CorroborationError {
  code: CorroborationErrorCode;
  stage: CorroborationStage;
  message: string;
  issues?: string[];
}

export interface CorroborationCounts {
  entitiesConsidered: number;
  locationsConsidered: number;
  activityEvents: number;
  spatialFindings: number;
  temporalFindings: number;
  spatiotemporalFindings: number;
  contradictions: number;
  corroboratedFacts: number;
  algorithmicSignals: number;
}

export interface CorroborationPersisted {
  findingsCreated: number;
  findingsSkipped: number;
}

export interface CorroborationResult {
  status: "synthesized" | "already_synthesized" | "failed";
  investigationId: string | null;
  graphVersion: string | null;
  counts: CorroborationCounts | null;
  persisted: CorroborationPersisted | null;
  warnings: string[];
  stages: StageReport[];
  error: CorroborationError | null;
  startedAt: string;
  finishedAt: string;
}

export interface CorroborationSummary {
  investigationId: string;
  graphVersion: string;
  analyzedAt: string | null;
  counts: CorroborationCounts;
}

export type CorroborationState =
  | { status: "not_available" }
  | { status: "pending" }
  | { status: "synthesized"; summary: CorroborationSummary };

export type CorroborationEvent =
  | { type: "stage"; report: StageReport }
  | { type: "persist_progress"; label: string; done: number; total: number }
  | { type: "result"; result: CorroborationResult };

// --- investigator-facing views (server-derived, id-resolved) -----------

export interface CorroborationEntityRef {
  id: string;
  label: string;
  kind: string;
}

export interface CorroborationLocationRef {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
}

export interface CorroborationFindingView {
  id: string;
  findingType: CorroborationFindingType;
  kind: CorroborationKind;
  classification: CorroborationClassification;
  entities: CorroborationEntityRef[];
  locations: CorroborationLocationRef[];
  window: { start: string; end?: string } | null;
  value: Record<string, unknown>;
  method: string;
  explanation: string;
  evidenceItemIds: string[];
  supportingRecordIds: string[];
  provenance: {
    source: string;
    location: string;
    method: string;
    confidence: number;
    processingHistory: string[];
    timestamp: string;
  };
}

export interface CorroborationFindingsFilter {
  type: CorroborationFindingType | null;
  classification: CorroborationClassification | null;
  entityId: string | null;
}

export interface CorroborationFindingsPage {
  findings: CorroborationFindingView[];
  total: number;
  offset: number;
  limit: number;
  graphVersion: string;
  filter: CorroborationFindingsFilter;
}

export interface EntityPairOverlapView {
  entityAId: string;
  entityBId: string;
  entityALabel: string;
  entityBLabel: string;
  entityAKind: string;
  entityBKind: string;
  spatialFindings: number;
  temporalFindings: number;
  repeatedOverlaps: number;
  contradictions: number;
  corroboratedFacts: number;
  strongestClassification: CorroborationClassification;
  findingIds: string[];
}
