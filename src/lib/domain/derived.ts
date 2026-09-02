import { z } from "zod";

import { ConfidenceSchema, ProvenanceSchema } from "./provenance";

/**
 * The three "beyond directly observed evidence" derived-item kinds
 * named in docs/requirements.md §7 that are not themselves facts.
 * Each fixes its `classification` field to the matching evidence
 * classification literal (rather than leaving it a free enum) so a
 * mislabeled row — e.g. an AI inference stored without the
 * "ai_inference" label — fails validation instead of silently passing
 * as some other kind of claim.
 */

/**
 * An AnalyticalSignal, per Agent 4 — Topology Analytics
 * (docs/contracts/agent-contracts.md): "signals are labeled as
 * Algorithmic Signal — they describe the graph, they are not
 * themselves claims about the world, and must never be presented as
 * fact." Populated by the P5.6 analytics milestone (src/lib/analytics/)
 * from the P5.5 graph. "path" is reserved for a future persisted-path
 * use case; P5.6 itself computes shortest paths live (never persisted —
 * see docs/data/analytics.md) since a path is a query-parameterized
 * result, not a corpus-wide signal.
 */
export const ANALYTICAL_SIGNAL_TYPES = [
  "degree",
  "centrality",
  "bridge",
  "community",
  "ranking",
  "path",
] as const;
export const AnalyticalSignalTypeSchema = z.enum(ANALYTICAL_SIGNAL_TYPES);
export type AnalyticalSignalType = z.infer<typeof AnalyticalSignalTypeSchema>;

export const AnalyticalSignalSchema = z.object({
  id: z.string().min(1),
  investigationId: z.string().min(1),
  graphVersion: z.string().min(1),
  targetEntityId: z.string().min(1).optional(),
  signalType: AnalyticalSignalTypeSchema,
  value: z.record(z.string(), z.unknown()),
  method: z.string().min(1),
  explanation: z.string().min(1),
  classification: z.literal("algorithmic_signal"),
  provenance: ProvenanceSchema,
});
export type AnalyticalSignal = z.infer<typeof AnalyticalSignalSchema>;

/**
 * An AIInference — a conclusion produced by extraction, entity
 * resolution, relationship inference, or the Copilot that goes beyond
 * directly observed evidence (docs/requirements.md §7). Population
 * happens once those stages exist.
 */
export const AIInferenceSchema = z.object({
  id: z.string().min(1),
  investigationId: z.string().min(1),
  claim: z.string().min(1),
  /** IDs of the evidence/derived items this inference is based on. */
  basedOn: z.array(z.string().min(1)),
  confidence: ConfidenceSchema,
  classification: z.literal("ai_inference"),
  provenance: ProvenanceSchema,
});
export type AIInference = z.infer<typeof AIInferenceSchema>;

/**
 * An InvestigativeLead — a suggestion for further investigation,
 * explicitly not a claim of fact at any confidence level
 * (docs/requirements.md §7).
 */
export const InvestigativeLeadSchema = z.object({
  id: z.string().min(1),
  investigationId: z.string().min(1),
  suggestion: z.string().min(1),
  relatedEntityIds: z.array(z.string().min(1)),
  classification: z.literal("investigative_lead"),
  provenance: ProvenanceSchema,
});
export type InvestigativeLead = z.infer<typeof InvestigativeLeadSchema>;
