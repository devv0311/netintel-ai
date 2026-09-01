/**
 * Evidence classification labels, per docs/requirements.md §7.
 * Every derived fact, finding, or answer the system produces must carry
 * exactly one of these — established-fact language is reserved for the
 * first two.
 */
export const EVIDENCE_CLASSIFICATIONS = [
  "observed_fact",
  "corroborated_fact",
  "algorithmic_signal",
  "ai_inference",
  "investigative_lead",
] as const;

export type EvidenceClassification = (typeof EVIDENCE_CLASSIFICATIONS)[number];

/**
 * The minimum provenance fields required on every extracted or derived
 * intelligence item, per docs/requirements.md §8. No stage may emit an
 * item lacking these.
 */
export interface Provenance {
  /** The originating evidence item(s) or upstream derived item(s). */
  source: string;
  /** Where within the source the item was found (section, record ID, field). */
  location: string;
  /** What process produced this item (extraction step, resolution rule, algorithm). */
  method: string;
  /** The system's confidence in the item, 0-1. */
  confidence: number;
  /** The chain of upstream items/steps that contributed to this item. */
  processingHistory: string[];
  /** When this item was produced/derived (distinct from any in-evidence event timestamp). */
  timestamp: string;
}

/** A derived intelligence item: some payload plus its required provenance and classification. */
export interface Provenanced<T> {
  data: T;
  provenance: Provenance;
  classification: EvidenceClassification;
}
