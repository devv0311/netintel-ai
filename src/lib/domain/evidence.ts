import { z } from "zod";

import { ValidationErrorSchema, ValidationWarningSchema } from "./validation";

/**
 * Evidence source and evidence item, per Agent 1 — Ingestion
 * (docs/contracts/agent-contracts.md) and docs/requirements.md §5
 * "Evidence ingestion". An EvidenceSource is the originating
 * document/dataset/statement an item was ingested from; an
 * EvidenceItem is one normalized unit produced from it. Neither
 * carries `provenance` in the generic sense used elsewhere in this
 * domain layer — a source IS the root of provenance for everything
 * downstream, and an item's provenance.source field points back to it.
 */

export const EVIDENCE_SOURCE_TYPES = [
  "document",
  "structured_dataset",
  "statement",
] as const;
export const EvidenceSourceTypeSchema = z.enum(EVIDENCE_SOURCE_TYPES);
export type EvidenceSourceType = z.infer<typeof EvidenceSourceTypeSchema>;

export const EvidenceSourceSchema = z.object({
  id: z.string().min(1),
  investigationId: z.string().min(1),
  sourceType: EvidenceSourceTypeSchema,
  /** Human-readable reference to the origin, e.g. a filename or dataset name. */
  label: z.string().min(1),
  ingestedAt: z.string().datetime(),
});
export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;

/**
 * The evidence item categories required by
 * docs/data/synthetic-investigation-spec.md §2.
 */
export const EVIDENCE_ITEM_TYPES = [
  "fir",
  "suspect_record",
  "alias_record",
  "phone_record",
  "imei_record",
  "vehicle_record",
  "bank_account_record",
  "location_record",
  "cdr_event",
  "financial_transaction_record",
  "witness_statement",
  "crime_event",
] as const;
export const EvidenceItemTypeSchema = z.enum(EVIDENCE_ITEM_TYPES);
export type EvidenceItemType = z.infer<typeof EvidenceItemTypeSchema>;

export const EVIDENCE_ITEM_VALIDATION_STATUSES = ["accepted", "rejected"] as const;
export const EvidenceItemValidationStatusSchema = z.enum(
  EVIDENCE_ITEM_VALIDATION_STATUSES,
);
export type EvidenceItemValidationStatus = z.infer<
  typeof EvidenceItemValidationStatusSchema
>;

export const EvidenceItemSchema = z.object({
  id: z.string().min(1),
  investigationId: z.string().min(1),
  evidenceSourceId: z.string().min(1),
  itemType: EvidenceItemTypeSchema,
  /** The normalized content of this item, in whatever shape its itemType implies. */
  content: z.record(z.string(), z.unknown()),
  ingestedAt: z.string().datetime(),
  validationStatus: EvidenceItemValidationStatusSchema,
  /** Required when validationStatus is "rejected"; per-item, not batch-level. */
  rejectionReason: z.string().optional(),
  errors: z.array(ValidationErrorSchema),
  warnings: z.array(ValidationWarningSchema),
  confidence: z.number().min(0).max(1),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;
