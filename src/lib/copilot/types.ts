/**
 * Investigation Copilot — shared types. Dependency-free at runtime (no
 * fs, no db, no server-only imports) so it can be imported from both
 * the server Copilot service and "use client" UI components, matching
 * src/lib/corroboration/types.ts.
 *
 * The Copilot pipeline, per Agent 6 (docs/contracts/agent-contracts.md)
 * and this milestone's brief:
 *
 *   parse & normalize the question
 *   → ground entity/alias/identifier references against resolved entities
 *   → deterministic structured retrieval over persisted evidence,
 *     extracted records, entities/aliases, graph edges, analytics and
 *     corroboration findings
 *   → assemble a handle-addressed evidence pack
 *   → build the deterministic grounded claim set (classification and
 *     confidence carried over from each source record, never invented)
 *   → synthesize prose over that claim set (Claude, cached; deterministic
 *     narration when no model is available)
 *   → validate the response against the strict contract
 *   → verify every citation resolves to a real persisted record
 *   → return the validated response
 *
 * The Copilot reads only already-persisted state through the repository
 * and the existing per-stage summary layers. It never reads a file, an
 * upload, or `evidence/ground-truth/`, and it never writes to a domain
 * table. The only thing it may write is the on-disk LLM response cache
 * (src/lib/ai/cache.ts).
 */

import type {
  CopilotAnswerStatus,
  CopilotClaim,
  CopilotConflict,
  CopilotDerivation,
  CopilotGroundingStatus,
  CopilotResponse,
  CopilotSynthesisMode,
  QuestionAmbiguity,
} from "./contract";

export type {
  CopilotAnswerStatus,
  CopilotClaim,
  CopilotConflict,
  CopilotDerivation,
  CopilotGroundingStatus,
  CopilotResponse,
  CopilotSynthesisMode,
  QuestionAmbiguity,
};

export const COPILOT_STAGES = [
  "parse_question",
  "ground_entities",
  "retrieve_evidence",
  "assemble_pack",
  "build_claims",
  "synthesize_answer",
  "validate_response",
  "verify_citations",
  "result",
] as const;
export type CopilotStage = (typeof COPILOT_STAGES)[number];

export const COPILOT_STAGE_LABELS: Record<CopilotStage, string> = {
  parse_question: "Parse & normalize the question",
  ground_entities: "Ground entity, alias & identifier references",
  retrieve_evidence: "Retrieve persisted evidence & derived intelligence",
  assemble_pack: "Assemble the handle-addressed evidence pack",
  build_claims: "Build the deterministic grounded claim set",
  synthesize_answer: "Synthesize the answer over the claim set",
  validate_response: "Validate against the strict response contract",
  verify_citations: "Verify every citation resolves to a real record",
  result: "Assemble Copilot result",
};

export type StageStatus = "pending" | "running" | "ok" | "skipped" | "failed";

export interface StageReport {
  stage: CopilotStage;
  status: StageStatus;
  detail: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
}

export const COPILOT_ERROR_CODES = [
  "NO_INVESTIGATION",
  "NO_DERIVED_INTELLIGENCE",
  "INVALID_QUESTION",
  "RETRIEVAL_FAILURE",
  "VALIDATION_FAILURE",
  "INTERNAL_ERROR",
] as const;
export type CopilotErrorCode = (typeof COPILOT_ERROR_CODES)[number];

/** A structured, user-safe error. Never carries a stack trace or a secret. */
export interface CopilotError {
  code: CopilotErrorCode;
  stage: CopilotStage;
  message: string;
  issues?: string[];
}

/**
 * A model/API problem. NOT a service failure: the deterministic claim
 * set still answers the question, so a model outage degrades the prose
 * rather than the grounding. Surfaced so the investigator can see that
 * the wording is deterministic and why.
 */
export const COPILOT_MODEL_ERROR_CODES = [
  /** No AI_PROVIDER_API_KEY is configured — the model was never called. */
  "MODEL_NOT_CONFIGURED",
  /** The Claude API call failed (network, rate limit, server error). */
  "MODEL_REQUEST_FAILED",
  /** The model replied, but its output failed schema validation or a grounding guardrail. */
  "MODEL_OUTPUT_REJECTED",
] as const;
export type CopilotModelErrorCode = (typeof COPILOT_MODEL_ERROR_CODES)[number];

export interface CopilotModelError {
  code: CopilotModelErrorCode;
  message: string;
  /** Specific guardrail rejections, when the code is MODEL_OUTPUT_REJECTED. */
  rejections?: string[];
}

export interface CopilotResult {
  status: "answered" | "failed";
  question: string;
  response: CopilotResponse | null;
  /** Non-fatal: set whenever the prose fell back to deterministic narration. */
  modelError: CopilotModelError | null;
  warnings: string[];
  stages: StageReport[];
  error: CopilotError | null;
  startedAt: string;
  finishedAt: string;
}

export type CopilotEvent =
  | { type: "stage"; report: StageReport }
  | { type: "result"; result: CopilotResult };

// --- server-derived state the Copilot screen renders from ---------------

export interface SuggestedQuestion {
  id: string;
  question: string;
  /** One line on what the question exercises, shown under the chip. */
  hint: string;
}

export interface CopilotCorpusCounts {
  evidenceItems: number;
  extractedRecords: number;
  entities: number;
  aliases: number;
  relationships: number;
  analyticalSignals: number;
  corroborationFindings: number;
}

export interface CopilotSummary {
  investigationId: string;
  investigationName: string;
  graphVersion: string;
  counts: CopilotCorpusCounts;
  /** Whether an AI_PROVIDER_API_KEY is present. False → deterministic narration only. */
  modelConfigured: boolean;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  suggestions: SuggestedQuestion[];
}

export type CopilotState =
  | { status: "not_available"; reason: string }
  | { status: "ready"; summary: CopilotSummary };

// --- retrieval / grounding intermediate shapes --------------------------

export const COPILOT_INTENTS = [
  "suspects_overview",
  "relationship_between",
  "financial_path",
  "colocation_at_event",
  "contradictions",
  "structural_significance",
  "intermediary_links",
  "case_summary",
  "entity_profile",
  "open_question",
] as const;
export type CopilotIntent = (typeof COPILOT_INTENTS)[number];

export const COPILOT_INTENT_LABELS: Record<CopilotIntent, string> = {
  suspects_overview: "Suspects & aliases",
  relationship_between: "Relationship between entities",
  financial_path: "Financial connection / transaction path",
  colocation_at_event: "Placement at a location & time",
  contradictions: "Contradictions between sources",
  structural_significance: "Structural significance in the network",
  intermediary_links: "Intermediary linking multiple principals",
  case_summary: "Case summary",
  entity_profile: "Entity profile",
  open_question: "Open question",
};

/** One entity reference recognised in a question. */
export interface GroundedMention {
  /** The exact span of the question text that matched. */
  surface: string;
  /** Character offset of `surface` within the normalized question. */
  offset: number;
  candidates: {
    entityId: string;
    label: string;
    kind: string;
    /** The canonical label, alias value, or identifier that produced the match. */
    matchedOn: string;
  }[];
  /** True when more than one distinct entity matched this surface. */
  ambiguous: boolean;
}

export interface QuestionGrounding {
  question: string;
  normalizedQuestion: string;
  intent: CopilotIntent;
  mentions: GroundedMention[];
  /** Mentions that resolved to exactly one entity, in question order. */
  resolvedEntityIds: string[];
  /** Name-shaped spans that matched no known entity at all. */
  unknownReferences: string[];
}
