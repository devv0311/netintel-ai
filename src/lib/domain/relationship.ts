import { z } from "zod";

import { EvidenceClassificationSchema, ProvenanceSchema } from "./provenance";

/**
 * A Relationship (graph edge), per Agent 3 — Graph Synthesis
 * (docs/contracts/agent-contracts.md): "every edge row carries evidence
 * references and an evidence-classification field; an edge without
 * them fails validation and is rejected." Populated by the P5.5 graph
 * synthesis milestone (src/lib/graph/) from P5.4's resolved entities and
 * P5.3's extracted records — never by identity resolution itself.
 */
export const RELATIONSHIP_TYPES = [
  "communication",
  "financial",
  "co_location",
  "family",
  "associate",
  "ownership",
  "other",
] as const;
export const RelationshipTypeSchema = z.enum(RELATIONSHIP_TYPES);
export type RelationshipType = z.infer<typeof RelationshipTypeSchema>;

export const RelationshipSchema = z.object({
  id: z.string().min(1),
  investigationId: z.string().min(1),
  sourceEntityId: z.string().min(1),
  targetEntityId: z.string().min(1),
  relationshipType: RelationshipTypeSchema,
  /** Whether direction (source → target) is investigatively meaningful (e.g. caller → callee, from-account → to-account) vs. a symmetric association (e.g. co-location). */
  directed: z.boolean(),
  /** Every evidence item that contributed to this edge (≥1) — the "why does this edge exist" answer at the source-document level. */
  evidenceItemIds: z.array(z.string().min(1)).min(1),
  /** Every extracted_record id that contributed to this edge (≥1) — the fact-level trace. */
  extractedRecordIds: z.array(z.string().min(1)).min(1),
  /** Human-readable conflict/warning descriptions; empty when there is nothing to flag. */
  conflicts: z.array(z.string()),
  /** Edge-kind-specific aggregate data (e.g. eventCount/firstObservedAt/lastObservedAt/totalAmount). Empty for simple ownership edges. */
  attributes: z.record(z.string(), z.unknown()),
  classification: EvidenceClassificationSchema,
  provenance: ProvenanceSchema,
});
export type Relationship = z.infer<typeof RelationshipSchema>;
