import { z } from "zod";

import { ProvenanceSchema } from "./provenance";

/**
 * An ExtractedRecord is one structured item (entity mention, event
 * mention, relationship mention, or attribute mention) pulled from an
 * EvidenceItem, per docs/requirements.md §5 "Information extraction"
 * and the extraction responsibility described alongside Agent 1 in
 * docs/contracts/agent-contracts.md. It always cites the exact source
 * location within its evidence item via `provenance.location`.
 */
export const EXTRACTED_RECORD_TYPES = [
  "entity_mention",
  "event_mention",
  "relationship_mention",
  "attribute_mention",
] as const;
export const ExtractedRecordTypeSchema = z.enum(EXTRACTED_RECORD_TYPES);
export type ExtractedRecordType = z.infer<typeof ExtractedRecordTypeSchema>;

export const ExtractedRecordSchema = z.object({
  id: z.string().min(1),
  evidenceItemId: z.string().min(1),
  recordType: ExtractedRecordTypeSchema,
  /** The extracted payload, shaped according to recordType. */
  data: z.record(z.string(), z.unknown()),
  provenance: ProvenanceSchema,
});
export type ExtractedRecord = z.infer<typeof ExtractedRecordSchema>;
