import { z } from "zod";

import { InvestigationStatusSchema } from "@/lib/domain/investigation";
import { EvidenceSourceTypeSchema, EvidenceItemTypeSchema } from "@/lib/domain/evidence";
import { EntityKindSchema } from "@/lib/domain/entity";
import { RelationshipTypeSchema } from "@/lib/domain/relationship";
import { EvidenceClassificationSchema } from "@/lib/domain/provenance";

/**
 * The raw, pre-ID fixture manifest format loaded from
 * evidence/synthetic/fixtures/<name>.json. IDs are assigned by the
 * loader (src/lib/fixtures/synthetic-loader.ts), never trusted from
 * the file — this is the same "AI/external input never mints an
 * authoritative ID" rule applied to fixture data.
 */
export const SyntheticFixtureManifestSchema = z.object({
  investigation: z.object({
    name: z.string().min(1),
    status: InvestigationStatusSchema,
  }),
  evidenceSource: z.object({
    sourceType: EvidenceSourceTypeSchema,
    label: z.string().min(1),
  }),
  evidenceItems: z.array(
    z.object({
      itemType: EvidenceItemTypeSchema,
      content: z.record(z.string(), z.unknown()),
    }),
  ),
  entities: z.array(
    z.object({
      kind: EntityKindSchema,
      canonicalLabel: z.string().min(1),
      attributes: z.record(z.string(), z.unknown()),
    }),
  ),
  aliases: z.array(
    z.object({
      entityLabel: z.string().min(1),
      aliasValue: z.string().min(1),
    }),
  ),
  relationships: z.array(
    z.object({
      sourceEntityLabel: z.string().min(1),
      targetEntityLabel: z.string().min(1),
      relationshipType: RelationshipTypeSchema,
      classification: EvidenceClassificationSchema,
    }),
  ),
});
export type SyntheticFixtureManifest = z.infer<typeof SyntheticFixtureManifestSchema>;

/**
 * The ground-truth fixture format, per docs/data/ground-truth-spec.md §3
 * (expected entity merges, expected relationships). References
 * entities by their canonical label rather than by assigned ID, since
 * ground truth is authored independently of any particular loader run
 * (docs/data/ground-truth-spec.md §4).
 */
export const GroundTruthFixtureSchema = z.object({
  expectedEntityMerges: z.array(
    z.object({
      canonicalLabel: z.string().min(1),
      aliases: z.array(z.string()),
    }),
  ),
  expectedRelationships: z.array(
    z.object({
      sourceLabel: z.string().min(1),
      targetLabel: z.string().min(1),
      relationshipType: RelationshipTypeSchema,
    }),
  ),
});
export type GroundTruthFixture = z.infer<typeof GroundTruthFixtureSchema>;
