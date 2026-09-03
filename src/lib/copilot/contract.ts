import { z } from "zod";

import {
  ConfidenceSchema,
  EvidenceClassificationSchema,
  ProvenanceSchema,
  type EvidenceClassification,
} from "@/lib/domain/provenance";

/**
 * The Investigation Copilot's strict response contract, per Agent 6
 * (docs/contracts/agent-contracts.md) and docs/requirements.md §5
 * ("Investigation Copilot", "Evidence-grounded answers"), §7 (evidence
 * classification) and §8 (provenance).
 *
 * Nothing reaches the UI without validating against
 * `CopilotResponseSchema`. Two separate schemas live here and they are
 * deliberately NOT the same object:
 *
 *   - `ModelAnswerSchema` — the ONLY thing a language model is allowed
 *     to produce. It carries prose and citation handles; it carries no
 *     identifiers, no classifications, no confidences, and no
 *     provenance. The model can therefore not mint an ID, relabel a
 *     claim's evidence classification, or invent a confidence: those
 *     are all owned by deterministic application code, exactly as
 *     src/lib/domain/ids.ts owns identifier minting.
 *
 *   - `CopilotResponseSchema` — the validated answer the API and the UI
 *     see. Every claim in it carries its own classification, its own
 *     confidence, and its own resolved citations into already-persisted
 *     records (evidence items, extracted records, entities,
 *     relationships, analytical signals, corroboration findings). It
 *     never inlines an evidence payload; it references ids that the
 *     existing endpoints already resolve.
 *
 * The evidence classification taxonomy is the project's existing
 * five-value one (docs/requirements.md §7) — imported, never redefined.
 */

/** Bumped whenever the model-facing output schema changes; part of the LLM cache key. */
export const COPILOT_SCHEMA_VERSION = "copilot.answer.v1";

// --- what a model may return -------------------------------------------

/**
 * A citation handle is a short, pack-local label (`C3`, `EV12`, `EN4`)
 * minted by deterministic retrieval, never a database identifier. The
 * model only ever sees and returns handles, so a hallucinated citation
 * is a handle that is not in the pack — caught by
 * src/lib/copilot/verify.ts rather than trusted.
 */
export const CITATION_HANDLE_PATTERN = /^(C|EV|XR|EN|RE|AS|CF)[0-9]{1,4}$/;
export const CitationHandleSchema = z.string().regex(CITATION_HANDLE_PATTERN);

export const ModelAnswerSchema = z.object({
  /**
   * The prose answer. Every sentence that makes a claim must carry one
   * or more inline `[Cn]` citation handles drawn from the grounded
   * claim set supplied in the prompt.
   */
  answer: z.string().min(1).max(6000),
  /** The claim handles the answer relies on (each must exist in the supplied claim set). */
  usedClaimIds: z.array(CitationHandleSchema).max(64),
  /** Hedges/limits the investigator must read alongside the answer. */
  caveats: z.array(z.string().min(1).max(500)).max(12),
  /** True when the supplied claim set does not support answering the question. */
  insufficientEvidence: z.boolean(),
});
export type ModelAnswer = z.infer<typeof ModelAnswerSchema>;

// --- the validated response --------------------------------------------

/**
 * How a claim came to exist. `retrieved` — read directly off a
 * persisted record. `derived` — computed deterministically by the
 * Copilot's own retrieval layer from persisted records (e.g. "no direct
 * relationship exists between A and B"). No third value exists, because
 * a model never authors a claim.
 */
export const CLAIM_DERIVATIONS = ["retrieved", "derived"] as const;
export const ClaimDerivationSchema = z.enum(CLAIM_DERIVATIONS);
export type ClaimDerivation = z.infer<typeof ClaimDerivationSchema>;

/** Resolved references into already-persisted records. Ids only — never a duplicated payload. */
export const ClaimCitationsSchema = z.object({
  evidenceItemIds: z.array(z.string().min(1)),
  extractedRecordIds: z.array(z.string().min(1)),
  entityIds: z.array(z.string().min(1)),
  relationshipIds: z.array(z.string().min(1)),
  analyticalSignalIds: z.array(z.string().min(1)),
  corroborationFindingIds: z.array(z.string().min(1)),
});
export type ClaimCitations = z.infer<typeof ClaimCitationsSchema>;

/**
 * One claim in an answer. Per Agent 6's contract, classification and
 * confidence are assigned PER CLAIM, never as one blanket value for the
 * whole answer — an answer may legitimately mix a Corroborated Fact
 * with an AI Inference, and must label them distinctly.
 */
