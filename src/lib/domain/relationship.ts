import { z } from "zod";

import { EvidenceClassificationSchema, ProvenanceSchema } from "./provenance";

/**
 * A Relationship (graph edge), per Agent 3 — Graph Synthesis
 * (docs/contracts/agent-contracts.md): "every edge row carries evidence
 * references and an evidence-classification field; an edge without
 * them fails validation and is rejected." Population happens in the
 * Graph Synthesis milestone (Workstream D) — this milestone only
 * establishes the shape and the persistence path.
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
  classification: EvidenceClassificationSchema,
  provenance: ProvenanceSchema,
});
export type Relationship = z.infer<typeof RelationshipSchema>;
