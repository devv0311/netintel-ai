/**
 * Graph synthesis — shared types. Dependency-free (no fs, no db, no
 * server-only imports) so it can be imported from both the server graph
 * service and "use client" UI components, matching
 * src/lib/resolution/types.ts.
 *
 * The graph synthesis pipeline, per docs/contracts/agent-contracts.md
 * (Agent 3) and this milestone's brief:
 *
 *   load persisted resolved entities
 *   → load extracted records
 *   → map evidence to canonical entities
 *   → construct relationship candidates
 *   → validate relationship endpoints
 *   → construct deterministic edges
 *   → attach provenance
 *   → persist graph relationships
 *   → build/rebuild in-memory graph
 *   → return structured graph result
 *
 * Graph synthesis reads only already-persisted resolved entities and
 * extracted records (via the repository layer) — no file, no upload, no
 * ground truth, and it never recreates identity resolution.
 */

export const GRAPH_STAGES = [
  "load_resolved_entities",
  "load_extracted_records",
  "map_evidence_to_entities",
  "construct_candidates",
  "validate_endpoints",
  "construct_edges",
  "attach_provenance",
  "persistence",
  "build_in_memory_graph",
  "result",
] as const;
export type GraphStage = (typeof GRAPH_STAGES)[number];

export const GRAPH_STAGE_LABELS: Record<GraphStage, string> = {
  load_resolved_entities: "Load resolved entities & aliases",
  load_extracted_records: "Load extracted records",
  map_evidence_to_entities: "Map evidence to canonical entities",
  construct_candidates: "Construct relationship candidates",
  validate_endpoints: "Validate relationship endpoints",
  construct_edges: "Construct deterministic edges",
  attach_provenance: "Attach & verify provenance",
  persistence: "Persist graph relationships",
  build_in_memory_graph: "Build in-memory graph",
  result: "Assemble graph result",
};

export type StageStatus = "pending" | "running" | "ok" | "skipped" | "failed";

export interface StageReport {
  stage: GraphStage;
  status: StageStatus;
  detail: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
}

export const GRAPH_ERROR_CODES = [
  "NO_INVESTIGATION",
  "NO_RESOLVED_ENTITIES",
  "NO_EXTRACTED_RECORDS",
  "VALIDATION_FAILURE",
  "PERSISTENCE_FAILURE",
  "INTERNAL_ERROR",
] as const;
export type GraphErrorCode = (typeof GRAPH_ERROR_CODES)[number];

/** A structured, user-safe error. Never carries a stack trace or a secret. */
export interface GraphError {
  code: GraphErrorCode;
  stage: GraphStage;
  message: string;
  issues?: string[];
}

export interface GraphCounts {
  entitiesConsidered: number;
  extractedRecordsConsidered: number;
  nodesByKind: Record<string, number>;
  edgesByType: Record<string, number>;
}

export interface GraphPersisted {
  relationshipsCreated: number;
  relationshipsSkipped: number;
}

export interface GraphResult {
  status: "synthesized" | "already_synthesized" | "failed";
  investigationId: string | null;
  counts: GraphCounts | null;
  persisted: GraphPersisted | null;
  warnings: string[];
  stages: StageReport[];
  error: GraphError | null;
  startedAt: string;
  finishedAt: string;
}

export interface GraphSummary {
  investigationId: string;
  synthesizedAt: string | null;
  totalNodes: number;
  nodesByKind: Record<string, number>;
  totalEdges: number;
  edgesByType: Record<string, number>;
  edgesByClassification: Record<string, number>;
}

export type GraphState =
  | { status: "not_available" }
  | { status: "pending" }
  | { status: "synthesized"; summary: GraphSummary };

export type GraphEvent =
  | { type: "stage"; report: StageReport }
  | { type: "persist_progress"; label: string; done: number; total: number }
  | { type: "result"; result: GraphResult };

/** One graph node — an entity (person/phone/imei/vehicle/bank_account) or a location. */
export interface NodeView {
  id: string;
  kind: string; // EntityKind | "location"
  label: string;
  degree: number;
}

/** One graph edge, shaped for rendering (full detail is a separate fetch). */
export interface EdgeView {
  id: string;
  source: string;
  target: string;
  relationshipType: string;
  directed: boolean;
  classification: string;
  confidence: number;
}

export interface GraphSnapshot {
  nodes: NodeView[];
  edges: EdgeView[];
  truncated: boolean;
  totalNodes: number;
  totalEdges: number;
}

export interface NodeDetailEdgeView {
  id: string;
  relationshipType: string;
  direction: "outgoing" | "incoming";
  otherNodeId: string;
  otherNodeLabel: string;
  otherNodeKind: string;
  classification: string;
  confidence: number;
}

export interface NodeDetail {
  id: string;
  kind: string;
  label: string;
  aliases: string[];
  attributes: Record<string, unknown>;
  provenance: {
    source: string;
    location: string;
    method: string;
    processingHistory: string[];
    timestamp: string;
  };
  edges: NodeDetailEdgeView[];
}

export interface EdgeDetailEvidenceRef {
  extractedRecordId: string;
  evidenceItemId: string;
  recordType: string;
  location: string;
}

export interface EdgeDetail {
  id: string;
  sourceEntityId: string;
  sourceLabel: string;
  targetEntityId: string;
  targetLabel: string;
  relationshipType: string;
  directed: boolean;
  classification: string;
  confidence: number;
  attributes: Record<string, unknown>;
  conflicts: string[];
  evidenceItemIds: string[];
  extractedRecords: EdgeDetailEvidenceRef[];
  provenance: {
    source: string;
    location: string;
    method: string;
    processingHistory: string[];
    timestamp: string;
  };
}