export const CopilotClaimSchema = z
  .object({
    /** Pack-local handle (`C1`, `C2`, …) used for citation inside the answer prose. */
    id: CitationHandleSchema,
    statement: z.string().min(1),
    classification: EvidenceClassificationSchema,
    confidence: ConfidenceSchema,
    derivation: ClaimDerivationSchema,
    /** Human-readable account of the records and method the claim came from. */
    explanation: z.string().min(1),
    citations: ClaimCitationsSchema,
  })
  .refine(
    (c) =>
      c.citations.evidenceItemIds.length +
        c.citations.extractedRecordIds.length +
        c.citations.entityIds.length +
        c.citations.relationshipIds.length +
        c.citations.analyticalSignalIds.length +
        c.citations.corroborationFindingIds.length >
      0,
    { message: "every claim must cite at least one persisted record", path: ["citations"] },
  );
export type CopilotClaim = z.infer<typeof CopilotClaimSchema>;

/** An entity reference the question could have meant, offered instead of a guess. */
export const AmbiguityCandidateSchema = z.object({
  entityId: z.string().min(1),
  label: z.string().min(1),
  kind: z.string().min(1),
  /** Why this candidate matched — the alias/identifier surface that produced it. */
  matchedOn: z.string().min(1),
});
export type AmbiguityCandidate = z.infer<typeof AmbiguityCandidateSchema>;

export const QuestionAmbiguitySchema = z.object({
  /** The exact span of the question that was ambiguous. */
  surface: z.string().min(1),
  candidates: z.array(AmbiguityCandidateSchema).min(2),
});
export type QuestionAmbiguity = z.infer<typeof QuestionAmbiguitySchema>;

/**
 * A conflict between sources that bears on the question. Exposed, never
 * resolved in favour of one side (docs/requirements.md §5,
 * "Contradiction detection").
 */
export const CopilotConflictSchema = z.object({
  summary: z.string().min(1),
  /** The claim(s) that carry this conflict, so the UI can link the banner to the cited claim. */
  claimIds: z.array(CitationHandleSchema).min(1),
  /** The distinct source evidence items behind the conflicting sides — a conflict needs at least two. */
  evidenceItemIds: z.array(z.string().min(1)).min(2),
});
export type CopilotConflict = z.infer<typeof CopilotConflictSchema>;

export const COPILOT_GROUNDING_STATUSES = [
  "fully_grounded",
  "partially_grounded",
  "insufficient_evidence",
] as const;
export const CopilotGroundingStatusSchema = z.enum(COPILOT_GROUNDING_STATUSES);
export type CopilotGroundingStatus = z.infer<typeof CopilotGroundingStatusSchema>;

export const COPILOT_ANSWER_STATUSES = [
  /** A grounded answer was produced. */
  "answered",
  /** Retrieval found nothing that supports an answer — say so, never fabricate. */
  "insufficient_evidence",
  /** An entity reference in the question matched more than one entity — expose candidates, never guess. */
  "ambiguous",
] as const;
export const CopilotAnswerStatusSchema = z.enum(COPILOT_ANSWER_STATUSES);
export type CopilotAnswerStatus = z.infer<typeof CopilotAnswerStatusSchema>;

/**
 * How the prose was produced. The GROUNDED MATERIAL is deterministic in
 * every mode — only the wording differs, and the mode is always
 * disclosed (docs/requirements.md §6: nondeterminism must be isolated
 * and disclosed, not silently mixed into deterministic steps).
 */
export const COPILOT_SYNTHESIS_MODES = [
  /** Claude narrated the deterministic claim set, and its output passed every guardrail. */
  "llm_synthesis",
  /** No model configured/reachable — the deterministic narration of the same claim set was used. */
  "deterministic",
  /** A model answer was produced but REJECTED by a guardrail; the deterministic narration was used instead. */
  "deterministic_fallback",
] as const;
export const CopilotSynthesisModeSchema = z.enum(COPILOT_SYNTHESIS_MODES);
export type CopilotSynthesisMode = z.infer<typeof CopilotSynthesisModeSchema>;

export const CopilotDerivationSchema = z.object({
  mode: CopilotSynthesisModeSchema,
  model: z.string().min(1),
  modelVersion: z.string().min(1),
  promptVersion: z.string().min(1),
  schemaVersion: z.string().min(1),
  /** Whether the model response was served from the on-disk LLM cache. */
  cache: z.enum(["hit", "miss", "bypass"]),
  /** Guardrail rejections recorded for this answer (empty when none fired). */
  rejections: z.array(z.string().min(1)),
});
export type CopilotDerivation = z.infer<typeof CopilotDerivationSchema>;

