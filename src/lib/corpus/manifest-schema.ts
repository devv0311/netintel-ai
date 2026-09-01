import { z } from "zod";

import { InvestigationStatusSchema } from "../domain/investigation";
import {
  EvidenceSourceTypeSchema,
  EvidenceItemTypeSchema,
} from "../domain/evidence";
import { LocationTypeSchema } from "../domain/location";
import { RelationshipTypeSchema } from "../domain/relationship";
import { EvidenceClassificationSchema } from "../domain/provenance";

/**
 * The Operation DarkNet Delhi corpus manifest format.
 *
 * This IS the P4.2 synthetic-fixture manifest format
 * (src/lib/fixtures/schema.ts) scaled to the full dataset — not a second,
 * incompatible format:
 *
 *   - same top-level concepts: one investigation, evidence sources, and
 *     evidence items whose `content` is a free-form record whose shape is
 *     implied by `itemType`;
 *   - same domain enums (EvidenceItemTypeSchema, EvidenceSourceTypeSchema,
 *     LocationTypeSchema, RelationshipTypeSchema, EvidenceClassificationSchema);
 *   - same rule that the file never carries an authoritative primary key —
 *     the loader (load.ts) assigns every domain-row id via
 *     src/lib/domain/ids.ts, exactly as the foundation-smoke loader does.
 *
 * It adds: `corpus` metadata (version, seed, generatedAt) so the dataset
 * is a fixed versioned artifact; and first-class arrays for the three
 * structured observational tables P4.2 defined "for the full dataset"
 * (locations, communicationEvents, financialTransactions), each linked
 * back to an evidence item by a local `ref`. `foundation-smoke.json` and
 * its loader are untouched and keep working.
 *
 * Local join handles used only inside the file (never persisted):
 *   - evidenceSources[].key        referenced by evidenceItems[].sourceKey
 *   - evidenceItems[].ref          referenced by *.sourceRef
 *   - locations[].ref              referenced by communicationEvents[].cellLocationRef
 */

const RefSchema = z.string().min(1);

export const CorpusMetaSchema = z.object({
  name: z.literal("operation-darknet-delhi"),
  version: z.string().min(1),
  seed: z.number().int(),
  generatedAt: z.string().datetime(),
  description: z.string().min(1),
});

export const CorpusManifestSchema = z.object({
  corpus: CorpusMetaSchema,
  investigation: z.object({
    name: z.string().min(1),
    status: InvestigationStatusSchema,
  }),
  evidenceSources: z
    .array(
      z.object({
        key: RefSchema,
        sourceType: EvidenceSourceTypeSchema,
        label: z.string().min(1),
      }),
    )
    .min(1),
  evidenceItems: z
    .array(
      z.object({
        ref: RefSchema,
        sourceKey: RefSchema,
        itemType: EvidenceItemTypeSchema,
        content: z.record(z.string(), z.unknown()),
      }),
    )
    .min(1),
  locations: z.array(
    z.object({
      ref: RefSchema,
      sourceRef: RefSchema,
      label: z.string().min(1),
      locationType: LocationTypeSchema,
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    }),
  ),
  communicationEvents: z.array(
    z.object({
      sourceRef: RefSchema,
      callerPhone: z.string().min(1),
      calleePhone: z.string().min(1),
      occurredAt: z.string().datetime(),
      durationSeconds: z.number().int().min(0),
      cellLocationRef: RefSchema.optional(),
    }),
  ),
  financialTransactions: z.array(
    z.object({
      sourceRef: RefSchema,
      amount: z.number().positive(),
      currency: z.string().min(1),
      occurredAt: z.string().datetime(),
    }),
  ),
});
export type CorpusManifest = z.infer<typeof CorpusManifestSchema>;

/**
 * The ground-truth artifact format for Operation DarkNet Delhi, covering
 * every content category in docs/data/ground-truth-spec.md §3. It
 * references parties/entities by design key or canonical label — never
 * by a loader-assigned id — because ground truth is authored from the
 * case design, independently of any loader run (spec §4).
 *
 * This schema lives beside the corpus manifest schema but is loaded ONLY
 * by ground-truth.ts, which is never reachable from the application
 * evidence path (see load.ts and tests/unit/corpus.test.ts).
 */
