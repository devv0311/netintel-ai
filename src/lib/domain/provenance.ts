import { z } from "zod";

/**
 * Evidence classification labels, per docs/requirements.md §7.
 * Every derived fact, finding, or answer the system produces must carry
 * exactly one of these — established-fact language is reserved for the
 * first two. Deliberately kept SEPARATE from confidence (below):
 * classification says what kind of claim this is, confidence says how
 * sure the system is of it. Collapsing the two into one enum would lose
 * that distinction, which is why this milestone's brief calls it out
 * explicitly.
 */
export const EVIDENCE_CLASSIFICATIONS = [
  "observed_fact",
  "corroborated_fact",
  "algorithmic_signal",
  "ai_inference",
  "investigative_lead",
] as const;

export const EvidenceClassificationSchema = z.enum(EVIDENCE_CLASSIFICATIONS);
export type EvidenceClassification = z.infer<typeof EvidenceClassificationSchema>;

/** A confidence value, 0 (no confidence) to 1 (certain). A plain number, not an enum. */
export const ConfidenceSchema = z.number().min(0).max(1);
export type Confidence = z.infer<typeof ConfidenceSchema>;

/**
 * The minimum provenance fields required on every extracted or derived
 * intelligence item, per docs/requirements.md §8. No stage may emit an
 * item lacking these, and no persisted row may be read back without
 * them validating.
 */
export const ProvenanceSchema = z.object({
  /** The originating evidence item(s) or upstream derived item(s). */
  source: z.string().min(1),
  /** Where within the source the item was found (section, record ID, field). */
  location: z.string().min(1),
  /** What process produced this item (extraction step, resolution rule, algorithm). */
  method: z.string().min(1),
  /** The system's confidence in the item. */
  confidence: ConfidenceSchema,
  /** The chain of upstream items/steps that contributed to this item. */
  processingHistory: z.array(z.string()),
  /** When this item was produced/derived (ISO-8601; distinct from any in-evidence event timestamp). */
  timestamp: z.string().datetime(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;
