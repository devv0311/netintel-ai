/**
 * Evaluation harness types (Workstream K).
 *
 * Two rules shape everything here, both taken from
 * docs/evaluation/evaluation-spec.md rather than invented:
 *
 *   1. A metric that cannot be computed from the ground truth that
 *      actually exists is reported as `not_implementable_yet` with a
 *      stated reason. It is never approximated, and never quietly
 *      dropped from the report.
 *   2. A threshold is only attached to a metric when the project has
 *      already fixed it elsewhere (docs/requirements.md §8 provenance
 *      completeness, §7/§11 report traceability). Everything else
 *      carries `threshold: null` — measured, reported, and explicitly
 *      un-judged. The evaluator does not invent pass marks.
 */

export type MetricStatus = "measured" | "not_implementable_yet";

/** A single evaluated metric, self-describing enough to audit without the code. */
export interface MetricResult {
  /** Stable machine id, e.g. "er.pairwise.precision". */
  id: string;
  name: string;
  /** Which evaluation-spec category this belongs to. */
  category: string;
  status: MetricStatus;
  /** What the number means, in one sentence. */
  definition: string;
  /** What is being counted on top of the fraction. */
  numeratorDefinition: string;
  /** What is being counted underneath. */
  denominatorDefinition: string;
  numerator: number | null;
  denominator: number | null;
  /** numerator/denominator, or a raw count when unit is "count". */
  value: number | null;
  unit: "ratio" | "count";
  /** Where the reference answer came from. */
  groundTruthSource: string;
  /** Which pipeline output was read. */
  systemInput: string;
  /**
   * Only set when the project already fixed this threshold. `null`
   * means "no threshold has been defined" — not "passed".
   */
  threshold: MetricThreshold | null;
  /** null whenever threshold is null. */
  passed: boolean | null;
  limitations: string[];
  /** Free-form supporting counts and examples for the report. */
  details?: Record<string, unknown>;
}

export interface MetricThreshold {
  value: number;
  comparison: "gte" | "lte" | "eq";
  /** The document that fixed it. Never this file. */
  source: string;
}

export interface EvaluationRunMeta {
  runId: string;
  startedAt: string;
  completedAt: string;
  corpusName: string;
  corpusVersion: string;
  corpusSeed: number;
  groundTruthPath: string;
  databasePath: string;
  gitCommit: string | null;
  nodeVersion: string;
  /** Stage durations in ms, in execution order. */
  pipelineStages: { stage: string; ms: number; detail: string }[];
}

export interface EvaluationReport {
  meta: EvaluationRunMeta;
  metrics: MetricResult[];
  /** Anything that stopped a metric from being computed at all. */
  errors: string[];
  summary: {
    measured: number;
    notImplementableYet: number;
    withThreshold: number;
    thresholdsPassed: number;
    thresholdsFailed: number;
  };
}

/** Helper: build a fully-populated ratio metric. */
export function ratioMetric(
  base: Omit<
    MetricResult,
    "status" | "value" | "unit" | "passed" | "threshold"
  > & { threshold?: MetricThreshold | null },
): MetricResult {
  const { numerator, denominator } = base;
  const value =
    numerator === null || denominator === null || denominator === 0
      ? null
      : numerator / denominator;
  const threshold = base.threshold ?? null;
  let passed: boolean | null = null;
  if (threshold && value !== null) {
    passed =
      threshold.comparison === "gte"
        ? value >= threshold.value
        : threshold.comparison === "lte"
          ? value <= threshold.value
          : value === threshold.value;
  }
  return { ...base, status: "measured", value, unit: "ratio", threshold, passed };
}

/** Helper: build a metric that the current ground truth cannot support. */
export function notImplementableYet(
  base: Pick<
    MetricResult,
    | "id"
    | "name"
    | "category"
    | "definition"
    | "numeratorDefinition"
    | "denominatorDefinition"
    | "groundTruthSource"
    | "systemInput"
  > & { limitations: string[] },
): MetricResult {
  return {
    ...base,
    status: "not_implementable_yet",
    numerator: null,
    denominator: null,
    value: null,
    unit: "ratio",
    threshold: null,
    passed: null,
  };
}

/** Standard precision / recall / F1 from a confusion count. */
export interface PrfCounts {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
}

export function precision(c: PrfCounts): number | null {
  const d = c.truePositives + c.falsePositives;
  return d === 0 ? null : c.truePositives / d;
}

export function recall(c: PrfCounts): number | null {
  const d = c.truePositives + c.falseNegatives;
  return d === 0 ? null : c.truePositives / d;
}

export function f1(c: PrfCounts): number | null {
  const p = precision(c);
  const r = recall(c);
  if (p === null || r === null || p + r === 0) return null;
  return (2 * p * r) / (p + r);
}