export const CorpusGroundTruthSchema = z.object({
  corpus: z.object({
    name: z.literal("operation-darknet-delhi"),
    version: z.string().min(1),
    seed: z.number().int(),
  }),
  keyActors: z.object({
    principalSuspects: z
      .array(
        z.object({
          key: z.string().min(1),
          canonicalName: z.string().min(1),
          role: z.string().min(1),
          aliases: z.array(z.string()),
          phones: z.array(z.string()),
          accounts: z.array(z.string()),
          vehicles: z.array(z.string()),
        }),
      )
      .min(8),
    intermediaries: z
      .array(
        z.object({
          key: z.string().min(1),
          name: z.string().min(1),
          role: z.enum(["money_mule", "communication_intermediary"]),
          phones: z.array(z.string()),
          accounts: z.array(z.string()),
        }),
      )
      .min(1),
  }),
  expectedEntityMerges: z
    .array(
      z.object({
        entityKey: z.string().min(1),
        canonicalLabel: z.string().min(1),
        sourceMentions: z.array(z.string().min(1)).min(1),
        aliases: z.array(z.string()),
      }),
    )
    .min(1),
  doNotMerge: z
    .array(
      z.object({
        a: z.string().min(1),
        b: z.string().min(1),
        reason: z.string().min(1),
      }),
    )
    .min(1),
  aliasMap: z
    .array(
      z.object({
        alias: z.string().min(1),
        entityKey: z.string().min(1),
        note: z.string().optional(),
      }),
    )
    .min(1),
  expectedRelationships: z
    .array(
      z.object({
        sourceKey: z.string().min(1),
        targetKey: z.string().min(1),
        relationshipType: RelationshipTypeSchema,
        classification: EvidenceClassificationSchema,
        explicit: z.boolean(),
        materiality: z.enum(["material", "noise"]),
        evidenceRefs: z.array(z.string()),
      }),
    )
    .min(1),
  hiddenConnections: z
    .array(
      z.object({
        between: z.array(z.string().min(1)).length(2),
        reason: z.string().min(1),
        evidenceChain: z.array(z.string().min(1)).min(2),
        recoverableBy: z.array(z.string().min(1)).min(1),
      }),
    )
    .min(1),
  moneyMulePaths: z
    .array(
      z.object({
        pathAccounts: z.array(z.string().min(1)).min(3),
        holders: z.array(z.string().min(1)).min(3),
        approxTotalRouted: z.number().nonnegative(),
        txnRefs: z.array(z.string()),
      }),
    )
    .min(1),
  temporalCorrelations: z
    .array(
      z.object({
        key: z.string().min(1),
        phones: z.array(z.string().min(1)).min(1),
        cellTower: z.string().min(1),
        windowStart: z.string().datetime(),
        windowEnd: z.string().datetime(),
        meaning: z.string().min(1),
      }),
    )
    .min(1),
  spatialCorrelations: z
    .array(
      z.object({
        entities: z.array(z.string().min(1)).min(1),
        locationKey: z.string().min(1),
        at: z.string().datetime(),
        basis: z.string().min(1),
      }),
    )
    .min(1),
  contradictions: z
    .array(
      z.object({
        kind: z.enum(["location_time", "attribute", "attribution"]),
        sources: z.array(z.string().min(1)).min(2),
        subject: z.string().min(1),
        detail: z.string().min(1),
        resolutionForbidden: z.literal(true),
      }),
    )
    .min(1),
  misleadingRelationships: z
    .array(
      z.object({
        key: z.string().min(1),
        between: z.array(z.string().min(1)).min(2),
        type: z.enum(["communication", "financial"]),
        detail: z.string().min(1),
        materiality: z.literal("noise"),
      }),
    )
    .min(1),
  expectedCommunities: z
    .array(
      z.object({
        key: z.string().min(1),
        members: z.array(z.string().min(1)).min(2),
      }),
    )
    .min(1),
  expectedSignals: z
    .array(
      z.object({
        entityKey: z.string().min(1),
        signal: z.string().min(1),
        rationale: z.string().min(1),
      }),
    )
    .min(1),
  intendedConclusions: z.array(z.string().min(1)).min(1),
  expectedCopilotAnswers: z
    .array(
      z.object({
        question: z.number().int().min(1).max(8),
        expects: z.string().min(1),
        boundEntities: z.array(z.string()).optional(),
      }),
    )
    .length(8),
});
export type CorpusGroundTruth = z.infer<typeof CorpusGroundTruthSchema>;