/** Ids the UI can hand to the existing graph / analytics / corroboration screens. */
export const RelatedViewsSchema = z.object({
  entityIds: z.array(z.string().min(1)),
  relationshipIds: z.array(z.string().min(1)),
  analyticalSignalIds: z.array(z.string().min(1)),
  corroborationFindingIds: z.array(z.string().min(1)),
});
export type RelatedViews = z.infer<typeof RelatedViewsSchema>;

/**
 * Classification strength, strongest first. Used to derive the
 * answer-level classification as the WEAKEST classification among the
 * claims the answer rests on — so an answer is never presented as
 * better established than its weakest supporting claim. Per-claim
 * labels remain authoritative; this is a reading floor, not a
 * replacement.
 */
export const CLASSIFICATION_STRENGTH: Record<EvidenceClassification, number> = {
  corroborated_fact: 5,
  observed_fact: 4,
  algorithmic_signal: 3,
  ai_inference: 2,
  investigative_lead: 1,
};

export const CopilotResponseSchema = z
  .object({
    question: z.string().min(1),
    /** Whitespace-normalized question, the form used for cache identity. */
    normalizedQuestion: z.string().min(1),
    status: CopilotAnswerStatusSchema,
    grounding: CopilotGroundingStatusSchema,
    answer: z.string().min(1),
    /** The weakest classification among the cited claims — a reading floor for the whole answer. */
    classification: EvidenceClassificationSchema,
    /** The minimum per-claim confidence among the cited claims. */
    confidence: ConfidenceSchema,
    claims: z.array(CopilotClaimSchema),
    caveats: z.array(z.string().min(1)),
    conflicts: z.array(CopilotConflictSchema),
    ambiguities: z.array(QuestionAmbiguitySchema),

    // Flattened supporting-id roll-ups (the union across every claim),
    // so a consumer never has to re-walk the claim list to answer
    // "what does this answer rest on?".
    supportingEvidenceIds: z.array(z.string().min(1)),
    supportingExtractedRecordIds: z.array(z.string().min(1)),
    supportingEntityIds: z.array(z.string().min(1)),
    supportingRelationshipIds: z.array(z.string().min(1)),
    supportingAnalyticalSignalIds: z.array(z.string().min(1)),
    supportingCorroborationFindingIds: z.array(z.string().min(1)),

    relatedViews: RelatedViewsSchema,
    derivation: CopilotDerivationSchema,
    /** The graph version the derived intelligence in this answer was computed against. */
    graphVersion: z.string().min(1).nullable(),
    provenance: ProvenanceSchema,
  })
  // An answered response must actually rest on something.
  .refine((r) => r.status !== "answered" || r.claims.length > 0, {
    message: "an answered response must carry at least one grounded claim",
    path: ["claims"],
  })
  // "Insufficient evidence" and "fully grounded" are mutually exclusive.
  .refine((r) => r.status !== "insufficient_evidence" || r.grounding === "insufficient_evidence", {
    message: "an insufficient_evidence response must report insufficient_evidence grounding",
    path: ["grounding"],
  })
  .refine((r) => r.grounding !== "fully_grounded" || r.claims.length > 0, {
    message: "a fully_grounded response must carry at least one grounded claim",
    path: ["grounding"],
  })
  // An ambiguous response must expose the candidates rather than guess.
  .refine((r) => r.status !== "ambiguous" || r.ambiguities.length > 0, {
    message: "an ambiguous response must expose the candidate entities it declined to choose between",
    path: ["ambiguities"],
  })
  // The answer-level classification is a floor, never stronger than the weakest claim.
  .refine(
    (r) =>
      r.claims.length === 0 ||
      CLASSIFICATION_STRENGTH[r.classification] ===
        Math.min(...r.claims.map((c) => CLASSIFICATION_STRENGTH[c.classification])),
    {
      message: "answer classification must equal the weakest per-claim classification",
      path: ["classification"],
    },
  )
  // Every conflict must reference claims that are actually present.
  .refine(
    (r) => r.conflicts.every((c) => c.claimIds.every((id) => r.claims.some((claim) => claim.id === id))),
    { message: "a conflict may only reference claims present in the response", path: ["conflicts"] },
  );
export type CopilotResponse = z.infer<typeof CopilotResponseSchema>;
