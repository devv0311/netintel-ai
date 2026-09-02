import { z } from "zod";

import { ProvenanceSchema } from "./provenance";
import { TemporalIntervalSchema } from "./temporal";

/**
 * A CorroborationFinding, per Agent 5 — Spatial/Temporal Corroboration
 * (docs/contracts/agent-contracts.md) and docs/requirements.md §5
 * ("Temporal analysis", "Spatial analysis", "Contradiction detection").
 * Populated by the P5.7 corroboration milestone (src/lib/corroboration/)
 * from the P5.2 persisted communication events, P5.3 extracted event
 * mentions, P5.4 resolved entities, P5.5 synthesized graph, and P5.2
 * persisted locations — never a file, never `evidence/ground-truth/`,
 * and never an invented coordinate or timestamp.
 *
 * A corroboration finding is one of two kinds of claim, and the two are
 * kept deliberately distinct (`docs/requirements.md` §7):
 *
 *   - `corroborated_fact` — a spatial/temporal co-occurrence that is
 *     directly supported by TWO OR MORE distinct source evidence items
 *     (e.g. two separate CDR records placing the same pair at the same
 *     cell tower inside the same window). Independent agreement raises
 *     an Observed Fact to a Corroborated Fact.
 *   - `algorithmic_signal` — a spatial/temporal overlap that is
 *     ALGORITHMICALLY DERIVED (a proximity computation between two
 *     distinct locations, a single-source co-occurrence, a flagged
 *     travel-speed contradiction). It describes the data; it is never
 *     itself a claim that two entities "were together".
 *
 * `observed_fact`, `ai_inference`, and `investigative_lead` are never
 * valid here — a contradiction is always an `algorithmic_signal` (a
 * flagged conflict is never itself a fact), enforced by the refinements
 * below and re-checked in src/lib/corroboration/verify.ts.
 */

export const CORROBORATION_FINDING_TYPES = [
  /** ≥2 distinct entities each observed active at the SAME persisted location. */
  "spatial_co_location",
  /** Two DISTINCT persisted locations within the documented distance threshold, each with entity activity — an algorithmic proximity signal, never "were together". */
  "spatial_proximity",
  /** ≥2 distinct entities each active within the same documented temporal window. */
  "temporal_co_occurrence",
  /** An entity pair co-located AND co-timed on ≥2 separate occasions — repeated spatial/temporal overlap. */
  "repeated_spatiotemporal_overlap",
  /** One entity placed at two locations whose separation implies an impossible travel speed within the observed time delta. */
  "spatiotemporal_contradiction",
] as const;
export const CorroborationFindingTypeSchema = z.enum(CORROBORATION_FINDING_TYPES);
export type CorroborationFindingType = z.infer<typeof CorroborationFindingTypeSchema>;

export const CORROBORATION_KINDS = ["spatial", "temporal", "spatiotemporal"] as const;
export const CorroborationKindSchema = z.enum(CORROBORATION_KINDS);
export type CorroborationKind = z.infer<typeof CorroborationKindSchema>;

/**
 * The only two classifications a corroboration finding may carry — a
 * strict subset of docs/requirements.md §7's five-value taxonomy.
 */
export const CORROBORATION_CLASSIFICATIONS = ["algorithmic_signal", "corroborated_fact"] as const;
export const CorroborationClassificationSchema = z.enum(CORROBORATION_CLASSIFICATIONS);
export type CorroborationClassification = z.infer<typeof CorroborationClassificationSchema>;

export const CorroborationFindingSchema = z
  .object({
    id: z.string().min(1),
    investigationId: z.string().min(1),
    /** The exact P5.5 graph version this finding was computed against (docs/requirements.md §5). */
    graphVersion: z.string().min(1),
    findingType: CorroborationFindingTypeSchema,
    /** Coarse grouping for the investigator UI's tab switcher. */
    kind: CorroborationKindSchema,
    /** The subject entity ids being related (1–2, sorted). A contradiction has exactly one; every other finding relates a pair. */
    entityIds: z.array(z.string().min(1)).min(1).max(2),
    /** The persisted location ids anchoring a spatial finding (0–2, sorted). Empty for a purely temporal finding. */
    locationIds: z.array(z.string().min(1)).max(2),
    /** The temporal window this finding was observed within — null only for a pure spatial-proximity finding. */
    window: TemporalIntervalSchema.nullable(),
    /**
     * Structured metrics only — `distanceMeters`, `windowSeconds`,
     * `occurrenceCount`, `evidenceItemCount`, `impliedSpeedMps`, etc.
     * References ids, never an inline copy of an evidence record.
     */
    value: z.record(z.string(), z.unknown()),
    /** `corroboration:<algorithm>` — e.g. `corroboration:haversine_proximity`, `corroboration:temporal_window`. */
    method: z.string().min(1),
    explanation: z.string().min(1),
    classification: CorroborationClassificationSchema,
    /** Every distinct source evidence item compared to produce this finding (≥1; ≥2 whenever classification is `corroborated_fact`). */
    evidenceItemIds: z.array(z.string().min(1)).min(1),
    /** The persisted observable records compared — `communication_events.id` and/or `extracted_records.id` values (≥1). */
    supportingRecordIds: z.array(z.string().min(1)).min(1),
    provenance: ProvenanceSchema,
  })
  .refine((f) => f.classification !== "corroborated_fact" || f.evidenceItemIds.length >= 2, {
    message: "a corroborated_fact finding must cite two or more distinct evidence items",
    path: ["classification"],
  })
  .refine((f) => f.findingType !== "spatiotemporal_contradiction" || f.classification === "algorithmic_signal", {
    message: "a spatiotemporal_contradiction is always an algorithmic_signal, never a corroborated_fact",
    path: ["classification"],
  });
export type CorroborationFinding = z.infer<typeof CorroborationFindingSchema>;
