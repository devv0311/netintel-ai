import { z } from "zod";

import { ProvenanceSchema } from "./provenance";

/**
 * A ResolutionDecision, per Agent 2 — Entity Resolution
 * (docs/contracts/agent-contracts.md) and docs/requirements.md §7: an
 * entity-resolution merge decision is, by the requirements document's
 * own definition, "a conclusion produced by extraction, entity
 * resolution, relationship inference, or the Copilot that goes beyond
 * directly observed evidence" — i.e. always AI Inference, never
 * Observed Fact, however deterministic/rule-based the decision logic
 * is. `classification` is therefore fixed to the literal "ai_inference"
 * (matching the fixed-literal pattern already used by
 * AnalyticalSignal/AIInference/InvestigativeLead in ./derived.ts).
 *
 * Deliberately kept distinct from Entity/Alias (./entity.ts) per this
 * milestone's brief: the canonical entity records what IS (a clean,
 * resolved identity), while the ResolutionDecision records WHY/HOW a
 * particular extracted record was assigned to it — one row per
 * extracted record processed, so every mention's own resolution
 * rationale, confidence, and any detected ambiguity remain individually
 * traceable (never collapsed into an opaque summary on the entity
 * itself).
 */
export const RESOLUTION_TYPES = [
  /** A phone/IMEI/vehicle/bank-account value canonicalized 1:1 — no ambiguity possible. */
  "canonicalized_identifier",
  /** A person mention merged into a cluster via a shared phone/account/vehicle identifier stated by its own evidence item. */
  "shared_identifier_merge",
  /** A person mention merged into an existing identifier-anchored cluster because its exact name string matches exactly one such cluster. */
  "exact_name_match",
  /** A mention with no corroborating merge evidence — becomes its own new canonical entity. */
  "new_entity",
  /** A mention whose exact name string matches two or more distinct identifier-anchored clusters — explicitly NOT merged into any of them. */
  "ambiguous_name_conflict",
  /**
   * A mention whose own record asserts two or more distinct values of one
   * mergeable identifier scheme — explicitly NOT merged on any of them.
   * At most one such value can be right and the record does not say which,
   * so merging on either would be a guess carrying a merge's confidence.
   * See src/lib/resolution/identifier-authority.ts.
   */
  "ambiguous_identifier_conflict",
] as const;
export const ResolutionTypeSchema = z.enum(RESOLUTION_TYPES);
export type ResolutionType = z.infer<typeof ResolutionTypeSchema>;

export const RESOLUTION_STATUSES = ["resolved", "ambiguous"] as const;
export const ResolutionStatusSchema = z.enum(RESOLUTION_STATUSES);
export type ResolutionStatus = z.infer<typeof ResolutionStatusSchema>;

export const ResolutionDecisionSchema = z.object({
  id: z.string().min(1),
  investigationId: z.string().min(1),
  /** The canonical entity this decision assigns its extracted record(s) to — always set, even when status is "ambiguous" (the mention still becomes its own entity; it is never dropped, per Agent 2's contract). */
  canonicalEntityId: z.string().min(1),
  /** The extracted_record id(s) this decision covers. */
  extractedRecordIds: z.array(z.string().min(1)).min(1),
  resolutionType: ResolutionTypeSchema,
  status: ResolutionStatusSchema,
  /** Populated only when status is "ambiguous": the other candidate entities this mention's name also matched, none of which it was merged into. */
  candidateEntityIds: z.array(z.string().min(1)),
  /** Human-readable conflict/warning descriptions; empty when there is nothing to flag. */
  conflicts: z.array(z.string()),
  /** Human-readable justification for this specific decision. */
  reason: z.string().min(1),
  classification: z.literal("ai_inference"),
  provenance: ProvenanceSchema,
});
export type ResolutionDecision = z.infer<typeof ResolutionDecisionSchema>;

/** Merges strictly below this confidence are never auto-applied (docs/contracts/agent-contracts.md, Agent 2). */
export const MERGE_CONFIDENCE_FLOOR = 0.5;
