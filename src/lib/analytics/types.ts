/**
 * Topology analytics — shared types. Dependency-free (no fs, no db, no
 * server-only imports) so it can be imported from both the server
 * analytics service and "use client" UI components, matching
 * src/lib/graph/types.ts.
 *
 * The analytics synthesis pipeline, per docs/contracts/agent-contracts.md
 * (Agent 4) and this milestone's brief:
 *
 *   load graph state (entities, locations, relationships, graph version)
 *   → build a deterministic analysis graph
 *   → compute degree metrics (in-memory only, feeds ranking)
 *   → compute centrality (degree centrality, betweenness centrality)
 *   → compute bridges (articulation points)
 *   → compute communities (Louvain)
 *   → compute investigative ranking
 *   → validate signal candidates
 *   → attach & verify provenance
 *   → persist analytical signals
 *   → return structured analytics result
 *
 * Analytics reads only already-persisted graph state (via the
 * repository layer) — no file, no upload, no ground truth, and it
 * never invents a relationship. Every signal is classified exactly
 * "algorithmic_signal" (docs/requirements.md §7) — a topology
 * calculation describes the graph, it is never itself a claim about
 * the world.
 */

export const ANALYTICS_STAGES = [
  "load_graph_state",
  "build_analysis_graph",
  "compute_centrality",
  "compute_bridges",
  "compute_communities",
  "compute_ranking",
  "validate_signals",
  "attach_provenance",
  "persistence",
  "result",
] as const;
export type AnalyticsStage = (typeof ANALYTICS_STAGES)[number];

export const ANALYTICS_STAGE_LABELS: Record<AnalyticsStage, string> = {
  load_graph_state: "Load graph state",
  build_analysis_graph: "Build deterministic analysis graph",
  compute_centrality: "Compute degree & betweenness centrality",
  compute_bridges: "Detect bridge / intermediary entities",
  compute_communities: "Detect communities",
  compute_ranking: "Compute investigative ranking",
  validate_signals: "Validate signal candidates",
  attach_provenance: "Attach & verify provenance",
  persistence: "Persist analytical signals",
  result: "Assemble analytics result",
};

export type StageStatus = "pending" | "running" | "ok" | "skipped" | "failed";

export interface StageReport {
  stage: AnalyticsStage;
  status: StageStatus;
  detail: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
}

export const ANALYTICS_ERROR_CODES = [
  "NO_INVESTIGATION",
  "NO_GRAPH",
  "VALIDATION_FAILURE",
  "PERSISTENCE_FAILURE",
  "INTERNAL_ERROR",
] as const;
export type AnalyticsErrorCode = (typeof ANALYTICS_ERROR_CODES)[number];

/** A structured, user-safe error. Never carries a stack trace or a secret. */
export interface AnalyticsError {
  code: AnalyticsErrorCode;
  stage: AnalyticsStage;
  message: string;
  issues?: string[];
}

export interface AnalyticsCounts {
  entitiesAnalyzed: number;
  edgesAnalyzed: number;
  bridgeEntities: number;
  communities: number;
  rankedEntities: number;
}

export interface AnalyticsPersisted {
  signalsCreated: number;
  signalsSkipped: number;
}

export interface AnalyticsResult {
  status: "synthesized" | "already_synthesized" | "failed";
  investigationId: string | null;
  graphVersion: string | null;
  counts: AnalyticsCounts | null;
  persisted: AnalyticsPersisted | null;
  warnings: string[];
  stages: StageReport[];
  error: AnalyticsError | null;
  startedAt: string;
  finishedAt: string;
}

export interface AnalyticsSummary {
  investigationId: string;
  graphVersion: string;
  analyzedAt: string | null;
  counts: AnalyticsCounts;
}

export type AnalyticsState =
  | { status: "not_available" }
  | { status: "pending" }
  | { status: "synthesized"; summary: AnalyticsSummary };

export type AnalyticsEvent =
  | { type: "stage"; report: StageReport }
  | { type: "persist_progress"; label: string; done: number; total: number }
  | { type: "result"; result: AnalyticsResult };

// --- degree (computed live, never persisted — see docs/data/analytics.md) --

export interface DegreeBreakdown {
  total: number;
  weighted: number;
  incoming: number;
  outgoing: number;
  byRelationshipType: Record<string, number>;
}

// --- ranked / entity-metric views -----------------------------------

export interface RankedEntityView {
  id: string;
  kind: string;
  label: string;
  rank: number;
  score: number;
  degreeCentrality: number;
  betweennessCentrality: number;
  bridgeScore: number;
}

export interface RankedEntitiesPage {
  entities: RankedEntityView[];
  total: number;
  offset: number;
  limit: number;
  graphVersion: string;
}

export interface EntityMetricSignalView {
  id: string;
  signalType: string;
  method: string;
  value: Record<string, unknown>;
  explanation: string;
  classification: string;
  confidence: number;
  supportingEdgeIds: string[];
}

export interface EntityAnalyticsDetail {
  id: string;
  kind: string;
  label: string;
  degree: DegreeBreakdown;
  signals: EntityMetricSignalView[];
  communityId: string | null;
}

// --- bridges ----------------------------------------------------------

export interface BridgeEntityView {
  id: string;
  kind: string;
  label: string;
  bridgeScore: number;
  componentsBefore: number;
  componentsAfter: number;
  affectedComponentSizes: number[];
  supportingEdgeIds: string[];
}

// --- communities --------------------------------------------------------

export interface CommunityView {
  id: string;
  size: number;
  memberEntityIds: string[];
  dominantEntityTypes: Record<string, number>;
  dominantRelationshipTypes: Record<string, number>;
  representativeEntityIds: string[];
}

// --- shortest path (always computed live, never persisted) --------------

export interface PathEdgeView {
  id: string;
  source: string;
  target: string;
  relationshipType: string;
  directed: boolean;
  classification: string;
}

export interface PathFoundResult {
  found: true;
  sourceEntityId: string;
  targetEntityId: string;
  nodeIds: string[];
  edges: PathEdgeView[];
  hopCount: number;
}

export interface PathNotFoundResult {
  found: false;
  sourceEntityId: string;
  targetEntityId: string;
  reason: string;
}

export type PathResult = PathFoundResult | PathNotFoundResult;
