/**
 * Structural boundary for the six pipeline stages defined in
 * docs/contracts/agent-contracts.md. This file establishes the shared
 * shape every stage module will implement — it intentionally contains
 * no stage logic and no fake/stub agent behavior. Each stage is
 * implemented in a later, dedicated milestone (see
 * docs/implementation-blueprint.md Workstreams B-H).
 */

export const PIPELINE_STAGES = [
  "ingestion",
  "entity_resolution",
  "graph_synthesis",
  "topology_analytics",
  "spatial_temporal_corroboration",
  "investigation_copilot",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export type PipelineStageStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "failed";

/**
 * The contract every pipeline stage module will satisfy: a typed,
 * asynchronous transform from one stage's output to the next, per its
 * corresponding agent contract. No stage is implemented against this
 * interface yet.
 */
export interface PipelineStageModule<TInput, TOutput> {
  readonly stage: PipelineStage;
  run(input: TInput): Promise<TOutput>;
}
